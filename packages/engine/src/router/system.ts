import { router, publicProcedure } from './trpc';
import { z } from 'zod';
import { exportAll, importAll, dataStatus, setCustomDataDir, exportBundleSchema } from '../system/exportImport';

/**
 * 系统级数据管理：导出 / 导入 / 状态 / 自定义数据目录。
 * 仅作用于单机版（个人模式）业务数据；协作版多租户家庭数据不在范围（避免越权导出他人数据）。
 */
export const systemRouter = router({
  /** 导出全部业务数据为标准化 JSON bundle */
  exportAll: publicProcedure.query(() => exportAll()),

  /** 从导出文件恢复数据（导入前先校验格式/版本/完整性，并自动备份当前库） */
  importAll: publicProcedure
    .input(z.object({ bundle: exportBundleSchema }))
    .mutation(({ input }) => importAll(input.bundle)),

  /** 数据状态：目录 / 文件大小 / schema 版本 / 各表行数 */
  dataStatus: publicProcedure.query(() => dataStatus()),

  /** 设置自定义数据目录（写入覆盖配置文件，重启后生效，旧数据自动迁移） */
  setCustomDataDir: publicProcedure
    .input(z.object({ dir: z.string().min(1) }))
    .mutation(({ input }) => setCustomDataDir(input.dir)),
});
