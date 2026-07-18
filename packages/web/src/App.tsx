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
import { Sun, Moon, LayoutGrid, Wallet, Bell, NotebookPen, Network, Calendar, Brain, PieChart, FlaskConical, Settings } from 'lucide-react';
import { trpc } from './lib/trpc';
import { useEventStream } from './lib/sse';
import { useUI } from './store/uiStore';
import { useSettings } from './store/settingsStore';
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
import { DomainBalancePage } from './features/domains/DomainBalancePage';
import { CommandPalette } from './features/command-palette/CommandPalette';
import { TaskDetailDialog } from './features/board/TaskDetailDialog';
import { SettingsButton } from './features/settings/SettingsButton';
import { SettingsPanel } from './features/settings/SettingsPanel';
import { Toaster } from 'sonner';

const QUADRANT_KEYS = ['q1', 'q2', 'q3', 'q4'];
const resolveId = (id: string) => id.replace(/^(mit-|slot-)/, '');

type Tab = 'board' | 'finance' | 'reminder' | 'notes' | 'flow' | 'incubator' | 'mindmap' | 'calendar' | 'domains';

const NAV: { id: Tab; label: string; icon: typeof LayoutGrid; sub: string }[] = [
  { id: 'board', label: '每日看板', icon: LayoutGrid, sub: 'P0' },
  { id: 'finance', label: '财务', icon: Wallet, sub: 'P1' },
  { id: 'reminder', label: '钟表铺', icon: Bell, sub: 'P1' },
  { id: 'notes', label: '灵感·记事', icon: NotebookPen, sub: 'P1' },
  { id: 'mindmap', label: '脑图', icon: Network, sub: 'P1' },
  { id: 'calendar', label: '日历', icon: Calendar, sub: 'P1' },
  { id: 'flow', label: '心流', icon: Brain, sub: 'P1' },
  { id: 'domains', label: '平衡轮', icon: PieChart, sub: 'P1' },
  { id: 'incubator', label: '孵化器', icon: FlaskConical, sub: 'P1' },
];

/** 将 hex 颜色转成 "r g b"，供 Tailwind 的 rgb(var(--accent) / <alpha>) 使用 */
function hexToRgbChannels(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return '10 132 255';
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `${r} ${g} ${b}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('board');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setQuadrant = trpc.tasks.setQuadrant.useMutation();
  const setSchedule = trpc.tasks.schedule.useMutation();
  const { data: allTasks = [] } = trpc.tasks.today.useQuery();
  const { data: domains = [] } = trpc.domains.list.useQuery();
  const [activeId, setActiveId] = useState<string | null>(null);
  const theme = useSettings((s) => s.theme);
  const accentColor = useSettings((s) => s.accentColor);
  const toggleTheme = useSettings((s) => s.toggleTheme);
  useEventStream();
  useReminderAlarm();

  // 首次用户手势解锁 AudioContext，确保「响铃」能真正出声（浏览器自动播放策略）
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  // 主题 + 强调色 同步到 <html>：深色加 dark 类；accent 写回 CSS 变量，即时生效。
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.setProperty('--accent', hexToRgbChannels(accentColor));
  }, [theme, accentColor]);

  // ⌘/Ctrl + , 打开设置（macOS 惯例）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      <div className="app-shell">
        {/* ===== 顶部标签栏（苹果风毛玻璃 header） ===== */}
        <header className="app-header">
          <div className="flex items-center gap-2">
            <div className="app-logo">D</div>
            <span className="text-sm font-bold text-accent">DM_life</span>
          </div>

          <nav className="app-tabs">
            {NAV.map(({ id, label, icon: Icon, sub }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`app-tab ${tab === id ? 'active' : ''}`}
                title={label}
              >
                <Icon size={15} />
                <span>{label}</span>
                <span className="app-tab-sub">{sub}</span>
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <SettingsButton onClick={() => setSettingsOpen(true)} />
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-bg-border bg-bg-raised text-gray-300 transition-colors hover:border-accent/50 hover:text-accent"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>

        {/* ===== 内容区 ===== */}
        <main className="app-content">
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
          ) : tab === 'domains' ? (
            <DomainBalancePage />
          ) : tab === 'incubator' ? (
            <IncubatorPage />
          ) : null}
        </main>
      </div>
      <CommandPalette />
      <TaskDetailDialog />
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster theme={theme} />
      <DragOverlay dropAnimation={null}>
        {activeTask ? <TaskCardOverlay task={activeTask} color={activeColor} accentBorder={activeTask.isMit} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
