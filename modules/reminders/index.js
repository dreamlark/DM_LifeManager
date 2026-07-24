/**
 * Modul: 提醒钟表铺 (Reminder Clocks)
 * Zweck: Nicht-alltägliche Zyklen (z.B. "alle 3 Monate"), mit Vorlaufkette.
 * Yuvomi-Stil: ein Router + Migration. period_rule = "days:N" | "months:N" | "years:N".
 */

import express from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../../server/logger.js';

const log = createLogger('Reminders');
const STATUSES = ['active', 'due', 'overdue', 'done'];

function nowISO() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }

/** Addiert eine Periode zu einem ISO-Datum (YYYY-MM-DD). */
function advance(dateStr, rule) {
  const m = /^(\w+):(\d+)$/.exec(rule || '');
  if (!m) return dateStr;
  const [, unit, n] = m;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (unit === 'days') d.setUTCDate(d.getUTCDate() + Number(n));
  else if (unit === 'months') d.setUTCMonth(d.getUTCMonth() + Number(n));
  else if (unit === 'years') d.setUTCFullYear(d.getUTCFullYear() + Number(n));
  return d.toISOString().slice(0, 10);
}

export default {
  name: 'reminders',
  nav: { label: '提醒钟表铺', icon: 'clock', path: '/reminders', order: 5 },

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS reminder_clocks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domain_key TEXT NOT NULL DEFAULT 'general',
        period_rule TEXT NOT NULL DEFAULT 'months:1',
        lead_chain TEXT NOT NULL DEFAULT '[7,1,0]',
        note_linked TEXT,
        next_fire_at TEXT NOT NULL,
        last_fired_at TEXT,
        last_completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reminder_fire ON reminder_clocks(next_fire_at, status);
    `);
  },

  routes(ctx) {
    const db = ctx.db;
    const router = express.Router();

    router.get('/reminders', (_req, res) => {
      try {
        const rows = db.prepare('SELECT * FROM reminder_clocks ORDER BY next_fire_at ASC').all();
        const today = new Date().toISOString().slice(0, 10);
        const enriched = rows.map((r) => ({
          ...r,
          is_overdue: r.next_fire_at < today && r.status !== 'done',
        }));
        res.json({ data: enriched });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/reminders', (req, res) => {
      try {
        const title = String(req.body?.title || '').trim();
        if (!title) return res.status(400).json({ error: 'Title required.', code: 400 });
        const nextFire = req.body?.next_fire_at || new Date().toISOString().slice(0, 10);
        const id = uid();
        db.prepare(`INSERT INTO reminder_clocks
          (id, title, domain_key, period_rule, lead_chain, note_linked, next_fire_at, status, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          id, title, req.body?.domain_key || 'general',
          req.body?.period_rule || 'months:1', JSON.stringify(req.body?.lead_chain || [7, 1, 0]),
          req.body?.note_linked || null, nextFire, 'active', nowISO(), nowISO(),
        );
        res.status(201).json({ data: db.prepare('SELECT * FROM reminder_clocks WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.patch('/reminders/:id/complete', (req, res) => {
      try {
        const r = db.prepare('SELECT * FROM reminder_clocks WHERE id=?').get(req.params.id);
        if (!r) return res.status(404).json({ error: 'Reminder not found.', code: 404 });
        const nextFire = advance(r.next_fire_at, r.period_rule);
        db.prepare(`UPDATE reminder_clocks SET last_completed_at=?, next_fire_at=?, status='active', updated_at=? WHERE id=?`)
          .run(nowISO().slice(0, 10), nextFire, nowISO(), req.params.id);
        res.json({ data: db.prepare('SELECT * FROM reminder_clocks WHERE id=?').get(req.params.id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.put('/reminders/:id', (req, res) => {
      try {
        const r = db.prepare('SELECT * FROM reminder_clocks WHERE id=?').get(req.params.id);
        if (!r) return res.status(404).json({ error: 'Reminder not found.', code: 404 });
        db.prepare(`UPDATE reminder_clocks SET title=?, domain_key=?, period_rule=?, lead_chain=?, note_linked=?, next_fire_at=?, status=?, updated_at=? WHERE id=?`)
          .run(
            String(req.body?.title ?? r.title).trim(), req.body?.domain_key ?? r.domain_key,
            req.body?.period_rule ?? r.period_rule, JSON.stringify(req.body?.lead_chain ?? JSON.parse(r.lead_chain || '[7,1,0]')),
            req.body?.note_linked ?? r.note_linked, req.body?.next_fire_at ?? r.next_fire_at,
            STATUSES.includes(req.body?.status) ? req.body.status : r.status, nowISO(), req.params.id,
          );
        res.json({ data: db.prepare('SELECT * FROM reminder_clocks WHERE id=?').get(req.params.id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/reminders/:id', (req, res) => {
      const r = db.prepare('DELETE FROM reminder_clocks WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Reminder not found.', code: 404 });
      res.json({ ok: true });
    });

    return router;
  },
};
