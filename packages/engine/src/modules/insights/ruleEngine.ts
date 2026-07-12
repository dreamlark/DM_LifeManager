import { db } from '../../db/client';
import { tasks, debts, reminderClocks } from '../../db/schema';
import { and, eq, lt, sql } from 'drizzle-orm';

/**
 * 每日回顾卡片（P0 stub）：基于现有任务做轻量聚合，不依赖向量检索。
 * 真实规则（压力背包评分、周回顾、领域平衡建议）P1 接入。
 */
export function dailyCard(): {
  total: number;
  done: number;
  mitCount: number;
  domainCounts: Record<string, number>;
} {
  const rows = db.select().from(tasks).all() as Array<{
    domain_key: string;
    status: string;
    is_mit: number;
  }>;

  const domainCounts: Record<string, number> = {};
  let done = 0;
  let mitCount = 0;
  for (const r of rows) {
    domainCounts[r.domain_key] = (domainCounts[r.domain_key] ?? 0) + 1;
    if (r.status === 'done') done += 1;
    if (r.is_mit) mitCount += 1;
  }

  return { total: rows.length, done, mitCount, domainCounts };
}

/**
 * 压力背包（P1）：跨表聚合三类「进行中 / 逾期未处理」负荷，
 * 加权成 0-100 压力指数并给等级标签，供右栏可视化。
 *
 * 数据源（只读聚合，不写事件）：
 * - 逾期提醒钟：reminder_clocks.status = 'overdue'
 * - 超期任务：tasks.status != 'done' 且 due_at < now
 * - 活跃债务：debts.status = 'active'（持续压力源）
 *
 * 权重设计：逾期提醒最紧急（×15）、超期任务（×10）、活跃债务（×5）。
 */
export function pressureBackpack(): {
  score: number;
  level: 'calm' | 'mild' | 'tense' | 'overloaded';
  breakdown: {
    overdueReminders: number;
    overdueTasks: number;
    activeDebts: number;
  };
} {
  const now = new Date().toISOString();

  const overdueReminders = db
    .select({ c: sql<number>`count(*)` })
    .from(reminderClocks)
    .where(eq(reminderClocks.status, 'overdue'))
    .get()?.c ?? 0;

  const overdueTasks = db
    .select({ c: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.status, 'todo'), lt(tasks.dueAt, now)))
    .get()?.c ?? 0;

  const activeDebts = db
    .select({ c: sql<number>`count(*)` })
    .from(debts)
    .where(eq(debts.status, 'active'))
    .get()?.c ?? 0;

  const raw = overdueReminders * 15 + overdueTasks * 10 + activeDebts * 5;
  const score = Math.min(100, raw);

  let level: 'calm' | 'mild' | 'tense' | 'overloaded' = 'calm';
  if (score >= 70) level = 'overloaded';
  else if (score >= 40) level = 'tense';
  else if (score > 0) level = 'mild';

  return {
    score,
    level,
    breakdown: {
      overdueReminders: Number(overdueReminders),
      overdueTasks: Number(overdueTasks),
      activeDebts: Number(activeDebts),
    },
  };
}
