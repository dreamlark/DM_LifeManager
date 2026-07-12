import http from 'node:http';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { incomingMessageToRequest } from '@trpc/server/adapters/node-http';
import { appRouter } from './router/appRouter';
import { attachSse } from './sse/sse';
import { initDb, saveDb } from './db/client';
import { migrate } from './db/migrate';
import { seedDomains, seedReminders, seedNotes } from './db/seed';
import { config } from './config';
import { logger } from './logging';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// 启动时自包含：异步初始化数据库（加载/新建文件）→ 建表 → 种子
await initDb();
migrate();
seedDomains();
seedReminders();
seedNotes();
// 种子数据通过 db 直写（未走 writeTx），首次启动需显式落盘，
// 否则进程在用户写入前退出会导致种子库从未写盘、下次启动又重新建库。
saveDb();

const server = http.createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];

  if (req.method === 'GET' && url === '/events') {
    attachSse(req, res);
    return;
  }

  // 调试端点：列出当前进程**实际生效**的 tRPC procedure 路径。
  // 用于排查"前端报 No procedure found 但源码里明明有"——通常意味着
  // 跑的 engine 进程加载的是早前代码快照（孤儿进程/未重启）。
  // 浏览器访问 http://127.0.0.1:<port>/_routes 即可看到完整路径列表。
  if (req.method === 'GET' && url === '/_routes') {
    const procs = (appRouter as any)._def.procedures as Record<string, unknown>;
    const paths = Object.keys(procs).sort();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify(
        {
          engine: 'dm-life',
          port: (server.address() as { port: number } | null)?.port ?? null,
          procedureCount: paths.length,
          paths,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (url.startsWith('/trpc')) {
    void (async () => {
      try {
        const webReq = incomingMessageToRequest(req, res, { maxBodySize: null });
        const response = await fetchRequestHandler({
          endpoint: '/trpc',
          req: webReq,
          router: appRouter,
          createContext: () => ({}),
        });
        res.statusCode = response.status;
        response.headers.forEach((v, k) => res.setHeader(k, v));
        const buf = Buffer.from(await response.arrayBuffer());
        res.end(buf);
      } catch (e) {
        logger.error({ err: e }, 'tRPC handler error');
        if (!res.headersSent) res.statusCode = 500;
        res.end('internal error');
      }
    })();
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('DM_life engine · 运行中');
});

/**
 * 端口自动协商：默认端口被占则 +1 重试，最多 10 次（14570-14579）。
 * 解决"沙箱孤儿进程占住 14570 杀不掉"导致的"新 engine 启不来/前端连旧版"问题。
 * 把最终绑定的端口写到 tmp 文件 .dm-life.engine.port，让 vite dev 能读到。
 */
const MAX_PORT_TRIES = 10;
let tryPort = config.port;
function listenWithRetry(remaining: number): void {
  // 每次重试都要重新注册 error 监听（once 会自动失效）
  server.once('error', (err: NodeJS.ErrnoException) => {
    process.stderr.write(`[engine] port ${tryPort} listen error: ${err.code} ${err.message}\n`);
    if (err.code === 'EADDRINUSE' && remaining > 0) {
      tryPort += 1;
      process.stderr.write(`[engine] retrying on port ${tryPort} (${remaining} attempts left)...\n`);
      listenWithRetry(remaining - 1);
    } else {
      process.stderr.write(`[engine] failed to bind port after retries: ${err.message}\n`);
      process.exit(1);
    }
  });
  server.listen(tryPort, config.host, () => {
    logger.info({ host: config.host, port: tryPort }, 'engine started');
    console.log(`DM_life engine → http://${config.host}:${tryPort}  (tRPC: /trpc, SSE: /events)`);
    // 把端口写到一个 tmp 文件，让 vite dev proxy 自动发现
    try {
      const portFile = path.join(os.tmpdir(), 'dm-life.engine.port');
      fs.writeFileSync(portFile, String(tryPort), 'utf8');
    } catch (e) {
      // tmp 写不进也不致命（仅无法自动发现）
      logger.warn({ err: e }, 'failed to write engine port file');
    }
  });
}
listenWithRetry(MAX_PORT_TRIES - 1);
