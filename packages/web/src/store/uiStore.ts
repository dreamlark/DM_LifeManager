import { create } from 'zustand';

export type Theme = 'dark' | 'light';

function getInitialTheme(): Theme {
  // 默认深色（与改造前一致）；localStorage 里显式选过浅色才切浅
  if (typeof localStorage !== 'undefined' && localStorage.getItem('dm-theme') === 'light') {
    return 'light';
  }
  return 'dark';
}

interface UIState {
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  /** 看板按领域筛选的当前选中领域；null 表示不过滤 */
  activeDomain: string | null;
  setActiveDomain: (key: string | null) => void;
  /** 点击同一切换取消，便于领域清单项复用 */
  toggleDomain: (key: string) => void;
  /** 浅色/深色主题，持久化到 localStorage，由 App 同步到 <html> 的 dark 类 */
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  /** 任务详情弹窗：当前打开的任务 id；null 表示关闭 */
  detailTaskId: string | null;
  openTaskDetail: (id: string) => void;
  closeTaskDetail: () => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  activeDomain: null,
  setActiveDomain: (activeDomain) => set({ activeDomain }),
  toggleDomain: (key) => set((s) => ({ activeDomain: s.activeDomain === key ? null : key })),
  theme: getInitialTheme(),
  setTheme: (theme) => set({ theme }),
  toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
  detailTaskId: null,
  openTaskDetail: (detailTaskId) => set({ detailTaskId }),
  closeTaskDetail: () => set({ detailTaskId: null }),
}));
