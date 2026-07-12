# DM_life · 本次交付总览

> 高级开发工程师（Senior Developer）——全栈 / 高级 Web 体验 / Laravel·Livewire·FluxUI·React·TS·Three.js

本次处理了你提的三个事项，已全部完成并通过验证。

## 1. 钟表铺「周期规则」改为下拉选择 ✅
- 文件：`packages/web/src/features/reminder/ReminderShopPage.tsx`
- 建钟 / 编辑表单的「周期规则」由自由文本改为下拉（每1周 / 每2周 / 每1个月 / 每2个月 / 每3个月 / 每半年 / 每年 / 每9个月），并保留「自定义」兜底输入。
- 自动识别预设 vs 自定义（`periodSelectValue`）：选中原预设显示下拉，选「自定义」则出现文本输入框，向后兼容历史自由文本规则。

## 2. 是否带本地数据库、是否需要存下来 ✅ 确认：会自动落盘
- 引擎用 sql.js（WASM SQLite），文件位于 `packages/engine/data/dm-life.db`（可用 `DM_LIFE_DATA_DIR` 覆盖路径，必须是真实 Windows 绝对路径并先 `mkdir`）。
- **每次写操作都自动持久化**：`writeTx()` 在事务提交后调用 `saveDb()` 把内存库导出为文件（`client.ts`）。所以债务/收入/流水/资产等所有数据都会存下，刷新/重启不丢。
- 事件表（events）为仅追加日志，与实体表原子双写，是系统的单一写路径（ADR-002）。

## 3. 财务页完全对齐 life-manager，样式统一 ✅
后端（引擎）已 typecheck 干净、引擎测试 2/2 通过；前端（FinancePage）已重写、vite build 成功、还款引擎 18/18 冒烟通过。

### 新增/对齐的能力
- **债务还款引擎**（纯 TS，移植自 life_manager/core/finance.py）：4 种方式——等额本息 / 等额本金 / 先息后本 / 固定月供；支持分段利率重定价、提前还款（reduce_term / reduce_payment）、续贷（parentDebtId）。无期数时优雅返回空计划。
- **债务卡片**：行内还款进度条 + 展开「还款计划」表（每期月供/本金/利息/剩余），含 debtType、期数、年化、利率类型(基准/LPR/固定)、基点、起贷日、提前还款/利率调整(JSON 高级区)。支持改名、结清、删除。
- **收入源**：incomeType / 月均 / 固定 / 月度或一次性 / 发放日，驱动「自动刷新本月」生成本月收入流水。
- **交易流水**：kind 含 还款(debt_payment)；按月收支趋势条（net 净额）。
- **资产**：类目含 固定资产 / 收入源（关联收入源）。
- **月度收支趋势**面板（近 6 个月收入/支出条）。
- **「自动刷新本月」按钮**：按收入源 payDay 与债务 dueDay 批量生成本月固定收入 + 债务还款流水（去重）。
- 新增引擎过程：`finance.debtSchedule({id})`、`finance.trend({months})`、`finance.autoRefresh`。

### 验证结果
| 项 | 结果 |
|---|---|
| 还款引擎冒烟（tsx，4 法+无期数+提前还款+利率重定价） | 18/18 通过 |
| 引擎财务测试（vitest 双写一致 + 总览聚合） | 2/2 通过 |
| 前端 vite build | 成功（1743 modules） |
| 财务后端 + 前端 typecheck（`tsc`） | 干净（FinancePage / modules/finance 无错误） |

### 运行方式（改动后端后请重启）
```bash
# 1) 停掉旧的引擎/前端（端口若被占用，换 14571/5174 并设 VITE_ENGINE_URL）
npm run dev:clean            # 清掉孤儿进程（脚本已修好 .mjs TS 语法问题）
npm run dev:engine           # 引擎 127.0.0.1:14570
npm run dev:web              # 前端 127.0.0.1:5173
```

### 遗留（预存、非本次引入、不影响运行时与构建）
全量 `tsc` 仍有 ~42 个预存类型错误（tasks/command 的 `TaskUncompleted` 事件未定义、flow/repository、client.ts `SqlJsDatabase` 大小写、EventStore 转换、web 若干文件等），均为类型层问题，esbuild/tsx 忽略，超出本次范围。
