# DM Life 2.0 — 人生管理系统（Yuvomi 风格重写）

> 分支 `refactor/yuvomi-architecture`：将系统彻底重写为 **单容器 / 零构建 / 单用户** 的 Yuvomi 风格实现。
> 完整架构、模块契约、安全模型与部署细节见 [`docs/refactor-yuvomi/README.md`](docs/refactor-yuvomi/README.md)。

一套自托管的人生管理系统，面向个人 / 家庭 NAS 单用户场景：每日看板（MIT / 四象限 / 时间块 / 复盘）、财务（债务 / 收入 / 流水 / 资产 / 预算 / 净资产）、灵感记事、提醒钟表铺、8 领域平衡轮、心流专注。

## 架构

| 维度 | 实现 |
|------|------|
| 后端 | 单进程 **Express 5** + **better-sqlite3**（WAL 模式） |
| 前端 | **零构建原生 JS**（浏览器直跑 ES Modules，无打包 / 无 transpile）+ PWA |
| 模块 | `modules/<name>/`（后端 `index.js` + 前端 `public/page.js`）drop-in 目录，自动注册导航与路由 |
| 鉴权 | `express-session` + bcrypt，首次启动安装向导生成管理员账户 |
| 安全 | helmet CSP、`X-CSRF-Token` 双提交、登录限流、`SESSION_SECRET` fail-closed、容器内非 root（gosu） |
| 部署 | **单容器** Docker / NAS 一键（`docker-compose.yml`），数据挂载 `./data`，模块热插拔 `./modules` |

> 与旧版（`redesign/streamlined` 分支的 TypeScript + React + tRPC + 事件溯源 + 协作双库）不同：本分支放弃协作 / 实时 / 多用户，换取极致的轻量与可维护性。旧架构代码已不再保留在本分支。

## 模块清单

| 模块 | 路径 | 功能 |
|------|------|------|
| `daily-board` | `/daily-board` | 每日看板：MIT / 四象限 / 时间块 / 复盘 / 8 领域 |
| `finance` | `/finance` | 债务 / 收入 / 流水 / 资产 / 预算 / 汇总（净资产） |
| `notes` | `/notes` | 灵感（idea）/ 笔记本（notebook） |
| `reminders` | `/reminders` | 周期提醒（钟表铺），逾期 / 顺延 |
| `balance` | `/balance` | 8 领域平衡轮（评分 + 雷达图） |
| `focus` | `/focus` | 心流专注记录（时长 / 评分） |

新增模块只需在 `modules/` 下建文件夹实现 [`模块契约`](docs/refactor-yuvomi/README.md#2-目标架构)，导航与路由自动注册，无需改核心代码。

## 本地运行

```bash
npm install                 # 含 better-sqlite3 / bcrypt 原生编译
cp .env.example .env        # SESSION_SECRET 留空则首次启动由安装向导生成
npm start                   # 默认 http://localhost:3000
# 首次访问 → 自动进入安装向导（设置管理员账号 / 应用名）
```

开发热重载：`npm run dev`。自动化冒烟测试：`npm test`（见 `test/smoke.mjs`，自起服务、跑 12 项端到端检查）。

## Docker / NAS 部署（单容器）

```bash
docker compose up -d --build      # 默认映射 ${DM_LIFE_PORT:-8080}:3000
```

- 数据持久化：`./data`（或 `${DATA_DIR}`）挂载到容器内 `/data`。
- 模块热插拔：`./modules`（或 `${MODULES_DIR}`）挂载到容器内 `/app/modules`。
- 健康检查：`GET /health` 返回 200。
- `SESSION_SECRET` 缺失时由 `entrypoint.sh` 自动生成并写入 `/data/.env.auto`。

支持 Unraid / TrueNAS / fnOS / Umbrel 等通用 Docker 主机；镜像基于 Node 22 精简镜像，运行时以非 root 运行。

## 技术栈

`express` · `better-sqlite3` · `express-session` · `bcrypt` · `helmet` · `express-rate-limit` · `compression` · `dotenv` —— 仅此 8 个运行时依赖，无前端构建链。

## License

MIT
