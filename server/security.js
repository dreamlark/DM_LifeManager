/**
 * Modul: Security — CSRF (Double-Submit Token)
 * Zweck: Schutz statusändernder Requests (POST/PUT/PATCH/DELETE) vor
 * Cross-Site-Request-Forgery. Yuvomi-Stil: Server setzt Token in die Session
 * und sendet es im Response-Header X-CSRF-Token mit; das Frontend sendet es
 * im Request-Header X-CSRF-Token zurück.
 */

import crypto from 'node:crypto';

/** Erzeugt ein kryptographisch sicheres CSRF-Token. */
export function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Middleware: bei state-changing Requests das mitgesendete Token prüfen.
 * Bei Desync wird das korrekte Token im Response-Header mitgeliefert, damit
 * das Frontend resynchronisieren kann (iOS-PWA-Resume-Fall).
 */
export function csrfMiddleware(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const expected = req.session?.csrfToken;
  const provided = req.headers['x-csrf-token'];

  if (!expected || provided !== expected) {
    if (req.session?.csrfToken) res.set('X-CSRF-Token', req.session.csrfToken);
    return res.status(403).json({ error: 'Invalid CSRF token.', code: 403 });
  }
  next();
}

/**
 * Response-Hook: immer das aktuelle CSRF-Token mitsenden, damit das Frontend
 * es aus dem Header (zuverlässiger als Cookie auf iOS Safari) lesen kann.
 */
export function attachCsrfHeader(req, res, next) {
  if (req.session?.csrfToken) {
    res.set('X-CSRF-Token', req.session.csrfToken);
  }
  next();
}
