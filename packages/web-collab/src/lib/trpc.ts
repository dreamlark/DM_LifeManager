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

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: SERVER_URL, fetch: authedFetch })],
});
