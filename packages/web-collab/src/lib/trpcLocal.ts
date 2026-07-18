import { createTRPCReact } from '@trpc/react-query';
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AppRouter } from '@dm-life/engine/router';

// 个人模式（单机版）tRPC React 客户端：指向本地 engine（经由 vite /engine 代理动态发现实际端口）
// 命名为 `trpc`（与单机版 packages/web 约定一致），并导出 `trpcLocal` 别名供 LocalApp/main 使用。
export const trpc = createTRPCReact<AppRouter>();
export const trpcLocal = trpc;

export const queryClientLocal = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 500, refetchOnWindowFocus: false },
    mutations: {
      onError: (err) => {
        const raw = err instanceof Error ? err.message : '未知错误';
        const friendly =
          /No procedure found/i.test(raw) || /NOT_FOUND/i.test(raw)
            ? `${raw}\n\n→ 可能是 engine 进程未启动或加载旧代码：\n  1) 确认 packages/engine 已运行（默认 14570；被占用时会自动 +1 到 14571+）\n  2) 浏览器访问 http://127.0.0.1:<实际端口>/_routes 确认 paths 列表（检查是否包含 tasks.ensureDaily）`
            : raw;
        toast.error(`操作失败：${friendly}`, { duration: 6000 });
      },
    },
  },
});
