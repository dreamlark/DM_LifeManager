/**
 * Modul: 灵感记事 (Notes / Ideas)
 * Zweck: Notizen + Ideen-Inkubator. Yuvomi-Stil: ein Router + Migration.
 */

import express from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../../server/logger.js';

const log = createLogger('Notes');
const KINDS = ['idea', 'notebook'];

function nowISO() { return new Date().toISOString(); }
function uid() { return crypto.randomUUID(); }

export default {
  name: 'notes',
  nav: { label: '灵感记事', icon: 'note', path: '/notes', order: 4 },

  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body_markdown TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'idea',
        task_id TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notes_kind ON notes(kind);
    `);
  },

  routes(ctx) {
    const db = ctx.db;
    const router = express.Router();

    router.get('/notes', (req, res) => {
      try {
        const kind = req.query.kind;
        const rows = kind
          ? db.prepare('SELECT * FROM notes WHERE kind=? ORDER BY updated_at DESC').all(kind)
          : db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all();
        res.json({ data: rows });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/notes', (req, res) => {
      try {
        const title = String(req.body?.title || '').trim();
        if (!title) return res.status(400).json({ error: 'Title required.', code: 400 });
        const id = uid();
        db.prepare('INSERT INTO notes (id, title, body_markdown, kind, task_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
          .run(id, title, req.body?.body_markdown || '', KINDS.includes(req.body?.kind) ? req.body.kind : 'idea',
            req.body?.task_id || null, nowISO(), nowISO());
        res.status(201).json({ data: db.prepare('SELECT * FROM notes WHERE id=?').get(id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.put('/notes/:id', (req, res) => {
      try {
        const n = db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id);
        if (!n) return res.status(404).json({ error: 'Note not found.', code: 404 });
        db.prepare('UPDATE notes SET title=?, body_markdown=?, kind=?, updated_at=? WHERE id=?')
          .run(String(req.body?.title ?? n.title).trim(), req.body?.body_markdown ?? n.body_markdown,
            KINDS.includes(req.body?.kind) ? req.body.kind : n.kind, nowISO(), req.params.id);
        res.json({ data: db.prepare('SELECT * FROM notes WHERE id=?').get(req.params.id) });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.delete('/notes/:id', (req, res) => {
      const r = db.prepare('DELETE FROM notes WHERE id=?').run(req.params.id);
      if (r.changes === 0) return res.status(404).json({ error: 'Note not found.', code: 404 });
      res.json({ ok: true });
    });

    return router;
  },
};
