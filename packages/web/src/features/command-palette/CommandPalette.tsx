import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../lib/trpc';
import { useUI } from '../../store/uiStore';
import { cn } from '../../lib/cn';
import type { TaskPriority } from '@dm-life/shared';

const PRIORITY_OPTIONS: { value: TaskPriority; label: string; active: string }[] = [
  { value: 'high', label: '高', active: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
  { value: 'medium', label: '中', active: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { value: 'low', label: '低', active: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
];

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function autoGrow(el: HTMLTextAreaElement | null, max = 120) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPaletteOpen);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [domainKey, setDomainKey] = useState('work');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [date, setDate] = useState<string>(todayStr());
  const { data: domains = [] } = trpc.domains.list.useQuery();
  const utils = trpc.useUtils();
  const create = trpc.tasks.create.useMutation({
    onSuccess: () => {
      // 写入成功后立即刷新看板与日历聚合，无需等 SSE 兜底
      utils.tasks.all.invalidate();
      utils.tasks.today.invalidate();
    },
  });
  const titleRef = useRef<HTMLInputElement | null>(null);
  const descRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // 打开时自动聚焦名称输入；关闭时清空表单
  useEffect(() => {
    if (open) {
      setTimeout(() => titleRef.current?.focus(), 0);
    } else {
      setTitle('');
      setDescription('');
      if (descRef.current) descRef.current.style.height = 'auto';
    }
  }, [open]);

  const submit = () => {
    const t = title.trim();
    if (!t || create.isPending) return;
    create.mutate({
      title: t,
      description: description.trim(),
      domainKey,
      priority,
      // 选中的日期当日 09:00 落进日历；无日期的任务日历不展示
      scheduledStart: `${date}T09:00:00`,
    });
    setTitle('');
    setDescription('');
    if (descRef.current) descRef.current.style.height = 'auto';
    setOpen(false);
  };

  const busy = create.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/3 w-[520px] max-w-[92vw] -translate-x-1/2 rounded-xl border border-bg-border bg-bg-raised p-4 shadow-2xl">
          <Dialog.Title className="sr-only">添加任务</Dialog.Title>
          <Dialog.Description className="sr-only">填写任务名称、描述并回车创建</Dialog.Description>

          <h3 className="mb-3 text-sm font-semibold text-gray-200">添加任务</h3>

          {/* 任务名称 */}
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="任务名称（按回车创建）"
            className="w-full rounded-lg bg-bg-base px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none ring-accent/40 placeholder:text-gray-500 focus:ring-2"
          />

          {/* 任务描述 */}
          <textarea
            ref={descRef}
            rows={2}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="任务描述（可选，Shift+Enter 换行）"
            className="mt-2 w-full resize-none rounded-lg bg-bg-base px-3 py-2 text-sm leading-relaxed text-gray-100 outline-none ring-accent/40 placeholder:text-gray-500 focus:ring-2"
          />

          {/* 优先级 + 日期 */}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-gray-400">优先级</span>
              <div className="flex gap-1">
                {PRIORITY_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    disabled={busy}
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs transition-colors',
                      priority === p.value
                        ? p.active
                        : 'border-bg-border bg-bg-base text-gray-400 hover:text-gray-200',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="shrink-0 text-xs text-gray-400">日期</span>
              <input
                type="date"
                value={date}
                disabled={busy}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-lg bg-bg-base px-2 py-1.5 text-xs text-gray-100 outline-none ring-accent/40 focus:ring-2"
              />
            </div>
          </div>

          {/* 领域 + 提交 */}
          <div className="mt-3 flex items-center gap-2">
            <span className="shrink-0 text-xs text-gray-400">领域</span>
            <select
              value={domainKey}
              onChange={(e) => setDomainKey(e.target.value)}
              className="flex-1 rounded-lg bg-bg-base px-2 py-1.5 text-sm text-gray-100 outline-none ring-accent/40 focus:ring-2"
            >
              {domains.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={submit}
              disabled={!title.trim() || busy}
              className={cn(
                'shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                !title.trim() || busy
                  ? 'cursor-not-allowed bg-bg-soft text-gray-500'
                  : 'bg-accent text-bg-base hover:bg-accent/90',
              )}
            >
              {busy ? '创建中…' : '确定'}
            </button>
          </div>

          <div className="mt-3 text-xs text-gray-500">按回车创建，Shift+Enter 在描述中换行</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
