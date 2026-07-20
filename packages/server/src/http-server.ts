// M2.3 —— 真实可运行的 HTTP 服务入口（供 Web 端联机接入）
// 协议：tRPC v11 的 fetch adapter + Bearer 鉴权 + CORS。
// 关键：使用 fetchRequestHandler（endpoint 选项会正确从 req.url 剥离 /trpc 前缀），
// 而非 nodeHTTPRequestHandler（该版本不会剥离 procedure 段，导致所有调用 404）。
// 启动：npm run dev / npm run start（默认 4100，可用 PORT 覆盖）
import { createServer } from 'node:http';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { incomingMessageToRequest } from '@trpc/server/adapters/node-http';
import { appRouter, ctxFromAuthorization } from './router';
import { attachHub } from './realtime/hub';
import { initDb, closeDb } from './db';
import { getVersionInfo, SCHEMA_VERSION } from './version';
import { sanitizeError } from './log-sanitize';

const PORT = Number(process.env.PORT || 4100);
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const ENDPOINT = '/trpc';

let dbReady = false;

/** 从请求解析客户端 IP（优先 x-forwarded-for，其次 socket 直连），用于限流等 */
function clientIp(req: import('node:http').IncomingMessage): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0]!.trim();
  if (Array.isArray(fwd) && fwd.length) return fwd[0]!.trim();
  return req.socket?.remoteAddress;
}

function setCors(res: import('node:http').ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function sendJson(res: import('node:http').ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function main() {
  const server = createServer((req, res) => {
    setCors(res);

    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = (req.url ?? '/').split('?')[0] ?? '/';

    // 版本信息：前端启动校验用（无需 db 就绪）
    if (url === '/api/version') {
      sendJson(res, 200, getVersionInfo());
      return;
    }

    // 健康检查：initDb 完成前返回 503，让启动脚本/前端知道服务正在预热
    if (url === '/health' || url === '/ready') {
      if (dbReady) {
        sendJson(res, 200, {
          status: 'ok',
          ready: true,
          service: 'dm-life-collab',
          schemaVersion: SCHEMA_VERSION,
        });
      } else {
        sendJson(res, 503, {
          status: 'warming',
          ready: false,
          service: 'dm-life-collab',
          schemaVersion: SCHEMA_VERSION,
        });
      }
      return;
    }

    // 数据库未就绪时拒绝业务请求，避免请求挂起直到超时（表现为 Failed to fetch）
    if (!dbReady) {
      sendJson(res, 503, { status: 'warming', ready: false, message: '协作服务正在初始化数据库，请稍后再试' });
      return;
    }

    if (url.startsWith(ENDPOINT)) {
      void (async () => {
        try {
          const webReq = incomingMessageToRequest(req, res, { maxBodySize: null });
          const response = await fetchRequestHandler({
            endpoint: ENDPOINT,
            req: webReq,
            router: appRouter,
            // 注意：此处 r 是 fetch 适配层包装后的 web Request，无 socket、headers 也非
            // 普通对象，不能直接取客户端 IP。必须用外层 Node IncomingMessage(req) 取 IP，
            // 否则 clientIp 恒为 undefined → 限流退化为全局共享 bucket（ip=unknown），失效。
            createContext: ({ req: r }) => ctxFromAuthorization(r.headers.get('authorization') ?? undefined, clientIp(req)),
          });
          res.statusCode = response.status;
          response.headers.forEach((v, k) => res.setHeader(k, v));
          const buf = Buffer.from(await response.arrayBuffer());
          res.end(buf);
        } catch (e) {
          console.error('[tRPC] handler error', sanitizeError(e));
          if (!res.headersSent) res.writeHead(500);
          res.end('内部错误');
        }
      })();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('家庭协作服务 · 运行中');
  });

  // 实时网关：在 /ws 挂载 WebSocket Hub（鉴权 + 在线状态 + 事件广播）
  attachHub(server);

  server.listen(PORT, () => {
    console.log(`✅ 家庭协作服务已监听: http://localhost:${PORT}${ENDPOINT}`);
  });

  // 后台初始化数据库；PGLite 冷启动可能耗时 10-30s，期间 /health 返回 503，业务请求返回 503
  try {
    await initDb();
    dbReady = true;
    console.log('✅ 数据库初始化完成，协作服务已就绪');
  } catch (err) {
    console.error('数据库初始化失败', sanitizeError(err));
    // 保持监听，但业务请求继续 503，便于通过 /health 与日志排查
  }

  const shutdown = async () => {
    console.log('\n正在关闭…');
    server.close();
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败', sanitizeError(err));
  process.exit(1);
});
