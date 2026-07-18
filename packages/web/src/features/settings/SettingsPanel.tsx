import { X } from 'lucide-react';
import { useSettings } from '../../store/settingsStore';
import { Toggle } from './controls/Toggle';
import { SelectField } from './controls/SelectField';
import { NumberField } from './controls/NumberField';
import { ColorField } from './controls/ColorField';
import { KeyValueEditor } from './controls/KeyValueEditor';

const DOMAIN_OPTIONS = [
  { value: 'health', label: '健康' },
  { value: 'family', label: '家庭' },
  { value: 'work', label: '工作' },
  { value: 'wealth', label: '财富' },
  { value: 'social', label: '社交' },
  { value: 'growth', label: '成长' },
  { value: 'leisure', label: '休闲' },
  { value: 'spirit', label: '心灵' },
  { value: 'quarter', label: '季度聚焦' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-bg-border px-4 py-3 last:border-b-0">
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <div className="divide-y divide-bg-border">{children}</div>
    </section>
  );
}

export function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useSettings();
  if (!open) return null;

  const openCollab = () => {
    if (s.collabAppUrl) window.open(s.collabAppUrl, '_blank');
  };

  return (
    <div className="fixed inset-0 z-[100]" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <aside
        className="absolute right-0 top-0 flex h-full w-[380px] flex-col border-l border-bg-border bg-bg-panel shadow-card"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-bg-border px-4 py-3">
          <h2 className="text-base font-semibold text-fg">设置</h2>
          <button
            onClick={onClose}
            title="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-bg-raised hover:text-fg"
          >
            <X size={18} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <Section title="外观">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-fg">主题</span>
              <div className="flex rounded-lg bg-bg-raised p-1">
                <button
                  onClick={() => s.set({ theme: 'dark' })}
                  className={`rounded-md px-3 py-1 text-sm transition-all ${
                    s.theme === 'dark' ? 'bg-bg-panel font-medium text-fg shadow-sm' : 'text-gray-400'
                  }`}
                >
                  深色
                </button>
                <button
                  onClick={() => s.set({ theme: 'light' })}
                  className={`rounded-md px-3 py-1 text-sm transition-all ${
                    s.theme === 'light' ? 'bg-bg-panel font-medium text-fg shadow-sm' : 'text-gray-400'
                  }`}
                >
                  浅色
                </button>
              </div>
            </div>
            <ColorField label="强调色" value={s.accentColor} onChange={(v) => s.set({ accentColor: v })} />
            <SelectField
              label="显示密度"
              value={s.density}
              options={[
                { value: 'comfortable', label: '宽松' },
                { value: 'compact', label: '紧凑' },
              ]}
              onChange={(v) => s.set({ density: v as 'comfortable' | 'compact' })}
            />
          </Section>

          <Section title="时间与日历">
            <SelectField
              label="周起始"
              value={s.weekStart}
              options={[
                { value: 0, label: '周日' },
                { value: 1, label: '周一' },
              ]}
              onChange={(v) => s.set({ weekStart: v as 0 | 1 })}
            />
            <NumberField
              label="每日起点"
              value={s.dayStartHour}
              min={5}
              max={12}
              suffix="时"
              onChange={(v) => s.set({ dayStartHour: v })}
            />
          </Section>

          <Section title="领域默认">
            <SelectField
              label="新建任务默认领域"
              value={s.defaultDomain ?? ''}
              options={[{ value: '', label: '（不指定）' }, ...DOMAIN_OPTIONS]}
              onChange={(v) => s.set({ defaultDomain: v === '' ? null : String(v) })}
            />
          </Section>

          <Section title="通知">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-fg">响铃总开关</span>
              <Toggle checked={s.soundEnabled} onChange={(v) => s.set({ soundEnabled: v })} />
            </div>
            <NumberField
              label="提前提醒"
              value={s.reminderAdvanceMin}
              min={0}
              max={60}
              suffix="分"
              onChange={(v) => s.set({ reminderAdvanceMin: v })}
            />
          </Section>

          <Section title="协作启动器">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-fg">联机版地址</span>
              <input
                value={s.collabAppUrl}
                onChange={(e) => s.set({ collabAppUrl: e.target.value })}
                className="w-44 rounded-lg border border-bg-border bg-bg-raised px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-fg">单机版地址</span>
              <input
                value={s.collabLocalUrl}
                onChange={(e) => s.set({ collabLocalUrl: e.target.value })}
                className="w-44 rounded-lg border border-bg-border bg-bg-raised px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
              />
            </div>
            <div className="py-2.5">
              <button
                onClick={openCollab}
                className="w-full rounded-lg bg-accent py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                打开联机版
              </button>
              <p className="mt-2 text-xs text-gray-500">
                启动联机版需在终端运行：<br />
                <code className="text-gray-400">npm run dev -w packages/server</code>
                <br />
                <code className="text-gray-400">npm run dev -w packages/web-collab</code>
              </p>
            </div>
          </Section>

          <Section title="自定义变量">
            <KeyValueEditor items={s.custom} onChange={(k, v) => s.updateCustom(k, v)} />
          </Section>

          <Section title="关于">
            <div className="py-2.5 text-sm text-fg">
              DM_life · 人生管理系统
              <span className="ml-2 text-xs text-gray-500">v1.0.0</span>
            </div>
          </Section>
        </div>

        <footer className="border-t border-bg-border px-4 py-3">
          <button
            onClick={() => s.resetDefaults()}
            className="w-full rounded-lg border border-bg-border bg-bg-raised py-2 text-sm text-gray-300 transition-colors hover:text-fg"
          >
            恢复默认
          </button>
        </footer>
      </aside>
    </div>
  );
}
