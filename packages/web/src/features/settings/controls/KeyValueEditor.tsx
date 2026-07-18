import { useState } from 'react';
import { SettingValue } from '../types';

interface Props {
  items: Record<string, SettingValue>;
  onChange: (key: string, value: SettingValue | null) => void;
}

export function KeyValueEditor({ items, onChange }: Props) {
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');
  const entries = Object.entries(items);

  const parse = (s: string): SettingValue => {
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (s !== '' && !Number.isNaN(Number(s))) return Number(s);
    return s;
  };

  return (
    <div className="space-y-2">
      {entries.length === 0 && (
        <p className="text-xs text-gray-500">暂无自定义变量，可在下方添加。</p>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2 rounded-lg bg-bg-raised px-2.5 py-1.5">
          <span className="w-24 shrink-0 truncate text-xs font-medium text-fg">{k}</span>
          {typeof v === 'boolean' ? (
            <input
              type="checkbox"
              checked={v}
              onChange={(e) => onChange(k, e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
          ) : (
            <input
              type="text"
              defaultValue={String(v)}
              onBlur={(e) => onChange(k, parse(e.target.value))}
              className="min-w-0 flex-1 rounded-md border border-bg-border bg-bg-panel px-2 py-1 text-xs text-fg outline-none focus:border-accent"
            />
          )}
          <button
            type="button"
            onClick={() => onChange(k, null)}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:text-red-400"
          >
            删除
          </button>
        </div>
      ))}

      <div className="flex items-center gap-2 pt-1">
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="变量名"
          className="w-24 shrink-0 rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
        />
        <input
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          placeholder="值"
          className="min-w-0 flex-1 rounded-md border border-bg-border bg-bg-raised px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
        />
        <button
          type="button"
          disabled={!newKey.trim()}
          onClick={() => {
            if (!newKey.trim()) return;
            onChange(newKey.trim(), parse(newVal));
            setNewKey('');
            setNewVal('');
          }}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-opacity disabled:opacity-40"
        >
          添加
        </button>
      </div>
    </div>
  );
}
