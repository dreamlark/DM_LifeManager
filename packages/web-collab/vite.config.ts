import { defineConfig } from 'vite';
import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// 联机版 Web 开发服务器：将 /trpc 代理到协作服务（默认 4100，可用 VITE_SERVER_PORT 覆盖）
const SERVER_PORT = Number(process.env.VITE_SERVER_PORT || 4100);

/**
 * 动态解析 engine URL（每次代理请求都会重新解析）。
 * 优先级：1) VITE_ENGINE_URL 环境变量；2) engine 写入 tmp 的 .dm-life.engine.port；
 * 3) 扫描 14570-14579 找第一个能响应 /_routes 的存活 engine；4) 回退 14570。
 *
 * 解决：沙箱孤儿进程占住 14570 导致新 engine 自动 +1 到 14571，
 * 而 vite 仍代理到 14570（旧版/无响应）→ 报 No procedure found on path tasks.ensureDaily。
 */
const PORT_FILE = path.join(os.tmpdir(), 'dm-life.engine.port');
const DEFAULT_PORT = 14570;
const PORT_MIN = 14570;
const PORT_MAX = 14579;
const CACHE_TTL = 2000;

type Cache = { url: string; ts: number } | null;
let cache: Cache = null;

function readPortFile(): number | null {
  try {
    if (fs.existsSync(PORT_FILE)) {
      const port = Number(fs.readFileSync(PORT_FILE, 'utf8').trim());
      if (Number.isFinite(port) && port > 0) return port;
    }
  } catch {
    /* ignore */
  }
  return null;
}

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
  if (process.env.VITE_ENGINE_URL) return process.env.VITE_ENGINE_URL;
  if (cache && Date.now() - cache.ts < CACHE_TTL) return cache.url;

  // 优先用端口文件（由新启动的 engine 写入）；若文件尚未写入，短暂等待最多 3 秒
  let pf = readPortFile();
  if (!pf) {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 200));
      pf = readPortFile();
      if (pf) break;
    }
  }
  if (pf && (await probe(pf))) {
    const url = `http://127.0.0.1:${pf}`;
    cache = { url, ts: Date.now() };
    return url;
  }

  // 端口文件缺失或探测失败时，扫描 14570-14579 作为兜底
  for (let p = PORT_MIN; p <= PORT_MAX; p++) {
    if (await probe(p)) {
      const url = `http://127.0.0.1:${p}`;
      cache = { url, ts: Date.now() };
      console.log(`[vite] engine discovered via scan -> ${url}`);
      return url;
    }
  }

  return `http://127.0.0.1:${DEFAULT_PORT}`;
}

console.log('[vite] engine proxy: dynamic discovery (port file + scan 14570-14579, per-request)');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      // 个人模式：/engine/* 代理到本地 engine，动态解析实际端口
      '/engine': ({
        target: process.env.VITE_ENGINE_URL || `http://127.0.0.1:${DEFAULT_PORT}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/engine/, ''),
        router: () => process.env.VITE_ENGINE_URL || resolveEngineUrl(),
      } as ProxyOptions & { router?: () => Promise<string> | string }),
      '/trpc': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
      },
      // 健康检查：用于 BackendGate 判断协作服务是否已初始化完成
      '/health': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
      },
      // 实时网关：把 WebSocket 升级也代理到协作服务（ws:true 必须）
      '/ws': {
        target: `http://127.0.0.1:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
