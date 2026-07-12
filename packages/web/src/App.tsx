import { useEffect, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Sun, Moon } from 'lucide-react';
import { trpc } from './lib/trpc';
import { useEventStream } from './lib/sse';
import { useUI } from './store/uiStore';
import { buildScheduleTimes } from '@dm-life/shared';
import { LeftColumn } from './features/board/LeftColumn';
import { CenterColumn } from './features/board/CenterColumn';
import { RightColumn } from './features/board/RightColumn';
import { TaskCardOverlay } from './features/board/TaskCard';
import { FinancePage } from './features/finance/FinancePage';
import { ReminderShopPage } from './features/reminder/ReminderShopPage';
import { useReminderAlarm } from './features/reminder/useReminderAlarm';
import { unlockAudio } from './lib/sound';
import { NotesHubPage } from './features/notes/NotesHubPage';
import { FlowPage } from './features/flow/FlowPage';
import { MindMapPage } from './features/mindmap/MindMapPage';
import { IncubatorPage } from './features/interests/IncubatorPage';
import { CalendarPage } from './features/calendar/CalendarPage';
import { CommandPalette } from './features/command-palette/CommandPalette';
import { TaskDetailDialog } from './features/board/TaskDetailDialog';
import { Toaster } from 'sonner';

const QUADRANT_KEYS = ['q1', 'q2', 'q3', 'q4'];
const resolveId = (id: string) => id.replace(/^(mit-|slot-)/, '');

type Tab = 'board' | 'finance' | 'reminder' | 'notes' | 'flow' | 'incubator' | 'mindmap' | 'calendar';

export default function App() {
  const [tab, setTab] = useState<Tab>('board');
  const setQuadrant = trpc.tasks.setQuadrant.useMutation();
  const setSchedule = trpc.tasks.schedule.useMutation();
  const { data: allTasks = [] } = trpc.tasks.today.useQuery();
  const { data: domains = [] } = trpc.domains.list.useQuery();
  const [activeId, setActiveId] = useState<string | null>(null);
  const theme = useUI((s) => s.theme);
  const toggleTheme = useUI((s) => s.toggleTheme);
  useEventStream();
  useReminderAlarm();

  // 首次用户手势解锁 AudioContext，确保「响铃」能真正出声（浏览器自动播放策略）
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // 主题同步到 <html>：浅色移除 .dark，深色加上；同时持久化，刷新不丢。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('dm-theme', theme);
    } catch {
      /* 隐私模式下 localStorage 可能不可写，忽略 */
    }
  }, [theme]);

  // dnd-kit 不会自动注册传感器；不配 sensors 时 useDraggable 的 listeners 是空操作，
  // 导致卡片完全拖不动。PointerSensor 设 5px 激活阈值避免与点击冲突。
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const overId = String(over.id);
    // 跨区域渲染时 draggable id 可能带 `mit-` / `slot-` 前缀，还原真实 taskId
    const taskId = resolveId(String(active.id));
    if (overId !== taskId && QUADRANT_KEYS.includes(overId)) {
      setQuadrant.mutate({
        id: taskId,
        importance: overId === 'q1' || overId === 'q2',
        urgency: overId === 'q1' || overId === 'q3',
      });
    } else if (overId.startsWith('slot-')) {
      // 拖入时间槽 → 按该小时排程（默认 1 小时）
      const hour = Number(overId.slice(5));
      const { scheduledStart, scheduledEnd } = buildScheduleTimes(hour, 0, 60);
      setSchedule.mutate({ id: taskId, scheduledStart, scheduledEnd });
    }
  };

  const onDragCancel = () => setActiveId(null);

  const activeTask = activeId ? allTasks.find((t) => t.id === resolveId(activeId)) : null;
  const activeColor = activeTask ? domains.find((d) => d.key === activeTask.domainKey)?.color : undefined;

  const TabBtn = ({ id, label }: { id: Tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        tab === id ? 'bg-bg-raised text-accent' : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  );

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="flex h-screen flex-col">
        <header className="flex items-center gap-2 border-b border-bg-border px-4 py-3">
          <span className="text-sm font-bold text-accent">DM_life</span>
          <nav className="ml-3 flex items-center gap-1">
            <TabBtn id="board" label="每日看板" />
            <TabBtn id="finance" label="财务" />
            <TabBtn id="reminder" label="提醒" />
            <TabBtn id="notes" label="灵感·记事" />
            <TabBtn id="mindmap" label="脑图" />
            <TabBtn id="calendar" label="日历" />
            <TabBtn id="flow" label="心流" />
            <TabBtn id="incubator" label="孵化器" />
          </nav>
          <span className="ml-auto text-xs text-gray-500">
            {tab === 'board'
              ? 'P0'
              : tab === 'finance'
                ? 'P1 · 财务'
              : tab === 'reminder'
                ? 'P1 · 钟表铺'
              : tab === 'notes'
                  ? 'P1 · 灵感·记事'
              : tab === 'mindmap'
                ? 'P1 · 脑图'
              : tab === 'calendar'
                ? 'P1 · 日历'
              : tab === 'flow'
                ? 'P1 · 心流'
              : 'P1 · 灵感孵化器'}
          </span>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            className="ml-2 flex h-7 w-7 items-center justify-center rounded-md border border-bg-border bg-bg-raised text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </header>
        <main className="flex-1 overflow-hidden">
          {tab === 'board' ? (
            <div className="grid h-full grid-cols-[280px_1fr_280px] gap-4 overflow-hidden p-4">
              <LeftColumn />
              <CenterColumn onOpenFlow={() => setTab('flow')} />
              <RightColumn />
            </div>
          ) : tab === 'finance' ? (
            <FinancePage />
          ) : tab === 'reminder' ? (
            <ReminderShopPage />
          ) : tab === 'notes' ? (
            <NotesHubPage />
          ) : tab === 'mindmap' ? (
            <MindMapPage />
          ) : tab === 'calendar' ? (
            <CalendarPage />
          ) : tab === 'flow' ? (
            <FlowPage />
          ) : tab === 'incubator' ? (
            <IncubatorPage />
          ) : null}
        </main>
      </div>
      <CommandPalette />
      <TaskDetailDialog />
      <Toaster theme={theme} />
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCardOverlay task={activeTask} color={activeColor} accentBorder={activeTask.isMit} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
