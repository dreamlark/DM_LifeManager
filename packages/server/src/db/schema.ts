// M2.1 —— 家庭协作系统 Postgres schema（drizzle-orm/pg-core）
// 全部表以 family_id 作为数据隔离锚点；外键级联保证成员/邀请/会话随家庭或用户清理。
import { pgTable, uuid, text, timestamp, boolean, index, unique, jsonb } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
});

export const families = pgTable('families', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // owner | admin | member | child | guest
    joinedAt: timestamp('joined_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    familyUserUniq: unique('memberships_family_user_uniq').on(t.familyId, t.userId),
    familyIdx: index('memberships_family_idx').on(t.familyId),
    userIdx: index('memberships_user_idx').on(t.userId),
  }),
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    role: text('role').notNull(),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (t) => ({
    familyIdx: index('invitations_family_idx').on(t.familyId),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    refreshToken: text('refresh_token').notNull().unique(),
    expiresAt: timestamp('expires_at', { mode: 'string', withTimezone: true }).notNull(),
  },
  (t) => ({
    refreshIdx: index('sessions_refresh_idx').on(t.refreshToken),
  }),
);

// ===== 共享日历（家庭共享日程） =====
// 设计见 family-collab-design.md §3.2 / §5.3：以 family_id 隔离，所有成员可见；
// createEvent 覆盖 owner/admin/member/child，editEvent 覆盖 owner/admin/member（删除仅创建人或 owner/admin）。
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    startAt: timestamp('start_at', { mode: 'string', withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { mode: 'string', withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    createdBy: uuid('created_by').notNull().references(() => users.id),
    version: timestamp('version', { mode: 'string', withTimezone: true }).defaultNow().notNull(), // 并发版本戳
    createdAt: timestamp('created_at', { mode: 'string', withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    familyIdx: index('calendar_events_family_idx').on(t.familyId),
    startIdx: index('calendar_events_start_idx').on(t.familyId, t.startAt),
  }),
);

// ===== 个人财务共享快照（单机版 engine → 家庭协作库桥接） =====
// 设计见 finance-share-design.md §3。server 仅存 owner 推送的数值快照，不回源 engine。
// 个人端编辑财务后，经引擎 SSE 防抖重推 snapshot；家庭成员读取时按 scope/allowedUserIds 过滤。
export const sharedFinanceItems = pgTable(
  'shared_finance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(), // summary|income|expense|asset|debt|investment|budget
    itemKey: text('item_key').notNull(), // 实体 id 或 '*'（聚合）
    label: text('label').notNull(),
    scope: text('scope').notNull().default('all'), // all | specific
    allowedUserIds: jsonb('allowed_user_ids').$type<string[]>().notNull().default([]),
    snapshot: jsonb('snapshot').notNull(), // 数值快照：保证家庭端一致
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyIdx: index('sfi_family_idx').on(t.familyId),
    ownerIdx: index('sfi_owner_idx').on(t.familyId, t.ownerUserId),
    // upsert 唯一键（与 store.upsertSharedFinance 的 ON CONFLICT 对应）
    ownerItemUniq: unique('sfi_owner_item_uniq').on(t.familyId, t.ownerUserId, t.itemType, t.itemKey),
  }),
);

// ===== 通用个人模块共享快照（提醒/记事/脑图/心流/领域… 复用一套桥接） =====
// 与 shared_finance_items 平行：server 仅存 owner 推送的快照，读取时按 scope/allowedUserIds 过滤。
// 用 module 判别列区分业务模块，唯一键含 module，避免不同模块的相同 itemType+itemKey 冲突。
export const sharedItems = pgTable(
  'shared_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(), // reminder | notes | mindmap | flow | domains | ...
    itemType: text('item_type').notNull(), // 模块内子类型（如 reminder 的 clock）
    itemKey: text('item_key').notNull(), // 实体 id 或 '*'（聚合）
    label: text('label').notNull(),
    scope: text('scope').notNull().default('all'), // all | specific
    allowedUserIds: jsonb('allowed_user_ids').$type<string[]>().notNull().default([]),
    snapshot: jsonb('snapshot').notNull(), // 数值/结构化快照
    done: boolean('done').notNull().default(false), // 协作完成状态：任意家庭成员均可标记
    note: text('note'), // 协作备注（可为空）
    updatedAt: timestamp('updated_at', { mode: 'string', withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    familyIdx: index('si_family_idx').on(t.familyId),
    ownerIdx: index('si_owner_idx').on(t.familyId, t.ownerUserId),
    moduleIdx: index('si_module_idx').on(t.familyId, t.module),
    // upsert 唯一键（与 store.upsertSharedItem 的 ON CONFLICT 对应），含 module 判别列
    ownerItemUniq: unique('si_owner_item_uniq').on(t.familyId, t.ownerUserId, t.module, t.itemType, t.itemKey),
  }),
);
