> **分支说明**：当前 `refactor/yuvomi-architecture` 分支已将本系统彻底重写为
> **单容器 / 零构建 / 单用户** 的 Yuvomi 风格实现（Express 5 + better-sqlite3 + 原生 JS PWA）。
> 下文描述的是旧版 TypeScript 架构；新版架构、模块契约与部署见
> [`docs/refactor-yuvomi/README.md`](docs/refactor-yuvomi/README.md)。

# DM_life — 人生管理系统（TypeScript 实现 · 单机 + 家庭协作）

一套自托管的人生管理系统：任务 / 四象限 / 时间块 / 财务 / 提醒 / 灵感 / 家庭共享。
架构遵循 `D:\DMYY\DM_Life` 的 `architecture.md` 规范，采用 **TypeScript + React + Vite** 前端、事件溯源（仅追加）引擎。

> 沙箱限制：当前可运行代码位于工作区 `D:\software\WorkBuddy\workspace\2026-07-06-21-41-50\dm-life`
> （Bash 仅能写工作区）。`D:\DMYY\DM_Life\dm-life` 仅留指针，授权后可整体移回。

---

## 目录

1. [技术栈与架构](#1-技术栈与架构)
2. [本地开发运行](#2-本地开发运行)
3. [测试与质量](#3-测试与质量)
4. [🚀 部署到家庭 NAS（重点）](#4-部署到家庭-nas重点)
   - 4.1 前置条件
   - 4.2 把代码放到 NAS
   - 4.3 配置域名 / 网络（局域网 / Tailscale / 公网域名）
   - 4.4 首次启动
   - 4.5 日常访问（浏览器 + 手机 PWA）
   - 4.6 增量升级（不丢数据）
   - 4.7 备份与回滚
   - 4.8 数据与目录结构
   - 4.9 故障排查
   - 4.10 fnOS 免 git 直接拉镜像（推荐家庭 NAS）
5. [增量升级机制（版本接口 + 横幅）](#5-增量升级机制版本接口--横幅)
6. [金额互转（预留接口状态）](#6-金额互转预留接口状态)
7. [已知坑与注意事项](#7-已知坑与注意事项)
8. [延期项](#8-延期项)

---

## 1. 技术栈与架构

**Monorepo（npm workspaces）**

| 包 | 作用 |
|---|---|
| `packages/shared` | 跨包契约：Zod schema、事件信封类型、feature flags |
| `packages/engine` | 单机引擎：tRPC v11 + Drizzle + **sql.js（纯 WASM SQLite，免编译）** + SSE |
| `packages/server` | 协作后端：tRPC v11 + Drizzle + **PGlite（文件型，免外部数据库）/ 可选真实 Postgres** + WebSocket 实时网关 |
| `packages/web` | 单机前端：React 18 + Vite + Zustand + Tailwind + dnd-kit |
| `packages/web-collab` | 联机前端（Web + 移动 PWA 共用一份静态包） |
| `apps/desktop` | Tauri 2 桌面壳（骨架，原生构建延期） |

**架构闭环（单一写路径 + 事件驱动）**

```
前端 tRPC mutation
  → CommandHandler: Zod 校验
    → db.transaction( 追加 events 行 + 更新实体行 )   // 原子双写
    → eventBus.publish(envelope)
  → SSE(/events): data: <envelope>                  // 实时推送（无名消息，EventSource.onmessage 接收）
  → 前端 store 订阅 SSE → 看板即时刷新
```

- `events` 表**仅追加**，实体表由命令在事务内同步更新（ADR-002）。
- 升级只重建镜像、不动数据卷 —— **升级不影响使用与数据**（见第 4、5 节）。

---

## 2. 本地开发运行

```bash
# 1. 安装依赖（仅首次）
cd dm-life && npm install

# 2. 启动引擎（终端 A）
cd packages/engine && npx tsx src/index.ts
#    → http://127.0.0.1:14570  (tRPC: /trpc, SSE: /events)
#    端口被占用时自动协商到 14571+，并写入 %TEMP%\.dm-life.engine.port

# 3. 单机前端（终端 B）
npm run dev -w @dm-life/web
#    → http://127.0.0.1:5173  (Vite 已代理 /trpc、/events 到引擎)

# 3'. 联机前端（含协作 / 家庭共享）
npm run dev -w @dm-life/web-collab
#    → http://127.0.0.1:5173
```

> 联机前端默认用**相对路径**访问后端（`location.origin/trpc`、`/engine`、`/ws`），
> 因此无论是本机 Vite 代理、还是下面第 4 节的 Caddy 反代，都无需改动任何环境变量。
> 仅当你要把前端指向一个**独立部署**的协作服务时，才需要设 `VITE_SERVER_URL`。

---

## 3. 测试与质量

```bash
npm run test -w @dm-life/engine     # vitest：56/56 通过（双写一致性 / 领域 / 财务 / 转账幂等 / 知识库 / 提醒 / 路由）
npm run test -w @dm-life/server     # vitest：29/29 通过（注册 / 家庭 / 邀请 / RBAC / 版本接口）
npm run build -w @dm-life/web-collab  # vite build 通过（PWA 静态包）
```

类型检查：`tsc --noEmit -p packages/{engine,server,web-collab}/tsconfig.json` 均 0 错误。

---

## 4. 🚀 部署到家庭 NAS（重点）

整套系统已**容器化**，一条命令拉起：引擎 + 协作后端 + 前端（nginx）+ Caddy 反代。数据通过挂载卷持久化，升级只重建镜像、不动数据。

> ⚠️ **多用户远程部署前必做（安全）**：必须为 `server` 设置强随机 `JWT_SECRET`，为 `engine`/`server` 设置一致的 `ENGINE_API_TOKEN`，否则多用户上 NAS 等于裸奔（详见 4.10）。镜像包保持**私有**，禁止翻 Public。

涉及文件（均已就绪）：

```
docker-compose.yml        # 编排：4 个服务（本地构建，适合开发者 / git 部署）
docker-compose.fnos.yml   # 编排：直接拉取 GHCR 预构建镜像（fnOS / 免 git 部署，见 4.10）
Caddyfile                 # 反向代理 + 自动 TLS
.dockerignore
.github/workflows/publish.yml  # 推送 main 时自动构建并发布镜像到 GHCR（包默认私有，禁止翻 Public）
packages/engine/Dockerfile
packages/server/Dockerfile
packages/web-collab/Dockerfile
packages/web-collab/nginx.conf
scripts/nas/backup.sh      # 打包 ./data 增量备份
scripts/nas/upgrade.sh     # 拉源码→备份→重建→滚动重启
```

### 4.1 前置条件

- **NAS 支持 Docker**：群晖 Container Manager / Q威 Container Station / 飞牛 fnOS / 任意装了 Docker 的 Linux 小主机皆可。
- 至少 **约 1 GB 空闲内存 + 几百 MB 磁盘**（数据会随使用增长）。
- （推荐）一个 **Tailscale** 账号 —— 免公网 IP、免路由器端口转发，手机/电脑装了 Tailscale 即可安全访问家里服务。
- （可选）一个**真实域名** + 能改 DNS —— 走标准 Let's Encrypt 证书，最省心。

### 4.2 把代码放到 NAS

有两种放法，按你喜好选：

**方式一 · git 拉仓库（适合会升级、想保留源码）**
```bash
# 在 NAS 的终端 / Container Manager 的终端里
git clone <你的仓库地址> dm-life
cd dm-life
```
升级时一条 `git pull` 即可。对应 `docker-compose.yml`（`docker compose up -d --build` 本地构建）。

**方式二 · 免 git 直接拉镜像（推荐家庭 NAS / fnOS，见 4.10）**
完全不碰源码：镜像已由 GitHub Actions 自动构建并发布到 GHCR（包**默认私有，禁止翻 Public**；私有包用带 `read:packages` 的 PAT 登录即可拉取），你只需在 fnOS 粘贴一份 compose 即可拉取运行，详见 [4.10](#410-fnos--任意-docker-主机免-git-直接拉镜像)。对应 `docker-compose.fnos.yml`。

若方式一不方便建远程仓库，也可把 `dm-life` 整个目录用 File Station / SCP 拷进 NAS 任意持久位置（如 `/volume1/docker/dm-life`）。
**确保该目录在重启后依然存在**（不要放在 `/tmp` 之类临时卷）。

### 4.3 配置域名 / 网络（三选一）

打开 `docker-compose.yml`，找到 `caddy` 服务的环境变量，把 `DOMAIN` 改成你的地址；并编辑 `Caddyfile` 顶部 `email` 改成你的邮箱（仅用于申请证书）。

#### 方案 A · 公网域名（最标准，需能改 DNS）
```yaml
# docker-compose.yml → caddy.environment
- DOMAIN=dm.yourdomain.com
```
```Caddyfile
email you@example.com
```
再把 `dm.yourdomain.com` 的 A 记录指向你家公网 IP，并在路由器转发 **80/443** 到 NAS。
Caddy 会自动申请并续期 Let's Encrypt 证书，访问 `https://dm.yourdomain.com`。

#### 方案 B · Tailscale（推荐家庭 NAS，免公网 IP / 免改路由器）
NAS 和你的每台设备都安装 Tailscale、登录同一账号。把 `DOMAIN` 设为你的 Tailscale 机器名：
```yaml
- DOMAIN=my-nas.ts.net
```
由于 `*.ts.net` 不是公开可签发证书的域名，让 Caddy 用**自签名证书**即可（隧道本身已由 Tailscale 加密）：
在 `Caddyfile` 的站点块内第一行加 `tls internal`：
```Caddyfile
my-nas.ts.net {
  tls internal
  encode zstd gzip
  ...
}
```
访问 `https://my-nas.ts.net`（首次浏览器/手机对自签名证书点一次「继续」即可）。

#### 方案 C · 仅局域网（最简，家人都在同一 WiFi）
不需要证书，直接走 HTTP：
```yaml
# docker-compose.yml → caddy.ports 改为只暴露 80，或映射到别的宿主端口
ports:
  - "8080:80"
```
访问 `http://<NAS 内网 IP>:8080`。
> 注意：PWA「添加到主屏幕」需要 HTTPS。若想手机装成 App，请用方案 B（Tailscale + `tls internal`）。

### 4.4 首次启动

```bash
cd /path/to/dm-life
docker compose up -d --build
```

首次构建会拉取 `node:22-slim` 等基础镜像并 `npm ci` + 前端 `vite build`，约几分钟。
构建完成后：

```bash
docker compose ps          # 四个服务应为 Up（caddy/engine/server/frontend）
docker compose logs -f engine   # 看引擎是否成功监听 14570
```

### 4.5 日常访问

| 设备 | 操作 |
|---|---|
| 电脑浏览器 | 打开 `https://你的域名`（或 `http://NAS的IP`） |
| 手机（iOS/Android） | 浏览器打开同一地址 → 菜单「添加到主屏幕」→ 像原生 App 一样启动（PWA，离线可开） |
| 家庭成员 | 各自设备的浏览器/App 登录同一家庭空间即可共享任务、日历、财务 |

前端的 API 地址是**相对路径**，自动跟随你访问的域名，无需任何配置。

### 4.6 增量升级（不丢数据）

升级只重建镜像，**数据卷 `./data` 完全不动**，因此「升级不影响使用与数据」。

```bash
bash scripts/nas/upgrade.sh
```

该脚本会依次：`git pull`（非 git 仓库则跳过）→ 备份当前 `./data` → `docker compose build` → `docker compose up -d` → 清理旧镜像。
浏览器端也会在检测到后端要求的**最低前端版本**高于当前时，弹出**可关闭的升级提示横幅**（见第 5 节），但不会阻断使用。

### 4.7 备份与回滚

**备份**（保留最近 7 份，可改参数）：
```bash
bash scripts/nas/backup.sh 7        # 产出 backups/dm-life-data-<时间戳>.tar.gz
```

**回滚数据**：解包任一备份覆盖 `./data` 即可：
```bash
tar -xzf backups/dm-life-data-YYYYMMDD-HHMMSS.tar.gz -C ./data
docker compose restart
```

**回滚程序版本**：
```bash
git checkout <旧版本 tag/commit>
docker compose up -d --build
```

### 4.8 数据与目录结构

```
dm-life/
├── data/                      # ⚠️ 持久化数据（备份对象，docker 卷挂载于此）
│   ├── engine/                # sql.js SQLite 数据库文件（单机引擎）
│   └── server/                # PGlite 数据库文件（协作后端）
├── backups/                   # 自动备份包（bash scripts/nas/backup.sh）
├── docker-compose.yml
├── Caddyfile
├── packages/...
└── scripts/nas/{backup,upgrade}.sh
```

`data/` 通过 `docker-compose.yml` 的 `volumes: ./data/engine:/data` 等挂载进容器，
镜像重建、容器删除都不会触碰它。

### 4.9 故障排查

| 现象 | 排查 |
|---|---|
| 页面打不开 | `docker compose ps` 看 `frontend`/`caddy` 是否 Up；`docker compose logs -f caddy` |
| 添加任务无反应 | 引擎健康：`curl http://<域名>/engine/_routes`（应返回路由列表）；日志 `docker compose logs -f engine` |
| 协作功能连不上 | 后端健康：`curl http://<域名>/health`（就绪返回 `200 {status:"ok"}`，预热中返回 `503`）；`docker compose logs -f server` |
| 端口 80/443 被占 | 改 `docker-compose.yml` 里 `caddy.ports` 为 `"8080:80" "8443:443"`，Caddyfile 无需改 |
| 证书报错 | 公网域名检查 DNS/端口转发；Tailscale/局域网改用 `tls internal` |
| 数据疑似丢失 | 确认没误删 `./data` 目录；从 `backups/` 恢复 |

---

### 4.10 fnOS / 任意 Docker 主机：免 git 直接拉镜像

如果你不想在 NAS 上 clone 仓库、也不想现场编译，可以用**预构建镜像**方案：本仓库已配置 GitHub Actions（`.github/workflows/publish.yml`），每次推送 `main` 都会自动把三个服务构建成 Docker 镜像并发布到 **GitHub Container Registry（GHCR）**。你只需在 fnOS 上拉取运行，全程不需要 git、不需要编译。

> 🔒 **安全红线（务必遵守）**
> 1. **GHCR 包保持私有，禁止翻 Public。** 公开包 + 自动拉取 `latest` 是供应链投毒的高危入口——一旦镜像源被攻破，所有部署会无声运行恶意版本。私有包即使被误推，外部也无法匿名拉取。
> 2. **镜像必须钉固到不可变标签 `:sha-<commit>` 或摘要 `:sha-<commit>@sha256:<digest>`，禁止使用 `:latest`。** `:latest` 可被覆盖，回滚/安全全靠不可变标签。
> 3. **必须设置 `JWT_SECRET` 与 `ENGINE_API_TOKEN`**，均为强随机值（如 `openssl rand -base64 48`）。缺失时服务启动即失败（fail-closed）。`ENGINE_API_TOKEN` 在 engine 与 server 必须一致。
> 4. **已移除 watchtower 自动拉取 latest。** 升级改为手动：改代码 → `publish.yml` 推新 `:sha-<commit>` 镜像 → 改 compose 里的 sha 标签 → `docker compose up -d`。

镜像地址（**私有包，请用 PAT 登录拉取；标签钉固到 `:sha-<commit>`**）：

```
ghcr.io/dreamlark/dm-life-engine:sha-<commit>   # 单机引擎（tRPC + sql.js）
ghcr.io/dreamlark/dm-life-server:sha-<commit>   # 协作后端（PGlite / 可选 Postgres）
ghcr.io/dreamlark/dm-life-web:sha-<commit>      # 前端静态站（Web + 移动 PWA）
```

**部署步骤（fnOS「容器」→「项目 / Compose」）**

1. 在 NAS 上新建项目文件夹（如 `docker/dm-life`）。
2. 把本仓库根目录的 **`docker-compose.fnos.yml`** 与 **`Caddyfile`** 两个文件放进该文件夹。
3. 在该文件夹新建 **`.env`** 文件，写入：
   ```
   JWT_SECRET=<openssl rand -base64 48 的输出>
   ENGINE_API_TOKEN=<openssl rand -base64 48 的输出，需与下方一致>
   DOMAIN=你的 Tailscale 机器名或域名
   ```
4. 把 `docker-compose.fnos.yml` 里三个 `image:` 的 `sha-REPLACE_ME` 改成你实际部署的 `:sha-<commit>`（在 GHCR 包页面的标签列表查看）。
5. 创建项目并启动。fnOS 会按 `image:` 直接从 GHCR 拉取三个钉固标签的镜像。

> 只有 `Caddyfile`、`.env` 与 compose 文件需要你手动放到 NAS。其余全是拉取的镜像，没有源码。

**Caddyfile 片段（如未下载，可新建同名文件）**

```Caddyfile
{
  email admin@<你的域名>
}

<你的域名> {
  encode zstd gzip
  handle_path /engine/* {
    reverse_proxy engine:14570
  }
  handle /trpc* {
    reverse_proxy server:4100
  }
  handle /api/* {
    reverse_proxy server:4100
  }
  handle /health* /ready* {
    reverse_proxy server:4100
  }
  handle /ws* {
    reverse_proxy server:4100
  }
  handle {
    reverse_proxy frontend:80
  }
}
```

> Tailscale / 局域网用户：在站点块首行加 `tls internal`（见 4.3 方案 B/C），并把 `<你的域名>` 换成 `my-nas.ts.net` 或改用 HTTP 端口。

**升级**：`publish.yml` 会为每个 commit 推送不可变的 `:sha-<commit>` 镜像。升级时把 compose 里的 sha 标签改成新 commit，执行 `docker compose up -d` 即可；或用 `scripts/nas/upgrade.sh`。**不要**用 watchtower 自动拉取 `latest`。数据卷 `./data` 不参与镜像，安全不变。

**回滚到某个版本**：把 compose 里三个 `image:` 的 `:sha-<commit>` 改成历史某个具体 commit 标签，再重建项目即可。

**若拉取报 401/403**：说明镜像包未公开或未登录。解决方式（拉私有）：
- 在 fnOS「镜像 / 注册表」里登录 `ghcr.io`，用户名=`dreamlark`（或你的协作者账号），密码=带 `read:packages` 作用域的 PAT，再拉取。
- **切勿**把包翻成 Public——公开 + 可变标签是供应链风险，参考上方「安全红线」。

---

## 5. 增量升级机制（版本接口 + 横幅）

为满足「系统预留升级接口，增量升级不影响使用与数据」：

- **协作后端**新增 `GET /api/version`，返回：
  ```json
  { "backend": "x.y.z", "minFrontend": "x.y.z", "schema": 1 }
  ```
  同时 `/health`、`/ready` 响应附带 `schemaVersion`。
- **前端（web-collab）**启动即拉取该接口；仅当后端要求的 `minFrontend` 高于当前前端时才弹出**非致命、可关闭的黄色横幅**提示刷新/升级，**不阻断任何操作**。
- 数据层迁移框架（`BASELINE_DDL` + `MIGRATIONS` + `addColumnIfMissing`）保证旧库在升级后自动补齐新表/新列，向后兼容。

---

## 6. 金额互转（预留接口状态）

P3 已落地**完整的后端契约与写路径**，作为后续「金额互转/转账」功能的预留接口：

- 共享层：`transferCreate/List/Get/Reverse` Zod schema + `TransferView`、事件 `TransferCreated`/`TransferReversed`。
- 引擎表 `finance_transfers`：`amount_minor`（整数分，防浮点误差）+ `idempotency_key`（唯一约束，防重复提交）。
- 单一写路径：`repository`（幂等插入/列表/撤销）→ `command`（`writeTx` 双写事件）→ `appRouter` 注册 `finance.transfers` 子路由，并附转账幂等单测。
- **作用域边界**：当前只记转账事实，**不自动联动资产余额**（手动余额不被静默改写）。
- 通过 `featureFlags.transfer = false` 默认**关闭 UI**，等 P4 灰度开放。

> 即：接口与数据层已就位、测试通过，但前端转账界面尚未开放（P4 待做）。

---

## 7. 已知坑与注意事项

1. **sql.js 免编译**：Windows 沙箱无法编译 better-sqlite3，已切纯 WASM `sql.js` + `drizzle-orm/sql-js`；落盘由引擎 `saveDb()` 保证。容器环境下数据经挂载卷持久化，重启不丢。
2. **tRPC v11 输入格式**：无 transformer 时 batch body 为「裸 input JSON」`{"0":{...}}`，**不是** `{"0":{"json":{...}}}`（那是 v10 格式）。
3. **SSE 必须是无名消息**（`data: ...\n\n`）：带 `event:` 字段时 `EventSource.onmessage` 收不到，表现为「点了没反应」。
4. **引擎端口自动协商**：容器内固定 14570（Caddy 转发 `engine:14570`）；本机开发若被占用会 +1 到 14571+ 并写端口文件。
5. **Docker daemon 不可达的沙箱**：本仓库是在代码层（vitest + tsc + vite build）充分验证的；镜像构建/compose 实测需在你自己的 NAS 上执行 `docker compose up -d --build`（YAML/bash 已通过语法校验）。
6. **`npm ci` 需要 `package-lock.json`**：仓库已包含，切勿在部署前删除。

---

## 8. 延期项

- **P4 转账前端 UI**：把 `transfer` feature flag 翻为 `true` 灰度开放（后端已就绪）。
- **Tauri 原生构建**：`tauri dev` / `tauri build`（需 Rust 工具链 + WebView2）。当前移动端走 PWA 已可用。
- **知识库 embedder 热替换**：可换神经网络模型（transformers.js / 外部 API），检索链路无需改动。
- **仓库移回 `D:\DMYY\DM_Life\dm-life`**（需授权）。
- **M3+**：笔记相册 / 账本可视化 / 离线更深度的 PWA。

---

> 部署出问题？先看第 4.9 节故障排查；仍卡住就把 `docker compose logs -f <服务>` 的输出贴给我。
