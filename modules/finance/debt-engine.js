/**
 * 债务引擎 (Debt Engine) — finance-v2 纯函数核心
 *
 * 设计约束（见 docs/refactor-yuvomi/finance-v2-design.md）：
 *  - 全部为纯函数：输入普通对象/数组，输出普通对象/数组，无 DB / 无 Req 依赖。
 *  - 零新依赖：IRR / 摊销 / 重定价均用原生数学实现。
 *  - 银行级四项能力：P0-1 LPR 重定价、P0-2 勾稽、P1-1 IRR/EAR、P1-2 提前还款收益。
 *
 * 利率口径：所有 `apr` / `rate` 字段以“百分比”表示（4.9 = 4.9%）。
 */

/* =========================================================================
 * 内置 LPR 历史种子（2022–2026，无法联网时的基准；随央行公布可更新）
 * effective_date 为“生效日”，lookupRate 取生效日之前最新一条。
 * ========================================================================= */
export const LPR_HISTORY = [
  // LPR 1年期
  { benchmark: 'LPR_1Y', rate: 3.70, effective_date: '2022-01-20' },
  { benchmark: 'LPR_1Y', rate: 3.65, effective_date: '2022-08-22' },
  { benchmark: 'LPR_1Y', rate: 3.55, effective_date: '2023-06-20' },
  { benchmark: 'LPR_1Y', rate: 3.45, effective_date: '2023-08-21' },
  { benchmark: 'LPR_1Y', rate: 3.35, effective_date: '2024-07-22' },
  { benchmark: 'LPR_1Y', rate: 3.10, effective_date: '2024-10-21' },
  { benchmark: 'LPR_1Y', rate: 3.00, effective_date: '2025-05-20' },
  // LPR 5年期
  { benchmark: 'LPR_5Y', rate: 4.60, effective_date: '2022-01-20' },
  { benchmark: 'LPR_5Y', rate: 4.45, effective_date: '2022-05-20' },
  { benchmark: 'LPR_5Y', rate: 4.30, effective_date: '2022-08-22' },
  { benchmark: 'LPR_5Y', rate: 4.20, effective_date: '2023-06-20' },
  { benchmark: 'LPR_5Y', rate: 3.95, effective_date: '2024-02-20' },
  { benchmark: 'LPR_5Y', rate: 3.85, effective_date: '2024-07-22' },
  { benchmark: 'LPR_5Y', rate: 3.60, effective_date: '2024-10-21' },
  { benchmark: 'LPR_5Y', rate: 3.50, effective_date: '2025-05-20' },
  // 央行贷款基准利率（旧合同锚，5年期以上口径）
  { benchmark: 'PBOC_BASE', rate: 4.30, effective_date: '2022-01-01' },
  { benchmark: 'PBOC_BASE', rate: 3.95, effective_date: '2024-02-20' },
  { benchmark: 'PBOC_BASE', rate: 3.60, effective_date: '2024-10-21' },
  { benchmark: 'PBOC_BASE', rate: 3.50, effective_date: '2025-05-20' },
];

/* =========================================================================
 * 日期工具（仅处理 YYYY-MM-DD / YYYY-MM-DDTHH... 字符串，避免时区漂移）
 * ========================================================================= */

/** 取日期的 YYYY-MM-DD 部分。 */
export function dateOnly(iso) {
  if (!iso) return null;
  return String(iso).slice(0, 10);
}

/** 在 YYYY-MM-DD 上加减 n 个月，自动按当月最后一天夹紧（溢出安全）。 */
export function addMonths(iso, n) {
  const d = dateOnly(iso);
  if (!d) return null;
  const [y, m, day] = d.split('-').map(Number);
  let total = y * 12 + (m - 1) + n;
  let ny = Math.floor(total / 12);
  let nm = (total % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  const nd = Math.min(day, last);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** dateA <= dateB 比较（字符串字典序对 YYYY-MM-DD 成立）。 */
function le(a, b) { return a <= b; }

/** 在固定 MM-DD 上找到 >= base 的第一个日期。 */
function nextFixedDate(mmdd, base) {
  const [mm, dd] = mmdd.split('-').map(Number);
  const b = dateOnly(base);
  const [by, bm, bd] = b.split('-').map(Number);
  let year = by;
  let candidate = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  if (candidate < b) year += 1;
  const last = new Date(year, mm, 0).getDate();
  const nd = Math.min(dd, last);
  return `${year}-${String(mm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

/** 从 LPR 历史取某基准在 date 当天生效的利率（取生效日之前最新一条）。 */
export function lookupRate(lprHistory, benchmark, date) {
  const d = dateOnly(date);
  let best = null;
  for (const row of lprHistory) {
    if (row.benchmark !== benchmark) continue;
    if (row.effective_date <= d) {
      if (!best || row.effective_date > best.effective_date) best = row;
    }
  }
  return best ? best.rate : null;
}

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const round6 = (x) => Math.round((x + Number.EPSILON) * 1e6) / 1e6;

/* =========================================================================
 * 解析器：repricing / rate_adjustments 可能是 JSON 字符串或对象
 * ========================================================================= */
function parseJSONField(field) {
  if (field == null || field === '') return null;
  if (typeof field === 'object') return field;
  try { return JSON.parse(field); } catch { return null; }
}
function parseAdjustments(field) {
  const v = parseJSONField(field);
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && a.date != null && a.rate != null)
    .map((a) => ({ date: dateOnly(a.date), rate: Number(a.rate) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* =========================================================================
 * 3.1 amortize(debt, opts) → 还款计划
 * ========================================================================= */

/**
 * 生成还款计划。
 * @param {object} debt 债务对象（至少需要 principal / apr / term_months / repayment_method）。
 * @param {object} [opts]
 *   - lprHistory: 覆盖内置 LPR_HISTORY
 *   - repricingEvents: 预计算的重定价事件（否则浮动利率时自动派生）
 *   - now: 仅用于标记，不改计算
 * @returns {Array<{period,date,payment,principal,interest,balance,rate,repricing}>}
 */
export function amortize(debt, opts = {}) {
  const principal = Number(debt?.principal) || 0;
  const term = Number(debt?.term_months) || 0;
  const apr = debt?.apr != null ? Number(debt.apr) : 0;
  const method = debt?.repayment_method || 'equal_installment';
  const balloon = Number(debt?.balloon_amount) || 0;
  if (term <= 0 || principal <= 0) return [];

  // 首期日期：优先首次还款日，否则起始日+1月
  const base = dateOnly(debt?.first_payment_date) || (debt?.start_date ? addMonths(dateOnly(debt.start_date), 1) : null);
  const periodDate = (i) => (base ? addMonths(base, i - 1) : null);

  // 重定价事件（利率切换点）
  let events = opts.repricingEvents || null;
  if (!events && debt?.interest_type === 'floating') {
    const rule = parseJSONField(debt.repricing);
    if (rule && rule.benchmark && base) {
      events = generateRepricingAdjustments(rule, base, term, opts.lprHistory || LPR_HISTORY);
    }
  }
  const adjustments = parseAdjustments(debt?.rate_adjustments);

  // 当期利率：重定价事件 > 手动覆盖 > apr
  const rateForDate = (dateISO) => {
    if (events && events.length) {
      let best = null;
      for (const e of events) if (le(e.effectiveDate, dateISO)) best = e;
      if (best) return best.rate;
    }
    if (adjustments.length) {
      let best = null;
      for (const a of adjustments) if (le(a.date, dateISO)) best = a;
      if (best) return best.rate;
    }
    return apr;
  };

  const effPrincipal = Math.max(0, principal - balloon); // 期内摊销本金（气球部分期末一次性）
  const r0 = apr / 100 / 12;
  let pay = method === 'equal_installment' ? pmt(effPrincipal, r0, term) : 0;

  const schedule = [];
  let balance = principal;
  let prevRate = null;

  for (let i = 1; i <= term; i++) {
    const dateISO = periodDate(i);
    const ratePct = rateForDate(dateISO);
    const r = ratePct / 100 / 12;

    // 浮动利率 + 等额本息：利率变化时，按剩余本金与剩余期数重算月供
    if (method === 'equal_installment' && prevRate !== null && ratePct !== prevRate) {
      const rem = term - (i - 1);
      pay = rem > 0 ? pmt(balance, r, rem) : 0;
    }

    let interest = 0;
    let principalPart = 0;
    let payment = 0;

    if (method === 'equal_installment') {
      interest = balance * r;
      principalPart = pay - interest;
      payment = pay;
    } else if (method === 'equal_principal') {
      principalPart = effPrincipal / term;
      interest = balance * r;
      payment = principalPart + interest;
    } else if (method === 'interest_only' || method === 'bullet') {
      interest = balance * r;
      principalPart = 0; // 本金期末一次性
      payment = interest;
    } else {
      // 兜底：等额本息
      interest = balance * r;
      principalPart = pay - interest;
      payment = pay;
    }

    // 期末：结清剩余本金（+ 气球）
    if (i === term) {
      principalPart = balance; // 含气球部分一并结清
      payment = principalPart + interest;
    }

    balance -= principalPart;
    // 浮点收尾
    if (balance < 0.005 && balance > -0.005) balance = 0;

    schedule.push({
      period: i,
      date: dateISO,
      payment: round2(payment),
      principal: round2(principalPart),
      interest: round2(interest),
      balance: round2(balance),
      rate: ratePct,
      repricing: prevRate !== null && ratePct !== prevRate,
    });
    prevRate = ratePct;
  }

  return schedule;
}

/** 等额本息月供。本金 P、月利率 r、期数 n。 */
function pmt(P, r, n) {
  if (n <= 0) return 0;
  if (r === 0) return P / n;
  const f = Math.pow(1 + r, n);
  return (P * r * f) / (f - 1);
}

/* =========================================================================
 * 3.2 generateRepricingAdjustments(rule, startDate, termMonths, lprHistory)
 * ========================================================================= */

/**
 * 生成浮动利率重定价事件序列（含起贷日初始利率）。
 * @param {object} rule { benchmark, spread, cycleMonths, anchor, fixedDate? }
 *   - benchmark: 'LPR_1Y' | 'LPR_5Y' | 'PBOC_BASE'
 *   - spread: 永久加点（百分比，如 0.5 = +0.5%）
 *   - cycleMonths: 12(年) / 6(半年) / 3(季)
 *   - anchor: 'anniversary'(对年对月对日) | 'fixed_date'(固定日历日)
 *   - fixedDate: 'MM-DD'，anchor=fixed_date 时必填
 * @param {string} startDate YYYY-MM-DD（起贷日 / 首次还款日基准）
 * @param {number} termMonths 期限（月）
 * @param {Array} lprHistory LPR 历史（默认内置）
 * @returns {Array<{effectiveDate, rate, basis}>}
 */
export function generateRepricingAdjustments(rule, startDate, termMonths, lprHistory) {
  const lpr = lprHistory && lprHistory.length ? lprHistory : LPR_HISTORY;
  const base = dateOnly(startDate);
  if (!rule || !rule.benchmark || !base) return [];
  const spread = Number(rule.spread) || 0;
  const cycle = Number(rule.cycleMonths) || 12;
  const anchor = rule.anchor || 'anniversary';

  const endDate = addMonths(base, Number(termMonths) || 0);
  const events = [];

  // 初始利率（起贷日即按 基准+加点）
  const initRate = lookupRate(lpr, rule.benchmark, base);
  events.push({
    effectiveDate: base,
    rate: round2((initRate ?? 0) + spread),
    basis: `${rule.benchmark}@${base}+${spread}`,
  });

  // 后续重定价点
  let cursor;
  if (anchor === 'fixed_date' && rule.fixedDate) {
    cursor = nextFixedDate(rule.fixedDate, base);
  } else {
    cursor = addMonths(base, cycle); // anniversary：对年对月对日
  }

  let guard = 0;
  while (le(cursor, endDate) && guard < 2000) {
    const rate = lookupRate(lpr, rule.benchmark, cursor);
    events.push({
      effectiveDate: cursor,
      rate: round2((rate ?? 0) + spread),
      basis: `${rule.benchmark}@${cursor}+${spread}`,
    });
    cursor = addMonths(cursor, cycle);
    guard += 1;
  }

  // 去重 + 排序
  const seen = new Set();
  const out = [];
  for (const e of events) {
    if (seen.has(e.effectiveDate)) continue;
    seen.add(e.effectiveDate);
    out.push(e);
  }
  out.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));
  return out;
}

/* =========================================================================
 * 3.3 computeIRR(cashflows) → { monthly, ear }
 * ========================================================================= */

/**
 * 借款人视角 IRR（月）/ EAR（年化）。
 * @param {number[]} cashflows 索引=期数（月）。t0 收本金(+)、其后每月月供(-)、提前还款(-)。
 * @returns {{monthly:number, ear:number}|null} 全正/全负或无符号变化返回 null。
 */
export function computeIRR(cashflows) {
  if (!Array.isArray(cashflows) || cashflows.length < 2) return null;
  const hasPos = cashflows.some((c) => c > 0);
  const hasNeg = cashflows.some((c) => c < 0);
  if (!hasPos || !hasNeg) return null; // 同号无解

  const npv = (rate) => cashflows.reduce((s, c, i) => s + c / Math.pow(1 + rate, i), 0);

  // 二分法：月利率区间 [-0.999999, 10]（即 -99.999% ~ 1000%）
  let lo = -0.999999;
  let hi = 10;
  let fLo = npv(lo);
  let fHi = npv(hi);
  if (fLo === 0) return { monthly: round6(lo), ear: round6(Math.pow(1 + lo, 12) - 1) };
  if (fHi === 0) return { monthly: round6(hi), ear: round6(Math.pow(1 + hi, 12) - 1) };
  if (fLo * fHi > 0) return null; // 无符号变化，无法求解

  let mid = (lo + hi) / 2;
  for (let k = 0; k < 300; k++) {
    mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-9) break;
    if (fLo * fMid < 0) { hi = mid; fHi = fMid; }
    else { lo = mid; fLo = fMid; }
  }
  const monthly = (lo + hi) / 2;
  const ear = Math.pow(1 + monthly, 12) - 1;
  return { monthly: round6(monthly), ear: round6(ear) };
}

/* =========================================================================
 * 3.4 debtProgressSummary(debt, actualPayments, opts) → 勾稽
 * ========================================================================= */

/**
 * 计划已还 vs 实际已还 勾稽。
 * @param {object} debt 债务对象
 * @param {Array<{amount:number,date?:string}>} actualPayments 真实还款流水（debt_payment）
 * @param {object} [opts] { now: 'YYYY-MM-DD' }
 * @returns {{paidPrincipal:number, actualPaidPrincipal:number, delta:number, status:string, periodsPaid:number, periodsActual:number}}
 *   status: 'ahead'(绿, delta>0.5) | 'behind'(琥珀, delta<-0.5) | 'on_track'(灰)
 */
export function debtProgressSummary(debt, actualPayments = [], opts = {}) {
  const now = dateOnly(opts.now) || dateOnly(new Date().toISOString());
  const sched = amortize(debt, opts);
  if (!sched.length) {
    return { paidPrincipal: 0, actualPaidPrincipal: 0, delta: 0, status: 'on_track', periodsPaid: 0, periodsActual: 0 };
  }
  // 按计划（时间口径）应已还本金
  const paidPrincipal = sched
    .filter((p) => p.date && le(p.date, now))
    .reduce((s, p) => s + p.principal, 0);
  // 实际：按真实流水笔数 N，取前 N 期本金累计
  const n = Array.isArray(actualPayments) ? actualPayments.length : 0;
  const actualPaidPrincipal = sched.slice(0, n).reduce((s, p) => s + p.principal, 0);
  const delta = round2(actualPaidPrincipal - paidPrincipal);
  let status = 'on_track';
  if (delta > 0.5) status = 'ahead';
  else if (delta < -0.5) status = 'behind';
  return {
    paidPrincipal: round2(paidPrincipal),
    actualPaidPrincipal: round2(actualPaidPrincipal),
    delta,
    status,
    periodsPaid: sched.filter((p) => p.date && le(p.date, now)).length,
    periodsActual: n,
  };
}

/* =========================================================================
 * 3.5 prepaymentBenefit(debt, extra, atPeriod, opts) → 提前还款收益
 * ========================================================================= */

/**
 * 量化提前还款收益（默认策略：月供不变、缩短期限）。
 * @param {object} debt 债务对象
 * @param {number} extra 第 atPeriod 期后一次性多还金额
 * @param {number} atPeriod 在第几期之后提前还（1-based）
 * @param {object} [opts] { strategy: 'shorten'|'reduce' } 首版默认 shorten
 * @returns {{interestSaved:number, termShortenedMonths:number}}
 */
export function prepaymentBenefit(debt, extra, atPeriod, opts = {}) {
  const sched = amortize(debt, opts);
  const term = sched.length;
  if (!term || !(Number(extra) > 0)) return { interestSaved: 0, termShortenedMonths: 0 };

  const baselineInterest = sched.reduce((s, p) => s + p.interest, 0);
  const k = Math.min(Math.max(1, Math.floor(Number(atPeriod) || term)), term);

  // 第 k 期期末余额（已扣当期本金）
  const balAtK = sched[k - 1].balance;
  const newBalance = balAtK - Number(extra);
  const paidInterestBefore = sched.slice(0, k).reduce((s, p) => s + p.interest, 0);

  // 提前还款即结清
  if (newBalance <= 0) {
    return { interestSaved: round2(baselineInterest - paidInterestBefore), termShortenedMonths: term - k };
  }

  // 月供沿用第 k 期月供（等额本息恒定；等额本金取第 k 期）
  const pay = sched[k - 1].payment;
  const r = (Number(debt?.apr) || 0) / 100 / 12;

  let bal = newBalance;
  let newInterest = paidInterestBefore;
  let rem = 0;
  let guard = 0;
  while (bal > 0.005 && guard < 2000) {
    const interest = bal * r;
    let principalPart = pay - interest;
    let payment = pay;
    if (principalPart >= bal) {
      principalPart = bal;
      payment = bal + interest;
      bal = 0;
    } else {
      bal -= principalPart;
    }
    newInterest += interest;
    rem += 1;
    guard += 1;
  }

  const newTerm = k + rem;
  return {
    interestSaved: round2(baselineInterest - newInterest),
    termShortenedMonths: Math.max(0, term - newTerm),
  };
}

/* =========================================================================
 * 便捷：构建 IRR 现金流（借款人视角）
 * ========================================================================= */

/**
 * 由债务 + 计划生成 IRR 现金流。
 * @param {object} debt
 * @param {object} [opts] { lprHistory, extraPayments: [{amount, atPeriod}] }
 * @returns {number[]|null} 不足 2 期返回 null
 */
export function buildCashflows(debt, opts = {}) {
  const sched = amortize(debt, opts);
  if (sched.length < 1) return null;
  const net0 = Number(debt?.principal) - (Number(debt?.origination_fee) || 0); // t0 净到手
  const flows = [net0];
  for (const p of sched) flows.push(-p.payment);
  // 提前还款作为额外流出（折算到对应期）
  if (Array.isArray(opts.extraPayments)) {
    for (const ep of opts.extraPayments) {
      const idx = Math.min(sched.length, Math.max(1, Number(ep.atPeriod) || sched.length)) + 1;
      flows[idx] = (flows[idx] || 0) - Number(ep.amount);
    }
  }
  return flows;
}
