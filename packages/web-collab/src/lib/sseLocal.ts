import { useEffect } from 'react';
import { trpcLocal } from './trpcLocal';
import { useAuthStore } from '../store/authStore';

/**
 * 订阅本地 engine 的 SSE 事件流（/engine/events）：任意写事件到来即让相关查询失效并重新拉取，
 * 实现「命令 → 事务双写 → 事件总线 → SSE → 看板刷新」的闭环（与个人模式一致）。
 */
export function useEventStreamLocal(): void {
  const utils = trpcLocal.useUtils();

  useEffect(() => {
    // P0-2：EventSource 无法自定义请求头，故令牌经 ?token= 传递（后端按查询参数校验）。
    // engine 未启用令牌时 token 为 null，则不附加任何凭证。
    const token = useAuthStore.getState().engineToken;
    const url = token ? `/engine/events?token=${encodeURIComponent(token)}` : '/engine/events';
    const es = new EventSource(url);

    es.onmessage = () => {
      void utils.tasks.today.invalidate();
      void utils.insights.dailyCard.invalidate();
      void utils.finance.summary.invalidate();
      void utils.finance.debts.list.invalidate();
      void utils.finance.incomes.list.invalidate();
      void utils.finance.transactions.list.invalidate();
      void utils.finance.assets.list.invalidate();
      void utils.finance.budgets.list.invalidate();
      void utils.reminders.list.invalidate();
      void utils.reminders.upcoming.invalidate();
      void utils.insights.pressure.invalidate();
      void utils.notes.list.invalidate();
      void utils.flow.summary.invalidate();
      void utils.flow.list.invalidate();
      void utils.interests.list.invalidate();
      void utils.interests.review.invalidate();
    };
    // 浏览器会在连接断开时自动重连；此处仅做可观测性告警，避免实时刷新静默失效却无从排查
    es.onerror = () => {
      console.warn('[sse] 本地事件流连接异常，实时刷新可能暂时失效，浏览器会自动重连');
    };

    return () => es.close();
  }, [utils]);
}
