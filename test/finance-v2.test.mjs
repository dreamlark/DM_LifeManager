/**
 * finance-v2 单元测试 — 债务引擎纯函数
 * 零依赖：Node 内置 node:test + node:assert
 * 运行：node --test test/finance-v2.test.mjs  (或 npm test)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  amortize,
  generateRepricingAdjustments,
  computeIRR,
  debtProgressSummary,
  prepaymentBenefit,
  buildCashflows,
  LPR_HISTORY,
  lookupRate,
  addMonths,
} from '../modules/finance/debt-engine.js';

/* ---------- 基础工具 ---------- */
test('addMonths 跨年与月末夹紧', () => {
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29'); // 2024 闰年 2 月
  assert.equal(addMonths('2024-01-31', 12), '2025-01-31');
  assert.equal(addMonths('2024-03-31', 1), '2024-04-30'); // 4 月无 31 → 夹紧
});

test('lookupRate 取生效日之前最新一条', () => {
  assert.equal(lookupRate(LPR_HISTORY, 'LPR_5Y', '2023-01-01'), 4.30); // 2022-08-22 后
  assert.equal(lookupRate(LPR_HISTORY, 'LPR_5Y', '2024-03-01'), 3.95); // 2024-02-20 后
  assert.equal(lookupRate(LPR_HISTORY, 'LPR_5Y', '2099-01-01'), 3.50); // 最新
});

/* ---------- 3.1 amortize ---------- */
test('amortize 等额本息：末期余额趋零、本金合计=本金', () => {
  const debt = { principal: 100000, apr: 6, term_months: 12, repayment_method: 'equal_installment' };
  const s = amortize(debt);
  assert.equal(s.length, 12);
  assert.ok(Math.abs(s[11].balance) < 1, '末期余额应趋零, 实际 ' + s[11].balance);
  const totalP = s.reduce((a, p) => a + p.principal, 0);
  assert.ok(Math.abs(totalP - 100000) < 1);
  // 等额本息月供恒定（允许最后一行因收尾微调）
  assert.ok(Math.abs(s[0].payment - s[5].payment) < 1);
});

test('amortize 等额本金：前期利息高于后期', () => {
  const debt = { principal: 120000, apr: 5, term_months: 24, repayment_method: 'equal_principal' };
  const s = amortize(debt);
  assert.ok(s[0].interest > s[23].interest, '等额本金前期利息应更高');
  const totalP = s.reduce((a, p) => a + p.principal, 0);
  assert.ok(Math.abs(totalP - 120000) < 1);
});

test('amortize 气球贷：期末一次性结清剩余本金', () => {
  const debt = { principal: 100000, apr: 5, term_months: 12, repayment_method: 'equal_installment', balloon_amount: 40000 };
  const s = amortize(debt);
  assert.ok(Math.abs(s[11].balance) < 1, '末期余额应归零');
  assert.ok(s[11].principal > 39000, '末期应含 ~40000 气球余额, 实际 ' + s[11].principal);
});

test('amortize 浮动利率：重定价生效点利率切换并标记', () => {
  const debt = {
    principal: 100000, apr: 4.9, term_months: 36, repayment_method: 'equal_installment',
    interest_type: 'floating',
    start_date: '2024-01-15',
    repricing: { benchmark: 'LPR_5Y', spread: 0.6, cycleMonths: 12, anchor: 'anniversary' },
  };
  const s = amortize(debt);
  const switches = s.filter((p) => p.repricing);
  assert.ok(switches.length >= 1, '应至少有一个重定价生效点');
  // 初始利率由基准+加点派生，不等于合同标注 apr(4.9)
  assert.notEqual(s[0].rate, 4.9);
  // 切换点当期利率应不同于上一期
  const k = s.findIndex((p) => p.repricing);
  assert.notEqual(s[k].rate, s[k - 1].rate);
});

test('amortize 无期限/无本金时返回空数组', () => {
  assert.deepEqual(amortize({ principal: 0, term_months: 12 }), []);
  assert.deepEqual(amortize({ principal: 1000 }), []);
});

/* ---------- 3.2 generateRepricingAdjustments ---------- */
test('generateRepricingAdjustments anniversary：对年对月对日', () => {
  const rule = { benchmark: 'LPR_5Y', spread: 0.5, cycleMonths: 12, anchor: 'anniversary' };
  const ev = generateRepricingAdjustments(rule, '2024-01-15', 36, LPR_HISTORY);
  assert.equal(ev[0].effectiveDate, '2024-01-15');
  assert.equal(ev[ev.length - 1].effectiveDate, '2027-01-15'); // 起贷 + 3 年（含到期日当次）
  assert.equal(ev.length, 4); // 初始 + 3 次年度重定价
  // 加点永久不变：每期 rate = 基准 + 0.5
  for (const e of ev) {
    const base = lookupRate(LPR_HISTORY, 'LPR_5Y', e.effectiveDate);
    assert.ok(Math.abs(e.rate - (base + 0.5)) < 1e-9);
  }
});

test('generateRepricingAdjustments fixed_date：固定日历日', () => {
  const rule = { benchmark: 'LPR_1Y', spread: 0, cycleMonths: 6, anchor: 'fixed_date', fixedDate: '01-01' };
  const ev = generateRepricingAdjustments(rule, '2024-03-01', 24, LPR_HISTORY);
  assert.equal(ev[0].effectiveDate, '2024-03-01'); // 初始（起贷日）
  assert.ok(ev.some((e) => e.effectiveDate === '2025-01-01'), '应包含固定日 2025-01-01');
  assert.ok(ev.some((e) => e.effectiveDate === '2025-07-01'), '半年度应含 2025-07-01');
});

test('generateRepricingAdjustments 缺参数返回空', () => {
  assert.deepEqual(generateRepricingAdjustments(null, '2024-01-15', 12, LPR_HISTORY), []);
  assert.deepEqual(generateRepricingAdjustments({ benchmark: 'LPR_5Y' }, null, 12, LPR_HISTORY), []);
});

/* ---------- 3.3 computeIRR ---------- */
test('computeIRR 等额本息月供案例：约 0.5%/月, EAR≈6.17%', () => {
  const pmt = 8606.64;
  const flows = [100000, ...Array(12).fill(-pmt)];
  const r = computeIRR(flows);
  assert.ok(r, '应返回结果');
  assert.ok(Math.abs(r.monthly - 0.005) < 1e-3, '月 IRR 应≈0.5%, 实际 ' + r.monthly);
  assert.ok(Math.abs(r.ear - 0.0617) < 1e-2, 'EAR 应≈6.17%, 实际 ' + r.ear);
});

test('computeIRR 全正/全负返回 null', () => {
  assert.equal(computeIRR([100, 200, 300]), null);
  assert.equal(computeIRR([-100, -200]), null);
  assert.equal(computeIRR([5]), null); // 不足两期
});

test('computeIRR 含手续费：资金成本抬高', () => {
  const debt = { principal: 100000, apr: 6, term_months: 12, repayment_method: 'equal_installment', origination_fee: 2000 };
  const flows = buildCashflows(debt);
  const r = computeIRR(flows);
  assert.ok(r && r.monthly > 0.005, '含手续费后月 IRR 应高于无费 0.5%, 实际 ' + (r && r.monthly));
});

/* ---------- 3.4 debtProgressSummary ---------- */
const schedDebt = { principal: 12000, apr: 5, term_months: 12, repayment_method: 'equal_installment', first_payment_date: '2024-02-15' };

test('debtProgressSummary 账实相符 (on_track)', () => {
  const pay = Array(12).fill({ amount: 1000 });
  const res = debtProgressSummary(schedDebt, pay, { now: '2099-01-01' });
  assert.equal(res.status, 'on_track');
  assert.ok(Math.abs(res.delta) <= 0.5);
  assert.equal(res.periodsActual, 12);
});

test('debtProgressSummary 提前还/多还 (ahead)', () => {
  const pay = Array(12).fill({ amount: 1000 });
  // 时间上仅 10 期应还，但已还 12 笔 → 实际 > 计划
  const res = debtProgressSummary(schedDebt, pay, { now: '2024-12-01' });
  assert.equal(res.status, 'ahead');
  assert.ok(res.delta > 0.5);
});

test('debtProgressSummary 逾期/漏还 (behind)', () => {
  const pay = Array(8).fill({ amount: 1000 });
  const res = debtProgressSummary(schedDebt, pay, { now: '2024-12-01' });
  assert.equal(res.status, 'behind');
  assert.ok(res.delta < -0.5);
});

/* ---------- 3.5 prepaymentBenefit ---------- */
test('prepaymentBenefit 省息与缩期为非负', () => {
  const debt = { principal: 120000, apr: 5, term_months: 120, repayment_method: 'equal_installment' };
  const b = prepaymentBenefit(debt, 20000, 12);
  assert.ok(b.interestSaved > 0, '应省息, 实际 ' + b.interestSaved);
  assert.ok(b.termShortenedMonths > 0, '应缩期, 实际 ' + b.termShortenedMonths);
});

test('prepaymentBenefit 随金额单调（更多→更多省息/缩期）', () => {
  const debt = { principal: 120000, apr: 5, term_months: 120, repayment_method: 'equal_installment' };
  const small = prepaymentBenefit(debt, 20000, 12);
  const big = prepaymentBenefit(debt, 40000, 12);
  assert.ok(big.interestSaved >= small.interestSaved);
  assert.ok(big.termShortenedMonths >= small.termShortenedMonths);
});

test('prepaymentBenefit 提前还款即结清', () => {
  const debt = { principal: 1000, apr: 5, term_months: 6, repayment_method: 'equal_installment' };
  const b = prepaymentBenefit(debt, 10000, 1); // 超额提前还
  assert.equal(b.termShortenedMonths, 5); // 剩 5 期被抹掉
});

test('prepaymentBenefit 金额为 0 返回零收益', () => {
  const debt = { principal: 120000, apr: 5, term_months: 120, repayment_method: 'equal_installment' };
  assert.deepEqual(prepaymentBenefit(debt, 0, 12), { interestSaved: 0, termShortenedMonths: 0 });
});
