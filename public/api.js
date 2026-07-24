/**
 * api.js — Same-origin fetch client.
 * - Reads X-CSRF-Token from responses, sends it back on state-changing requests.
 * - On 401 dispatches `auth:expired` (router redirects to /login).
 * - Auto-resyncs on CSRF desync (403 + X-CSRF-Token header) and retries once.
 * - Single module instance shared across router + module pages.
 */

class ApiError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const state = { csrf: null };

function readCsrf(res, json) {
  const tok = res && res.headers.get('X-CSRF-Token');
  if (tok) state.csrf = tok;
  if (json && json.csrfToken) state.csrf = json.csrfToken;
}

async function doFetch(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && state.csrf) {
    headers['X-CSRF-Token'] = state.csrf;
  }
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { json = await res.json(); } catch { /* ignore */ }
  }
  readCsrf(res, json);
  return { res, json };
}

async function request(method, path, body) {
  let { res, json } = await doFetch(method, path, body);

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new ApiError('auth', '登录已过期，请重新登录。', 401);
  }

  // CSRF desync: server returned the correct token; resync + retry once.
  if (res.status === 403 && !(path.endsWith('/auth/login') || path.endsWith('/auth/setup'))) {
    const correct = res.headers.get('X-CSRF-Token');
    if (correct && correct !== state.csrf) {
      state.csrf = correct;
      ({ res, json } = await doFetch(method, path, body));
      if (res.status === 401) {
        window.dispatchEvent(new CustomEvent('auth:expired'));
        throw new ApiError('auth', '登录已过期，请重新登录。', 401);
      }
    }
  }

  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || `请求失败 (${res.status})`;
    throw new ApiError('http', msg, res.status);
  }
  return json;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b) => request('POST', p, b),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
};

export { ApiError };
export function setCsrf(token) { if (token) state.csrf = token; }
