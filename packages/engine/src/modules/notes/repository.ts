import { db } from '../../db/client';
import { notes } from '../../db/schema';
import { eq } from 'drizzle-orm';
import type { NoteView } from '@dm-life/shared';

interface NoteRow {
  id: string;
  title: string;
  bodyMarkdown: string;
  links: string | null;
  tags: string | null;
  kind: string;
  taskId: string | null;
  createdAt: string;
}

function parseJsonArray(v: string | null): string[] {
  if (!v) return [];
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

export function insertNote(p: {
  id: string;
  title: string;
  bodyMarkdown: string;
  links: string[];
  tags: string[];
  kind: 'idea' | 'notebook';
  taskId: string | null;
  now: string;
}): void {
  db.insert(notes)
    .values({
      id: p.id,
      title: p.title,
      bodyMarkdown: p.bodyMarkdown,
      links: JSON.stringify(p.links),
      tags: JSON.stringify(p.tags),
      kind: p.kind,
      taskId: p.taskId,
      createdAt: p.now,
      updatedAt: p.now,
    })
    .run();
}

/** 列表：按摄入时间倒序；可按 kind 过滤（灵感/记事本分流） */
export function listNotes(limit = 50, kind?: 'idea' | 'notebook'): NoteView[] {
  let query = db.select().from(notes);
  if (kind) query = query.where(eq(notes.kind, kind));
  const rows = query.orderBy(notes.createdAt).limit(limit).all() as NoteRow[];

  // 倒序（最新在前）
  return rows
    .reverse()
    .map((r) => ({
      id: r.id,
      title: r.title,
      bodyMarkdown: r.bodyMarkdown,
      links: parseJsonArray(r.links),
      tags: parseJsonArray(r.tags),
      kind: (r.kind as 'idea' | 'notebook') ?? 'idea',
      taskId: r.taskId,
      createdAt: r.createdAt,
    }));
}

export function updateNoteFields(
  id: string,
  fields: Partial<{ title: string; bodyMarkdown: string; links: string; tags: string; taskId: string | null }>,
  now: string,
): void {
  db.update(notes).set({ ...fields, updatedAt: now }).where(eq(notes.id, id)).run();
}

export function deleteNote(id: string): void {
  db.delete(notes).where(eq(notes.id, id)).run();
}
