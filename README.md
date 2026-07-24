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

## 部署

两条路线：**Docker（推荐，NAS / 服务器）** 与 **裸机直接运行（无 Docker）**。两者数据都落在本地目录，单文件 SQLite（better-sqlite3 WAL），无需外部数据库。

### 方式一：Docker / NAS 单容器（推荐）

**前置条件**：已装 Docker Engine + Docker Compose v2（`docker compose` 子命令可用）。宿主机无需 Node / 编译工具——原生模块在镜像内编译。

**第 1 步 · 取得代码**

```bash
git clone -b refactor/yuvomi-architecture https://github.com/dreamlark/DM_LifeManager.git
cd DM_LifeManager
```

（已在本机有代码则跳过，直接进入下一步。）

**第 2 步 · 配置环境变量（可选但建议）**

```bash
cp .env.example .env
```

`.env` 里最关键是 `SESSION_SECRET`。**留空则首次启动由 `entrypoint.sh` 自动生成并写入容器内的 `/data/.env.auto`**——但这依赖数据卷持久化，若数据卷被清空会重新生成、导致旧会话全部失效。生产建议显式填一个 ≥32 字符的随机串：

```bash
# 生成并写入（一次性）
printf 'SESSION_SECRET=%s\n' "$(head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48)" >> .env
```

**第 3 步 · 启动**

```bash
docker compose up -d --build
```

- 构建一次即可；之后 `docker compose up -d` 不再重建（除非代码变动）。
- 默认宿主机端口 **`8080`** → 容器 `3000`。要改端口：在 shell 里 `export DM_LIFE_PORT=9000` 后再 `up`，或写进 `.env`（compose 会读取同目录 `.env` 做变量插值）。
- 数据挂载：宿主 `./data`（可用 `DATA_DIR` 覆盖）→ 容器 `/data`，内含 `dm-life.db`(+`-wal`/`-shm`) 与 `.env.auto`。
- 模块热插拔：宿主 `./modules`（可用 `MODULES_DIR` 覆盖）→ 容器 `/app/modules`，放自己的 `modules/<name>/` 即生效。
- 运行身份：容器内 `gosu node` 非 root；若 NAS 以特定 UID（如 TrueNAS 的 568）挂载，entrypoint 检测到非 root 会直接启动并沿用该 UID 的目录权限。

**第 4 步 · 验证健康**

```bash
curl -fsS http://localhost:8080/health      # 返回 {"status":"ok",...}
docker compose ps                           # STATE 应为 running/healthy
```

**第 5 步 · 首次安装向导**

浏览器打开 `http://<宿主机IP>:8080`，应用检测到无用户会自动进入安装向导：设置**管理员用户名 / 显示名 / 密码**，提交即建库完成。之后用该账号登录。

> 健康检查 `GET /health` 对 `Accept: text/html` 的请求会放行给 SPA（返回 `index.html`），对普通请求返回 JSON `200`。

### 方式二：裸机 / 直接运行（无 Docker）

适合本地开发或不想用容器的场景。需要 Node ≥ 22，以及原生模块编译工具链（better-sqlite3、bcrypt 要本地编译）：

```bash
# Debian/Ubuntu 编译依赖
sudo apt-get update && sudo apt-get install -y python3 make g++ build-essential

npm install                 # 编译 better-sqlite3 / bcrypt
cp .env.example .env        # SESSION_SECRET 留空则首次启动自动生成
npm start                   # 默认 http://localhost:3000
```

- 开发热重载：`npm run dev`（Node `--watch`）。
- 自动化冒烟测试：`npm test`（自起服务跑端到端检查）。
- 生产裸机：把 `NODE_ENV=production` 设进环境，用进程管理器（systemd / pm2）保活，并把 `PORT` / `DB_PATH` / `DATA_DIR` 指向稳定路径。

### 环境变量一览

| 变量 | 默认值 | 作用 | 在哪设 |
|------|--------|------|--------|
| `PORT` | `3000` | 容器内监听端口 | `.env` / compose `environment` |
| `NODE_ENV` | `production`（compose 强制） | 运行模式 | compose `environment` |
| `DB_PATH` | `/data/dm-life.db` | SQLite 文件路径 | compose `environment`（默认已设） |
| `DATA_DIR` | `/data` | 数据目录 | compose `environment`（默认已设） |
| `SESSION_SECRET` | 空（自动生成） | 会话签名密钥，**≥32 字符**；变更会令所有会话失效 | `.env` |
| `SESSION_SECURE` | `false` | `true`=给 Cookie 打 Secure 标记（**仅 HTTPS 反向代理时设 true**，否则 HTTP 下登录失败） | `.env` |
| `TRUST_PROXY` | `1` | 信任的反向代理跳数（`1`=一层，如 Caddy；多层按实际填） | `.env` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 登录限流窗口 | `.env` |
| `RATE_LIMIT_MAX_ATTEMPTS` | `8` | 窗口内最大登录尝试次数 | `.env` |
| `DM_LIFE_PORT` | `8080` | **宿主机**映射端口（compose 插值变量，非应用变量） | shell / `.env` |
| `DATA_DIR`（compose 层） | `./data` | 宿主数据卷路径（compose 插值变量） | shell / `.env` |
| `MODULES_DIR`（compose 层） | `./modules` | 宿主模块卷路径（compose 插值变量） | shell / `.env` |

> 注意：`docker-compose.yml` 的 `environment:` 会覆盖 `env_file: .env` 中同名键（如 `DB_PATH`、`DATA_DIR`、`NODE_ENV`、`SESSION_SECURE` 已在 compose 内显式给出）。`SESSION_SECRET` 未在此列出，所以**以 `.env` 为准**，留空则由 entrypoint 自动生成。

### 反向代理 + HTTPS（公网 / 域名访问必做）

直接暴露 `:8080` 是明文 HTTP。要上 HTTPS 并绑定域名，在前面加一层反向代理，并把 `SESSION_SECURE` 设为 `true`：

**.env**
```bash
SESSION_SECURE=true
TRUST_PROXY=1
```

**Caddy**（最简单，自动申请证书）
```caddy
dm.example.com {
    reverse_proxy localhost:8080
}
```

**Nginx**
```nginx
server {
    listen 443 ssl;
    server_name dm.example.com;
    # ssl_certificate / ssl_certificate_key ...（或用 certbot）

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # 关键：告知后端原始协议
    }
}
```

**Traefik**：用 `labels` 把 `dm-life` 服务暴露到 `dm.example.com` 的 `websecure` 入口即可，原理同上。

> 若代理后面还套了一层（如 Traefik→Nginx），`TRUST_PROXY` 要填对应的跳数。PWA（可"安装到主屏"）要求 HTTPS，纯 LAN 明文 HTTP 也能正常用，只是无法安装为 App。

### 数据备份与恢复

数据全部在宿主 `./data/`：`dm-life.db`、`dm-life.db-wal`、`dm-life.db-shm`、`.env.auto`。SQLite 用 WAL 模式，**只拷 `.db` 可能丢最近写入**，稳妥做法：

```bash
docker compose stop dm-life                 # 停写，保证一致性
cp -a ./data ./data-backup-$(date +%F)     # 整目录复制（含 wal/shm）
docker compose start dm-life               # 恢复服务
```

恢复时把备份目录整体盖回 `./data` 再 `docker compose up -d` 即可。也可不停机用 `sqlite3 /data/dm-life.db ".backup '/path/backup.db'"` 在线热备。

### 升级

```bash
git pull                                  # 或手动覆盖代码文件
docker compose up -d --build              # 重建镜像，数据卷 ./data 保持不变
```

升级只替换镜像与代码，数据库在 `./data` 持久化、原地复用。**大版本跨架构（如从 `redesign/streamlined` 协作版迁来）不在本分支支持范围**，本分支为全新单用户库。

### 常见问题排查

| 现象 | 原因 / 解决 |
|------|------|
| 浏览器白屏、`#app` 为空 | 前端 JS 解析失败。检查 `public/app.js` 头部块注释未被 `*/` 提前闭合（本分支已修复）；清掉浏览器缓存/Service Worker 重试。 |
| 登录后马上被踢回登录页 | 多半是 **HTTPS 下 `SESSION_SECURE` 仍为 `false`**，Cookie 带不上。设为 `true` 重启。 |
| 端口已被占用 | `export DM_LIFE_PORT=9000` 后重新 `up`。 |
| `./data` 权限报错 | 宿主目录属主与容器内 `node`(UID 1000) 不符。以 root 启动 entrypoint 会自动 `chown`；TrueNAS 等固定 UID 场景确保挂载目录对该 UID 可写。 |
| 改了 `SESSION_SECRET` 后全员掉线 | 正常——密钥变更令所有会话签名失效，重新登录即可。 |
| 安装向导不出现 / 一直显示向导 | 看 `GET /api/v1/version` 的 `setup_required`；前者多为 Cookie 脏数据，清 Cookie 重试；后者说明 `users` 表为空，正常走安装。 |

支持 Unraid / TrueNAS / fnOS / Umbrel 等通用 Docker 主机；镜像基于 Node 22 精简镜像，运行时以非 root 运行。

## 技术栈

`express` · `better-sqlite3` · `express-session` · `bcrypt` · `helmet` · `express-rate-limit` · `compression` · `dotenv` —— 仅此 8 个运行时依赖，无前端构建链。

## License

MIT
