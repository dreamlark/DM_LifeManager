import { db } from '../../db/client';
import { debts, incomes, transactions, assets } from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import type {
  DebtView,
  IncomeView,
  TransactionView,
  AssetView,
  FinanceSummary,
} from '@dm-life/shared';
import { getDebtSummary, getRepaymentSchedule, type DebtCalcInput, type ScheduleRow, type DebtSummary } from './schedule';

type DebtRow = typeof debts.$inferSelect;
type IncomeRow = typeof incomes.$inferSelect;
type TxnRow = typeof transactions.$inferSelect;
type AssetRow = typeof assets.$inferSelect;
type AssetClass = (typeof assets.$inferInsert)['assetClass'];

function parseJsonArray(raw: string | null): any[] {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string | null): any | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
  } catch {
    return null;
  }
}

function safeStr(v: unknown): string {
  return v == null ? '' : String(v);
}

function debtRowToView(r: DebtRow): DebtView {
  return {
    id: r.id,
    creditor: r.creditor,
    principal: r.principal,
    apr: r.apr,
    minPayment: r.minPayment,
    dueDay: r.dueDay,
    status: r.status,
    debtType: r.debtType,
    termMonths: r.termMonths,
    repaymentMethod: r.repaymentMethod,
    startDate: r.startDate,
    rateType: r.rateType,
    baseRate: r.baseRate,
    rateSpread: r.rateSpread,
    rateAdjustments: parseJsonArray(r.rateAdjustments),
    repricing: parseJsonObject(r.repricing),
    prepayments: parseJsonArray(r.prepayments).map((p: any) => ({
      date: safeStr(p.date),
      amount: Number(p.amount) || 0,
      type: p.type ?? 'reduce_term',
    })),
    parentDebtId: r.parentDebtId,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
function incomeRowToView(r: IncomeRow): IncomeView {
  return {
    id: r.id,
    source: r.source,
    amount: r.amount,
    currency: r.currency,
    receivedAt: r.receivedAt,
    recurring: !!r.recurring,
    note: r.note,
    incomeType: r.incomeType,
    monthlyAvg: r.monthlyAvg,
    isFixed: !!r.isFixed,
    incomeMode: r.incomeMode,
    payDay: r.payDay,
    adjustmentDay: r.adjustmentDay,
    rateAdjustments: parseJsonArray(r.rateAdjustments).map((a: any) => ({
      effectiveDate: safeStr(a.effectiveDate),
      newAmount: Number(a.newAmount) || 0,
    })),
    createdAt: r.createdAt,
  };
}
function txnRowToView(r: TxnRow): TransactionView {
  return {
    id: r.id,
    kind: r.kind,
    category: r.category,
    amount: r.amount,
    merchant: r.merchant,
    occurredAt: r.occurredAt,
    debtId: r.debtId,
    incomeSourceId: r.incomeSourceId,
    note: r.note,
    createdAt: r.createdAt,
  };
}
function assetRowToView(r: AssetRow): AssetView {
  return {
    id: r.id,
    name: r.name,
    assetClass: r.assetClass,
    value: r.value,
    asOf: r.asOf,
    linkedIncomeSourceId: r.linkedIncomeSourceId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** 把 DebtRow 映射成还款引擎输入 */
function debtRowToCalcInput(r: DebtRow): DebtCalcInput {
  return {
    principal: r.principal,
    annualRate: r.apr ?? 0,
    termMonths: r.termMonths ?? 0,
    repaymentMethod: (r.repaymentMethod as DebtCalcInput['repaymentMethod']) ?? 'equal_installment',
    startDate: r.startDate ?? r.createdAt,
    rateType: (r.rateType as DebtCalcInput['rateType']) ?? null,
    baseRate: r.baseRate ?? null,
    rateSpread: r.rateSpread ?? null,
    rateAdjustments: r.rateAdjustments ?? null,
    repricing: r.repricing ?? null,
    prepayments: r.prepayments ?? null,
  };
}

/* ---------- 债务 ---------- */
export function listDebts(): DebtView[] {
  const rows = db.select().from(debts).orderBy(desc(debts.createdAt)).all() as DebtRow[];
  return rows.map(debtRowToView);
}
export function getDebt(id: string): DebtRow | undefined {
  return db.select().from(debts).where(eq(debts.id, id)).get() as DebtRow | undefined;
}
export function getIncome(id: string): IncomeRow | undefined {
  return db.select().from(incomes).where(eq(incomes.id, id)).get() as IncomeRow | undefined;
}
export function getTransaction(id: string): TxnRow | undefined {
  return db.select().from(transactions).where(eq(transactions.id, id)).get() as TxnRow | undefined;
}
export function getAsset(id: string): AssetRow | undefined {
  return db.select().from(assets).where(eq(assets.id, id)).get() as AssetRow | undefined;
}
export function insertDebt(p: {
  id: string;
  creditor: string;
  principal: number;
  apr: number | null;
  minPayment: number | null;
  dueDay: number | null;
  status: 'active' | 'paid' | 'frozen';
  now: string;
  debtType?: string;
  termMonths?: number | null;
  repaymentMethod?: string;
  startDate?: string | null;
  rateType?: string | null;
  baseRate?: number | null;
  rateSpread?: number | null;
  rateAdjustments?: string | null;
  repricing?: string | null;
  prepayments?: string | null;
  parentDebtId?: string | null;
  note?: string;
}): void {
  db.insert(debts)
    .values({
      id: p.id,
      creditor: p.creditor,
      principal: p.principal,
      apr: p.apr,
      minPayment: p.minPayment,
      dueDay: p.dueDay,
      status: p.status,
      debtType: p.debtType ?? 'other',
      termMonths: p.termMonths ?? null,
      repaymentMethod: p.repaymentMethod ?? 'equal_installment',
      startDate: p.startDate ?? null,
      rateType: p.rateType ?? null,
      baseRate: p.baseRate ?? null,
      rateSpread: p.rateSpread ?? null,
      rateAdjustments: p.rateAdjustments ?? null,
      repricing: p.repricing ?? null,
      prepayments: p.prepayments ?? null,
      parentDebtId: p.parentDebtId ?? null,
      note: p.note ?? '',
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}
export function updateDebtFields(
  id: string,
  fields: Partial<{
    creditor: string;
    principal: number;
    apr: number | null;
    minPayment: number | null;
    dueDay: number | null;
    status: 'active' | 'paid' | 'frozen';
    debtType: string;
    termMonths: number | null;
    repaymentMethod: string;
    startDate: string | null;
    rateType: string | null;
    baseRate: number | null;
    rateSpread: number | null;
    rateAdjustments: string | null;
    repricing: string | null;
    prepayments: string | null;
    parentDebtId: string | null;
    note: string | null;
  }>,
  now: string,
): void {
  db.update(debts).set({ ...fields, updatedAt: now }).where(eq(debts.id, id)).run();
}

export function deleteDebtById(id: string): void {
  db.delete(debts).where(eq(debts.id, id)).run();
}

/* ---------- 收入 ---------- */
export function listIncomes(): IncomeView[] {
  const rows = db.select().from(incomes).orderBy(desc(incomes.receivedAt)).all() as IncomeRow[];
  return rows.map(incomeRowToView);
}
export function insertIncome(p: {
  id: string;
  source: string;
  amount: number;
  currency: string;
  receivedAt: string;
  recurring: boolean;
  note: string;
  now: string;
  incomeType?: string;
  monthlyAvg?: number | null;
  isFixed?: boolean;
  incomeMode?: string;
  payDay?: number | null;
  adjustmentDay?: number | null;
  rateAdjustments?: string | null;
}): void {
  db.insert(incomes)
    .values({
      id: p.id,
      source: p.source,
      amount: p.amount,
      currency: p.currency,
      receivedAt: p.receivedAt,
      recurring: p.recurring,
      note: p.note,
      incomeType: p.incomeType ?? 'salary',
      monthlyAvg: p.monthlyAvg ?? null,
      isFixed: p.isFixed ?? true,
      incomeMode: p.incomeMode ?? 'monthly',
      payDay: p.payDay ?? null,
      adjustmentDay: p.adjustmentDay ?? null,
      rateAdjustments: p.rateAdjustments ?? null,
      createdAt: p.now,
    })
    .run();
}
/** incomes 表无 updatedAt 列，仅更新传入字段 */
export function updateIncomeFields(
  id: string,
  fields: Partial<{
    source: string;
    amount: number;
    note: string;
    incomeType: string;
    monthlyAvg: number | null;
    isFixed: boolean;
    incomeMode: string;
    payDay: number | null;
    adjustmentDay: number | null;
    rateAdjustments: string | null;
  }>,
): void {
  db.update(incomes).set({ ...fields }).where(eq(incomes.id, id)).run();
}
export function deleteIncomeById(id: string): void {
  db.delete(incomes).where(eq(incomes.id, id)).run();
}

/* ---------- 交易流水 ---------- */
export function listTransactions(): TransactionView[] {
  const rows = db.select().from(transactions).orderBy(desc(transactions.occurredAt)).all() as TxnRow[];
  return rows.map(txnRowToView);
}
export function insertTransaction(p: {
  id: string;
  kind: 'expense' | 'income' | 'debt_payment';
  category: string;
  amount: number;
  merchant: string | null;
  occurredAt: string;
  note: string;
  debtId?: string | null;
  incomeSourceId?: string | null;
  now: string;
}): void {
  db.insert(transactions)
    .values({
      id: p.id,
      kind: p.kind,
      category: p.category,
      amount: p.amount,
      merchant: p.merchant,
      occurredAt: p.occurredAt,
      note: p.note,
      debtId: p.debtId ?? null,
      incomeSourceId: p.incomeSourceId ?? null,
      createdAt: p.now,
    })
    .run();
}
/** transactions 表无 updatedAt 列，仅更新传入字段 */
export function updateTransactionFields(
  id: string,
  fields: Partial<{
    kind: 'expense' | 'income' | 'debt_payment';
    category: string;
    amount: number;
    note: string;
    debtId: string | null;
    incomeSourceId: string | null;
  }>,
): void {
  db.update(transactions).set({ ...fields }).where(eq(transactions.id, id)).run();
}
export function deleteTransactionById(id: string): void {
  db.delete(transactions).where(eq(transactions.id, id)).run();
}

/* ---------- 资产 ---------- */
export function listAssets(): AssetView[] {
  const rows = db.select().from(assets).orderBy(desc(assets.asOf)).all() as AssetRow[];
  return rows.map(assetRowToView);
}
export function insertAsset(p: {
  id: string;
  name: string;
  assetClass: AssetClass;
  value: number;
  asOf: string;
  linkedIncomeSourceId?: string | null;
  now: string;
}): void {
  db.insert(assets)
    .values({
      id: p.id,
      name: p.name,
      assetClass: p.assetClass,
      value: p.value,
      asOf: p.asOf,
      linkedIncomeSourceId: p.linkedIncomeSourceId ?? null,
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}
export function updateAssetValue(
  id: string,
  value: number,
  asOf: string,
  now: string,
  linkedIncomeSourceId?: string | null,
  assetClass?: AssetClass,
  name?: string,
): void {
  const set: Partial<typeof assets.$inferInsert> = { value, asOf, updatedAt: now };
  if (linkedIncomeSourceId !== undefined) set.linkedIncomeSourceId = linkedIncomeSourceId;
  if (assetClass !== undefined) set.assetClass = assetClass;
  if (name !== undefined) set.name = name;
  db.update(assets).set(set).where(eq(assets.id, id)).run();
}
export function deleteAssetById(id: string): void {
  db.delete(assets).where(eq(assets.id, id)).run();
}

/* ---------- 还款计划（引擎计算） ---------- */
export function debtSchedule(id: string): { summary: DebtSummary; schedule: ScheduleRow[] } | null {
  const row = getDebt(id);
  if (!row) return null;
  const input = debtRowToCalcInput(row);
  return { summary: getDebtSummary(input), schedule: getRepaymentSchedule(input) };
}

export interface DebtProgressItem {
  id: string;
  creditor: string;
  debtType: string;
  status: string;
  principal: number;
  remainingPrincipal: number;
  /** 计划已还本金（按起贷日推算：本金 - 剩余本金） */
  paidPrincipal: number;
  /** 实际已还本金（Σ 实际 debt_payment 流水对应期本金；P0-2 勾稽） */
  actualPaidPrincipal: number;
  paidMonths: number;
  totalMonths: number;
  progress: number;
  /** 本金偿还进度（已还本金 / 原始本金） */
  principalProgress: number;
}

export interface DebtProgressOverall {
  /** 整体还款进度（按本金加权的单笔进度均值，与单笔进度条口径一致） */
  progress: number;
  paidPrincipal: number;
  /** 实际已还本金合计（P0-2 勾稽） */
  actualPaidPrincipal: number;
  remainingPrincipal: number;
  totalPrincipal: number;
  paidMonths: number;
  totalMonths: number;
}

/**
 * 双层还款进度汇总：
 *  - items：每笔债务的「单笔进度」（已还本金 / 剩余本金 / 已还期数 / 总期数 / 进度）
 *  - overall：跨所有有期限债务的「整体进度」（按本金加权，与单笔进度条同一口径）
 * 一次查询计算全部，避免前端对每笔债务各发一次 debtSchedule。
 */
export function debtProgressSummary(): { items: DebtProgressItem[]; overall: DebtProgressOverall } {
  const rows = (db.select().from(debts).all() as DebtRow[]).filter((d) => (d.termMonths ?? 0) > 0);

  // 实际还款流水（按债务分组），用于 P0-2 勾稽「实际已还本金」
  const payTxns = (db.select().from(transactions).all() as TxnRow[]).filter(
    (t) => t.kind === 'debt_payment' && t.debtId,
  );
  const txnCountByDebt = new Map<string, number>();
  for (const t of payTxns) {
    if (!t.debtId) continue;
    txnCountByDebt.set(t.debtId, (txnCountByDebt.get(t.debtId) ?? 0) + 1);
  }

  const items: DebtProgressItem[] = rows.map((r) => {
    const sum = getDebtSummary(debtRowToCalcInput(r));
    const progress = r.status === 'paid' ? 1 : sum.progress;
    const principalProgress = r.status === 'paid' ? 1 : sum.principalProgress;
    const plannedPaid = Math.max(0, r.principal - sum.remainingPrincipal);
    // 实际已还本金：有真实还款流水时，按流水期数累计还款计划对应期本金；否则回退到计划值。
    const actualCount = txnCountByDebt.get(r.id) ?? 0;
    let actualPaid = plannedPaid;
    if (actualCount > 0 && sum.totalMonths > 0) {
      const schedule = getRepaymentSchedule(debtRowToCalcInput(r));
      const n = Math.min(actualCount, schedule.length);
      actualPaid = schedule.slice(0, n).reduce((s, row) => s + row.principal, 0);
    }
    return {
      id: r.id,
      creditor: r.creditor,
      debtType: r.debtType,
      status: r.status,
      principal: r.principal,
      remainingPrincipal: sum.remainingPrincipal,
      paidPrincipal: round2(plannedPaid),
      actualPaidPrincipal: round2(actualPaid),
      paidMonths: sum.paidMonths,
      totalMonths: sum.totalMonths,
      progress: Math.max(0, Math.min(1, progress)),
      principalProgress: Math.max(0, Math.min(1, principalProgress)),
    };
  });

  let totalPrincipal = 0;
  let weightedProgress = 0;
  let totalPaidPrincipal = 0;
  let totalActualPaid = 0;
  let totalRemaining = 0;
  let totalMonthsAll = 0;
  let paidMonthsAll = 0;
  for (const it of items) {
    totalPrincipal += it.principal;
    totalPaidPrincipal += it.paidPrincipal;
    totalActualPaid += it.actualPaidPrincipal;
    totalRemaining += it.remainingPrincipal;
    totalMonthsAll += it.totalMonths;
    paidMonthsAll += it.paidMonths;
    weightedProgress += it.principalProgress * it.principal;
  }
  const overallProgress = totalPrincipal > 0 ? weightedProgress / totalPrincipal : 0;

  return {
    items,
    overall: {
      progress: Math.max(0, Math.min(1, overallProgress)),
      paidPrincipal: round2(totalPaidPrincipal),
      actualPaidPrincipal: round2(totalActualPaid),
      remainingPrincipal: round2(totalRemaining),
      totalPrincipal: round2(totalPrincipal),
      paidMonths: paidMonthsAll,
      totalMonths: totalMonthsAll,
    },
  };
}

/**
 * 债务优化建议（P1-3）：雪崩法（先还高利率）/ 滚雪球法（先还小额）。
 * 基于真实引擎摘要（当前利率、剩余本金、月供）排序，返回带理由与排名的建议序列。
 */
export interface PayoffAdviceItem {
  debtId: string;
  creditor: string;
  currentRate: number;
  remainingPrincipal: number;
  monthlyPayment: number;
  rank: number;
  reason: string;
}
export function debtPayoffAdvice(mode: 'avalanche' | 'snowball'): PayoffAdviceItem[] {
  const rows = (db.select().from(debts).all() as DebtRow[]).filter(
    (d) => d.status === 'active' && (d.termMonths ?? 0) > 0,
  );
  const items: PayoffAdviceItem[] = rows.map((r) => {
    const sum = getDebtSummary(debtRowToCalcInput(r));
    return {
      debtId: r.id,
      creditor: r.creditor,
      currentRate: sum.currentRate,
      remainingPrincipal: sum.remainingPrincipal,
      monthlyPayment: sum.monthlyPayment,
      rank: 0,
      reason: '',
    };
  });

  const cmp =
    mode === 'avalanche'
      ? (a: PayoffAdviceItem, b: PayoffAdviceItem) => b.currentRate - a.currentRate || b.remainingPrincipal - a.remainingPrincipal
      : (a: PayoffAdviceItem, b: PayoffAdviceItem) => a.remainingPrincipal - b.remainingPrincipal || b.currentRate - a.currentRate;

  items.sort((a, b) => cmp(a, b));

  items.forEach((it, i) => {
    it.rank = i + 1;
    if (mode === 'avalanche') it.reason = `利率最高 ${it.currentRate}%，先还省利息`;
    else it.reason = `余额最小 ${fmt0(it.remainingPrincipal)}，先还得正反馈`;
  });
  return items;
}

function fmt0(n: number): string {
  return `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`;
}

/* ---------- 月度收支趋势 ---------- */
export function monthlyTrend(months: number): { month: string; income: number; expense: number; net: number }[] {
  const now = new Date();
  const trend: { month: string; income: number; expense: number; net: number }[] = [];
  const txnRows = db.select().from(transactions).all() as TxnRow[];

  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthTxns = txnRows.filter((t) => (t.occurredAt || '').slice(0, 7) === monthStr);
    const income = monthTxns.filter((t) => t.kind === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = monthTxns
      .filter((t) => t.kind === 'expense' || t.kind === 'debt_payment')
      .reduce((s, t) => s + t.amount, 0);
    trend.push({
      month: monthStr,
      income: round2(income),
      expense: round2(expense),
      net: round2(income - expense),
    });
  }
  return trend;
}

/* ---------- 自动刷新：生成本月固定收入 + 债务还款流水 ---------- */
export function autoGenerateMonthly(now = new Date()): { incomes: number; debts: number; skipped: number } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const thisMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  let incomes = 0;
  let debts = 0;
  let skipped = 0;

  // 已存在的本月流水（按 来源/债务 + 月份 去重）
  const existing = db.select().from(transactions).all() as TxnRow[];
  const existingKeys = new Set(
    existing.filter((t) => (t.occurredAt || '').slice(0, 7) === thisMonthStr).map((t) => txnKey(t)),
  );

  // 固定收入源
  const incomeRows = db.select().from(incomes).all() as IncomeRow[];
  for (const inc of incomeRows) {
    if (inc.incomeMode !== 'monthly') continue;
    const payDay = Math.min(inc.payDay ?? 28, lastDay);
    const payDate = `${thisMonthStr}-${String(payDay).padStart(2, '0')}`;
    if (now < new Date(payDate)) continue;
    const amount = inc.monthlyAvg ?? inc.amount;
    const key = `income:${inc.id}:${thisMonthStr}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const id = `tx_${cryptoRandom()}`;
    insertTransaction({
      id,
      kind: 'income',
      category: inc.source,
      amount,
      merchant: null,
      occurredAt: payDate,
      note: '自动生成',
      incomeSourceId: inc.id,
      now: now.toISOString(),
    });
    incomes += 1;
  }

  // 活跃债务：按扣款日生成还款流水
  const debtRows = (db.select().from(debts).all() as DebtRow[]).filter((d) => d.status === 'active');
  for (const d of debtRows) {
    const sum = getDebtSummary(debtRowToCalcInput(d));
    if (sum.paidMonths >= sum.totalMonths && sum.totalMonths > 0) continue;
    const dedDay = Math.min(d.dueDay ?? new Date(d.startDate ?? d.createdAt).getDate(), lastDay);
    const dedDate = `${thisMonthStr}-${String(dedDay).padStart(2, '0')}`;
    if (now < new Date(dedDate)) continue;
    const key = `debt:${d.id}:${thisMonthStr}`;
    if (existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    const id = `tx_${cryptoRandom()}`;
    insertTransaction({
      id,
      kind: 'debt_payment',
      category: d.creditor,
      amount: sum.monthlyPayment > 0 ? sum.monthlyPayment : d.minPayment ?? 0,
      merchant: null,
      occurredAt: dedDate,
      note: '自动生成',
      debtId: d.id,
      now: now.toISOString(),
    });
    debts += 1;
  }

  return { incomes, debts, skipped };
}

function txnKey(t: TxnRow): string {
  if (t.incomeSourceId) return `income:${t.incomeSourceId}:${(t.occurredAt || '').slice(0, 7)}`;
  if (t.debtId) return `debt:${t.debtId}:${(t.occurredAt || '').slice(0, 7)}`;
  return `${t.kind}:${t.category}:${t.occurredAt}`;
}

function cryptoRandom(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/* ---------- 总览（仓库层聚合，非 VIEW，便于跨表计算） ---------- */
export function summary(): FinanceSummary {
  const debtRows = db.select().from(debts).all() as DebtRow[];
  const incomeRows = db.select().from(incomes).all() as IncomeRow[];
  const txnRows = db.select().from(transactions).all() as TxnRow[];
  const assetRows = db.select().from(assets).all() as AssetRow[];

  let totalDebt = 0;
  let monthlyMinPayment = 0;
  let debtCount = 0;
  for (const d of debtRows) {
    if (d.status !== 'active') continue;
    const sum = getDebtSummary(debtRowToCalcInput(d));
    // 已真正还清的债务（剩余本金为 0）不应再计入总负债和月还款，
    // 避免用户点击「结清」或自然还清后仍占用现金流统计。
    const hasSchedule = sum.totalMonths > 0;
    if (hasSchedule && sum.remainingPrincipal <= 0) continue;
    debtCount += 1;
    totalDebt += hasSchedule ? sum.remainingPrincipal : d.principal;
    monthlyMinPayment += hasSchedule ? sum.monthlyPayment : (d.minPayment ?? 0);
  }

  // 月度固定收入（月度收入源）
  let monthlyIncome = 0;
  let incomeSourceCount = 0;
  for (const i of incomeRows) {
    if (i.incomeMode === 'monthly') {
      incomeSourceCount += 1;
      monthlyIncome += i.monthlyAvg ?? i.amount;
    }
  }

  const totalAssets = assetRows.reduce((s, a) => s + a.value, 0);
  const totalIncome = txnRows
    .filter((t) => t.kind === 'income')
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = txnRows
    .filter((t) => t.kind === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  // 当月收支
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthIncome = txnRows
    .filter((t) => t.kind === 'income' && (t.occurredAt || '').slice(0, 7) === thisMonth)
    .reduce((s, t) => s + t.amount, 0);
  const monthExpense = txnRows
    .filter((t) => (t.kind === 'expense' || t.kind === 'debt_payment') && (t.occurredAt || '').slice(0, 7) === thisMonth)
    .reduce((s, t) => s + t.amount, 0);

  const monthlyExpense = txnRows
    .filter((t) => t.kind === 'expense')
    .reduce((s, t) => s + t.amount, 0);

  const netWorth = totalAssets - totalDebt;

  return {
    totalDebt: round2(totalDebt),
    monthlyMinPayment: round2(monthlyMinPayment),
    totalAssets: round2(totalAssets),
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    netWorth: round2(netWorth),
    monthlyIncome: round2(monthlyIncome),
    monthlyDebtPayment: round2(monthlyMinPayment),
    monthlyExpense: round2(monthlyExpense),
    monthIncome: round2(monthIncome),
    monthExpense: round2(monthExpense),
    debtCount,
    incomeSourceCount,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
