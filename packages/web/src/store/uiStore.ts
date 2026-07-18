import { create } from 'zustand';

interface UIState {
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  /** 看板按领域筛选的当前选中领域；null 表示不过滤 */
  activeDomain: string | null;
  setActiveDomain: (key: string | null) => void;
  /** 点击同一切换取消，便于领域清单项复用 */
  toggleDomain: (key: string) => void;
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
  detailTaskId: null,
  openTaskDetail: (detailTaskId) => set({ detailTaskId }),
  closeTaskDetail: () => set({ detailTaskId: null }),
}));
