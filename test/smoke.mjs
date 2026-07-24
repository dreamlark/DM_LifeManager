// 自动化冒烟测试（自包含）：启动服务 → 跑 12 项端到端检查 → 关闭。
// 用法：npm test  （或 node test/smoke.mjs）
// 不自依赖外部服务；使用临时 DATA_DIR，结束后清理。

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('.');
const PORT = process.env.SMOKE_PORT || 31337;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dml-smoke-'));
const SESSION_SECRET = 'smoke-' + crypto.randomBytes(16).toString('hex');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function j(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) { try { json = await res.json(); } catch {} }
  return { res, json };
}

async function waitReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(BASE + '/health');
      if (r.status === 200) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const env = {
  ...process.env,
  PORT: String(PORT),
  DATA_DIR,
  SESSION_SECRET,
  NODE_ENV: 'production',
};

const server = spawn(process.execPath, ['--import', 'dotenv/config', 'server/index.js'], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});

let exitCode = 1;
try {
  if (!await waitReady()) throw new Error('server 未在超时内就绪');

  // 1. version: 首跑应 setup_required=true
  let { res, json } = await j('GET', '/api/v1/version');
  check('GET /version → setup_required=true', res.status === 200 && json.setup_required === true, `setup_required=${json.setup_required}`);

  // 2. setup: 创建管理员 + csrfToken
  ({ res, json } = await j('POST', '/api/v1/auth/setup', { username: 'admin', display_name: 'Admin', password: 'password123' }));
  check('POST /auth/setup → 201 + csrfToken', res.status === 201 && !!json.csrfToken, `status=${res.status}`);
  const csrf = json.csrfToken;

  // 取全部 Set-Cookie（含 dmlife.sid 会话 + csrf-token）
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')];
  const cookie = setCookies.join('; ');

  // 3. me (已登录)
  ({ res, json } = await j('GET', '/api/v1/auth/me', undefined, { Cookie: cookie }));
  check('GET /auth/me (已登录) → 200', res.status === 200 && json.user?.username === 'admin', `status=${res.status}`);

  // 4. modules: 6 个
  ({ res, json } = await j('GET', '/api/v1/modules', undefined, { Cookie: cookie }));
  const names = (json.data || []).map((m) => m.name).sort().join(',');
  check('GET /modules → 6 模块', res.status === 200 && json.data?.length === 6, `modules=[${names}]`);

  // 5. 写债务（带 CSRF）
  ({ res, json } = await j('POST', '/api/v1/finance/debts', { creditor: 'Bank', principal: 100000, apr: 4.9, min_payment: 2000 }, { Cookie: cookie, 'X-CSRF-Token': csrf }));
  check('POST /finance/debts (CSRF 正确) → 201', res.status === 201 && json.data?.principal === 100000, `status=${res.status}`);

  // 6. 读债务
  ({ res, json } = await j('GET', '/api/v1/finance/debts', undefined, { Cookie: cookie }));
  check('GET /finance/debts → 含数据', res.status === 200 && Array.isArray(json.data) && json.data.length === 1, `count=${json.data?.length}`);

  // 7. summary: totalDebt
  ({ res, json } = await j('GET', '/api/v1/finance/summary', undefined, { Cookie: cookie }));
  check('GET /finance/summary → totalDebt', res.status === 200 && json.data?.totalDebt === 100000, `totalDebt=${json.data?.totalDebt}`);

  // 8. 写债务无 CSRF → 403
  ({ res } = await j('POST', '/api/v1/finance/debts', { creditor: 'X', principal: 1 }, { Cookie: cookie }));
  check('POST /finance/debts 无 CSRF → 403', res.status === 403, `status=${res.status}`);

  // 9. 静态资产 app.js
  ({ res } = await j('GET', '/app.js'));
  check('GET /app.js → 200 + JS', res.status === 200 && (res.headers.get('content-type') || '').includes('javascript'), `ct=${res.headers.get('content-type')}`);

  // 10. 模块 page.js 可达
  ({ res } = await j('GET', '/modules/finance/page.js'));
  check('GET /modules/finance/page.js → 200', res.status === 200, `status=${res.status}`);

  // 11. health
  ({ res } = await j('GET', '/health'));
  check('GET /health → 200', res.status === 200, `status=${res.status}`);

  // 12. 未登录读受保护 → 401
  ({ res } = await j('GET', '/api/v1/finance/debts'));
  check('GET /finance/debts 未登录 → 401', res.status === 401, `status=${res.status}`);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n结果：${passed}/${results.length} 通过`);
  exitCode = passed === results.length ? 0 : 1;
} catch (e) {
  console.error('冒烟异常：', e.message);
  exitCode = 1;
} finally {
  server.kill('SIGTERM');
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch {}
  process.exit(exitCode);
}
