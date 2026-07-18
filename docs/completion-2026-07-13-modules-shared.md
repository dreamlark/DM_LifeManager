# 模块迁移与共享适配 — 完成总览（#209–#217）

> 用户请求：「请修复并完成后续其他模块的迁移和共享适配工作」
> 两个财务 Bug（收入/债务共享详情不显示、保存共享无反应）已在更早会话修复；本文档覆盖「后续模块」的迁移与共享适配收尾。

## 已交付

### 1. 通用共享基座（#209）
- **server** 新增 `shared_items` 表（唯一键含 `module`）+ `sharedItems` router：
  - `listByFamily`：按 `viewer + module` 过滤、`owner` 自见；
  - `upsert` / `remove`：需 `manageShared` 权限；
  - 实时事件 `sharedItems.updated`。
- **前端通用壳**（复用，无需每模块重写）：
  - `SharedItemsConfigModal`（dnd-kit 拖拽选条目 + SSE 防抖重推快照）；
  - `FamilySharedItemsBoard`（协作模式看板，`onBoardEvent` 监听实时刷新）；
  - `FamilySharedHub`（协作模式聚合页，堆叠各模块 board）。

### 2. 逐模块迁移 + 共享适配
| # | 模块 | 个人页迁移 | 共享适配器 | FamilySharedHub board |
|---|------|-----------|-----------|----------------------|
| 210/211 | 提醒 reminder | ✅ ReminderShopPage | ✅ reminderShare | ⏰ 人生钟表铺 |
| 212 | 记事 notes | ✅ NotesHubPage + NoteFormModal | ✅ notesShare | 📝 灵感·记事本 |
| 213 | 脑图 mindmap | ✅ MindMapPage（纯 localStorage） | ✅ mindmapShare | 🧠 思维导图 |
| 214 | 心流 flow | ✅ FlowPage | ✅ flowShare | 🌊 心流仪表盘 |
| 215 | 平衡轮 domains | ✅ DomainBalancePage | ✅ domainShare | ⚖️ 领域平衡轮 |
| 216 | 孵化器 interests | ✅ IncubatorPage + InterestCaptureModal | ✅ interestsShare | 🧪 灵感孵化器 |
| 217 | 日历 calendar | ✅ CalendarPage（此前仅占位） | 原生共享日历承担 | —（见下） |

**共享三层架构（避免重复）：**
- `finance` → 独立 `FamilyFinanceBoard`（sharedFinance，#203–#208）；
- `calendar` → 联机版原生共享日历（`src/components/CalendarPage.tsx`，#179–183）；
- `reminder/notes/mindmap/flow/domains/interests` → 通用 `sharedItems` 桥接（#209）。

### 3. 接线核对
- `LocalApp.tsx` 9 个 Tab 全部接实：board / finance / reminder / notes / mindmap / calendar / flow / domains / incubator。
- `FamilySharedHub.tsx` 6 个 board 就绪（上表）。
- `web-collab/package.json` 显式声明 hoisted 依赖 `@radix-ui/react-dialog`、`mind-elixir`。

## 验证结果
- 每个模块：`tsc --noEmit` exit 0、`vite build` exit 0（仅 chunk >500KB 警告）。
- server `shared-items.test.ts`：6/6 通过（upsert→listByFamily 按 module 过滤、scope=specific 过滤、guest RBAC）。
- 无 `@trpc/server` 进入浏览器路径，无白屏风险。

## 运行方式（交付给用户）
完整联机栈需三件套（端口被孤儿进程占用时换端口）：
1. **engine**：`cd packages/engine && npm run start`（默认 :14570）
2. **server**：`cd packages/server && CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR= CODEBUDDY_TOOL_CALL_ID= PORT=4100 PGLITE_DIR=./.collab-data ../../node_modules/.bin/tsx src/http-server.ts`
   - ⚠️ 入口是 `src/http-server.ts`（非 `src/index.ts`）；PGLite 冷启动约 30s。
   - `ensure.ts` 首次启动幂等建 `shared_items` 等表。
3. **web-collab**：`npm run dev -w packages/web-collab`（默认 :5173，错开用 `--port 5174`）

## 已知缺口
- 浏览器级 e2e（alice 共享 → bob 实时可见 / 范围过滤）尚未自动化，需用户在物理机起栈后预览验证。
- 生产 `migrations/` 未独立补（全部表靠 `ensure.ts` 幂等建表）。
