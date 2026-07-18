# 单机版功能迁移至联机版 · 对比与实施方案

> 目标：在**联机版前端（`packages/web-collab`）**现有界面风格基础上，整合**单机版（`packages/web`）**的全部功能；
> 单机版代码**不做任何改动**（仅作为复制源），迁移后功能逻辑与原单机版保持一致。
> 架构决策（用户 2026-07-13 确认）：**统一单体应用** —— 联机版成为统一外壳，新增「个人 / 协作」模式切换。

## 一、功能差异对比（逐步对比）

| 维度 | 单机版 `packages/web` | 联机版 `packages/web-collab`（现状） | 单机独有的功能（需迁移） |
|---|---|---|---|
| 数据后端 | `packages/engine`（sql.js 本地 SQLite，`:14570`） | `packages/server`（PGLite + tRPC + WS，`:4100`） | 全部单机业务数据 |
| 实时机制 | SSE `/events` 失效刷新 | WebSocket `/ws` 实时网关 | SSE 失效刷新闭环 |
| 每日看板 | ✅ MIT / 四象限 / 时间块 / 复盘（三栏 + dnd） | ❌ 仅有「共享任务」看板（认领/指派/轮换） | ✅ 每日看板（P0） |
| 财务 | ✅ 债务/收入/流水/资产 + 汇总/进度/建议 | ❌ | ✅ 财务（P1） |
| 提醒钟表铺 | ✅ 周期事务钟 + 响铃/逾期 | ❌ | ✅ 提醒（P1） |
| 灵感·记事 | ✅ notes + 关联记忆（向量检索） | ❌ | ✅ 记事（P1） |
| 脑图 | ✅ MindMap | ❌ | ✅ 脑图（P1） |
| 日历 | ✅ 任务日历视图（`trpc.tasks.all`） | ⚠️ 有「共享日历」事件（不同实体） | ✅ 单机任务日历视图 |
| 心流 | ✅ 专注会话仪表盘 | ❌ | ✅ 心流（P1） |
| 平衡轮 | ✅ 8+1 领域平衡轮 | ❌ | ✅ 领域平衡轮（P1） |
| 孵化器 | ✅ 灵感孵化器（interests） | ❌ | ✅ 孵化器（P1） |
| 领域 | ✅ 8+1 领域（筛选/聚合） | ❌ | ✅ 领域 |
| 命令面板 | ✅ Cmd+K 全局命令 | ❌ | ✅ 命令面板 |
| 主题 | ✅ 浅/深（uiStore + localStorage） | ✅ 浅/深（ThemeToggle） | 复用联机版机制 |
| 账户/家庭 | ❌ 无登录 | ✅ 注册/登录/家庭/RBAC/邀请/在线 | —（保留） |
| 共享任务 | ❌ | ✅ 认领/指派/轮换/日历事件 | —（保留） |

**结论**：单机版独有约 9 大功能模块（看板/财务/提醒/记事/脑图/日历/心流/平衡轮/孵化器）+ 领域 + 命令面板 +
SSE 失效闭环 + uiStore 主题，全部需迁移；联机版的账户/家庭/共享任务/实时网关**原样保留**。

## 二、迁移架构方案（统一单体 + 双客户端）

```
┌─────────────────────────── web-collab（统一外壳）──────────────────────────┐
│ 顶栏：模式切换 [个人 | 协作]  · 主题 · 退出                                   │
│                                                                              │
│ ┌─ mode==='local'（个人模式）──────────────────────────────────────────┐   │
│ │ LocalApp（复制自 packages/web App，逻辑 1:1）                          │   │
│ │   trpcLocal ──/engine/trpc──▶ packages/engine(:14570)  [sql.js]        │   │
│ │   SSE /engine/events ─▶ 失效刷新                                        │   │
│ │   9 大功能 Tab（看板/财务/提醒/记事/脑图/日历/心流/平衡轮/孵化器）       │   │
│ └────────────────────────────────────────────────────────────────────┘   │
│ ┌─ mode==='collab'（协作模式）──────────────────────────────────────────┐   │
│ │ 现有协作外壳（AuthScreen/FamilyBoard/TaskBoard/共享日历…）             │   │
│ │   trpc ──/trpc──▶ packages/server(:4100)  [PGLite+WS]                  │   │
│ └────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
```

**关键技术决策**
1. **双 tRPC 客户端**：`trpc`（联机，指向 server）+ `trpcLocal`（个人，指向 engine），
   各自独立 `TRPCReactProvider` + `QueryClient`。复制的组件把 `import ... from '.../trpc'` 改为 `trpcLocal` 即可，**逻辑零改动**。
2. **引擎路由代理**：vite 新增 `'/engine'` 代理到 `127.0.0.1:14570`（rewrite 掉 `/engine` 前缀），
   `trpcLocal` 用 `/engine/trpc`，SSE 用 `/engine/events`。个人模式需先 `npm run dev:engine`。
3. **样式桥接（重要）**：两 app 的 `--accent` 等语义相反（联机=hex，单机=Tailwind RGB 三元组）。
   为不破坏联机版现有样式，单机 Tailwind 令牌**改名为 `--lc-*` 前缀**（`--lc-bg-base`/`--lc-accent`/…），
   Tailwind config 同步改引用；复制组件类名不变（`text-accent` 仍映射到 `rgb(var(--lc-accent)/<alpha>)`），互不冲突。
4. **主题**：复制 `uiStore`（个人模式用），与联机 `ThemeToggle` 共用 `.dark` 类机制，互不影响。
5. **依赖**：所有库（tailwindcss/@trpc/react-query/sonner/@dnd-kit/core/lucide-react/@dm-life/engine 类型…）
   已在 workspace 根 `node_modules` 提升（hoisted），**无需 npm install**，仅需在 web-collab `package.json` 补声明。

## 三、逐步迁移顺序（逐一迁移 + 每步验证）

- P0 基础：Tailwind 桥接 + `trpcLocal`/`sseLocal` + `modeStore` + vite 代理 + 模式切换外壳 ✅（本步）
- **① 每日看板**（board：LeftColumn/CenterColumn/RightColumn/TaskCard/TaskDetailDialog + CommandPalette + uiStore + sound）→ 本步落地
- ② 财务（FinancePage + 模态）
- ③ 提醒（ReminderShopPage + useReminderAlarm + 响铃）
- ④ 灵感·记事（NotesHubPage + 关联记忆面板）
- ⑤ 心流（FlowPage）
- ⑥ 脑图（MindMapPage）
- ⑦ 日历（单机任务日历视图，复用 `trpc.tasks.all`）
- ⑧ 平衡轮（DomainBalancePage）
- ⑨ 孵化器（IncubatorPage / interests）
- ⑩ 领域筛选接入各 Tab（uiStore.activeDomain）

每步：复制源文件 → 改写 `trpc`→`trpcLocal` → `tsc --noEmit` → `vite build` → 记入日志。

## 四、回归基线（迁移中持续守护）
- 单机版引擎：vitest **41/41**（不动）
- 联机版 server：vitest **29/29**（不动）
- web-collab：`tsc --noEmit` 0 error + `vite build` 通过（每步校验）
