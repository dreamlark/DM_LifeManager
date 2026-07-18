# M2 共享日历 + 单机版财务模块 —— 交付总览

> 联机版「共享日历」协作核心模块 + 单机版「财务模块」对齐收尾，均已完整实现并通过验证。

## 一、共享日历（联机版 `@dm-life/server` + `@dm-life/web-collab`）

### 能力
- **创建 / 编辑 / 删除**家庭日历事件（标题、地点、起止时间、全天、备注）。
- **多人实时同步**：任一成员增删改事件，经 WebSocket 网关即时广播给同家庭在线成员，前端 `onBoardEvent` 订阅刷新，**无需手动 reload**。
- **权限管理（RBAC）**：
  - `createEvent`：owner / admin / member / child 可创建。
  - `editEvent`：owner / admin / member 可改他人事件；**创建人可改自己创建的事件**（bypass）。
  - 删除：创建人 / owner / admin 可删；成员删他人事件 `FORBIDDEN`。
  - guest 无任何写权限。
- 月视图网格（周一起点）、点击空白格建事件、点击 chip 编辑、今天高亮、稳定 Zustand 选择器（避免无限渲染）。

### 分层实现
| 层 | 文件 | 要点 |
|---|---|---|
| Schema | `packages/server/src/db/schema.ts` | `calendarEvents` 表（familyId / title / startAt / endAt / allDay / createdBy / version），双索引 |
| 类型 | `packages/server/src/types.ts` | `CalendarEvent` 接口 |
| 权限 | `packages/server/src/rbac.ts` | `createEvent` / `editEvent` 加入权限矩阵 |
| 存储 | `packages/server/src/store.ts` | CRUD + `toCalendarEvent` mapper + `reset()` |
| 事件 | `packages/server/src/realtime/eventBus.ts` | `calendar.created / updated / deleted` |
| DDL | `packages/server/src/db/ensure.ts` | 建表 + 索引 |
| 路由 | `packages/server/src/router.ts` | `calendarEvents.list/create/update/remove`，写后 `publishEvent` |
| 前端页 | `packages/web-collab/src/components/CalendarPage.tsx` | 月视图 + `EventModal` + 实时订阅 + 权限门控 |
| 入口 | `packages/web-collab/src/App.tsx` | 「日历」tab |
| 推送文案 | `packages/web-collab/src/lib/realtime.ts` | 三类事件中文通知 |
| 样式 | `packages/web-collab/src/styles.css` | 月视图 / 弹窗样式 |

### 验证
- server `vitest`：**28/28**（含 4 个日历测试：创建+升序、guest 无 createEvent、child 创建/不可改他人、删除边界、不存在事件 NOT_FOUND）。
- web-collab `tsc --noEmit`：exit 0。
- 浏览器端到端（系统 Chrome + 代理绕过）：**19/19 全绿**，新增「共享日历：alice 建事件 → bob 实时看到」，**无运行时错误**。

## 二、单机版财务模块（对齐收尾 `@dm-life/engine` + `@dm-life/web`）

### 能力
- 既有：债务 / 收入 / 流水 / 资产 + `summary` 聚合（沿用事件溯源双写闭环）。
- 新增 **账目核对 `reconcile()`**：全局勾稽 —— Σ资产−Σ债务、Σ收入、Σ支出、Σ已还本金 vs 还款流水，返回 `discrepancies`（逐债 + 全局范围）。
- 新增 **报表导出 `exportReport({format:'csv'|'json', month?})`**：返回 `{format, filename, content}`，前端 Blob 下载；`month` 可按月过滤。

### 分层实现
| 层 | 文件 | 要点 |
|---|---|---|
| 命令 | `packages/engine/src/modules/finance/command.ts` | `reconcile()` / `exportReport()` 入口 + Zod 校验 |
| 存储 | `packages/engine/src/modules/finance/repository.ts` | 勾稽计算 + CSV/JSON 序列化 |
| 路由 | `packages/engine/src/router/appRouter.ts` | `finance.reconcile` / `finance.exportReport` query |
| 契约 | `packages/shared/src/schemas.ts` | `exportReportInputSchema` |
| 前端 | `packages/web/src/features/finance/FinancePage.tsx` | 「账目核对」面板 + 「导出报表」按钮 |

### 验证
- engine `vitest`：**19/19**（含 `reconcile.test.ts` 4/4：干净数据 balanced、还款不一致 discrepancy、CSV/JSON 合法、month 过滤）。
- web `tsc` 注：单机版 `packages/web` 现有若干**预先存在、与财务无关**的 tsc 报错（notes/tasks/board/command-palette/flow/vite.config），该包经 esbuild 运行不卡 tsc，不影响可运行性。

## 三、数据隔离确认
- 共享日历（联机版 Postgres/PGLite）与单机版财务（sql.js 事件溯源）**分属不同 workspace 包、不同数据库、不同进程**，数据交互**无冲突**。财务 reconcile/exportReport 仅读 engine 本地库，不触达协作服务。

## 四、本地运行方式
```bash
# 联机版协作服务（共享日历后端）
cd packages/server
PORT=4100 PGLITE_DIR=/真实/路径/.pg npm run start

# 联机版前端（共享日历 UI）
cd packages/web-collab
VITE_SERVER_PORT=4100 npm run dev          # http://127.0.0.1:5173

# 单机版引擎 + 前端（财务模块）
cd packages/engine && npm run dev          # SSE 引擎
cd packages/web && npm run dev             # 财务页在「财务」tab
```

## 五、测试结果汇总
| 模块 | 测试 | 结果 |
|---|---|---|
| 协作服务（含日历） | `packages/server` vitest | **28/28** |
| 单机引擎（含财务） | `packages/engine` vitest | **19/19** |
| 联机前端 | web-collab `tsc --noEmit` | exit 0 |
| 端到端 | 系统 Chrome e2e | **19/19**（含日历实时同步） |
