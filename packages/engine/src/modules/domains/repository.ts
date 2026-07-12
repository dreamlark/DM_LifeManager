import { db } from '../../db/client';
import { domains } from '../../db/schema';
import type { DomainView } from '@dm-life/shared';

type DomainRow = typeof domains.$inferSelect;

function rowToView(row: DomainRow): DomainView {
  return {
    key: row.key,
    name: row.name,
    isQuarterFocus: !!row.isQuarterFocus,
    color: row.color,
  };
}

export function list(): DomainView[] {
  const rows = db.select().from(domains).all() as DomainRow[];
  return rows.map(rowToView);
}

/** 平衡轮聚合（P0 stub：返回空结构，接口就位待 P1 接入实际时长统计） */
export function balanceWheel(_week: string): {
  domainMinutes: Record<string, number>;
  topStresses: string[];
} {
  const all = list();
  const domainMinutes: Record<string, number> = {};
  for (const d of all) domainMinutes[d.key] = 0;
  return { domainMinutes, topStresses: [] };
}
