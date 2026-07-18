# 变更记录（CHANGELOG）

本文档记录 DM_life 各版本的实质变更。最新一次提交为「家庭 NAS 容器化部署 + 增量升级接口 + 金额互转预留契约」。

---

## 2026-07-18 · 容器化部署 / 增量升级 / 金额互转预留（本次上传）

### 新增 · 部署（P0）
- 全套容器化编排，一条命令拉起：`docker-compose.yml`（engine + server + frontend + Caddy + watchtower）。
- 三份 `Dockerfile`：`packages/engine`、`packages/server`、`packages/web-collab`（前端多阶段构建 → nginx 静态托管）。
- `Caddyfile`：反向代理 + 自动 TLS（剥离 `/engine` 前缀转引擎，其余 `/trpc` `/api` `/health` `/ws` 转协作后端）。
- `packages/web-collab/nginx.conf`：SPA 回退 + 资源长缓存。
- `.dockerignore`：排除依赖/构建产物/运行时数据，镜像安全精简。
- `scripts/nas/backup.sh`：打包 `./data` 增量备份（保留最近 N 份）。
- `scripts/nas/upgrade.sh`：拉源码 → 备份 → 重建镜像 → 滚动重启（数据卷不动）。

### 新增 · 增量升级接口（P1）
- 协作后端 `GET /api/version` 返回 `{ backend, minFrontend, schema }`；`/health`、`/ready` 响应附带 `schemaVersion`。
- 前端（web-collab）启动版本校验，**非致命可关闭横幅**：仅当后端要求的最低前端版本高于当前时提示升级，不阻断使用。

### 新增 · 金额互转预留契约（P3）
- 共享层：`transferCreate/List/Get/Reverse` Zod schema + `TransferView`、事件 `TransferCreated`/`TransferReversed`、`featureFlags`（默认 `transfer:false`）。
- 引擎表 `finance_transfers`：`amount_minor`（整数分防浮点）+ `idempotency_key`（唯一约束防重复）。
- 单一写路径：`repository`（幂等插入/列表/撤销）→ `command`（`writeTx` 双写）→ `appRouter` 注册 `finance.transfers` 子路由，含转账幂等单测。
- 作用域边界：仅记转账事实，不自动联动资产余额（手动余额不被静默改写）。

### 新增 · 协作能力（M2，独立包）
- `packages/server`：tRPC v11 + Drizzle + PGLite（文件型，免外部库）/ 可选真实 Postgres；注册/家庭/邀请/RBAC；WebSocket 实时网关。
- `packages/web-collab`：浅深主题、RBAC 成员卡、邀请/家庭、共享任务（认领/指派/轮换）、共享日历；Web + 移动 PWA 共用。

### 文档
- 重写 `README.md`：详细「部署到家庭 NAS」章节（前置条件 / 三种网络方案 / 首次启动 / 日常访问 / 增量升级 / 备份回滚 / 故障排查）。
- 新增 `DEPLOY-UPGRADE-PLAN.md`：分阶段部署与升级方案（P0–P4）。

### 验证
- engine vitest **56/56**（原 52 → +4 转账幂等）、server vitest **29/29**（原 28 → +1 版本接口）。
- engine / server / web-collab `tsc --noEmit` 全 0 错误；web-collab `vite build` 通过。
- 顺手修复一处既存严格类型问题（`index.ts` `split('?')[0]` 缺 `?? '/'`）。

---

## 2026-07-16 · 第 8 轮收尾 + 修复（已含于本版）

- 主题唯一真相收敛到 `uiStore.theme`（dark/light/system）+ `applyTheme`，浅色对比度修复走主题感知变量。
- 字号 `FontScale`（small/standard/large/xlarge）+ `applyFontScale`，`data-font-scale` 驱动 rem 缩放。
- 模式开关与协作 UI 门控解耦：`useModeStore` 只决定「是否显示协作入口」，不再触发登录跳转。
- PIN 锁屏有效期（`expiresAt` 1d/7d/30d/90d/1y/永久）+ 自动解锁。
- 启动编排：engine+server+web 后台并行，仅门控浏览器打开；UI 出现降到数秒级。
- 共享快照刷新防卡顿：`scheduleReload`（去抖 + 并发哨兵 + AbortController）+ 按 `module` 精准刷新。
- 详见 `ROUND8-VERIFICATION.md`、`FIXES_2026-07-16.md`、`M2-*.md`。

## 2026-07-15 · 第 7 轮（已含于本版）

- 修复「添加任务提示成功但不显示」（`boardDate` 旧日期根因）、`CommandPalette` 用 `boardDate` 创建任务。
- 修复 react-query `useMutation` 引用不稳定导致无限 refetch 风暴（用 `useRef` 守卫）。
- 详见 `ROUND7-VERIFICATION.md`。

## 2026-07-11 · 首次归档（基线）

- 单机版 dm-life：看板 / 财务 / 提醒 / 灵感 / 月历 / 任务详情。
- 事件溯源（仅追加）+ 单一写路径（ADR-002）。
- 详见 `OVERVIEW.md`。
