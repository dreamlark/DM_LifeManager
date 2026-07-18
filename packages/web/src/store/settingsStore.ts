import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { AppSettings, DEFAULT_SETTINGS, SettingValue } from '../features/settings/types';

interface SettingsState extends AppSettings {
  /** 局部更新若干设置项，即时生效并持久化 */
  set: (patch: Partial<AppSettings>) => void;
  /** 恢复全部默认（清空自定义变量） */
  resetDefaults: () => void;
  /** 自定义变量增/改/删（value 为 null 表示删除该 key） */
  updateCustom: (key: string, value: SettingValue | null) => void;
  /** 深色/浅色切换 */
  toggleTheme: () => void;
}

const DATA_KEYS: (keyof AppSettings)[] = [
  'theme',
  'accentColor',
  'density',
  'weekStart',
  'dayStartHour',
  'defaultDomain',
  'soundEnabled',
  'reminderAdvanceMin',
  'collabAppUrl',
  'collabLocalUrl',
  'autoBackup',
  'custom',
];

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (patch) => set(patch),
      resetDefaults: () => set({ ...DEFAULT_SETTINGS, custom: {} }),
      updateCustom: (key, value) =>
        set((s) => {
          const custom = { ...s.custom };
          if (value === null) delete custom[key];
          else custom[key] = value;
          return { custom };
        }),
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    }),
    {
      name: 'dm-settings',
      // 仅持久化数据字段，函数不写入 localStorage
      partialize: (s) => {
        const out: Record<string, unknown> = {};
        for (const k of DATA_KEYS) out[k] = s[k];
        return out as AppSettings;
      },
    },
  ),
);
