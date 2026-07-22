# 设计优化 · 第二轮：架构内聚（Architectural Cohesion）

> 目标：根治"复杂度过高"的根源——**双后端、双数据库、双 tRPC 客户端、双实时通道**。
> 把两套系统真正合并为一套，让"个人模式"与"协作模式"只是同一内核上的**能力开关**，而非两套应用。

## 1. 根因分析

当前 `packages/web-collab` 的"统一外壳"只是**表面统一**：
- 个人模式 → `trpcLocal` → `packages/engine`（sql.js，`:14570`）→ SSE `/events`
- 协作模式 → `trpc` → `packages/server`（PGlite，`:4100`）→ WS `/ws`

两套路由、两套数据库、两套实时机制。带来的问题：
1. **数据库双写**：个人数据在 sql.js，协作数据在 PGlite，无法互通；共享功能要靠 bridge 层搬运。
2. **排错面翻倍**：引擎 401、server drizzle 缺包、SSE/WS 不刷新，三个独立故障域。
3. **一致性难保**：同一业务（如"任务"）在两端有不同实现与不同 bug 面。
4. **部署必带 engine**：即便只用协作，也要起 engine；个人模式又必须起 server（家庭共享依赖它）。

## 2. 第二轮方案：单一内核（Core）

### 2.1 合并后端 → `packages/core`（单进程 tRPC）
- 删除 `packages/engine` 与 `packages/server` 的进程边界，合并为 **一个 Node 进程** `packages/core`：
  - 单一 `initTRPC` 实例，挂载原 engine 路由 + 原 server 路由（按前缀区分，如 `/trpc/local`、`/trpc/collab`，或统一到 `/trpc` 由 router 内部按 ctx 分流）。
  - 单一数据库：**收敛到 PGlite**（Postgres 兼容、文件型、可平滑升级真实 Postgres）。
    - 个人模式 = 一个自动创建的"本地家庭"，仅 1 个 owner。
    - 协作模式 = 同一套家庭/成员/RBAC 模型，多人。
  - 单一实时通道：**统一用 WebSocket**；个人模式也走 WS（保留 SSE 作为降级）。删掉 engine 专属的 SSE 双写闭环，统一事件总线 `eventBus` 一份。
- 事件溯源（events 仅追加、双写实体）的既有 ADR 保留，只在单库内实现。

### 2.2 合并前端 → 单一 tRPC 客户端 + 能力开关
- 删除 `trpcLocal` 与双 `TRPCReactProvider`。前端只有 **一个** `trpc` 客户端指向 `/trpc`。
- `useModeStore` 不再决定"连哪个后端"，只决定**当前家庭的能力集**（是否启用成员/邀请/共享）。个人用户看到的就是一个只有自己的家庭。
- 所有业务页面（看板/财务/提醒/记事/脑图/日历/心流/平衡轮/孵化器）**只写一份**，不再区分 local/collab 副本。

### 2.3 部署随之简化
- All-in-One 镜像内只需跑 **1 个 core 进程 + caddy + 静态前端**（原先是 engine+server+frontend+caddy 四个）。
- 端口仍为 8080，零必填配置。

## 3. 迁移策略（增量、可回滚）
为降低风险，按"路由收敛 → 数据迁移 → 删旧"三阶段：
1. **阶段 A（并行）**：core 进程内同时挂 engine 路由（代理到旧 engine 逻辑）与 server 路由；前端先切到单一客户端但按 mode 选前缀。
2. **阶段 B（迁移）**：提供一次性迁移脚本，把个人模式的 sql.js 数据导入 PGlite 本地家庭（已有 `docs/migration-singleuser-to-collab.md` 思路可复用）。
3. **阶段 C（清理）**：删除 `packages/engine`、`trpcLocal`、SSE 专属闭环；完成单库单客户端。

## 4. 本轮收益与遗留

**已解决**：复杂度根因消除——1 进程、1 库、1 客户端、1 实时通道；排错面减半；个人/协作数据天然互通。
**遗留**：
- 首次部署仍需用户面对"HTTP→PIN 卡死""证书"等运维细节。
- 升级/排障仍偏极客（看日志、手动迁移）。

## 5. 判定
- 精简：★★★★（代码与运行实体大幅减少）
- 稳定：★★★★（故障域减半，单库单写路径）
- 高效：★★★★（少了进程间转发与双写）
- 便捷：★★★（部署已简，但运维体验待第三轮补齐）
