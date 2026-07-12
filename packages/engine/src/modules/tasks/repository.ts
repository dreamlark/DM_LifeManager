import { db } from '../../db/client';
import { tasks } from '../../db/schema';
import { eq, asc } from 'drizzle-orm';
import type { CreateTaskInput, TaskView } from '@dm-life/shared';

type TaskRow = typeof tasks.$inferSelect;

function quadrantOf(row: Pick<TaskRow, 'importance' | 'urgency'>): TaskView['quadrant'] {
  if (row.importance && row.urgency) return 'q1';
  if (row.importance && !row.urgency) return 'q2';
  if (!row.importance && row.urgency) return 'q3';
  return 'q4';
}

function rowToView(row: TaskRow): TaskView {
  return {
    id: row.id,
    title: row.title,
    domainKey: row.domainKey,
    projectId: row.projectId,
    importance: !!row.importance,
    urgency: !!row.urgency,
    isMit: !!row.isMit,
    mitOrder: row.mitOrder,
    status: row.status,
    quadrant: quadrantOf(row),
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    dueAt: row.dueAt,
    description: row.description ?? '',
    priority: (row.priority as TaskView['priority']) ?? 'medium',
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    completionQuality: row.completionQuality ?? null,
    attentionPeak: row.attentionPeak ?? null,
  };
}

/** 今日看板：返回全部任务并标注象限（P0 不做日期过滤，展示全量） */
export function listToday(): TaskView[] {
  const rows = db.select().from(tasks).orderBy(asc(tasks.mitOrder), asc(tasks.createdAt)).all();
  return (rows as TaskRow[]).map(rowToView);
}

/** 日历等场景：返回全部任务（含描述/优先级），按 scheduledStart 升序。 */
export function listAll(): TaskView[] {
  const rows = db.select().from(tasks).orderBy(asc(tasks.scheduledStart), asc(tasks.createdAt)).all();
  return (rows as TaskRow[]).map(rowToView);
}

export function getTask(id: string): TaskView | null {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get() as TaskRow | undefined;
  return row ? rowToView(row) : null;
}

export function insertTask(p: { id: string } & CreateTaskInput & { now: string }): void {
  db.insert(tasks)
    .values({
      id: p.id,
      title: p.title,
      domainKey: p.domainKey,
      projectId: p.projectId ?? null,
      importance: p.importance,
      urgency: p.urgency,
      isMit: p.isMit,
      mitOrder: p.mitOrder ?? null,
      status: 'todo',
      scheduledStart: p.scheduledStart ?? null,
      scheduledEnd: p.scheduledEnd ?? null,
      dueAt: p.dueAt ?? null,
      description: p.description ?? '',
      priority: p.priority ?? 'medium',
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}

export function markComplete(
  id: string,
  completedAt: string,
  completionQuality: number | null,
  attentionPeak: number | null,
): void {
  db.update(tasks)
    .set({ status: 'done', completedAt, completionQuality, attentionPeak, updatedAt: completedAt })
    .where(eq(tasks.id, id))
    .run();
}

/** 取消完成：状态回退为 todo，清空完成时间/质量/注意力峰值（未完成任务不带这些指标）。 */
export function markIncomplete(id: string): void {
  const now = new Date().toISOString();
  db.update(tasks)
    .set({ status: 'todo', completedAt: null, completionQuality: null, attentionPeak: null, updatedAt: now })
    .where(eq(tasks.id, id))
    .run();
}

export function updateQuadrant(id: string, importance: boolean, urgency: boolean): void {
  db.update(tasks)
    .set({ importance, urgency, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();
}

export function updateSchedule(id: string, scheduledStart: string, scheduledEnd: string): void {
  db.update(tasks)
    .set({ scheduledStart, scheduledEnd, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();
}

export function updateMit(id: string, isMit: boolean, mitOrder: number | null): void {
  db.update(tasks)
    .set({ isMit, mitOrder, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();
}

/** 编辑任务：仅更新显式传入（非 undefined）的字段，其余保持原值。 */
export function updateTaskFields(
  id: string,
  fields: {
    title?: string;
    domainKey?: string;
    projectId?: string | null;
    importance?: boolean;
    urgency?: boolean;
    dueAt?: string | null;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    description?: string | null;
    priority?: 'low' | 'medium' | 'high';
    status?: 'todo' | 'doing' | 'done' | 'archived';
  },
): void {
  const now = new Date().toISOString();
  const set: Record<string, unknown> = { updatedAt: now };
  if (fields.title !== undefined) set.title = fields.title;
  if (fields.domainKey !== undefined) set.domainKey = fields.domainKey;
  if (fields.projectId !== undefined) set.projectId = fields.projectId;
  if (fields.importance !== undefined) set.importance = fields.importance;
  if (fields.urgency !== undefined) set.urgency = fields.urgency;
  if (fields.dueAt !== undefined) set.dueAt = fields.dueAt;
  if (fields.scheduledStart !== undefined) set.scheduledStart = fields.scheduledStart;
  if (fields.scheduledEnd !== undefined) set.scheduledEnd = fields.scheduledEnd;
  if (fields.description !== undefined) set.description = fields.description;
  if (fields.priority !== undefined) set.priority = fields.priority;
  if (fields.status !== undefined) set.status = fields.status;
  db.update(tasks).set(set).where(eq(tasks.id, id)).run();
}

export function deleteTask(id: string): void {
  db.delete(tasks).where(eq(tasks.id, id)).run();
}
