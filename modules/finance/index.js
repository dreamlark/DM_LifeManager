/**
 * Modul: 财务 (Finance) — P1
 * Zweck: 债务 / 收入 / 流水 / 资产 / 预算 + 汇总。
 * Yuvomi-Stil: ein Express-Router + eigene Migration.
 *
 * Hinweis: Die komplexe Tilgungs-Engine (4 Methoden, Zinsanpassung, Sondertilgung)
 * des Vorgängers wird hier auf ein pragmatisches, aber korrektes Modell reduziert:
 * - Schuldenfortschritt = principal − SUM(debt_payment-Transaktionen für diese Schuld)
 * - Budgets werden live aus Transaktionen (expense) berechnet.
 */

import express from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../../server/logger.js';
import {
  LPR_HISTORY,
  amortize,
  generateRepricingAdjustments,
  computeIRR,
  debtProgressSummary,
  prepaymentBenefit,
  buildCashflows,
  addMonths,
} from './debt-engine.js';

const log = createLogger('Finance');

const DEBT_STATUS = ['active', 'paid', 'frozen'];
const TXN_KIND = ['expense', 'income', 'debt_payment'];
const ASSET_CLASS = ['cash', 'investment', 'property', 'other', 'fixed_asset', 'income_source'];
const BUDGET_SCOPE = ['overall', 'category'];

function nowISO() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }
const monthOf = (iso) => (iso || nowISO()).slice(0, 7);

export default {
  name: 'finance',
  nav: { label: '财务', icon: 'wallet', path: '/finance', order: 2 },

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS debts (
        id TEXT PRIMARY KEY,
        creditor TEXT NOT NULL,
        principal REAL NOT NULL,
        apr REAL,
        min_payment REAL,
        due_day INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        debt_type TEXT NOT NULL DEFAULT 'other',
        term_months INTEGER,
        repayment_method TEXT NOT NULL DEFAULT 'equal_installment',
        start_date TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE IF NOT EXISTS incomes (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL DEFAULT 'CNY',
        received_at TEXT NOT NULL,
        recurring INTEGER NOT NULL DEFAULT 0,
        income_type TEXT NOT NULL DEFAULT 'salary',
        monthly_avg REAL,
        is_fixed INTEGER NOT NULL DEFAULT 1,
        income_mode TEXT NOT NULL DEFAULT 'monthly',
        pay_day INTEGER,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        merchant TEXT,
        occurred_at TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        debt_id TEXT,
        income_source_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        asset_class TEXT NOT NULL,
        value REAL NOT NULL,
        as_of TEXT NOT NULL,
        linked_income_source_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE IF NOT EXISTS budgets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'overall',
        category TEXT,
        monthly_limit REAL NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      -- finance-v2: LPR / 基准利率历史（种子：2022–2026）
      CREATE TABLE IF NOT EXISTS lpr_history (
        benchmark      TEXT NOT NULL,
        rate           REAL NOT NULL,
        effective_date TEXT NOT NULL
      );

      -- finance-v2: 浮动利率重定价事件（由规则派生后落库，便于审计）
      CREATE TABLE IF NOT EXISTS debt_repricing_events (
        id            TEXT PRIMARY KEY,
        debt_id       TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        old_rate      REAL,
        new_rate      REAL,
        basis         TEXT,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      -- finance-v2: 提前还款记录（含量化回写）
      CREATE TABLE IF NOT EXISTS debt_extra_payments (
        id             TEXT PRIMARY KEY,
        debt_id        TEXT NOT NULL,
        amount         REAL NOT NULL,
        at_period      INTEGER,
        interest_saved REAL,
        term_shortened INTEGER,
        applied_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_txn_at ON transactions(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_txn_kind ON transactions(kind);
      CREATE INDEX IF NOT EXISTS idx_debt_status ON debts(status);
      CREATE INDEX IF NOT EXISTS idx_reprice_debt ON debt_repricing_events(debt_id);
      CREATE INDEX IF NOT EXISTS idx_extrapay_debt ON debt_extra_payments(debt_id);
    `);

    // finance-v2: 增量列（幂等追加，旧行默认 fixed/NULL，已存在则跳过）
    const addCols = [
      ['interest_type', "TEXT NOT NULL DEFAULT 'fixed'"],
      ['repricing', 'TEXT'],
      ['first_payment_date', 'TEXT'],
      ['payment_day', 'INTEGER'],
      ['origination_fee', 'REAL'],
      ['balloon_amount', 'REAL'],
      ['rate_adjustments', 'TEXT'],
    ];
    const existing = new Set(
      db.prepare("PRAGMA table_info(debts)").all().map((c) => c.name),
    );
    for (const [col, def] of addCols) {
      if (!existing.has(col)) db.exec(`ALTER TABLE debts ADD COLUMN ${col} ${def}`);
    }

    // 种子 LPR 历史（仅首次为空时写入）
    const lprCount = db.prepare('SELECT COUNT(*) AS c FROM lpr_history').get().c;
    if (lprCount === 0) {
      const ins = db.prepare('INSERT INTO lpr_history (benchmark, rate, effective_date) VALUES (?,?,?)');
      const seed = db.transaction(() => {
        for (const row of LPR_HISTORY) ins.run(row.benchmark, row.rate, row.effective_date);
      });
      seed();
    }
  },

  routes(ctx) {
    const db = ctx.db;
    const router = express.Router();

    // ---------- Debts ----------
    router.get('/debts', (_req, res) => {
      try {
        const rows = db.prepare('SELECT * FROM debts ORDER BY status, creditor').all();
        const pay = db.prepare("SELECT COALESCE(SUM(amount),0) p FROM transactions WHERE kind='debt_payment' AND debt_id=?");
        const enriched = rows.map((d) => {
          const paid = pay.get(d.id).p;
          const remaining = Math.max(0, d.principal - paid);
          return { ...d, paid_amount: paid, remaining };
        });
        res.json({ data: enriched });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/debts', (req, res) => {
      try {
        const creditor = String(req.body?.creditor || '').trim();
        if (!creditor) return res.status(400).json({ error: 'Creditor required.', code: 400 });
        const principal = Number(req.body?.principal);
        if (!Number.isFinite(principal) || principal < 0) return res.status(400).json({ error: 'Invalid principal.', code: 400 });
        const id = uid();
        const interestType = req.body?.interest_type === 'floating' ? 'floating' : 'fixed';
        db.prepare(`INSERT INTO debts (id, creditor, principal, apr, min_payment, due_day, status,
          debt_type, term_months, repayment_method, start_date, note, created_at, updated_at,
          interest_type, repricing, first_payment_date, payment_day, origination_fee, balloon_amount, rate_adjustments)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, creditor, principal, numOrNull(req.body?.apr), numOrNull(req.body?.min_payment),
          intOrNull(req.body?.due_day), DEBT_STATUS.includes(req.body?.status) ? req.body.status : 'active',
          req.body?.debt_type || 'other', intOrNull(req.body?.term_months),
          req.body?.repayment_method || 'equal_installment', req.body?.start_date || null,
          req.body?.note || '', nowISO(), nowISO(),
          interestType, jsonField(req.body?.repricing),
          req.body?.first_payment_date || null, intOrNull(req.body?.payment_day),
          numOrNull(req.body?.origination_fee), numOrNull(req.body?.balloon_amount),
          jsonField(req.body?.rate_adjustments),
        );
        res.status(201).json({ data: db.prepare('SELECT * FROM debts WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.put('/debts/:id', (req, res) => {
      try {
        const d = db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id);
        if (!d) return res.status(404).json({ error: 'Debt not found.', code: 404 });
        const interestType = req.body?.interest_type === 'floating' ? 'floating' : (req.body?.interest_type ?? d.interest_type);
        db.prepare(`UPDATE debts SET creditor=?, principal=?, apr=?, min_payment=?, due_day=?, status=?,
          debt_type=?, term_months=?, repayment_method=?, start_date=?, note=?, updated_at=?,
          interest_type=?, repricing=?, first_payment_date=?, payment_day=?, origination_fee=?, balloon_amount=?, rate_adjustments=?
          WHERE id=?`).run(
          String(req.body?.creditor ?? d.creditor).trim(), numOr(req.body?.principal, d.principal),
          numOrNull(req.body?.apr ?? d.apr), numOrNull(req.body?.min_payment ?? d.min_payment),
          intOrNull(req.body?.due_day ?? d.due_day), DEBT_STATUS.includes(req.body?.status) ? req.body.status : d.status,
          req.body?.debt_type ?? d.debt_type, intOrNull(req.body?.term_months ?? d.term_months),
          req.body?.repayment_method ?? d.repayment_method, req.body?.start_date ?? d.start_date,
          req.body?.note ?? d.note, nowISO(),
          interestType, jsonField(req.body?.repricing ?? d.repricing),
          req.body?.first_payment_date ?? d.first_payment_date, intOrNull(req.body?.payment_day ?? d.payment_day),
          numOrNull(req.body?.origination_fee ?? d.origination_fee), numOrNull(req.body?.balloon_amount ?? d.balloon_amount),
          jsonField(req.body?.rate_adjustments ?? d.rate_adjustments),
          req.params.id,
        );
        res.json({ data: db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.patch('/debts/:id/status', (req, res) => {
      try {
        const status = req.body?.status;
        if (!DEBT_STATUS.includes(status)) return res.status(400).json({ error: 'Invalid status.', code: 400 });
        db.prepare('UPDATE debts SET status=?, updated_at=? WHERE id=?').run(status, nowISO(), req.params.id);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/debts/:id', (req, res) => {
      const r = db.prepare('DELETE FROM debts WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Debt not found.', code: 404 });
      res.json({ ok: true });
    });

    // ---------- Debt planning (finance-v2) ----------
    // 还款计划（含重定价生效点标记）
    router.get('/debts/:id/schedule', (req, res) => {
      try {
        const d = db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id);
        if (!d) return res.status(404).json({ error: 'Debt not found.', code: 404 });
        const schedule = amortize(d, { lprHistory: LPR_HISTORY });
        const canPlan = schedule.length > 0;
        const events = d.interest_type === 'floating' && d.start_date
          ? generateRepricingAdjustments(parseRepricing(d.repricing), d.first_payment_date || addMonths(d.start_date, 1), d.term_months || 0, LPR_HISTORY)
          : [];
        res.json({ data: { debt: d, schedule, canPlan, repricingEvents: events } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // IRR/EAR + 勾稽 + 已记录提前还款
    router.get('/debts/:id/summary', (req, res) => {
      try {
        const d = db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id);
        if (!d) return res.status(404).json({ error: 'Debt not found.', code: 404 });
        const canPlan = Number(d.term_months) > 0 && Number(d.principal) > 0;
        let irr = null;
        let reconciliation = null;
        let schedule = null;
        if (canPlan) {
          schedule = amortize(d, { lprHistory: LPR_HISTORY });
          const flows = buildCashflows(d, { lprHistory: LPR_HISTORY });
          irr = flows ? computeIRR(flows) : null;
          const pays = db.prepare("SELECT amount, occurred_at FROM transactions WHERE kind='debt_payment' AND debt_id=? ORDER BY occurred_at").all(d.id);
          reconciliation = debtProgressSummary(d, pays, { lprHistory: LPR_HISTORY });
        }
        const extraPayments = db.prepare('SELECT * FROM debt_extra_payments WHERE debt_id=? ORDER BY applied_at').all(d.id);
        res.json({ data: { canPlan, irr, reconciliation, extraPayments, schedule } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 设置浮动利率规则（清空则转固定）
    router.post('/debts/:id/repricing', (req, res) => {
      try {
        const d = db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id);
        if (!d) return res.status(404).json({ error: 'Debt not found.', code: 404 });
        const itype = req.body?.interest_type === 'floating' ? 'floating' : 'fixed';
        let repricing = null;
        if (itype === 'floating') {
          const r = req.body?.repricing;
          if (!r || !r.benchmark) return res.status(400).json({ error: 'Floating rate requires repricing rule with benchmark.', code: 400 });
          repricing = JSON.stringify({
            benchmark: r.benchmark,
            spread: Number(r.spread) || 0,
            cycleMonths: Number(r.cycleMonths) || 12,
            anchor: r.anchor === 'fixed_date' ? 'fixed_date' : 'anniversary',
            fixedDate: r.anchor === 'fixed_date' ? (r.fixedDate || null) : null,
          });
        }
        db.prepare('UPDATE debts SET interest_type=?, repricing=?, updated_at=? WHERE id=?').run(itype, repricing, nowISO(), d.id);
        // 重定价事件落库（清空旧 → 写新）
        db.prepare('DELETE FROM debt_repricing_events WHERE debt_id=?').run(d.id);
        let events = [];
        if (itype === 'floating' && d.start_date) {
          const base = d.first_payment_date || addMonths(d.start_date, 1);
          const evs = generateRepricingAdjustments(JSON.parse(repricing), base, d.term_months || 0, LPR_HISTORY);
          const ins = db.prepare('INSERT INTO debt_repricing_events (id, debt_id, effective_date, old_rate, new_rate, basis) VALUES (?,?,?,?,?,?)');
          const tx = db.transaction(() => { for (const e of evs) ins.run(uid(), d.id, e.effectiveDate, null, e.rate, e.basis); });
          tx();
          events = evs;
        }
        res.json({ data: { ...db.prepare('SELECT * FROM debts WHERE id=?').get(d.id), repricingEvents: events } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 模拟提前还款收益（不落库）
    router.get('/debts/:id/extra-payments/benefit', (req, res) => {
      try {
        const d = db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id);
        if (!d) return res.status(404).json({ error: 'Debt not found.', code: 404 });
        const amount = Number(req.query.amount);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount.', code: 400 });
        const atPeriod = intOrNull(req.query.atPeriod) || Number(d.term_months) || 1;
        const benefit = prepaymentBenefit(d, amount, atPeriod, { lprHistory: LPR_HISTORY });
        res.json({ data: benefit });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // 记录提前还款，回写 interest_saved / term_shortened
    router.post('/debts/:id/extra-payments', (req, res) => {
      try {
        const d = db.prepare('SELECT * FROM debts WHERE id=?').get(req.params.id);
        if (!d) return res.status(404).json({ error: 'Debt not found.', code: 404 });
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount.', code: 400 });
        const atPeriod = intOrNull(req.body?.atPeriod) || Number(d.term_months) || 1;
        const benefit = prepaymentBenefit(d, amount, atPeriod, { lprHistory: LPR_HISTORY });
        const id = uid();
        db.prepare(`INSERT INTO debt_extra_payments (id, debt_id, amount, at_period, interest_saved, term_shortened, applied_at)
          VALUES (?,?,?,?,?,?,?)`).run(
          id, d.id, amount, atPeriod, benefit.interestSaved, benefit.termShortenedMonths, nowISO(),
        );
        res.status(201).json({ data: { id, benefit, record: db.prepare('SELECT * FROM debt_extra_payments WHERE id=?').get(id) } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---------- Incomes ----------
    router.get('/incomes', (_req, res) => {
      try {
        const rows = db.prepare('SELECT * FROM incomes ORDER BY source').all();
        res.json({ data: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.post('/incomes', (req, res) => {
      try {
        const source = String(req.body?.source || '').trim();
        if (!source) return res.status(400).json({ error: 'Source required.', code: 400 });
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount)) return res.status(400).json({ error: 'Invalid amount.', code: 400 });
        const id = uid();
        db.prepare(`INSERT INTO incomes (id, source, amount, currency, received_at, recurring,
          income_type, monthly_avg, is_fixed, income_mode, pay_day, note, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, source, amount, req.body?.currency || 'CNY', req.body?.received_at || nowISO(),
          req.body?.recurring ? 1 : 0, req.body?.income_type || 'salary',
          numOrNull(req.body?.monthly_avg), req.body?.is_fixed ? 1 : 0,
          req.body?.income_mode || 'monthly', intOrNull(req.body?.pay_day),
          req.body?.note || '', nowISO(),
        );
        res.status(201).json({ data: db.prepare('SELECT * FROM incomes WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.put('/incomes/:id', (req, res) => {
      try {
        const r0 = db.prepare('SELECT * FROM incomes WHERE id=?').get(req.params.id);
        if (!r0) return res.status(404).json({ error: 'Income not found.', code: 404 });
        db.prepare(`UPDATE incomes SET source=?, amount=?, currency=?, received_at=?, recurring=?,
          income_type=?, monthly_avg=?, is_fixed=?, income_mode=?, pay_day=?, note=? WHERE id=?`).run(
          String(req.body?.source ?? r0.source).trim(), numOr(req.body?.amount, r0.amount),
          req.body?.currency ?? r0.currency, req.body?.received_at ?? r0.received_at,
          req.body?.recurring ? 1 : 0, req.body?.income_type ?? r0.income_type,
          numOrNull(req.body?.monthly_avg ?? r0.monthly_avg), req.body?.is_fixed ? 1 : 0,
          req.body?.income_mode ?? r0.income_mode, intOrNull(req.body?.pay_day ?? r0.pay_day),
          req.body?.note ?? r0.note, req.params.id,
        );
        res.json({ data: db.prepare('SELECT * FROM incomes WHERE id=?').get(req.params.id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.delete('/incomes/:id', (req, res) => {
      const r = db.prepare('DELETE FROM incomes WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Income not found.', code: 404 });
      res.json({ ok: true });
    });

    // ---------- Transactions ----------
    router.get('/transactions', (req, res) => {
      try {
        const month = req.query.month ? String(req.query.month) : null;
        let rows;
        if (month) {
          rows = db.prepare("SELECT * FROM transactions WHERE substr(occurred_at,1,7)=? ORDER BY occurred_at DESC").all(month);
        } else {
          rows = db.prepare('SELECT * FROM transactions ORDER BY occurred_at DESC LIMIT 500').all();
        }
        res.json({ data: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.post('/transactions', (req, res) => {
      try {
        const kind = req.body?.kind;
        if (!TXN_KIND.includes(kind)) return res.status(400).json({ error: 'Invalid kind.', code: 400 });
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount.', code: 400 });
        const category = String(req.body?.category || 'other').trim();
        const id = uid();
        db.prepare(`INSERT INTO transactions (id, kind, category, amount, merchant, occurred_at,
          note, debt_id, income_source_id, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id, kind, category, amount, req.body?.merchant || null,
          req.body?.occurred_at || nowISO(), req.body?.note || '',
          req.body?.debt_id || null, req.body?.income_source_id || null, nowISO(),
        );
        res.status(201).json({ data: db.prepare('SELECT * FROM transactions WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.delete('/transactions/:id', (req, res) => {
      const r = db.prepare('DELETE FROM transactions WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Transaction not found.', code: 404 });
      res.json({ ok: true });
    });

    // ---------- Assets ----------
    router.get('/assets', (_req, res) => {
      try { res.json({ data: db.prepare('SELECT * FROM assets ORDER BY asset_class, name').all() }); }
      catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.post('/assets', (req, res) => {
      try {
        const name = String(req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Name required.', code: 400 });
        const value = Number(req.body?.value);
        if (!Number.isFinite(value)) return res.status(400).json({ error: 'Invalid value.', code: 400 });
        if (!ASSET_CLASS.includes(req.body?.asset_class)) return res.status(400).json({ error: 'Invalid asset_class.', code: 400 });
        const id = uid();
        db.prepare(`INSERT INTO assets (id, name, asset_class, value, as_of, linked_income_source_id, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(
          id, name, req.body.asset_class, value, req.body?.as_of || nowISO().slice(0, 10),
          req.body?.linked_income_source_id || null, nowISO(), nowISO(),
        );
        res.status(201).json({ data: db.prepare('SELECT * FROM assets WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.put('/assets/:id', (req, res) => {
      try {
        const r0 = db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id);
        if (!r0) return res.status(404).json({ error: 'Asset not found.', code: 404 });
        db.prepare(`UPDATE assets SET name=?, asset_class=?, value=?, as_of=?, linked_income_source_id=?, updated_at=? WHERE id=?`).run(
          String(req.body?.name ?? r0.name).trim(), ASSET_CLASS.includes(req.body?.asset_class) ? req.body.asset_class : r0.asset_class,
          numOr(req.body?.value, r0.value), req.body?.as_of ?? r0.as_of,
          req.body?.linked_income_source_id ?? r0.linked_income_source_id, nowISO(), req.params.id,
        );
        res.json({ data: db.prepare('SELECT * FROM assets WHERE id=?').get(req.params.id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.delete('/assets/:id', (req, res) => {
      const r = db.prepare('DELETE FROM assets WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Asset not found.', code: 404 });
      res.json({ ok: true });
    });

    // ---------- Budgets ----------
    router.get('/budgets', (_req, res) => {
      try { res.json({ data: db.prepare('SELECT * FROM budgets ORDER BY name').all() }); }
      catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.post('/budgets', (req, res) => {
      try {
        const name = String(req.body?.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Name required.', code: 400 });
        const limit = Number(req.body?.monthly_limit);
        if (!Number.isFinite(limit) || limit < 0) return res.status(400).json({ error: 'Invalid monthly_limit.', code: 400 });
        const scope = BUDGET_SCOPE.includes(req.body?.scope) ? req.body.scope : 'overall';
        const id = uid();
        db.prepare(`INSERT INTO budgets (id, name, scope, category, monthly_limit, note, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(
          id, name, scope, scope === 'category' ? (req.body?.category || 'other') : null,
          limit, req.body?.note || '', nowISO(), nowISO(),
        );
        res.status(201).json({ data: db.prepare('SELECT * FROM budgets WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.put('/budgets/:id', (req, res) => {
      try {
        const r0 = db.prepare('SELECT * FROM budgets WHERE id=?').get(req.params.id);
        if (!r0) return res.status(404).json({ error: 'Budget not found.', code: 404 });
        db.prepare(`UPDATE budgets SET name=?, scope=?, category=?, monthly_limit=?, note=?, updated_at=? WHERE id=?`).run(
          String(req.body?.name ?? r0.name).trim(), BUDGET_SCOPE.includes(req.body?.scope) ? req.body.scope : r0.scope,
          (req.body?.scope || r0.scope) === 'category' ? (req.body?.category ?? r0.category) : null,
          numOr(req.body?.monthly_limit, r0.monthly_limit), req.body?.note ?? r0.note, nowISO(), req.params.id,
        );
        res.json({ data: db.prepare('SELECT * FROM budgets WHERE id=?').get(req.params.id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });
    router.delete('/budgets/:id', (req, res) => {
      const r = db.prepare('DELETE FROM budgets WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Budget not found.', code: 404 });
      res.json({ ok: true });
    });

    // ---------- Summary ----------
    router.get('/summary', (_req, res) => {
      try {
        const month = monthOf(nowISO());
        const debtRows = db.prepare("SELECT principal, status FROM debts").all();
        const totalDebt = debtRows.filter((d) => d.status === 'active' || d.status === 'frozen')
          .reduce((s, d) => s + d.principal, 0);
        const minMonthly = debtRows.filter((d) => d.status === 'active')
          .reduce((s, d) => s + (d.min_payment || 0), 0);

        // finance-v2: 活跃且有期限的债务，披露 IRR/EAR + 勾稽状态
        const insightRows = db.prepare("SELECT * FROM debts WHERE status='active' AND term_months IS NOT NULL AND term_months > 0").all();
        const debtInsights = insightRows.map((d) => {
          const flows = buildCashflows(d, { lprHistory: LPR_HISTORY });
          const irr = flows ? computeIRR(flows) : null;
          const pays = db.prepare("SELECT amount, occurred_at FROM transactions WHERE kind='debt_payment' AND debt_id=? ORDER BY occurred_at").all(d.id);
          const recon = debtProgressSummary(d, pays, { lprHistory: LPR_HISTORY });
          return { id: d.id, creditor: d.creditor, irr, reconStatus: recon.status, reconDelta: recon.delta };
        });

        const incomeRows = db.prepare('SELECT amount, recurring, monthly_avg FROM incomes').all();
        const monthlyIncome = incomeRows.reduce((s, r) => {
          if (r.recurring) return s + (r.monthly_avg ?? r.amount);
          return s; // einmalige Einnahmen zählen nicht zur laufenden Monatsrate
        }, 0);

        const assetRows = db.prepare('SELECT value FROM assets').all();
        const totalAssets = assetRows.reduce((s, a) => s + a.value, 0);

        const expenseMonth = db.prepare("SELECT COALESCE(SUM(amount),0) e FROM transactions WHERE kind='expense' AND substr(occurred_at,1,7)=?").get(month).e;

        const budgets = db.prepare('SELECT * FROM budgets').all();
        const budgetStatus = budgets.map((b) => {
          let spent = 0;
          if (b.scope === 'overall') {
            spent = expenseMonth;
          } else {
            spent = db.prepare("SELECT COALESCE(SUM(amount),0) e FROM transactions WHERE kind='expense' AND category=? AND substr(occurred_at,1,7)=?")
              .get(b.category, month).e;
          }
          return { ...b, spent, remaining: b.monthly_limit - spent, pct: b.monthly_limit ? Math.round((spent / b.monthly_limit) * 100) : 0 };
        });

        res.json({
          data: {
            month,
            totalDebt, minMonthly, monthlyIncome, totalAssets,
            netWorth: totalAssets - totalDebt,
            monthlyExpense: expenseMonth,
            monthlyNet: monthlyIncome - expenseMonth,
            budgetStatus,
            debtInsights,
          },
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
  },
};

function numOr(v, fallback) { return Number.isFinite(Number(v)) ? Number(v) : fallback; }
function numOrNull(v) { return v === undefined || v === null || v === '' ? null : Number(v); }
function intOrNull(v) { return v === undefined || v === null || v === '' ? null : parseInt(v, 10); }

/** 将 repricing / rate_adjustments 规整为 JSON 字符串或 NULL（对象→string，非法→NULL）。 */
function jsonField(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    try { JSON.parse(v); return v; } catch { return JSON.stringify(v); }
  }
  try { return JSON.stringify(v); } catch { return null; }
}
/** 解析 repricing 字段（JSON 字符串或对象）为对象，失败返回空对象。 */
function parseRepricing(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
}
