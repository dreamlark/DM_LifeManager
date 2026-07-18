# dm-life 增量升级 + 家庭 NAS 部署方案

> 目标：①系统预留升级接口，支持**增量升级（零停机、数据零丢失、旧前端兼容）**；②后端部署在**家庭 NAS**，前端运行在 **Web + 移动（PWA）** 各自平台；③架构**预留「金额互转/转账」接口**，融入现有事件溯源闭环，不影响现有功能与数据。

---

## 0. 目标与硬约束

| 维度 | 要求 |
|------|------|
| 升级 | 增量、不停机、数据零丢失、旧前端可继续用 |
| 后端 | 家庭 NAS（Docker 容器，统一出入口） |
| 前端 | Web（浏览器）+ 移动（PWA 主屏可装）各自独立更新 |
| 金额 | 预留 transfer 接口：整数分存储、事务原子、幂等、不破坏现有财务 |
| 安全 | 不裸奔暴露端口；传输 TLS；最小暴露面 |

---

## 1. 现状盘点（代码已确认）

- **部署文件**：项目根**仅有** `start-dm-life.bat`（Windows 专用），**无 Dockerfile / compose / 任何部署脚本** → 部署为全新设计。
- **健康门控基础已具备**：`packages/server/src/http-server.ts` 已有 `/health` + `/ready`，PGlite 冷启动（~30s）期间返回 **503**，就绪后 **200**。可直接用作滚动升级的门控信号。
- **架构**：`engine`（tRPC v11 + Drizzle + sql.js WASM SQLite，端口 14570–14579 自动协商，`DM_LIFE_DATA_DIR`） + `server`（协作，PGlite） + `web-collab`（Vite :5173） + `shared`（Zod 契约）。
- **财务现状**：债务 / 收入 / 流水 / 资产 + summary + budget（已落地，P1 完成）。
- **事件溯源闭环（ADR，写路径单一）**：tRPC mutation → `CommandHandler`（Zod 校验 → `writeTx` 事务**双写 events + 实体** → `eventBus.publish`）→ SSE `/events` → 前端 Zustand 刷新。

---

## 2. 总体架构拓扑（文字图）

```
                  家庭 NAS（Docker Compose 统一管理）
  ┌──────────────────────────────────────────────────────────┐
  │  Caddy 反向代理 + 自动 TLS                                  │
  │     │  /trpc /ws /health /api/*  → server:4100            │
  │     │  /engine/*                  → engine:14570           │
  │     │  /                           → 静态前端（web 构建物） │
  │  ┌────────────┐  ┌────────────┐  ┌─────────────────────┐ │
  │  │  engine    │  │  server    │  │  frontend (static)  │ │
  │  │ sql.js     │  │ PGlite     │  │  Web + 移动 PWA     │ │
  │  │ :14570     │  │ :4100      │  │  manifest + SW      │ │
  │  └─────┬──────┘  └─────┬──────┘  └─────────┬──────────┘ │
  │        │ 持久卷 /data/engine/.data              │            │
  │        │ 持久卷 /data/server/.collab-data        │            │
  └────────┼───────────────────┼──────────────────┼────────────┘
            │                   │                  │
       (可选 Watchtower       (restic 备份       (Tailscale / Cloudflare
        自动拉新镜像)          到二盘/云)           Tunnel 外网访问)
            │
   ┌────────┴─────────┐
   Web 浏览器         移动端 PWA（主屏安装，SW 离线 + 后台静默更新）
```

---

## 3. 增量升级机制（核心）

### 3.1 版本协商（前后端解耦升级）
- 新增 `GET /api/version` 返回：
  ```json
  { "backend": "1.4.2", "minFrontend": "1.3.0", "schema": 12 }
  ```
- 前端启动时拉 `/api/version`：
  - `minFrontend > 当前版本` → **非致命**「可升级」横幅（不崩溃、不阻断使用）。
  - `schema` 超出兼容范围 → 明确提示「请先升级后端/前端」，避免静默数据错乱。
- tRPC 路由按命名空间 `v1` / `v2` 并存；过渡期内旧前端继续走 `v1`，新前端走 `v2`，后端同时服务。

### 3.2 Schema 迁移：additive-only（向后兼容）
- 采用 **Drizzle Kit 迁移**，演进规则：
  - **只加列/表**，新列 `NULL` 或带默认值；**不删、不改类型、不重命名**单步完成。
  - 破坏性变更走**双版本过渡**：先双写（旧+新字段），读时带 fallback，下一版本再清理旧字段。
- `transfer`（互转）即按此规则新增 `financeTransfers` 表，完全不动现有 `债务/收入/流水/资产` 表。

### 3.3 后端滚动升级（健康门控，零停机）
- Compose 中 server/engine 均配 `healthcheck`（轮询 `/health`，503 视为未就绪）。
- 升级流程：`docker compose pull` 新镜像 → 新容器起 → `/health` 仍 503 直到 PGlite 预热完成 → 变为 200 → **反向代理才切流** → 旧容器保留观察，确认无异常后再 `stop`。
- 因 `/health` 已天然实现 503→200，无需额外改造即可获得门控。

### 3.4 前端增量更新（Web + 移动统一）
- **Web**：构建物为静态文件，由 Caddy 直接托管；叠加 **Service Worker**（离线优先 + 后台静默更新，刷新即新）。
- **移动**：同一份静态包 + `manifest.json` + SW = **PWA**，可「添加到主屏幕」，离线可用、更新无感。
- 前端各自更新，**不依赖 NAS 升级节奏**；版本不兼容时按 3.1 提示而非白屏。

### 3.5 数据零丢失与回滚
- 升级前**自动快照**：`/data/engine/.data` + `/data/server/.collab-data`（NAS 卷快照或 `restic`/`cp -r` 到备份卷）。
- 迁移在快照之后、于**单事务**内执行；失败自动回滚到上一镜像 + 恢复快照。
- 回滚为**受保护操作**（见 7 节 `/admin/upgrade`）。

---

## 4. 家庭 NAS 部署

### 4.1 容器化（草案）

`packages/engine/Dockerfile`（略，基于 `node:22-slim`，启动 `tsx src/index.ts`，挂载 `/data`）：
```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV DM_LIFE_DATA_DIR=/data/engine/.data PORT=14570
EXPOSE 14570
CMD ["node", "packages/engine/dist/index.js"]
```
`packages/server/Dockerfile` 同理（PGlite 冷启动 ~30s，compose `healthcheck` 给足宽限）。

根目录 `docker-compose.yml`（草案）：
```yaml
services:
  engine:
    build: ./packages/engine
    volumes: ["./data/engine:/data/engine"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:14570/_routes"]
      interval: 10s
  server:
    build: ./packages/server
    volumes: ["./data/server:/data/server"]
    environment: [ "CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR=", "CODEBUDDY_TOOL_CALL_ID=" ]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:4100/health"]
      interval: 10s
      start_period: 60s      # PGlite 冷启动宽限
  caddy:
    image: caddy:2
    ports: ["443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile", "./data/frontend:/srv", "caddy_data:/data"]
  watchtower:
    image: containrrr/watchtower
    volumes: ["/var/run/docker.sock:/var/run/docker.sock"]
    command: "--interval 86400 --cleanup"
volumes: { caddy_data: {} }
```
> 注意：部分 NAS（如群晖 ARM 机型）需 **arm64** 镜像；构建时 `--platform linux/arm64` 或统一在 NAS 本机 build。

### 4.2 网络与 HTTPS（不裸奔）
- **内网**：NAS 局域网 IP + 域名（DDNS，如 `dm.example.com`）。
- **外网**：优先 **Tailscale**（零配置 mesh VPN，家人设备装客户端即直连，无需端口转发）；备选 Cloudflare Tunnel。
- **TLS**：Caddy 自动申请/续期证书，全链路 HTTPS；前端静态也走 443。

### 4.3 数据卷与备份
- 所有可变数据挂到 NAS 持久卷 `./data`（engine `.data` + server `.collab-data` + frontend 静态）。
- **备份**：`restic` 定时（每日）备份 `./data` 到第二块盘 / 云；保留 7–30 天快照。
- **引擎坑预警**：sql.js 必须用**真实绝对路径**（`DM_LIFE_DATA_DIR=/data/engine/.data`，Linux 路径），否则回退内存 + 落盘卡死（沿用既有坑 #8）。

### 4.4 资源
- PGlite 与 sql.js（WASM）均吃内存，NAS 建议 ≥ 2–4GB 可用内存给容器；冷启动 30s 内别判死（沿用坑 #3）。

---

## 5. 前端跨平台（Web + 移动）

| 平台 | 形态 | 更新方式 | 说明 |
|------|------|----------|------|
| Web | 浏览器访问 `https://dm.example.com` | 静态重部署 + SW 缓存 | 已支持 light/dark、响应式 |
| 移动 | **PWA**（主屏安装，离线 + 静默更新） | 同 Web 静态包 | 复用现有响应式 UI，零额外成本 |
| 移动（备选） | Tauri Mobile（Android/iOS 原生壳包 WebView） | 应用商店 / Tauri updater | 若需原生能力（通知/生物锁）再上，前期不阻塞 |

- 推荐**先 PWA**：一份静态构建同时满足 Web 与移动，增量更新成本最低，符合「各自平台独立更新、不依赖 NAS」。
- 现有 `apps/desktop`（Tauri2）继续服务桌面用户，与 NAS 部署互不冲突。

---

## 6. 金额互转预留接口（transfer）

> 设计原则：**现在就把「槽位」和「契约」铺好，但 UI 暂不暴露**，后续填肉不破坏、不迁移。

### 6.1 数据模型（整数分，杜绝浮点误差）
```ts
// packages/engine/src/db/schema.ts（新增，additive）
export const financeTransfers = pgTable('finance_transfers', {
  id: text('id').primaryKey(),
  fromAccount: text('from_account').notNull(), // 资产/账户 id
  toAccount: text('to_account').notNull(),
  amountMinor: integer('amount_minor').notNull(), // 整数「分」，绝不存浮点
  currency: text('currency').notNull().default('CNY'),
  note: text('note'),
  status: text('status').notNull().default('done'), // done | reversed
  idempotencyKey: text('idempotency_key').notNull().unique(), // 幂等
  createdAt: text('created_at').notNull(),
});
```

### 6.2 tRPC 路由 + Zod 契约（`packages/shared`）
```ts
// packages/shared/src/finance.ts（新增 transfer 段）
export const transferCreate = z.object({
  fromAccount: z.string(), toAccount: z.string(),
  amountMinor: z.number().int().positive(),
  currency: z.string().default('CNY'), note: z.string().optional(),
  idempotencyKey: z.string(), // 前端生成 UUID，重试安全
});
export const transferRouter = { create: transferCreate, list: z.object({}), get: z.object({ id: z.string() }) };
```

### 6.3 融入事件溯源闭环（与现有一致）
- `transfer.create` 走既有 `CommandHandler` → `writeTx` **单事务双写** `events` + `financeTransfers`（借记 from、贷记 to 同事务原子）→ `eventBus.publish` → SSE → 前端财务看板刷新。
- 完全复用 ADR 的「写路径单一」约束，不另开写通道。

### 6.4 幂等 + 不破坏现有
- `idempotencyKey` 唯一约束 → 重试/升级重发不会导致重复转账（直接命中已存在记录）。
- `amountMinor` 整数分 → 避免 `0.1+0.2` 类浮点错乱；展示层 `/100` 格式化。
- 现有债务/收入/流水/资产**表结构与接口零改动**，transfer 是纯增量。

### 6.5 落地方式（feature flag）
- 后端：路由 + schema + handler 实现并随迁移建表，但 `shared` 配置里 `featureFlags.transfer = false` 时不向旧前端暴露菜单。
- 前端：组件先写好但 `if (!flags.transfer) return null`，后续开 flag 即上线，无需改库。

---

## 7. 升级接口预留清单

| 接口 / 信号 | 用途 | 状态 |
|-------------|------|------|
| `GET /api/version` | 返回 backend / minFrontend / schema 版本 | **待新增** |
| `GET /health` `/ready` | 503→200 健康门控（PGlite 冷启动） | ✅ 已有，扩 `schemaVersion` 字段 |
| `POST /admin/upgrade` | 鉴权后触发迁移 / 回滚（先快照） | **待新增**（仅管理员） |
| `GET /api/changelog` | 升级说明（可选） | 可选 |
| 前端启动兼容校验 | 拉 version，非致命横幅 / 阻断提示 | **待新增** |

---

## 8. 备份 / 回滚脚本草案（放 `scripts/nas/`）

- `backup.sh`：快照 `./data`（restic 或 `cp -r` 到 `./backup/$(date +%F)`）。
- `upgrade.sh`：`pull` 新镜像 → 等 `/health` 200 → 切流 → 旧容器保留 → 跑回归冒烟 → 异常则回滚镜像 + 恢复快照。
- 升级后**自动冒烟**：复用现有 `vitest`（engine 52 / server 28）+ Playwright `smoke-ui*.cjs`，确保「升级不影响使用」。

---

## 9. 分阶段落地建议

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **P0** | 容器化：engine/server Dockerfile + compose + Caddy + 数据卷 | 无（先在本机 Docker 跑通） |
| **P1** | 升级接口：`/api/version` + 前端兼容校验横幅 + `/health` 扩 schemaVersion | P0 |
| **P2** | 迁移框架（Drizzle）+ `backup.sh`/`upgrade.sh` + 健康门控滚动升级 | P0 |
| **P3** | 预留 `transfer`：schema + Zod + 路由 + handler + feature flag（无 UI） | P1 |
| **P4**（后续） | transfer UI + Tauri Mobile（如需原生） | P3 |

---

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| PGlite 冷启动 ~30s 被误判死 | compose `start_period: 60s` + `/health` 503 门控 |
| sql.js 路径回退内存卡死（坑 #8） | `DM_LIFE_DATA_DIR` 传真实 Linux 绝对路径 |
| 升级并发孤儿进程（坑 #1） | compose 托管进程树，单入口 `http-server.ts`，端口固定 |
| 金额浮点误差 | 一律整数分 `amountMinor` |
| 转账重复执行 | `idempotencyKey` 唯一约束 |
| NAS 断电丢写 | restic 定时备份 + 事务写 |
| 架构不兼容导致静默错乱 | `/api/version` 显式校验 + 非致命提示 |

---

## 11. 建议的下一步（待你拍板后我可直接动手）

1. **是否现在脚手架部署文件**：`packages/engine/Dockerfile`、`packages/server/Dockerfile`、`docker-compose.yml`、`Caddyfile`、`scripts/nas/backup.sh`、`scripts/nas/upgrade.sh`，并在本机 Docker 跑通（若环境允许）。
2. **是否现在实现 transfer 预留骨架**：schema + Zod + 路由 + handler + feature flag（无 UI，纯后台契约，零风险）。
3. **NAS 具体型号**：群晖 / 威联通 / Unraid / TrueNAS？决定是否要 arm64 构建与 GUI 部署要点。

> 先出方案与建议，未动代码；按你确认的范围再进入实现，并沿用既有回归用例（vitest + Playwright smoke）做「升级不影响使用」验证。
