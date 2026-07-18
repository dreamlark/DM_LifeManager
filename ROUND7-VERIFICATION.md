# 第 7 轮修复验证报告（#304–#308）

> 一句话结论：**5 项全部交付且通过全量回归，未引入新问题。**

## 改动清单

| 编号 | 需求 | 改动文件 |
|------|------|----------|
| #304 | 看板左右边栏可拖拽调宽 + 持久化 | `packages/web-collab/src/LocalApp.tsx` + `styles.css`(`.board-splitter`) |
| #305 | 「今日最重要」超过 4 件滚动（不再无限累加） | `packages/web-collab/src/features/board/LeftColumn.tsx`（MIT 列表包 `max-h-[300px] overflow-y-auto`） |
| #306 | 全站注释小字加大 2 个字号 | `packages/web-collab/src/styles.css`（`.text-[9/10/11px]` → `11/12/13px`） |
| #307 | 提醒首次响铃去重日历按钮 + 加「确定」按钮 | `packages/web-collab/src/features/reminder/ReminderShopPage.tsx` |
| #308 | 修复图示绿色「更新保护」看不清，并彻查全站彩色字对比度 | `tailwind.css` + `tailwind.config.ts`（9 个语义色补全 100–600 双主题调色板） |

## 验证结果（全绿）

| 检查项 | 命令 / 手段 | 结果 |
|--------|--------------|------|
| 类型检查 | `tsc --noEmit -p packages/web-collab/tsconfig.json` | ✅ 退出 0 |
| 生产构建 | `vite build` | ✅ 1802 模块，成功 |
| #303 回归（协作↔个人完成状态同步） | `.data-repro/sync-api.cjs` | ✅ 方向 A/B 均 PASS |
| 真实浏览器 UI 冒烟 | `.data-repro/smoke-ui.cjs`（受管 Playwright + Chromium） | ✅ **22 / 22 PASS** |

### UI 冒烟覆盖点
- #304：分隔条 = 2；初始左栏 250px；拖拽后 367px（300–460 区间）；持久化到 `localStorage['dm-board-cols']`；刷新后保持。
- #305：MIT 列表容器 `max-height:300px` 滚动上限且含多任务（经 engine 种子 6 个 `isMit` 任务，测后清理，零污染）。
- #307：自定义日历按钮已移除（0 个）；存在「确定」提交按钮。
- #308（双主题）：`--lc-emerald/sky/red/amber/rose/green-200` 浅色=深色档、深色=明亮档全部命中；「更新保护」文字对比度 **浅色 7.11 / 深色 12.67**，均 ≥ 4.5。

## 附注
- 验证用的临时调试脚本已清理；保留 `smoke-ui.cjs`（UI 回归）与 `sync-api.cjs`（#303 同步回归）作为长期回归用例。
- 环境：vite :5175 / engine :14570 / collab :4100 均健康。
