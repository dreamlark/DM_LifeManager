// M2.1 —— 开发/测试期幂等建表（与 drizzle-kit 生成的迁移脚本等价）
// 生产环境请用 migrations/ 下的标准 Postgres 迁移（drizzle-kit migrate 或 psql -f）。
import { sql } from 'drizzle-orm';

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    owner_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    joined_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (family_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    role text NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    expires_at timestamptz NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text,
    location text,
    start_at timestamptz NOT NULL,
    end_at timestamptz,
    all_day boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES users(id),
    version timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS memberships_family_idx ON memberships(family_id)`,
  `CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id)`,
  `CREATE INDEX IF NOT EXISTS invitations_family_idx ON invitations(family_id)`,
  `CREATE INDEX IF NOT EXISTS sessions_refresh_idx ON sessions(refresh_token)`,
  `CREATE INDEX IF NOT EXISTS calendar_events_family_idx ON calendar_events(family_id)`,
  `CREATE INDEX IF NOT EXISTS calendar_events_start_idx ON calendar_events(family_id, start_at)`,
  `CREATE TABLE IF NOT EXISTS shared_finance_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type text NOT NULL,
    item_key text NOT NULL,
    label text NOT NULL,
    scope text NOT NULL DEFAULT 'all',
    allowed_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sfi_family_idx ON shared_finance_items(family_id)`,
  `CREATE INDEX IF NOT EXISTS sfi_owner_idx ON shared_finance_items(family_id, owner_user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sfi_owner_item_uniq ON shared_finance_items(family_id, owner_user_id, item_type, item_key)`,
  `CREATE TABLE IF NOT EXISTS shared_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module text NOT NULL,
    item_type text NOT NULL,
    item_key text NOT NULL,
    label text NOT NULL,
    scope text NOT NULL DEFAULT 'all',
    allowed_user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    snapshot jsonb NOT NULL,
    done boolean NOT NULL DEFAULT false,
    note text,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS si_family_idx ON shared_items(family_id)`,
  `CREATE INDEX IF NOT EXISTS si_owner_idx ON shared_items(family_id, owner_user_id)`,
  `CREATE INDEX IF NOT EXISTS si_module_idx ON shared_items(family_id, module)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS si_owner_item_uniq ON shared_items(family_id, owner_user_id, module, item_type, item_key)`,
];

/**
 * 增量列迁移（升级兼容）：已存在的库若是在 `done`/`note` 列加入 schema 之前创建的，
 * `CREATE TABLE IF NOT EXISTS` 会跳过整张表，导致 `shared_items` 缺列，
 * 共享保存报 `column "done" of relation "shared_items" does not exist`。
 * 用幂等的 `ADD COLUMN IF NOT EXISTS` 补齐（PGLite/真 Postgres 通用），每次启动安全重放。
 */
const COLUMN_MIGRATIONS = [
  `ALTER TABLE shared_items ADD COLUMN IF NOT EXISTS done boolean NOT NULL DEFAULT false`,
  `ALTER TABLE shared_items ADD COLUMN IF NOT EXISTS note text`,
];

/** 在已连接的 PG 兼容数据库上幂等创建全部表与索引（pglite / 真 Postgres 通用） */
export async function ensureSchema(db: any): Promise<void> {
  for (const stmt of DDL) {
    await db.execute(sql.raw(stmt));
  }
  for (const stmt of COLUMN_MIGRATIONS) {
    await db.execute(sql.raw(stmt));
  }
}
