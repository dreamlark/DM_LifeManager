// M2.1 —— Drizzle 驱动的 repository（替代 M1 内存 Map）
// 方法签名与返回类型与 M1 完全一致，auth/rbac/router 仅需适配 async 调用，无需改业务语义。
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from './db';
import { users, families, memberships, invitations, sessions, calendarEvents, sharedFinanceItems, sharedItems } from './db/schema';
import type { User, Family, Membership, Invitation, Session, Role, CalendarEvent, SharedFinanceItem, SharedFinanceItemType, SharedFinanceScope, SharedItem, SharedItemModule, SharedItemScope } from './types';

function iso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  if (typeof d === 'string') return d;
  return String(d);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toUser(r: any): User {
  return { id: r.id, email: r.email, name: r.name, passwordHash: r.passwordHash, createdAt: iso(r.createdAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toFamily(r: any): Family {
  return { id: r.id, name: r.name, ownerId: r.ownerId, createdAt: iso(r.createdAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toMembership(r: any): Membership {
  return { id: r.id, familyId: r.familyId, userId: r.userId, role: r.role as Role, joinedAt: iso(r.joinedAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toInvitation(r: any): Invitation {
  return { id: r.id, familyId: r.familyId, token: r.token, role: r.role as Role, createdBy: r.createdBy, expiresAt: iso(r.expiresAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSession(r: any): Session {
  return { id: r.id, userId: r.userId, refreshToken: r.refreshToken, expiresAt: iso(r.expiresAt) };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCalendarEvent(r: any): CalendarEvent {
  return {
    id: r.id,
    familyId: r.familyId,
    title: r.title,
    description: r.description ?? null,
    location: r.location ?? null,
    startAt: r.startAt ? iso(r.startAt) : new Date().toISOString(),
    endAt: r.endAt ? iso(r.endAt) : null,
    allDay: Boolean(r.allDay),
    createdBy: r.createdBy,
    version: iso(r.version),
    createdAt: iso(r.createdAt),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSharedFinanceItem(r: any): SharedFinanceItem {
  return {
    id: r.id,
    familyId: r.familyId,
    ownerUserId: r.ownerUserId,
    itemType: r.itemType as SharedFinanceItemType,
    itemKey: r.itemKey,
    label: r.label,
    scope: (r.scope ?? 'all') as SharedFinanceScope,
    allowedUserIds: Array.isArray(r.allowedUserIds) ? (r.allowedUserIds as string[]) : [],
    snapshot: r.snapshot,
    updatedAt: iso(r.updatedAt),
  };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSharedItem(r: any): SharedItem {
  return {
    id: r.id,
    familyId: r.familyId,
    ownerUserId: r.ownerUserId,
    module: r.module as SharedItemModule,
    itemType: r.itemType,
    itemKey: r.itemKey,
    label: r.label,
    scope: (r.scope ?? 'all') as SharedItemScope,
    allowedUserIds: Array.isArray(r.allowedUserIds) ? (r.allowedUserIds as string[]) : [],
    snapshot: r.snapshot,
    done: Boolean(r.done),
    note: r.note ?? null,
    updatedAt: iso(r.updatedAt),
  };
}

export const store = {
  async createUser(input: { email: string; name: string; passwordHash: string }): Promise<User> {
    const db = getDb();
    const [r] = await db
      .insert(users)
      .values({ email: input.email.toLowerCase(), name: input.name, passwordHash: input.passwordHash })
      .returning();
    return toUser(r);
  },
  async getUserById(id: string): Promise<User | undefined> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ? toUser(rows[0]) : undefined;
  },
  async getUserByEmail(email: string): Promise<User | undefined> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return rows[0] ? toUser(rows[0]) : undefined;
  },

  async createFamily(input: { name: string; ownerId: string }): Promise<Family> {
    const db = getDb();
    const [r] = await db.insert(families).values({ name: input.name, ownerId: input.ownerId }).returning();
    return toFamily(r);
  },
  async getFamily(id: string): Promise<Family | undefined> {
    const db = getDb();
    const rows = await db.select().from(families).where(eq(families.id, id)).limit(1);
    return rows[0] ? toFamily(rows[0]) : undefined;
  },

  async addMembership(input: { familyId: string; userId: string; role: Role }): Promise<Membership> {
    const db = getDb();
    const [r] = await db.insert(memberships).values(input).returning();
    return toMembership(r);
  },
  async getMembership(familyId: string, userId: string): Promise<Membership | undefined> {
    const db = getDb();
    const rows = await db.select().from(memberships).where(and(eq(memberships.familyId, familyId), eq(memberships.userId, userId))).limit(1);
    return rows[0] ? toMembership(rows[0]) : undefined;
  },
  async getMembershipsByFamily(familyId: string): Promise<Membership[]> {
    const db = getDb();
    const rows = await db.select().from(memberships).where(eq(memberships.familyId, familyId));
    return rows.map(toMembership);
  },
  async getMembershipsByUser(userId: string): Promise<Membership[]> {
    const db = getDb();
    const rows = await db.select().from(memberships).where(eq(memberships.userId, userId));
    return rows.map(toMembership);
  },
  async removeMembership(id: string): Promise<void> {
    const db = getDb();
    await db.delete(memberships).where(eq(memberships.id, id));
  },
  async updateMembershipRole(id: string, role: Role): Promise<Membership> {
    const db = getDb();
    const [r] = await db
      .update(memberships)
      .set({ role })
      .where(eq(memberships.id, id))
      .returning();
    return toMembership(r);
  },

  async createInvitation(input: { familyId: string; token: string; role: Role; createdBy: string; expiresAt: string }): Promise<Invitation> {
    const db = getDb();
    const [r] = await db.insert(invitations).values(input).returning();
    return toInvitation(r);
  },
  async getInvitation(token: string): Promise<Invitation | undefined> {
    const db = getDb();
    const rows = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
    return rows[0] ? toInvitation(rows[0]) : undefined;
  },
  async deleteInvitation(token: string): Promise<void> {
    const db = getDb();
    await db.delete(invitations).where(eq(invitations.token, token));
  },

  async createSession(input: { userId: string; refreshToken: string; expiresAt: string }): Promise<Session> {
    const db = getDb();
    const [r] = await db.insert(sessions).values(input).returning();
    return toSession(r);
  },
  async getSession(refreshToken: string): Promise<Session | undefined> {
    const db = getDb();
    const rows = await db.select().from(sessions).where(eq(sessions.refreshToken, refreshToken)).limit(1);
    return rows[0] ? toSession(rows[0]) : undefined;
  },
  async deleteSession(refreshToken: string): Promise<void> {
    const db = getDb();
    await db.delete(sessions).where(eq(sessions.refreshToken, refreshToken));
  },
  /** 吊销某用户的全部 refresh 会话（登出所有设备） */
  async deleteSessionsByUser(userId: string): Promise<void> {
    const db = getDb();
    await db.delete(sessions).where(eq(sessions.userId, userId));
  },

  // ===== 共享日历（家庭共享日程） =====
  async createCalendarEvent(input: {
    familyId: string;
    title: string;
    description?: string | null;
    location?: string | null;
    startAt: string;
    endAt?: string | null;
    allDay?: boolean;
    createdBy: string;
  }): Promise<CalendarEvent> {
    const db = getDb();
    const [r] = await db
      .insert(calendarEvents)
      .values({
        familyId: input.familyId,
        title: input.title,
        description: input.description ?? null,
        location: input.location ?? null,
        startAt: input.startAt,
        endAt: input.endAt ?? null,
        allDay: input.allDay ?? false,
        createdBy: input.createdBy,
      })
      .returning();
    return toCalendarEvent(r);
  },
  async getCalendarEvent(id: string): Promise<CalendarEvent | undefined> {
    const db = getDb();
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1);
    return rows[0] ? toCalendarEvent(rows[0]) : undefined;
  },
  /** 列出家庭全部日历事件，按 startAt 升序（月视图/列表共用） */
  async listCalendarEvents(familyId: string): Promise<CalendarEvent[]> {
    const db = getDb();
    const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.familyId, familyId));
    const all: CalendarEvent[] = rows.map(toCalendarEvent);
    return all.sort((a, b) => a.startAt.localeCompare(b.startAt));
  },
  async updateCalendarEvent(
    id: string,
    patch: Partial<{
      title: string;
      description: string | null;
      location: string | null;
      startAt: string;
      endAt: string | null;
      allDay: boolean;
    }>,
  ): Promise<CalendarEvent | undefined> {
    const db = getDb();
    const [r] = await db
      .update(calendarEvents)
      .set({ ...patch, version: new Date().toISOString() })
      .where(eq(calendarEvents.id, id))
      .returning();
    return r ? toCalendarEvent(r) : undefined;
  },
  async deleteCalendarEvent(id: string): Promise<void> {
    const db = getDb();
    await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  },

  // ===== 个人财务共享快照（家庭协作库桥接） =====
  /** upsert：以 (family_id, owner_user_id, item_type, item_key) 唯一键冲突更新，否则插入。 */
  async upsertSharedFinance(input: {
    familyId: string;
    ownerUserId: string;
    itemType: SharedFinanceItemType;
    itemKey: string;
    label: string;
    scope: SharedFinanceScope;
    allowedUserIds: string[];
    snapshot: unknown;
  }): Promise<SharedFinanceItem> {
    const db = getDb();
    // scope=all 时忽略 allowlist，避免越权残留
    const allowedUserIds = input.scope === 'all' ? [] : input.allowedUserIds;
    const [r] = await db
      .insert(sharedFinanceItems)
      .values({
        familyId: input.familyId,
        ownerUserId: input.ownerUserId,
        itemType: input.itemType,
        itemKey: input.itemKey,
        label: input.label,
        scope: input.scope,
        allowedUserIds,
        snapshot: input.snapshot,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [sharedFinanceItems.familyId, sharedFinanceItems.ownerUserId, sharedFinanceItems.itemType, sharedFinanceItems.itemKey],
        set: {
          label: input.label,
          scope: input.scope,
          allowedUserIds,
          snapshot: input.snapshot,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();
    return toSharedFinanceItem(r);
  },

  /** 列出家庭全部共享财务项（权限/范围过滤在 router 层按 viewer 做）。 */
  async listSharedFinanceByFamily(familyId: string): Promise<SharedFinanceItem[]> {
    const db = getDb();
    const rows = await db.select().from(sharedFinanceItems).where(eq(sharedFinanceItems.familyId, familyId));
    return rows.map(toSharedFinanceItem);
  },

  async removeSharedFinance(id: string, familyId?: string): Promise<void> {
    const db = getDb();
    // N1：必须按 familyId 过滤，否则仅凭全局 id 可越权删除其他家庭的共享财务项
    await db
      .delete(sharedFinanceItems)
      .where(familyId ? and(eq(sharedFinanceItems.id, id), eq(sharedFinanceItems.familyId, familyId)) : eq(sharedFinanceItems.id, id));
  },

  // ===== 通用个人模块共享快照（提醒/记事/脑图/心流/领域…） =====
  /** upsert：以 (family_id, owner_user_id, module, item_type, item_key) 唯一键冲突更新，否则插入。 */
  async upsertSharedItem(input: {
    familyId: string;
    ownerUserId: string;
    module: SharedItemModule;
    itemType: string;
    itemKey: string;
    label: string;
    scope: SharedItemScope;
    allowedUserIds: string[];
    snapshot: unknown;
  }): Promise<SharedItem> {
    const db = getDb();
    const allowedUserIds = input.scope === 'all' ? [] : input.allowedUserIds;
    const [r] = await db
      .insert(sharedItems)
      .values({
        familyId: input.familyId,
        ownerUserId: input.ownerUserId,
        module: input.module,
        itemType: input.itemType,
        itemKey: input.itemKey,
        label: input.label,
        scope: input.scope,
        allowedUserIds,
        snapshot: input.snapshot,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: [sharedItems.familyId, sharedItems.ownerUserId, sharedItems.module, sharedItems.itemType, sharedItems.itemKey],
        set: {
          label: input.label,
          scope: input.scope,
          allowedUserIds,
          snapshot: input.snapshot,
          updatedAt: new Date().toISOString(),
        },
      })
      .returning();
    return toSharedItem(r);
  },

  /** 列出家庭共享项；可选按 module 过滤。权限/范围过滤在 router 层按 viewer 做。 */
  async listSharedItems(familyId: string, module?: string): Promise<SharedItem[]> {
    const db = getDb();
    const rows = module
      ? await db.select().from(sharedItems).where(and(eq(sharedItems.familyId, familyId), eq(sharedItems.module, module)))
      : await db.select().from(sharedItems).where(eq(sharedItems.familyId, familyId));
    return rows.map(toSharedItem);
  },

  async removeSharedItem(id: string, familyId?: string): Promise<void> {
    const db = getDb();
    // N1：必须按 familyId 过滤，否则仅凭全局 id 可越权删除其他家庭的共享项
    await db
      .delete(sharedItems)
      .where(familyId ? and(eq(sharedItems.id, id), eq(sharedItems.familyId, familyId)) : eq(sharedItems.id, id));
  },

  /** 协作操作：家庭成员标记完成 / 添加备注（仅更新 done/note；对任务模块额外同步 snapshot.status） */
  async updateSharedItem(id: string, familyId: string | undefined, patch: { done?: boolean; note?: string | null }): Promise<void> {
    const db = getDb();
    const [row] = await db
      .select({ module: sharedItems.module })
      .from(sharedItems)
      .where(familyId ? and(eq(sharedItems.id, id), eq(sharedItems.familyId, familyId)) : eq(sharedItems.id, id));
    if (!row) return; // N1：若 id 不属于该 family（跨家庭 IDOR），视为无操作，拒绝越权写入
    const set: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (patch.done !== undefined) set.done = patch.done;
    if (patch.note !== undefined) set.note = patch.note;
    if (patch.done !== undefined && row.module === 'task') {
      set.snapshot = sql`jsonb_set(COALESCE(${sharedItems.snapshot}, '{}'::jsonb), '{status}', to_jsonb(${patch.done ? 'done' : 'todo'}::text))`;
    }
    await db
      .update(sharedItems)
      .set(set)
      .where(familyId ? and(eq(sharedItems.id, id), eq(sharedItems.familyId, familyId)) : eq(sharedItems.id, id));
  },

  /**
   * 批量同步 owner 的个人模块共享快照：单次事务内 upsert 多项 + 删除未选项，
   * 仅触发一次广播（替代前端 N 次 upsert/remove 导致 N 次广播的连锁放大）。
   */
  async syncSharedItems(
    familyId: string,
    ownerUserId: string,
    upserts: Array<{
      module: SharedItemModule;
      itemType: string;
      itemKey: string;
      label: string;
      scope: SharedItemScope;
      allowedUserIds: string[];
      snapshot: unknown;
    }>,
    removes: string[],
  ): Promise<void> {
    const db = getDb();
    await db.transaction(async (tx: any) => {
      for (const u of upserts) {
        const allowedUserIds = u.scope === 'all' ? [] : u.allowedUserIds;
        await tx
          .insert(sharedItems)
          .values({
            familyId,
            ownerUserId,
            module: u.module,
            itemType: u.itemType,
            itemKey: u.itemKey,
            label: u.label,
            scope: u.scope,
            allowedUserIds,
            snapshot: u.snapshot,
            updatedAt: new Date().toISOString(),
          })
          .onConflictDoUpdate({
            target: [sharedItems.familyId, sharedItems.ownerUserId, sharedItems.module, sharedItems.itemType, sharedItems.itemKey],
            set: {
              label: u.label,
              scope: u.scope,
              allowedUserIds,
              snapshot: u.snapshot,
              updatedAt: new Date().toISOString(),
            },
          });
      }
      for (const id of removes) {
        // 仅删除「本人」共享的项：listByFamily 可能返回其他成员共享给我的项，
        // 若按整张 existing 列表做差集会误删他人共享。owner-only 约束保证安全。
        await tx
          .delete(sharedItems)
          .where(and(eq(sharedItems.id, id), eq(sharedItems.ownerUserId, ownerUserId)));
      }
    });
  },
  async reset(): Promise<void> {
    const db = getDb();
    await db.delete(sharedFinanceItems);
    await db.delete(sharedItems);
    await db.delete(calendarEvents);
    await db.delete(sessions);
    await db.delete(invitations);
    await db.delete(memberships);
    await db.delete(families);
    await db.delete(users);
  },
};
