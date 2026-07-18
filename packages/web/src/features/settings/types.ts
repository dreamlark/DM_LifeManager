export type SettingValue = string | number | boolean;

export interface AppSettings {
  // —— 外观 ——
  theme: 'dark' | 'light';
  accentColor: string; // 强调色，默认苹果蓝
  density: 'comfortable' | 'compact'; // 显示密度

  // —— 时间与日历 ——
  weekStart: 0 | 1; // 0=周日, 1=周一
  dayStartHour: number; // 每日起点小时 5..12

  // —— 领域 ——
  defaultDomain: string | null; // 新建任务默认领域 key

  // —— 通知 / 提醒 ——
  soundEnabled: boolean; // 响铃总开关
  reminderAdvanceMin: number; // 提前提醒分钟 0..60

  // —— 协作启动器 ——
  collabAppUrl: string; // 联机版地址
  collabLocalUrl: string; // 单机版地址

  // —— 数据 ——
  autoBackup: boolean; // 本地自动备份（预留）

  // —— 自定义常用变量（用户自由增删）——
  custom: Record<string, SettingValue>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accentColor: '#0a84ff',
  density: 'comfortable',
  weekStart: 1,
  dayStartHour: 6,
  defaultDomain: null,
  soundEnabled: true,
  reminderAdvanceMin: 5,
  collabAppUrl: 'http://localhost:5174',
  collabLocalUrl: 'http://localhost:5173',
  autoBackup: false,
  custom: {},
};
