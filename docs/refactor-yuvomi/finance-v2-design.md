# Finance-v2 模块设计 — 银行级债务还款规划

> 分支：`refactor/yuvomi-architecture`。状态：**方案设计（待评审）**，尚未实现。
> 目标：在现有 `finance` 模块上**增量**补回原 dm-life 的银行级债务规划能力，不破坏现有数据、不新增运行时依赖。
> 本文件取代旧 `债务管理P0P1落地说明.md` / `债务管理银行专业评估.md`，为唯一权威规格（旧文档已删除，main 分支仍有存档）。

---

## 0. 目标与原则

补回四大银行级能力（来自原银行专业评估 P0/P1）：

1. **P0-1 利率重定价自动化**（LPR / 基准利率联动）
2. **P0-2 实际已还勾稽**（计划口径 vs 真实流水，银行级对账）
3. **P1-1 实际年化利率（IRR / EAR）披露**
4. **P1-2 提前还款收益量化**（省利息 + 缩期限）

设计原则：

- **增量、向后兼容**：现有 `debts` 行不破坏；旧数据默认表现为"固定利率、无计划"，用户补全字段后生成计划。
- **纯函数引擎**：所有金融计算放 `modules/finance/debt-engine.js`（无 DB / 无 Req 依赖），可单测。
- **零新依赖**：IRR / 摊销 / 重定价均用原生数学实现，不引入库。
- **复用安全模型**：沿用现有 CSRF 双提交、会话、参数化查询。
- **优雅降级**：前端对缺失字段（如未设 `term_months`）不报错，仅隐藏对应卡片。

---

## 1. 与现有 `finance` 模块的关系

**建议：扩展 `modules/finance/`，不新建独立模块。**

理由：债务本就属于 finance 领域；拆成 `finance` + `debt-planning` 两模块会割裂同一实体的读写。落地方式：

- 债务 CRUD 与汇总继续在 `modules/finance/index.js`。
- 规划相关逻辑隔离在新增文件 `modules/finance/debt-engine.js`（纯函数）。
- 规划相关路由挂在现有 `finance` 路由下（`/api/v1/finance/debts/:id/...`）。
- 前端在 `modules/finance/public/page.js` 的债务详情区扩展视图。

---

## 2. 数据模型（增量迁移）

### 2.1 `debts` 表新增列（`IF NOT EXISTS` 追加）

| 列 | 类型 | 说明 |
|---|---|---|
| `interest_type` | TEXT | `fixed` / `floating`，默认 `fixed` |
| `repricing` | TEXT(JSON) | 浮动利率规则（见 2.3），固定利率为 NULL |
| `first_payment_date` | TEXT | 首次还款日（生成计划用） |
| `payment_day` | INTEGER | 每月扣款日 |
| `origination_fee` | REAL | 放款手续费（计入 IRR 现金流 t0 流出） |
| `balloon_amount` | REAL | 期末气球贷余额（可选） |
| `rate_adjustments` | TEXT(JSON) | 手动利率覆盖列表（重定价规则存在时**自动让位**） |

> 现有 `principal / apr / min_payment / due_day / term_months / repayment_method / start_date` 保留不变。

### 2.2 新增表

```sql
CREATE TABLE IF NOT EXISTS lpr_history (
  benchmark     TEXT NOT NULL,        -- LPR_1Y / LPR_5Y / PBOC_BASE
  rate          REAL NOT NULL,
  effective_date TEXT NOT NULL
);   -- 种子：2022–2026 各品种利率（无法联网时的基准，可随央行公布更新）

CREATE TABLE IF NOT EXISTS debt_repricing_events (
  id            TEXT PRIMARY KEY,
  debt_id       TEXT NOT NULL,
  effective_date TEXT NOT NULL,
  old_rate      REAL,
  new_rate      REAL,
  basis         TEXT,                 -- 来自哪个 benchmark / fixed_date
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS debt_extra_payments (
  id            TEXT PRIMARY KEY,
  debt_id       TEXT NOT NULL,
  amount        REAL NOT NULL,
  at_period     INTEGER,              -- 第几期之后提前还
  interest_saved REAL,                -- 量化结果（写入）
  term_shortened INTEGER,             -- 缩短月数（写入）
  applied_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
```

### 2.3 真实还款流水

复用现有 `transactions`（`kind='debt_payment'`, `debt_id` 关联）。为支持勾稽，可选给 `transactions` 加 `principal_portion` / `interest_portion`（默认 NULL，NULL 时按当期计划比例估算）。**首版可不加列**，勾稽用 `SUM(amount)` 近似。

---

## 3. 引擎纯函数（`modules/finance/debt-engine.js`）

全部为纯函数，输入普通对象 / 数组，输出普通对象 / 数组，便于 `node:test` 单测。

### 3.1 `amortize(debt)` → schedule
```js
// 返回 [{ period, date, payment, principal, interest, balance }]
// 支持 repayment_method: equal_installment(等额本息) / equal_principal(等额本金)
// 若 interest_type=floating 且 repricing 规则有效，在重定价生效点切换当期利率
```
- 利率取值优先级：`repricing` 派生当期利率 > `rate_adjustments` 手动覆盖 > `apr`。
- 处理 `origination_fee`（t0 额外本金）、`balloon_amount`（末期一次性）。

### 3.2 `generateRepricingAdjustments(rule, startDate, termMonths, lprHistory)` → events
```js
// rule = { benchmark, spread, cycleMonths, anchor, fixedDate? }
// 返回 [{ effectiveDate, rate }]，rate = 锚定基准(生效日) + spread(永久加点)
```
- `anchor=anniversary`：对年对月对日；`anchor=fixed_date`：固定日历日。
- `cycleMonths`：12(年)/6(半年)/3(季)。
- 内置 `LPR_HISTORY`（2022–2026）；联网拉取为可选（首版不做）。

### 3.3 `computeIRR(cashflows)` → { monthly, ear }
```js
// cashflows: 借款人视角，t0 收本金(+)、其后每月 -月供、提前还款(-)
// 二分法求月 IRR，EAR = (1+monthly)^12 − 1
```
- 含提前还款时 IRR 更贴近真实资金成本。
- 数值稳定性：现金流全正/全负时返回 null（无法求解），前端提示。

### 3.4 `debtProgressSummary(debt, actualPayments)` → reconciliation
```js
// paidPrincipal   = 按计划(时间口径) 应已还本金
// actualPaidPrincipal = 按真实 debt_payment 流水条数取前 N 期本金累计 (N=真实笔数)
// delta = actualPaidPrincipal − paidPrincipal
```
- `delta > 0.5`：提前还 / 多还（绿色，省利息）
- `delta < -0.5`：逾期或漏还（琥珀色，风险提示）
- 接近 0：账实相符

### 3.5 `prepaymentBenefit(debt, extra, atPeriod)` → { interestSaved, termShortenedMonths }
```js
// 在当前计划基础上，第 atPeriod 期后一次性多还 extra
// 量化：剩余期限节省的利息总额、期限缩短月数
```
- 两种策略可选（前端提供开关）：①月供不变、缩短期限；②期限不变、降低月供。首版默认"缩短期限"。

---

## 4. API 路由（挂在 `/api/v1/finance`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/debts/:id/schedule` | 还款计划（含重定价生效点标记） |
| GET | `/debts/:id/summary` | IRR/EAR + 勾稽 + （可选）提前还款模拟 |
| POST | `/debts/:id/repricing` | 设置浮动利率规则（清空则转固定） |
| POST | `/debts/:id/extra-payments` | 记录提前还款，回写 `interest_saved` / `term_shortened` |
| GET | `/debts/:id/extra-payments/benefit?amount=&atPeriod=` | 模拟提前还款收益（不落库） |

均复用现有鉴权 + CSRF；写操作沿用 `X-CSRF-Token` 双提交。

---

## 5. 前端（`modules/finance/public/page.js` 扩展）

债务详情视图新增：

- **还款计划表**：期数 / 日期 / 月供 / 本金 / 利息 / 余额；重定价生效行高亮标"利率切换"。
- **IRR/EAR 徽章**：天蓝色高亮显示实际年化。
- **勾稽卡**：计划已还 / 实际已还 / 差异，按阈值着色（绿/琥珀/灰）。
- **重定价编辑器**：基准品种 / 加点 / 重定价周期 / 对日方式；固定利率隐藏。
- **提前还款模拟器**：输入金额 + 期数 → 实时显示省息 + 缩期。

复用现有 `api.js`（CSRF 自动携带）、`ui.js`（卡片/表格/弹窗）、CSS 变量主题。

---

## 6. 迁移与兼容

- 所有 `CREATE TABLE` / `ALTER` 用 `IF NOT EXISTS`；旧 `debts` 行 `interest_type` 默认 `fixed`、`repricing` 为 NULL → 旧数据表现不变。
- 用户补全 `term_months` + `repayment_method` 后，`/schedule` 与 `/summary` 才有意义；缺失时前端隐藏对应卡片。
- 不改动现有 `GET /debts`、`POST /debts`、`/summary`（净资产）等既有契约。

---

## 7. 测试（财务数学必须单测）

新增 `test/finance-v2.test.mjs`（用 Node 内置 `node:test`，零依赖）：

- `amortize`：等额本息末期余额趋零、等额本金前期利息高；重定价生效点利率切换正确。
- `computeIRR`：已知月供+本金案例，IRR/EAR 与手算吻合；全正/全负返回 null。
- `generateRepricingAdjustments`：anniversary / fixed_date 两种 anchor 生效日正确；加点永久不变。
- `debtProgressSummary`：按计划 vs 真实笔数计算 delta，阈值着色边界（±0.5）正确。
- `prepaymentBenefit`：省息与缩期为非负、随金额单调。

并入 `npm test`（在 `test/smoke.mjs` 之后追加，或单独 `node --test`）。

---

## 8. 实施分期（每期可独立提交、不阻塞主线）

| 期 | 内容 | 交付 |
|---|---|---|
| **P1** | 数据模型迁移 + `debt-engine.js` 纯函数 + `test/finance-v2.test.mjs` | 可独立验证财务数学正确性 |
| **P2** | API 路由（`/schedule` `/summary` `/repricing` `/extra-payments`） | 后端可用 |
| **P3** | 前端债务详情视图（计划表 / IRR 徽章 / 勾稽卡 / 重定价编辑器 / 提前还款模拟器） | 端到端可用 |
| **P4** | 接入 `finance/summary` 净资产展示（标注 IRR/勾稽） | 全局视图闭环 |

---

## 9. 开放问题 / 风险

- **利率基准源**：首版用内置 `LPR_HISTORY` 种子；联网实时拉取为可选后续项。
- **币种**：首版仅 CNY。
- **还款法**：首版支持等额本息 / 等额本金；先息后本等后续。
- **多债务汇总 IRR**：首版按单债务披露；组合视角可后续。
