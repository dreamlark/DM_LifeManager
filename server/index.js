/**
 * Modul: Server Entry Point
 * Zweck: Express-App, Security-Middleware, Session, Modul-Loading, SPA-Fallback.
 * Yuvomi-Stil: eine Datei, die alles verbindet — keine verstreute Config.
 */

import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLogger } from './logger.js';
import { getDb } from './db.js';
import { router as authRouter, sessionMiddleware, requireAuth } from './auth.js';
import { csrfMiddleware, attachCsrfHeader } from './security.js';
import { loadModules } from './modules.js';

const log = createLogger('Server');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { version: APP_VERSION } = JSON.parse(
  // eslint-disable-next-line import/no-unresolved
  (await import('node:fs')).readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
);

const app = express();
const PORT = process.env.PORT || 3000;

// --------------------------------------------------------
// Security Headers
// --------------------------------------------------------
const isSecure = process.env.SESSION_SECURE === 'true';
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'self'"],
      upgradeInsecureRequests: isSecure ? [] : null,
    },
  },
  hsts: isSecure ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));

const _tp = process.env.TRUST_PROXY;
app.set('trust proxy', _tp === undefined ? 1 : /^\d+$/.test(_tp) ? parseInt(_tp, 10) : _tp);

// --------------------------------------------------------
// Request parsing + compression
// --------------------------------------------------------
app.use(compression());
app.use(express.json({ limit: '7mb' }));
app.use(express.urlencoded({ extended: true, limit: '7mb' }));
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.', code: 400 });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large (max 7 MB).', code: 413 });
  next(err);
});

// --------------------------------------------------------
// Sessions + CSRF header
// --------------------------------------------------------
app.use(sessionMiddleware);
app.use(attachCsrfHeader);

// No caching for API responses
app.use('/api/', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// Global API rate limiter
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 400,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.', code: 429 },
  skip: (req) => req.path === '/health',
});
app.use('/api/', apiLimiter);

// --------------------------------------------------------
// Static frontend (zero-build vanilla JS PWA)
// --------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: true,
  lastModified: true,
  redirect: false,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.ico', '.svg', '.webp', '.woff2', '.woff'].includes(ext)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
    if (filePath.endsWith('manifest.webmanifest')) res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  },
}));

// --------------------------------------------------------
// Auth routes (public: login + setup; protected: me/logout)
// --------------------------------------------------------
app.use('/api/v1/auth', authRouter);

// --------------------------------------------------------
// Version / setup metadata (public bootstrap)
// --------------------------------------------------------
function appName() {
  try {
    const row = getDb().prepare('SELECT value FROM sync_config WHERE key = ?').get('app_name');
    return row?.value || 'DM Life';
  } catch { return 'DM Life'; }
}
function setupRequired() {
  try {
    const { count } = getDb().prepare('SELECT COUNT(*) AS count FROM users').get();
    return count === 0;
  } catch { return false; }
}

app.get('/api/v1/version', (req, res) => {
  res.json({ app_name: appName(), setup_required: setupRequired(), version: APP_VERSION });
});

// --------------------------------------------------------
// Global auth guard for everything under /api/v1 except auth + version
// --------------------------------------------------------
app.use('/api/v1', (req, res, next) => {
  if (req.path.startsWith('/auth') || req.path === '/version' || req.path.startsWith('/modules')) {
    return next();
  }
  return requireAuth(req, res, next);
});

// CSRF für state-changing Requests (login/setup ausgenommen)
app.use('/api/v1', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/auth/setup') return next();
  return csrfMiddleware(req, res, next);
});

// --------------------------------------------------------
// Module routes (mounted by loader)
// --------------------------------------------------------
const nav = await loadModules(app);

app.get('/api/v1/modules', (req, res) => {
  res.json({ data: nav });
});

// --------------------------------------------------------
// Health check
// --------------------------------------------------------
app.get('/health', (req, res, next) => {
  if (req.headers.accept && req.headers.accept.includes('text/html')) return next();
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --------------------------------------------------------
// SPA fallback
// --------------------------------------------------------
const spaLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests.', code: 429 } });

app.get('/{*splat}', spaLimiter, (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.', code: 404 });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, _next) => {
  log.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error.', code: 500 });
});

app.listen(PORT, () => {
  log.info(`Server running on port ${PORT} | v${APP_VERSION}`);
  log.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  log.info(`Modules loaded: ${nav.map((n) => n.name).join(', ') || '(none)'}`);
});

export default app;
