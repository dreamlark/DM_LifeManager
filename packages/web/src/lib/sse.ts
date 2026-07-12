import { useEffect } from 'react';
import { trpc } from './trpc';

/**
 * 订阅引擎 SSE 事件流：任意写事件到来即让相关查询失效并重新拉取，
 * 实现「命令 → 事务双写 → 事件总线 → SSE → 看板刷新」的闭环。
 */
export function useEventStream(): void {
  const utils = trpc.useUtils();

  useEffect(() => {
    const es = new EventSource('/events');

    es.onmessage = () => {
      void utils.tasks.today.invalidate();
      void utils.insights.dailyCard.invalidate();
      void utils.finance.summary.invalidate();
      void utils.finance.debts.list.invalidate();
      void utils.finance.incomes.list.invalidate();
      void utils.finance.transactions.list.invalidate();
      void utils.finance.assets.list.invalidate();
      void utils.reminders.list.invalidate();
      void utils.reminders.upcoming.invalidate();
      void utils.insights.pressure.invalidate();
      void utils.notes.list.invalidate();
      void utils.flow.summary.invalidate();
      void utils.flow.list.invalidate();
      void utils.interests.list.invalidate();
      void utils.interests.review.invalidate();
    };
    // 浏览器会在连接断开时自动重连
    es.onerror = () => {
      /* noop */
    };

    return () => es.close();
  }, [utils]);
}
