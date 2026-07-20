import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpcLocal, queryClientLocal } from './lib/trpcLocal';
import { useAuthStore } from './store/authStore';
import App from './App';
import { BackendGate } from './components/BackendGate';
import './tailwind.css';
import './styles.css';

// 个人模式（单机版）tRPC 客户端：经 vite /engine 代理转发到 packages/engine（:14570）
// 包装 fetch 增加 10s 超时：引擎不可达/挂起时让 mutation 快速报错（toast），而非无限 pending 表现为“按键无响应”。
// 关键：必须「合并」react-query/tRPC 传入的取消信号（init.signal），不能覆盖——
// 否则 invalidate() 触发的在途请求无法被 react-query 取消，失效-重取链路被打乱，
// 看板点击后不刷新（切走再回来靠全新 fetch 才生效）。
const trpcFetch: typeof fetch = (input, init) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  const external = init?.signal;
  if (external) {
    if (external.aborted) ctrl.abort();
    else external.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(timer));
};

// P0-2：若 engine 启用了访问令牌（登录后由服务端下发），请求时携带 Bearer，
// 否则（桌面单机 / 未配置）返回空对象，不携带任何凭证。令牌仅在已登录时存在，匿名者拿不到。
function engineHeaders(): Record<string, string> {
  const token = useAuthStore.getState().engineToken;
  return token ? { authorization: `Bearer ${token}` } : {};
}

const trpcLocalClient = trpcLocal.createClient({
  links: [httpBatchLink({ url: '/engine/trpc', fetch: trpcFetch, headers: engineHeaders })],
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <trpcLocal.Provider client={trpcLocalClient} queryClient={queryClientLocal}>
      <QueryClientProvider client={queryClientLocal}>
        <BackendGate>
          <App />
        </BackendGate>
      </QueryClientProvider>
    </trpcLocal.Provider>
  </React.StrictMode>,
);
