# DM_life — 人生管理系统（TypeScript 全新实现 · P0 骨架）

基于 `D:\DMYY\DM_Life` 的 `architecture.md` / `人生管理系统设计文档.md` 规范，**严格遵循文档技术方案**的绿色重写版本。
技术栈：**TypeScript + React + Vite + Tauri 2**（前端框架以 architecture.md 的 React+Vite 为准，否决设计文档里的 Next.js）。
与 `DM_Life/life-manager/`（Python+Vue 旧实现）并行独立，本仓库是全新的 TS 实现。

> 沙箱限制：可运行代码当前落在工作区目录 `D:\software\WorkBuddy\workspace\2026-07-06-21-41-50\dm-life`
> （Bash 只能写工作区）。`D:\DMYY\DM_Life\dm-life` 仅留指针说明，授权后可整体移回。

---

## 技术栈

- **Monorepo**：npm workspaces（`packages/shared` · `packages/engine` · `packages/web` · `apps/desktop`）
- **引擎**（`@dm-life/engine`）：TypeScript + Drizzle ORM + **sql.js（纯 WASM SQLite，无需原生编译）** + tRPC v11（`fetchRequestHandler`）+ SSE
- **前端**（`@dm-life/web`）：React 18 + Vite + Zustand + `@trpc/client` + Tailwind CSS + dnd-kit + lucide-react
- **桌面壳**（`apps/desktop`）：Tauri 2（Rust 骨架，原生构建为延期项）

## 目录结构

```
dm-life/
├── packages/
│   ├── shared/      # 跨包契约：事件信封 / Zod schema / tRPC 初始化
│   ├── engine/      # TS 引擎：数据层 + 事件骨干 + 业务模块 + tRPC/SSE 服务
│   │   └── src/
│   │       ├── db/          # client(sql.js) · schema(Drizzle) · migrate · seed
│   │       ├── eventbus/    # 进程内类型化 EventBus
│   │       ├── events/      # EventStore（仅追加写）
│   │       ├── modules/     # tasks / projects / domains / notes / insights（单一写路径）
│   │       ├── knowledge/   # KnowledgeBackend 端口 + LocalAdapter stub
│   │       ├── router/      # appRouter（tRPC）
│   │       ├── sse/         # SSE 桥（EventBus → EventSource）
│   │       └── index.ts     # 服务入口 @127.0.0.1:14570
│   └── web/         # React 前端：三栏每日看板 + Ctrl/⌘K 命令面板
└── apps/desktop/    # Tauri 2 骨架（未构建）
```

## 运行

```bash
# 1. 安装依赖（仅首次）
cd dm-life && npm install

# 2. 启动引擎（终端 A）
cd packages/engine && npx tsx src/index.ts
#    → http://127.0.0.1:14570  (tRPC: /trpc, SSE: /events)

# 3. 启动前端（终端 B）
npm run dev -w @dm-life/web
#    → http://127.0.0.1:5173  (Vite 已将 /trpc、/events 代理到引擎)
```

## 测试

```bash
npm run test -w @dm-life/engine      # vitest：双写一致性 + 事件驱动（2/2 通过）
```

## 架构闭环（单一写路径 + 事件驱动）

```
前端 tRPC mutation
  → CommandHandler: Zod 校验
    → db.transaction( 追加 events 行 + 更新实体行 )   // 原子双写
    → eventBus.publish(envelope)
  → SSE(/events): event: <Type>\ndata: <envelope>     // 实时推送
  → 前端 Zustand reactiveStore 订阅 SSE → 看板即时刷新
```

- **events 表仅追加**（仓库层无 UPDATE/DELETE），实体表由命令在事务内同步更新 —— 符合 architecture.md 的 ADR-002。
- 前端永不直接写实体，所有变更经由命令 → 事件。

## 已实现（P0）

- ✅ 事件总线 + EventStore（仅追加）
- ✅ 每日看板三栏：左（MIT 1-3 可拖拽 + 8+1 领域条）/ 中（四象限拖拽改重要性·紧急性 + 时间块·番茄钟 stub）/ 右（Ctrl/⌘K 命令面板 + 背包/提醒/记忆 stub）
- ✅ 任务：创建 / 完成 / 四象限重分类 / 排程 / MIT 切换；tasks.today 查询；task_quadrant 视图
- ✅ 领域：8+1 种子（健康/家庭/工作/财富/社交/成长/休闲/心灵/季度聚焦）
- ✅ 项目（PARA 最小）、笔记摄入（KnowledgeBackend stub）、每日复盘卡片（规则引擎 stub）
- ✅ tRPC + SSE 全链路验收通过

## 已知坑（已修复）

1. **better-sqlite3 在 Windows 沙箱无法编译**（缺 MSVC、预编译二进制未下载）→ 已切纯 WASM 的 `sql.js` + `drizzle-orm/sql-js`；client 异步 `initDb()`，`writeTx()` 双写后 `export()` 落盘。
2. **tRPC v11 `fetchRequestHandler` 的 mutation 输入格式**：body 须为「裸 input JSON」`{"title":...}`，**不是** JSON-RPC 包装、也不是 `{"json":{...}}`。GET query 无输入时直接 `/trpc/x.list`。
3. vite dev 默认监听 `localhost`（IPv6 `::1`），curl `127.0.0.1` 连不上 → 已设 `server.host:'127.0.0.1'` + `strictPort:true`。

## 延期项（接口已就位）

- Tauri 原生构建（`tauri dev` / `tauri build`，需 Rust 工具链 + WebView2，沙箱无）
- KnowledgeBackend 真实向量检索（当前为 LocalAdapter stub）
- 压力背包、财务三视图、提醒「钟表铺」等 P1+ 模块
