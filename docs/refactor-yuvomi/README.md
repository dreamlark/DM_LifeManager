# DM Life — Yuvomi 架构重构说明

> 分支：`refactor/yuvomi-architecture`
> 目标：把原「TypeScript + React + Vite + Tauri2 单体 + 事件溯源引擎 + 家庭协作双库」彻底重写为
> **单容器、零构建、单用户** 的 Yuvomi 风格实现。

---

## 1. 为什么重构（取舍）

原实现健壮但重：npm workspaces 6 包、tRPC v11、sql.js WASM 引擎、SSE 实时、PGLite 协作库、RBAC、Tauri2 桌面壳。
对「个人自托管 NAS 单用户」场景来说，这些复杂度大部分是负担。

**彻底 Yuvomi 化后的取舍：**

| 维度 | 原实现 | 新实现（Yuvomi） |
|------|--------|------------------|
| 后端 | TS 引擎 + 协作 server（双进程） | 单进程 **Express 5** + **better-sqlite3**（WAL） |
| 前端 | React + Vite（需构建） | **零构建原生 JS**（浏览器直跑，ES Modules） |
| 实时 | SSE 事件流 | 无（单用户，按需刷新） |
| 协作 | 家庭共享 / RBAC 双库 | 放弃（单用户 REST） |
| 溯源 | events 仅追加双写 | 直接 CRUD（简单可靠） |
| 部署 | 多容器 compose | **单容器** + 安装向导 + NAS 一键 |

**保留的核心功能**：每日看板（MIT / 四象限 / 时间块 / 复盘）、财务（债务 / 收入 / 流水 / 资产 / 预算 / 汇总）、灵感记事、提醒钟表铺、领域平衡轮、心流专注。

---

## 2. 目标架构

```
┌─────────────────────────────────────────────────────────┐
│  浏览器（零构建 PWA）                                      │
│  public/  ← index.html + theme-init.js + app.js + …      │
│  modules/<name>/public/page.js  ← 各模块 SPA 页（动态 import）│
└───────────────┬─────────────────────────────────────────┘
                │ 同源 fetch（含 X-CSRF-Token 双提交）
┌───────────────▼─────────────────────────────────────────┐
│  Express 5 单进程（server/）                               │
│  ├─ helmet (CSP) + compression + rate-limit              │
│  ├─ express-session (better-sqlite3 存储) + CSRF 双提交   │
│  ├─ 模块加载器 modules.js（扫描 modules/<name>/index.js）   │
│  ├─ 静态服务 public/ + modules/<name>/public/            │
│  └─ 安装向导 setup.js（首次启动生成 SESSION_SECRET）       │
└───────────────┬─────────────────────────────────────────┘
                │ better-sqlite3（WAL 模式）
┌───────────────▼─────────────────────────────────────────┐
│  SQLite 单库（DB_PATH，默认 ./data/dm-life.db）           │
└─────────────────────────────────────────────────────────┘
```

**模块契约**（`modules/<name>/index.js` 默认导出）：

```js
export default {
  name: 'daily-board',
  nav: { label: '每日看板', icon: 'calendar', path: 'daily-board', order: 10 },
  migrate(db) { /* db.prepare(...).run() */ },
  routes(ctx) {
    // ctx = { db, requireAuth, requireAdmin, apiPrefix }
    ctx.router.get('/tasks', ctx.requireAuth, (req, res) => { ... });
  }
};
```

- `migrate(db)` 在启动时对共享 better-sqlite3 实例执行建表（`IF NOT EXISTS`）。
- `routes(ctx)` 返回 Express Router，挂载于 `/api/v1/<name>`。
- 前端资产放 `modules/<name>/public/`，由加载器以 `/modules/<name>` 静态暴露；
  `page.js` 用 `export default function render(App) { ... }` 作为该模块 SPA 页。

---

## 3. 安全模型

- **helmet CSP**：`script-src 'self'`、`style-src 'self' 'unsafe-inline'`、`img-src 'self' data:`、
  `connect-src 'self'`、`frame-src 'self'`、`object-src 'none'`。
  `index.html` 不含内联 `<script>`（防 FOUC 的 `theme-init.js` 为经典脚本，且不在 CSP 限制内问题范畴）。
- **CSRF 双提交令牌**：每个响应带 `X-CSRF-Token` 头；变更请求（非 GET/HEAD/OPTIONS）须回传相同令牌。
  `api.js` 自动从响应头读取并在下次写请求带回；403 时自动用响应头重同步并重试一次。
- **Session**：`express-session` + `better-sqlite3` 存储；`SESSION_SECRET` 缺失则启动失败（fail-closed），
  或由安装向导首次启动自动生成并写入 `DATA_DIR/.env.auto`。
- **限流**：登录接口 `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_ATTEMPTS`（生产默认 8 次/分钟）。
- **非 root 降权**：Docker 镜像内用 `gosu node` 以非 root 运行（见 `Dockerfile` / `entrypoint.sh`）。

---

## 4. 本地运行

```bash
# 1. 安装依赖（含 better-sqlite3 / bcrypt 原生编译）
npm install

# 2. 配置环境变量（可复制 .env.example → .env）
cp .env.example .env
#   SESSION_SECRET 留空则首次启动由安装向导生成

# 3. 启动
npm start            # 或 npm run dev（--watch 热重载）
#   默认 http://localhost:3000

# 4. 首次访问 → 自动进入安装向导（设置管理员账号 / 应用名）
```

> 注意：本项目在 Windows 开发环境下有两个已知坑已修复：
> 1. `better-sqlite3` 返回属性是 `lastInsertRowid`（不是 `lastInsertRowId`）。
> 2. `modules.js` 动态 `import()` 模块路径必须是 `file://` URL（Windows 裸盘符路径会报
>    `Only URLs with a scheme in: file...`）。已用 `pathToFileURL()` 修正。

---

## 5. 模块清单

| 模块 | 路径 | 功能 |
|------|------|------|
| `daily-board` | `/daily-board` | 每日看板：MIT / 四象限 / 时间块 / 复盘 / 8 领域 |
| `finance` | `/finance` | 债务 / 收入 / 流水 / 资产 / 预算 / 汇总 |
| `notes` | `/notes` | 灵感（idea）/ 笔记本（notebook） |
| `reminders` | `/reminders` | 周期提醒（钟表铺），逾期 / 顺延 |
| `balance` | `/balance` | 8 领域平衡轮（评分 + 雷达图） |
| `focus` | `/focus` | 心流专注记录（时长 / 评分） |

新增模块只需在 `modules/` 下建文件夹实现上述契约，导航与路由自动注册，无需改核心代码。

---

## 6. Docker 部署（NAS 单容器）

```bash
# 构建并启动
docker compose up -d --build
# 默认映射 ${DM_LIFE_PORT:-8080}:3000

# 数据持久化：./data（或 ${DATA_DIR}）挂载到容器内 /data
# 模块热插拔：./modules（或 ${MODULES_DIR}）挂载到容器内 /app/modules
```

- `Dockerfile`：基于 Node 22 精简镜像，`npm ci` + 原生模块编译 + `gosu node` 降权。
- `entrypoint.sh`：首次启动若 `SESSION_SECRET` 为空则自动生成并写入 `/data/.env.auto`。
- 健康检查：`GET /health` 返回 200。

---

## 7. 与原实现的关系

- 本分支**不破坏** `main` / `redesign/streamlined`；是并行的新架构实验。
- 数据模型（任务 / 财务 / 提醒等）语义保持对齐，但存储从「事件溯源 + 协作双库」简化为「单库 CRUD」。
- 若需回退到原 TS 实现，切换分支即可，互不影响。

---

## 8. 冒烟测试结论（本分支验证）

在隔离端口完成端到端验证（setup → login → CSRF 往返 → 各模块读写 → 静态资产）：

- `GET /api/v1/version`、`/api/v1/modules`、`/api/v1/auth/me` 行为正确（未登录正确拒绝）。
- `POST /auth/setup` → 201；`POST /auth/login` → 200；均返回 `csrfToken`。
- `X-CSRF-Token` 双提交：正确令牌 → 200，错误令牌 → 403（符合预期）。
- 6 个模块的所有 GET/写路由均返回 200，数据正确落库（如任务 `domain_key` / `importance` / `urgency` 完整保存）。
- 前端静态资产（含 `/app.js` 经 `text/javascript`、PWA `manifest.webmanifest` / `sw.js`、各模块 `page.js`、图标）均可达且 Content-Type 正确。
- 修复的关键 bug：`auth.js` 的 `lastInsertRowid` 拼写；`modules.js` 的 Windows `file://` 导入路径。
