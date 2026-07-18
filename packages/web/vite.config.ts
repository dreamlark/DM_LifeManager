import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as http from 'node:http';

/**
 * 动态解析 engine URL（每次代理请求都会重新解析，而非只在 vite 启动时解析一次）。
 *
 * 优先级：
 *  1) 环境变量 VITE_ENGINE_URL（手动指定，最高优先级）
 *  2) engine 启动时写入 tmp 的 .dm-life.engine.port（权威，带存活探测）
 *  3) 端口文件缺失/失效时，扫描 14570-14579 找第一个能响应 /_routes 的存活 engine
 *  4) 回退默认 14570
 *
 * 关键改进：解析发生在「每次请求」而非「vite 启动时」。这样即使：
 *  - 先起了 vite、后起 engine（engine 自动 +1 到 14571 并写端口文件）
 *  - 或 engine 中途重启到别的端口
 * vite 都会自动跟随最新 engine，不再卡在旧端口 → 根除 No procedure found。
 */
const PORT_FILE = path.join(os.tmpdir(), 'dm-life.engine.port');
const DEFAULT_PORT = 14570;
const PORT_MIN = 14570;
const PORT_MAX = 14579;
const CACHE_TTL = 4000; // 4s 内复用解析结果，避免每个请求都扫描端口

type Cache = { url: string; ts: number } | null;
let cache: Cache = null;

function readPortFile(): number | null {
  try {
    if (fs.existsSync(PORT_FILE)) {
      const port = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
      if (Number.isFinite(port) && port > 0) return port;
    }
  } catch {
    /* 读不到忽略 */
  }
  return null;
}

/** 探测某端口是否有存活的 engine（能响应 /_routes 即视为存活） */
function probe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/_routes', timeout: 600 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function resolveEngineUrl(): Promise<string> {
  // 1) 手动指定优先
  if (process.env.VITE_ENGINE_URL) return process.env.VITE_ENGINE_URL;

  // 2) 缓存未过期直接复用
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.url;

  // 3) 端口文件（engine 权威来源），带存活探测
  const pf = readPortFile();
  if (pf && (await probe(pf))) {
    const url = `http://127.0.0.1:${pf}`;
    cache = { url, ts: Date.now() };
    return url;
  }

  // 4) 端口文件缺失/失效 → 扫描端口范围找存活 engine
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (await probe(p)) {
      const url = `http://127.0.0.1:${p}`;
      cache = { url, ts: Date.now() };
      console.log(`[vite] engine discovered → ${url}`);
      return url;
    }
  }

  // 5) 全部失败回退默认
  return `http://127.0.0.1:${DEFAULT_PORT}`;
}

console.log('[vite] engine proxy: 动态发现（端口文件 + 端口扫描 14570-14579，每次请求实时解析）');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@dm-life/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: {
    // shared 是 TS 源码，不入预构建，交给 esbuild 实时转译
    exclude: ['@dm-life/shared'],
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
    // 预览服务同样代理到 engine（截图走 preview）
    proxy: {
      '/trpc': ({
        target: process.env.VITE_ENGINE_URL || `http://127.0.0.1:${DEFAULT_PORT}`,
        changeOrigin: true,
        router: () => process.env.VITE_ENGINE_URL || resolveEngineUrl(),
      } as ProxyOptions & { router?: () => string }),
      '/events': ({
        target: process.env.VITE_ENGINE_URL || `http://127.0.0.1:${DEFAULT_PORT}`,
        changeOrigin: true,
        router: () => process.env.VITE_ENGINE_URL || resolveEngineUrl(),
      } as ProxyOptions & { router?: () => string }),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // 每次请求通过 router 函数实时解析 engine 端口（http-proxy 原生支持）
      '/trpc': ({
        target: process.env.VITE_ENGINE_URL || `http://127.0.0.1:${DEFAULT_PORT}`,
        changeOrigin: true,
        router: () => process.env.VITE_ENGINE_URL || resolveEngineUrl(),
      } as ProxyOptions & { router?: () => string }),
      '/events': ({
        target: process.env.VITE_ENGINE_URL || `http://127.0.0.1:${DEFAULT_PORT}`,
        changeOrigin: true,
        router: () => process.env.VITE_ENGINE_URL || resolveEngineUrl(),
      } as ProxyOptions & { router?: () => string }),
    },
  },
});
