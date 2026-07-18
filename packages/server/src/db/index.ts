// M2.1 —— 数据库工厂
// 运行时双方言：
//  - 生产：DATABASE_URL 以 postgres:// 开头 → postgres-js 连接真实 Postgres（表由 migrations/ 迁移建立）
//  - 开发/测试：默认使用 PGLite（WASM 编译的真实 Postgres 引擎，无需外部服务）→ 内存实例 + ensureSchema 建表
import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { ensureSchema } from './ensure';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pg: any = null;

/** 初始化并返回单例数据库实例；首次调用时按环境建立连接并建表 */
export async function initDb(): Promise<any> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('postgres://')) {
    const client = postgres(url, { max: 10 });
    _db = drizzlePg(client, { schema });
    // 生产环境表结构由 migrations/ 管理，不在此处 ensure，避免与迁移版本冲突
  } else {
    // 开发/测试：默认内存实例；设置 PGLITE_DIR 可走文件型（重启持久化，便于 Web 演示）
    const dir = process.env.PGLITE_DIR;
    _pg = dir ? new PGlite(dir) : new PGlite();
    _db = drizzle(_pg, { schema });
    await ensureSchema(_db);
  }
  return _db;
}

/** 获取已初始化的数据库实例（未初始化时抛错，提醒先 await initDb()） */
export function getDb(): any {
  if (!_db) throw new Error('数据库未初始化，请先 await initDb()');
  return _db;
}

/** 关闭连接（测试/进程退出时调用） */
export async function closeDb(): Promise<void> {
  if (_pg) {
    await _pg.close();
    _pg = null;
  }
  _db = null;
}
