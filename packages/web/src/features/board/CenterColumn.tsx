import { useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Play, Square, Brain } from 'lucide-react';
import { trpc } from '../../lib/trpc';
import { useUI } from '../../store/uiStore';
import { TaskCard } from './TaskCard';
import { hourOfScheduled } from '@dm-life/shared';
import type { TaskView } from '@dm-life/shared';

const QUAD = [
  { key: 'q1', title: '重要且紧急', hint: '立即做', cls: 'border-red-500/40' },
  { key: 'q2', title: '重要不紧急', hint: '计划做', cls: 'border-amber-500/40' },
  { key: 'q3', title: '紧急不重要', hint: '委托', cls: 'border-sky-500/40' },
  { key: 'q4', title: '不重要不紧急', hint: '减少', cls: 'border-gray-600/40' },
] as const;

// 时间块覆盖的小时范围（08:00 - 22:00），每个小时是一个可拖入的落点
const HOURS = Array.from({ length: 15 }, (_, i) => i + 8);

function Quadrant({
  qkey,
  title,
  hint,
  cls,
  tasks,
  colorOf,
}: {
  qkey: string;
  title: string;
  hint: string;
  cls: string;
  tasks: TaskView[];
  colorOf: (k: string) => string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: qkey });
  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border bg-bg-panel p-2 transition ${cls} ${
        isOver ? 'ring-2 ring-accent' : ''
      }`}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-semibold text-gray-200">{title}</span>
        <span className="text-[10px] text-gray-500">{hint}</span>
      </div>
      <div data-role="task-list" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} color={colorOf(t.domainKey)} />
        ))}
      </div>
    </div>
  );
}

function TimeSlot({
  hour,
  tasks,
  colorOf,
}: {
  hour: number;
  tasks: TaskView[];
  colorOf: (k: string) => string | undefined;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot-${hour}` });
  return (
    <div
      ref={setNodeRef}
      data-hour={hour}
      className={`flex min-w-[120px] flex-1 flex-col gap-1 rounded-lg border p-1.5 transition ${
        isOver ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-bg-border bg-bg-base/60'
      }`}
    >
      <div className="text-[10px] font-medium text-gray-500">{String(hour).padStart(2, '0')}:00</div>
      {tasks.length === 0 ? (
        <div className="m-auto text-[10px] text-gray-600">拖入</div>
      ) : (
        tasks.map((t) => <TaskCard key={t.id} task={t} color={colorOf(t.domainKey)} scope="slot" />)
      )}
    </div>
  );
}

function FocusEntryButton({ onOpenFlow }: { onOpenFlow: () => void }) {
  return (
    <button
      onClick={onOpenFlow}
      className="flex items-center gap-1 rounded-md border border-bg-border bg-bg-raised px-2 py-0.5 text-xs text-gray-200 transition hover:border-accent/50 hover:text-accent"
      title="打开心流仪表盘，开始一次专注"
    >
      <Brain size={12} /> 开始专注
    </button>
  );
}

export function CenterColumn({ onOpenFlow }: { onOpenFlow?: () => void }) {
  const { data: tasks = [] } = trpc.tasks.today.useQuery();
  const { data: domains = [] } = trpc.domains.list.useQuery();
  const activeDomain = useUI((s) => s.activeDomain);
  const colorOf = (k: string) => domains.find((d) => d.key === k)?.color;
  const inDomain = (t: TaskView) => !activeDomain || t.domainKey === activeDomain;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3 overflow-hidden">
        {QUAD.map((q) => (
          <Quadrant
            key={q.key}
            qkey={q.key}
            title={q.title}
            hint={q.hint}
            cls={q.cls}
            tasks={tasks.filter((t) => t.quadrant === q.key && inDomain(t))}
            colorOf={colorOf}
          />
        ))}
      </div>

      <div className="rounded-xl border border-bg-border bg-bg-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-200">时间块</h2>
          {onOpenFlow && <FocusEntryButton onOpenFlow={onOpenFlow} />}
        </div>
        <div className="flex h-24 gap-1.5 overflow-x-auto rounded-lg bg-bg-base p-1">
          {HOURS.map((h) => (
            <TimeSlot
              key={h}
              hour={h}
              tasks={tasks.filter((t) => inDomain(t) && hourOfScheduled(t.scheduledStart) === h)}
              colorOf={colorOf}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
