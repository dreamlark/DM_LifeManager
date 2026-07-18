# 第 8 轮修复验证报告（#309–#311）

> 一句话结论：**3 项全部交付且通过全量回归，未引入新问题。**

## 改动清单

| 编号 | 需求 | 改动文件 | 根因 |
|------|------|----------|------|
| #310 | 设置弹窗尺寸固定（切标签不变高/变窄，内容少可留白） | `packages/web-collab/src/components/SettingsPage.tsx` | `Dialog.Content` 仅设了宽度，高度随内容撑开 |
| #309 | 调整左右边栏宽度后，切 tab 再切回每日看板布局错乱（宽度未保持） | `packages/web-collab/src/LocalApp.tsx` | 旧代码用 `useEffect([])` 命令式写 `gridTemplateColumns` 内联样式，切 tab 时看板子树重挂、内联样式丢失且 effect 不再跑 |
| #311 | 家庭协作共享任务改完成状态后，不回写个人每日看板 | `packages/server/src/store.ts` + `packages/web-collab/src/features/shared/FamilySharedItemsBoard.tsx` | 服务端 `updateSharedItem` 未更新 `snapshot.status`；协作视图下 `LocalApp` 未挂载漏收 SSE，`invalidate()` 保留缓存新鲜度导致切回不重拉 |

## 具体改动

### #310 设置弹窗固定尺寸
- `Dialog.Content` 由 `w-[min(720px,92vw)]` 改为 `flex h-[min(560px,85vh)] w-[min(720px,92vw)] ... flex-col`（固定 560px 高 / 720px 宽，纵向 flex）。
- 内部由 `<div className="flex min-h-[420px]">` + `<nav ... w-32>` 改为 `<div className="flex min-h-0 flex-1">` + `<nav ... overflow-y-auto>`；内容区 `.flex-1 overflow-y-auto p-5` 内部滚动。切任意标签（数据 / 关于 / 主题等）弹窗尺寸恒定 720×560，内容少留白。

### #309 边栏宽度切页保持
- 移除 `applyGrid()` + `useEffect([])` 命令式写样式；改为 React 受控内联 `style`，绑定 `leftW / rightW / windowWidth` 状态（新增 `windowWidth` state + resize 监听）。
- `LocalApp` 组件在切 tab 时不卸载，内联样式随 state 重渲染，宽度稳定保持。
- `windowWidth > 1100` 时才施加三栏 `gridTemplateColumns`；≤1100 回退 CSS 默认断点（收起右/左栏），与既有响应式一致。

### #311 协作任务完成状态同步到个人看板
- 服务端 `updateSharedItem`（store.ts）新增：`module==='task'` 时 `set.snapshot = jsonb_set(COALESCE(snapshot,'{}'), '{status}', to_jsonb(done?'done':'todo'::text))`（PgLite 需 `::text` 消除多态类型歧义，防 `42804`）。
- 前端 `FamilySharedItemsBoard.toggleDone` 的 Direction A（协作→个人）完成 `tasks.complete/uncomplete` 后，由 `invalidate()` 改为显式 `localUtils.tasks.today.refetch()` + `insights.dailyCard.refetch()`，确保切回每日看板立即同步。

## 验证结果（全绿）

| 检查项 | 命令 / 手段 | 结果 |
|--------|--------------|------|
| 类型检查（web-collab） | `tsc --noEmit -p packages/web-collab/tsconfig.json` | ✅ 退出 0 |
| 类型检查（server） | `tsc --noEmit` (packages/server) | ✅ 退出 0 |
| 生产构建 | `vite build` | ✅ 1802 模块，成功 |
| 服务端单测 | `vitest run`（packages/server） | ✅ **28 / 28 PASS**（含 #311 `snapshot.status` 断言） |
| 引擎单测 | `vitest run`（packages/engine） | ✅ **52 / 52 PASS** |
| #311 同步单测现场复跑 | `vitest run src/__tests__/shared-items.test.ts` | ✅ **8 / 8 PASS**（本次复跑确认） |
| 真实浏览器 UI 冒烟（第 7 轮） | `.data-repro/smoke-ui.cjs` | ✅ **22 / 22 PASS** |
| 真实浏览器 UI 冒烟（第 8 轮） | `.data-repro/smoke-ui-round8.cjs` | ✅ **8 / 8 PASS** |
| #303/#311 同步 API 回归 | `.data-repro/sync-api.cjs` | ✅ 方向 A / 方向 B 均 PASS |

### 第 8 轮 UI 冒烟覆盖点（smoke-ui-round8.cjs）
- #309：拖拽左分隔条 → 367px；切到「财务」tab → 切回「每日看板」→ 断言 grid 仍 367px（不回退 250）。
- #310：打开设置弹窗 → 断言 720×560；切「数据」「关于」tab → 断言尺寸恒定 720×560 不变。
- PIN 处理与第 7 轮 harness 一致（自动识别 `.applock` 并输入 4 位）。

## 附注
- 长期回归用例保留：`smoke-ui.cjs`（UI）、`smoke-ui-round8.cjs`（第 8 轮 UI）、`sync-api.cjs`（同步）。
- 环境：vite :5175 / engine :14570 / collab :4100 均健康。
- 本次会话仅就服务端 shared-items 单测现场复跑确认（8/8 PASS）；其余回归结果为本轮早前执行确认的全绿状态。
