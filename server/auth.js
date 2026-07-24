/**
 * Modul: Authentifizierung
 * Zweck: Session-Middleware (better-sqlite3-Store), Auth-Guards, Login/Logout/
 * Setup/Me-Routen. Yuvomi-Stil: bcrypt + express-session + CSRF-Double-Submit,
 * erstes Admin-Konto via /setup (Installer).
 *
 * "彻底 Yuvomi 化" → Single-User-REST: es gibt genau ein Admin-Konto, keine
 * Familien/Rollen-Komplexität, keine Collaboration.
 */

import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import { getDb } from './db.js';
import { generateToken } from './security.js';
import { createLogger } from './logger.js';

const log = createLogger('Auth');

const router = express.Router();
const SESSION_COOKIE = 'dmlife.sid';
const AVATAR_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4'];

// --------------------------------------------------------
// Session-Store (same DB instance, no extra native binding)
// --------------------------------------------------------
class BetterSQLiteStore extends session.Store {
  constructor() {
    super();
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid        TEXT PRIMARY KEY,
        sess       TEXT NOT NULL,
        expired_at INTEGER NOT NULL
      )
    `);
    setInterval(() => {
      getDb().prepare('DELETE FROM sessions WHERE expired_at <= ?').run(Date.now());
    }, 15 * 60_000).unref();
  }

  get(sid, cb) {
    try {
      const row = getDb().prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      getDb().prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)')
        .run(sid, JSON.stringify(sess), Date.now() + ttl);
      cb(null);
    } catch (e) { cb(e); }
  }

  destroy(sid, cb) {
    try {
      getDb().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (e) { cb(e); }
  }

  touch(sid, sess, cb) {
    try {
      const ttl = sess.cookie?.maxAge ?? 7 * 24 * 60 * 60 * 1000;
      getDb().prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?').run(Date.now() + ttl, sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}

if (!process.env.SESSION_SECRET) {
  // Sicherheitshalber: ohne Secret kein Start (Installer erzeugt eines).
  throw new Error('[Auth] SESSION_SECRET must be set. Run the installer or set it in .env.');
}

const sessionStore = new BetterSQLiteStore();
const expressSession = session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  name: SESSION_COOKIE,
  cookie: {
    httpOnly: true,
    secure: process.env.SESSION_SECURE === 'true',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
});

function sessionMiddleware(req, res, next) {
  return expressSession(req, res, next);
}

// --------------------------------------------------------
// Rate Limiter (Login brute-force Schutz)
// --------------------------------------------------------
const loginLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS) || 8,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a moment.', code: 429 },
});

// --------------------------------------------------------
// Guards
// --------------------------------------------------------
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) {
    req.authUserId = req.session.userId;
    req.authRole = req.session.role || 'admin';
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated.', code: 401 });
}

function requireAdmin(req, res, next) {
  if (req.authRole === 'admin') return next();
  return res.status(403).json({ error: 'Permission denied.', code: 403 });
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    avatar_color: row.avatar_color,
    role: row.role,
    created_at: row.created_at,
  };
}

/** Richtet eine neue Session nach Login/Setup ein. */
function setupAuthSession(req, res, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.role = user.role;
      req.session.csrfToken = generateToken();
      res.cookie('csrf-token', req.session.csrfToken, {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.SESSION_SECURE === 'true',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });
      resolve();
    });
  });
}

// --------------------------------------------------------
// Routen
// --------------------------------------------------------

/**
 * POST /api/v1/auth/login
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.', code: 400 });
    }
    const user = getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      await bcrypt.compare(password, '$2b$12$invalidhashfortimingprotection000000000000000000000');
      return res.status(401).json({ error: 'Invalid credentials.', code: 401 });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.', code: 401 });

    await setupAuthSession(req, res, user);
    res.json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  } catch (err) {
    log.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/setup  (First-run bootstrap)
 * Erstellt das erste Admin-Konto. 403 wenn bereits Nutzer existieren.
 */
router.post('/setup', loginLimiter, async (req, res) => {
  try {
    const { count } = getDb().prepare('SELECT COUNT(*) AS count FROM users').get();
    if (count > 0) {
      if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found.', code: 404 });
      }
      return res.status(403).json({ error: 'Setup already completed.', code: 403 });
    }

    const username = String(req.body?.username || '').trim();
    const display_name = String(req.body?.display_name || '').trim();
    const { password } = req.body || {};

    if (!username || !display_name || !password) {
      return res.status(400).json({ error: 'Username, display name, and password are required.', code: 400 });
    }
    if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-64 chars (letters, numbers, . _ -).', code: 400 });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.', code: 400 });
    }

    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
    const hash = await bcrypt.hash(password, 12);

    const result = getDb().prepare(
      'INSERT INTO users (username, display_name, password_hash, avatar_color, role) VALUES (?, ?, ?, ?, ?)'
    ).run(username, display_name, hash, avatarColor, 'admin');

    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);

    // App-Name aus Setup übernehmen (sofern mitgeschickt).
    if (req.body?.app_name) {
      getDb().prepare('INSERT OR REPLACE INTO sync_config (key, value) VALUES (?, ?)')
        .run('app_name', String(req.body.app_name).slice(0, 64));
    }

    await setupAuthSession(req, res, user);
    res.status(201).json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Username already taken.', code: 409 });
    }
    log.error('Setup error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * POST /api/v1/auth/logout
 */
router.post('/logout', requireAuth, (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed.', code: 500 });
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });
});

/**
 * GET /api/v1/auth/me
 */
router.get('/me', requireAuth, (req, res) => {
  try {
    const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(req.authUserId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'User not found.', code: 401 });
    }
    if (!req.session.csrfToken) req.session.csrfToken = generateToken();
    res.cookie('csrf-token', req.session.csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.SESSION_SECURE === 'true',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    });
    res.json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  } catch (err) {
    log.error('/me error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

/**
 * PATCH /api/v1/auth/me/password
 */
router.patch('/me/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Current and new password are required.', code: 400 });
    }
    if (new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.', code: 400 });
    }
    const user = getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(req.authUserId);
    if (!user) return res.status(404).json({ error: 'User not found.', code: 404 });
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.', code: 401 });
    const hash = await bcrypt.hash(new_password, 12);
    getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.authUserId);
    res.json({ ok: true });
  } catch (err) {
    log.error('Password change error:', err);
    res.status(500).json({ error: 'Internal server error.', code: 500 });
  }
});

export { router, sessionMiddleware, requireAuth, requireAdmin, setupAuthSession };
export default router;
