/**
 * Modul: 领域平衡 (Balance Wheel) — 8+1 领域评分
 * Zweck: Pro Domain eine 1–10 Bewertung; Übersicht zeigt die Ausgewogenheit.
 * Yuvomi-Stil: ein Router + Migration. Nutzt die domains-Tabelle aus daily-board.
 */

import express from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../../server/logger.js';

const log = createLogger('Balance');
const SCORES = ['health', 'career', 'wealth', 'family', 'social', 'growth', 'leisure', 'spirit'];

function nowISO() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }

export default {
  name: 'balance',
  nav: { label: '领域平衡', icon: 'balance', path: '/balance', order: 3 },

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS balance_scores (
        id TEXT PRIMARY KEY,
        domain_key TEXT NOT NULL,
        score INTEGER NOT NULL,
        reviewed_at TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_balance_domain ON balance_scores(domain_key, reviewed_at);
    `);
  },

  routes(ctx) {
    const db = ctx.db;
    const router = express.Router();

    router.get('/domains', (_req, res) => {
      try {
        const rows = db.prepare('SELECT key, name, color, is_quarter_focus FROM domains ORDER BY name').all();
        res.json({ data: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/scores', (req, res) => {
      try {
        // Neueste Bewertung je Domain
        const rows = db.prepare(`
          SELECT s.* FROM balance_scores s
          JOIN (SELECT domain_key, MAX(reviewed_at) mr FROM balance_scores GROUP BY domain_key) m
            ON m.domain_key = s.domain_key AND m.mr = s.reviewed_at
          ORDER BY s.domain_key
        `).all();
        res.json({ data: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/scores', (req, res) => {
      try {
        const domainKey = String(req.body?.domain_key || '');
        if (!SCORES.includes(domainKey) && domainKey !== 'general') {
          // flexibel: existierende Domain akzeptieren
          const exists = db.prepare('SELECT 1 FROM domains WHERE key=?').get(domainKey);
          if (!exists) return res.status(400).json({ error: 'Unknown domain_key.', code: 400 });
        }
        const score = parseInt(req.body?.score, 10);
        if (!Number.isInteger(score) || score < 1 || score > 10) {
          return res.status(400).json({ error: 'Score must be 1–10.', code: 400 });
        }
        const id = uid();
        const reviewedAt = String(req.body?.reviewed_at || new Date().toISOString().slice(0, 10));
        db.prepare('INSERT INTO balance_scores (id, domain_key, score, reviewed_at, note, created_at) VALUES (?,?,?,?,?,?)')
          .run(id, domainKey, score, reviewedAt, req.body?.note || null, nowISO());
        res.status(201).json({ data: db.prepare('SELECT * FROM balance_scores WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/summary', (_req, res) => {
      try {
        const rows = db.prepare(`
          SELECT s.domain_key, s.score, s.reviewed_at FROM balance_scores s
          JOIN (SELECT domain_key, MAX(reviewed_at) mr FROM balance_scores GROUP BY domain_key) m
            ON m.domain_key = s.domain_key AND m.mr = s.reviewed_at
        `).all();
        const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
        const domains = db.prepare('SELECT key, name, color FROM domains ORDER BY name').all();
        const byDomain = domains.map((d) => {
          const sc = rows.find((r) => r.domain_key === d.key);
          return { ...d, score: sc ? sc.score : null };
        });
        res.json({ data: { avg: Math.round(avg * 10) / 10, byDomain } });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/scores/:id', (req, res) => {
      const r = db.prepare('DELETE FROM balance_scores WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Score not found.', code: 404 });
      res.json({ ok: true });
    });

    return router;
  },
};
