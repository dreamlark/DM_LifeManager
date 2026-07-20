import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@dm-life/server/router';
import { useAuthStore } from '../store/authStore';

// 服务端地址：开发期走 vite 代理（同源 /trpc → 4100），生产用 VITE_SERVER_URL 直连
const SERVER_URL = (import.meta.env.VITE_SERVER_URL || `${location.origin}/trpc`).replace(/\/$/, '');

// 防止并发 401 时多次刷新
let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const { refreshToken } = useAuthStore.getState();
    if (!refreshToken) return false;
    try {
      const res = await trpc.auth.refresh.mutate({ refreshToken });
      useAuthStore.getState().setTokens(res.accessToken, res.refreshToken);
      await refreshEngineToken();
      return true;
    } catch {
      useAuthStore.getState().clear();
      return false;
    }
  })();
  const ok = await refreshing;
  refreshing = null;
  return ok;
}

// 自定义 fetch：注入 Bearer，遇到 401 自动用 refresh 旋转一次后重试
async function authedFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const access = useAuthStore.getState().accessToken;
  const headers = new Headers(init?.headers);
  if (access) headers.set('Authorization', `Bearer ${access}`);
  let res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    const refreshed = await tryRefresh();
    if (refreshed) {
      const next = useAuthStore.getState().accessToken;
      if (next) headers.set('Authorization', `Bearer ${next}`);
      res = await fetch(url, { ...init, headers });
    }
  }
  return res;
}

/**
 * 登录（或刷新成功）后，从服务端拉取引擎共享令牌并存入内存（P0-2）。
 * 仅已登录用户能拿到该令牌，避免匿名者直连 engine。engineToken 为 null 时
 * 表示 engine 未启用令牌（桌面单机场景），前端照常不带令牌访问。
 */
export async function refreshEngineToken(): Promise<void> {
  try {
    const { engineToken } = await trpc.auth.engineToken.query();
    useAuthStore.getState().setEngineToken(engineToken ?? null);
  } catch {
    useAuthStore.getState().setEngineToken(null);
  }
}

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: SERVER_URL, fetch: authedFetch })],
});
