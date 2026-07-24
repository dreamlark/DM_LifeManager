/**
 * Modul: 每日看板 (Daily Board) — P0
 * Zweck: MIT / 四象限 / 时间块 / 今日回顾 — die zentrale Tagesübersicht.
 * Yuvomi-Stil: ein Express-Router + eigene Migration, Daten in einer SQLite-Datei.
 */

import express from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../../server/logger.js';

const log = createLogger('DailyBoard');

const STATUSES = ['todo', 'doing', 'done', 'archived'];
const PRIORITIES = ['low', 'medium', 'high'];

const DOMAINS = [
  { key: 'health', name: '健康', color: '#22c55e', q: 1 },
  { key: 'career', name: '事业', color: '#6366f1', q: 1 },
  { key: 'wealth', name: '财富', color: '#f59e0b', q: 0 },
  { key: 'family', name: '家庭', color: '#ef4444', q: 0 },
  { key: 'social', name: '社交', color: '#06b6d4', q: 0 },
  { key: 'growth', name: '成长', color: '#a855f7', q: 0 },
  { key: 'leisure', name: '休闲', color: '#ec4899', q: 0 },
  { key: 'spirit', name: '心灵', color: '#14b8a6', q: 0 },
];

function nowISO() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }

export default {
  name: 'daily-board',
  nav: { label: '每日看板', icon: 'calendar', path: '/daily', order: 1 },

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS domains (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        is_quarter_focus INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domain_key TEXT NOT NULL DEFAULT 'general',
        importance INTEGER NOT NULL DEFAULT 0,
        urgency INTEGER NOT NULL DEFAULT 0,
        is_mit INTEGER NOT NULL DEFAULT 0,
        mit_order INTEGER,
        status TEXT NOT NULL DEFAULT 'todo',
        scheduled_start TEXT,
        scheduled_end TEXT,
        due_at TEXT,
        description TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'medium',
        task_date TEXT,
        repeat TEXT NOT NULL DEFAULT 'none',
        source_daily_id TEXT,
        completion_quality INTEGER,
        created_by INTEGER,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE TABLE IF NOT EXISTS focus_sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT,
        domain_key TEXT,
        attention_type TEXT NOT NULL DEFAULT 'deep',
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        score INTEGER,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_date ON tasks(task_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_mit ON tasks(is_mit, mit_order);
    `);

    const ins = db.prepare('INSERT OR IGNORE INTO domains (key, name, color, is_quarter_focus) VALUES (?, ?, ?, ?)');
    for (const d of DOMAINS) ins.run(d.key, d.name, d.color, d.q);
  },

  routes(ctx) {
    const db = ctx.db;
    const router = express.Router();

    // ---- Domains ----
    router.get('/domains', (_req, res) => {
      try {
        const rows = db.prepare('SELECT key, name, color, is_quarter_focus FROM domains ORDER BY name').all();
        res.json({ data: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.patch('/domains/:key', (req, res) => {
      try {
        const { is_quarter_focus } = req.body;
        db.prepare('UPDATE domains SET is_quarter_focus = ? WHERE key = ?')
          .run(is_quarter_focus ? 1 : 0, req.params.key);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Daily routine instantiation ----
    router.post('/ensure-daily', (req, res) => {
      try {
        const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
        const templates = db.prepare("SELECT * FROM tasks WHERE repeat='daily' AND task_date IS NULL").all();
        const ins = db.prepare(`INSERT OR IGNORE INTO tasks
          (id, title, domain_key, importance, urgency, is_mit, mit_order, status,
           scheduled_start, scheduled_end, due_at, description, priority, task_date,
           repeat, source_daily_id, created_by, created_at, updated_at)
          VALUES (@id,@title,@domain_key,@importance,@urgency,@is_mit,@mit_order,@status,
           @scheduled_start,@scheduled_end,@due_at,@description,@priority,@task_date,
           'none',@source_daily_id,@created_by,@created_at,@updated_at)`);
        let created = 0;
        for (const t of templates) {
          const exists = db.prepare('SELECT 1 FROM tasks WHERE source_daily_id=? AND task_date=?')
            .get(t.id, date);
          if (exists) continue;
          ins.run({
            id: uid(), title: t.title, domain_key: t.domain_key, importance: t.importance,
            urgency: t.urgency, is_mit: t.is_mit, mit_order: t.mit_order, status: 'todo',
            scheduled_start: t.scheduled_start, scheduled_end: t.scheduled_end, due_at: t.due_at,
            description: t.description, priority: t.priority, task_date: date,
            source_daily_id: t.id, created_by: req.authUserId, created_at: nowISO(), updated_at: nowISO(),
          });
          created++;
        }
        res.json({ created });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- List tasks for a date ----
    router.get('/tasks', (req, res) => {
      try {
        const date = String(req.query.date || new Date().toISOString().slice(0, 10));
        const rows = db.prepare(`
          SELECT * FROM tasks
          WHERE task_date = ? OR (task_date IS NULL AND repeat != 'daily')
          ORDER BY is_mit DESC, mit_order ASC,
            CASE status WHEN 'done' THEN 1 ELSE 0 END,
            CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
            scheduled_start ASC NULLS LAST, created_at DESC
        `).all(date);
        res.json({ data: rows, date });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/tasks/:id', (req, res) => {
      try {
        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
        if (!row) return res.status(404).json({ error: 'Task not found.', code: 404 });
        res.json({ data: row });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/tasks', (req, res) => {
      try {
        const title = String(req.body?.title || '').trim();
        if (!title) return res.status(400).json({ error: 'Title is required.', code: 400 });
        const priority = PRIORITIES.includes(req.body?.priority) ? req.body.priority : 'medium';
        const status = STATUSES.includes(req.body?.status) ? req.body.status : 'todo';

        // MIT ordering: append to end
        let mitOrder = null;
        if (req.body?.is_mit) {
          const max = db.prepare('SELECT COALESCE(MAX(mit_order), -1) AS m FROM tasks WHERE is_mit=1').get();
          mitOrder = max.m + 1;
        }

        const id = uid();
        const importance = Number.isInteger(req.body?.importance) ? req.body.importance : (req.body?.importance ? 1 : 0);
        const urgency = Number.isInteger(req.body?.urgency) ? req.body.urgency : (req.body?.urgency ? 1 : 0);
        db.prepare(`INSERT INTO tasks
          (id, title, domain_key, importance, urgency, is_mit, mit_order, status,
           scheduled_start, scheduled_end, due_at, description, priority, task_date,
           repeat, created_by, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id, title, req.body?.domain_key || 'general',
          importance, urgency,
          req.body?.is_mit ? 1 : 0, mitOrder, status,
          req.body?.scheduled_start || null, req.body?.scheduled_end || null,
          req.body?.due_at || null, req.body?.description || '',
          priority, req.body?.task_date || null, req.body?.repeat || 'none',
          req.authUserId, nowISO(), nowISO(),
        );
        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        res.status(201).json({ data: row });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.put('/tasks/:id', (req, res) => {
      try {
        const t = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
        if (!t) return res.status(404).json({ error: 'Task not found.', code: 404 });

        let mitOrder = t.mit_order;
        const isMit = req.body?.is_mit !== undefined ? (req.body.is_mit ? 1 : 0) : t.is_mit;
        if (isMit && !t.is_mit) {
          const max = db.prepare('SELECT COALESCE(MAX(mit_order), -1) AS m FROM tasks WHERE is_mit=1').get();
          mitOrder = max.m + 1;
        } else if (!isMit) {
          mitOrder = null;
        }

        db.prepare(`UPDATE tasks SET
          title=?, domain_key=?, importance=?, urgency=?, is_mit=?, mit_order=?,
          status=?, scheduled_start=?, scheduled_end=?, due_at=?, description=?, priority=?,
          task_date=?, repeat=?, updated_at=?
          WHERE id=?`).run(
          String(req.body?.title ?? t.title).trim(),
          req.body?.domain_key ?? t.domain_key,
          req.body?.importance !== undefined ? (req.body.importance ? 1 : 0) : t.importance,
          req.body?.urgency !== undefined ? (req.body.urgency ? 1 : 0) : t.urgency,
          isMit, mitOrder,
          STATUSES.includes(req.body?.status) ? req.body.status : t.status,
          req.body?.scheduled_start ?? t.scheduled_start,
          req.body?.scheduled_end ?? t.scheduled_end,
          req.body?.due_at ?? t.due_at,
          req.body?.description ?? t.description,
          PRIORITIES.includes(req.body?.priority) ? req.body.priority : t.priority,
          req.body?.task_date ?? t.task_date,
          req.body?.repeat ?? t.repeat,
          nowISO(), req.params.id,
        );
        const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
        res.json({ data: row });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.patch('/tasks/:id/status', (req, res) => {
      try {
        const status = req.body?.status;
        if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.', code: 400 });
        const prev = db.prepare('SELECT status FROM tasks WHERE id = ?').get(req.params.id);
        if (!prev) return res.status(404).json({ error: 'Task not found.', code: 404 });
        const completionQuality = status === 'done' ? (req.body?.completion_quality ?? null) : null;
        db.prepare('UPDATE tasks SET status=?, completion_quality=?, updated_at=? WHERE id=?')
          .run(status, completionQuality, nowISO(), req.params.id);
        res.json({ data: { id: req.params.id, status, completion_quality } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.patch('/tasks/:id/mit-order', (req, res) => {
      try {
        const order = req.body?.mit_order;
        if (typeof order !== 'number') return res.status(400).json({ error: 'mit_order required.' });
        db.prepare('UPDATE tasks SET mit_order=?, updated_at=? WHERE id=?').run(order, nowISO(), req.params.id);
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/tasks/:id', (req, res) => {
      try {
        const r = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
        if (r.changes === 0) return res.status(404).json({ error: 'Task not found.', code: 404 });
        res.json({ ok: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Quadrant view (importance × urgency) ----
    router.get('/quadrant', (req, res) => {
      try {
        const date = String(req.query.date || new Date().toISOString().slice(0, 10));
        const rows = db.prepare(`
          SELECT * FROM tasks
          WHERE (task_date = ? OR (task_date IS NULL AND repeat != 'daily'))
            AND status != 'archived'
          ORDER BY scheduled_start ASC NULLS LAST
        `).all(date);
        const q = { q1: [], q2: [], q3: [], q4: [] };
        for (const t of rows) {
          if (t.importance && t.urgency) q.q1.push(t);
          else if (t.importance && !t.urgency) q.q2.push(t);
          else if (!t.importance && t.urgency) q.q3.push(t);
          else q.q4.push(t);
        }
        res.json({ data: q, date });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- MIT list ----
    router.get('/mit', (req, res) => {
      try {
        const date = String(req.query.date || new Date().toISOString().slice(0, 10));
        const rows = db.prepare(`
          SELECT * FROM tasks
          WHERE is_mit = 1 AND (task_date = ? OR (task_date IS NULL AND repeat != 'daily'))
            AND status != 'archived'
          ORDER BY mit_order ASC
        `).all(date);
        res.json({ data: rows, date });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Time blocks (scheduled) ----
    router.get('/timeblocks', (req, res) => {
      try {
        const date = String(req.query.date || new Date().toISOString().slice(0, 10));
        const rows = db.prepare(`
          SELECT * FROM tasks
          WHERE (task_date = ? OR (task_date IS NULL AND repeat != 'daily'))
            AND scheduled_start IS NOT NULL
          ORDER BY scheduled_start ASC
        `).all(date);
        res.json({ data: rows, date });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ---- Daily review ----
    router.get('/review', (req, res) => {
      try {
        const date = String(req.query.date || new Date().toISOString().slice(0, 10));
        const total = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE task_date = ? OR (task_date IS NULL AND repeat != 'daily')`).get(date).c;
        const done = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE (task_date = ? OR (task_date IS NULL AND repeat != 'daily')) AND status='done'`).get(date).c;
        const mit = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE is_mit=1 AND (task_date = ? OR (task_date IS NULL AND repeat != 'daily'))`).get(date).c;
        const mitDone = db.prepare(`SELECT COUNT(*) c FROM tasks WHERE is_mit=1 AND (task_date = ? OR (task_date IS NULL AND repeat != 'daily')) AND status='done'`).get(date).c;
        const focus = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(score),0) s FROM focus_sessions WHERE date(started_at)=?`).get(date);
        res.json({
          data: {
            date, total, done,
            completionRate: total ? Math.round((done / total) * 100) : 0,
            mit, mitDone,
            focusSessions: focus.c, focusScoreSum: focus.s,
          },
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    return router;
  },
};

export { DOMAINS };
