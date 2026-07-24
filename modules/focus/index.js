/**
 * Modul: 心流 (Flow / Focus Sessions)
 * Zweck: Konzentrations-Sessions protokollieren + einfache Auswertung.
 * Yuvomi-Stil: ein Router. Tabelle focus_sessions wird in daily-board migriert
 * (geteilte SQLite-Datei, eine Verbindung).
 */

import express from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../../server/logger.js';

const log = createLogger('Focus');

function nowISO() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }

export default {
  name: 'focus',
  nav: { label: '心流', icon: 'activity', path: '/focus', order: 6 },

  // keine eigene Migration: focus_sessions wird von daily-board angelegt.
  routes(ctx) {
    const db = ctx.db;
    const router = express.Router();

    router.get('/sessions', (req, res) => {
      try {
        const date = req.query.date ? String(req.query.date) : null;
        const rows = date
          ? db.prepare("SELECT * FROM focus_sessions WHERE date(started_at)=? ORDER BY started_at DESC").all(date)
          : db.prepare('SELECT * FROM focus_sessions ORDER BY started_at DESC LIMIT 200').all();
        res.json({ data: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/sessions', (req, res) => {
      try {
        const started = String(req.body?.started_at || nowISO());
        const ended = String(req.body?.ended_at || nowISO());
        const score = req.body?.score !== undefined ? parseInt(req.body.score, 10) : null;
        const id = uid();
        db.prepare(`INSERT INTO focus_sessions (id, task_id, domain_key, attention_type, started_at, ended_at, score, note, created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(
          id, req.body?.task_id || null, req.body?.domain_key || null,
          req.body?.attention_type || 'deep', started, ended, score, req.body?.note || null, nowISO(),
        );
        res.status(201).json({ data: db.prepare('SELECT * FROM focus_sessions WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/summary', (req, res) => {
      try {
        const date = req.query.date ? String(req.query.date) : new Date().toISOString().slice(0, 10);
        const total = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(score),0) s, COALESCE(SUM((julianday(ended_at)-julianday(started_at))*24*60),0) mins FROM focus_sessions WHERE date(started_at)=?").get(date);
        res.json({
          data: {
            date,
            sessions: total.c,
            totalMinutes: Math.round(total.mins),
            avgScore: total.c ? Math.round((total.s / total.c) * 10) / 10 : 0,
          },
        });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/sessions/:id', (req, res) => {
      const r = db.prepare('DELETE FROM focus_sessions WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Session not found.', code: 404 });
      res.json({ ok: true });
    });

    return router;
  },
};
