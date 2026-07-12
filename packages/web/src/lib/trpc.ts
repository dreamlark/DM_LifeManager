import { createTRPCReact } from '@trpc/react-query';
import { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AppRouter } from '@dm-life/engine/router';

export const trpc = createTRPCReact<AppRouter>();

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 500, refetchOnWindowFocus: false },
    mutations: {
      // 写操作失败不再静默：弹 toast 让用户看到原因，而非"点了没反应"
      onError: (err) => {
        const raw = err instanceof Error ? err.message : '未知错误';
        // tRPC 客户端在 fetch 拿到 404 时抛的 message，提示用户排查 engine 版本
        const friendly =
          /No procedure found/i.test(raw) || /NOT_FOUND/i.test(raw)
            ? `${raw}\n\n→ 可能是 engine 进程加载的是旧代码：\n  1) 浏览器访问 http://127.0.0.1:14570/_routes 确认 paths 列表\n  2) 旧版缺 procedure：Ctrl+C 停掉 engine 后重新 \`npm run dev:engine\``
            : raw;
        toast.error(`操作失败：${friendly}`, { duration: 6000 });
      },
    },
  },
});
