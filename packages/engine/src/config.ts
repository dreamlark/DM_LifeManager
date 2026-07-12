import path from 'node:path';
import os from 'node:os';

/**
 * 解析数据目录（数据库文件 dm-life.db 的存放位置）。
 *
 * 关键修复（数据在「更新程序」后丢失）：
 * 旧逻辑默认把 db 放在引擎包内的 `data/`（安装/源码目录内部），一旦程序被更新、
 * 重装或工作区被重建，这个目录会被整体覆盖/删除，导致数据全部丢失。
 * 新逻辑默认放在**操作系统用户数据目录**（Windows %APPDATA%、macOS ~/Library/Application Support、
 * Linux XDG_DATA_HOME），该目录与安装目录隔离，程序更新不会触及，数据可长期保留。
 *
 * 优先级：DM_LIFE_DATA_DIR 环境变量 > 测试临时目录(VITEST) > 用户数据目录。
 */
function resolveDataDir(): string {
  if (process.env.DM_LIFE_DATA_DIR) return process.env.DM_LIFE_DATA_DIR;

  // 测试环境：用系统临时目录，避免污染真实用户数据、且每个运行互相隔离
  if (process.env.VITEST || process.env.NODE_ENV === 'test') {
    return path.join(os.tmpdir(), 'dm-life-test-data');
  }

  // 生产/开发默认：操作系统用户数据目录（与安装目录隔离，更新程序不被清空）
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'dm-life',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dm-life');
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'dm-life');
}

/** 集中配置 + fail-fast（环境变量可覆盖） */
export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 14570),
  /** 数据目录：默认放在操作系统用户数据目录（与安装目录隔离，更新程序不丢失） */
  dataDir: resolveDataDir(),
};

if (!Number.isFinite(config.port) || config.port <= 0) {
  throw new Error(`非法 PORT: ${process.env.PORT}`);
}
