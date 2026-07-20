// M2.1 tRPC router —— auth + families 全套，含 RBAC 保护（store 已切换为 Drizzle 异步仓库）
import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { store } from './store';
import {
  hashPassword,
  verifyPassword,
  issueSession,
  rotateRefresh,
  verifyAccess,
  getEngineToken,
  revokeSession,
  revokeAllSessions,
} from './auth';
import { requirePermission, requireMembership, type AuthContext } from './rbac';
import { publishEvent } from './realtime/eventBus';
import type { Role, PublicUser, SharedItemModule } from './types';

const t = initTRPC.context<AuthContext>().create();
export const router = t.router;
const publicProcedure = t.procedure;

const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先登录' });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});
const authedProcedure = publicProcedure.use(isAuthed);

const emailSchema = z.string().email('邮箱格式不正确');
const passwordSchema = z.string().min(6, '密码至少 6 位');
const roleSchema = z.enum(['owner', 'admin', 'member', 'child', 'guest'] as const);

function toPublic(u: { id: string; email: string; name: string }): PublicUser {
  return { id: u.id, email: u.email, name: u.name };
}

export const appRouter = router({
  auth: router({
    register: publicProcedure
      .input(z.object({ email: emailSchema, name: z.string().min(1, '请填写昵称'), password: passwordSchema, rememberMe: z.boolean().optional().default(true) }))
      .mutation(async ({ input }) => {
        if (await store.getUserByEmail(input.email)) {
          throw new TRPCError({ code: 'CONFLICT', message: '该邮箱已注册' });
        }
        const passwordHash = await hashPassword(input.password);
        const user = await store.createUser({ email: input.email, name: input.name, passwordHash });
        // 注册即创建个人家庭，保证首次进入即有看板归属（与前端「注册即创建你自己的家庭」一致）
        const family = await store.createFamily({ name: `${input.name}的家庭`, ownerId: user.id });
        await store.addMembership({ familyId: family.id, userId: user.id, role: 'owner' });
        const tokens = await issueSession(user.id, input.rememberMe);
        return { user: toPublic(user), ...tokens };
      }),

    login: publicProcedure
      .input(z.object({ email: emailSchema, password: z.string().min(1), rememberMe: z.boolean().optional().default(true) }))
      .mutation(async ({ input }) => {
        const user = await store.getUserByEmail(input.email);
        if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '邮箱或密码错误' });
        }
        const tokens = await issueSession(user.id, input.rememberMe);
        return { user: toPublic(user), ...tokens };
      }),

    refresh: publicProcedure
      .input(z.object({ refreshToken: z.string().min(1) }))
      .mutation(async ({ input }) => {
        try {
          return await rotateRefresh(input.refreshToken);
        } catch {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '刷新令牌无效或已过期' });
        }
      }),

    me: authedProcedure.query(async ({ ctx }) => {
      const user = await store.getUserById(ctx.userId);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND', message: '用户不存在' });
      return toPublic(user);
    }),

    /** 返回引擎共享令牌（P0-2）。浏览器登录后获取，访问 engine（/engine/*）时携带。
     *  未配置 ENGINE_API_TOKEN 时返回 null（engine 不要求令牌）。仅对已登录用户可见，
     *  避免匿名者拿到令牌后直连 engine。 */
    engineToken: authedProcedure.query(async () => {
      return { engineToken: getEngineToken() };
    }),

    /** 会话吊销（P1-4）：吊销当前 refresh 会话（传 refreshToken）或该用户全部会话（不传）。
     *  用于“退出登录 / 登出所有设备”，避免令牌在本地清除后仍可被复用。 */
    logout: authedProcedure
      .input(z.object({ refreshToken: z.string().min(1).optional() }))
      .mutation(async ({ ctx, input }) => {
        if (input.refreshToken) await revokeSession(input.refreshToken);
        else await revokeAllSessions(ctx.userId);
        return { ok: true };
      }),

    /** 登出所有设备：吊销该用户的全部 refresh 会话 */
    logoutAll: authedProcedure.mutation(async ({ ctx }) => {
      await revokeAllSessions(ctx.userId);
      return { ok: true };
    }),
  }),

  families: router({
    create: authedProcedure
      .input(z.object({ name: z.string().min(1, '请填写家庭名称') }))
      .mutation(async ({ ctx, input }) => {
        const family = await store.createFamily({ name: input.name, ownerId: ctx.userId });
        await store.addMembership({ familyId: family.id, userId: ctx.userId, role: 'owner' });
        publishEvent({ kind: 'family.created', familyId: family.id, actorId: ctx.userId });
        return family;
      }),

    invite: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          role: roleSchema.refine((r) => r !== 'owner', '邀请角色不能为 owner'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageMembers');
        const token = randomUUID();
        const inv = await store.createInvitation({
          familyId: input.familyId,
          token,
          role: input.role,
          createdBy: ctx.userId,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(), // 7 天
        });
        publishEvent({ kind: 'invitation.created', familyId: input.familyId, role: input.role, actorId: ctx.userId });
        return { token: inv.token, role: inv.role, expiresAt: inv.expiresAt };
      }),

    acceptInvite: authedProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const inv = await store.getInvitation(input.token);
        if (!inv) throw new TRPCError({ code: 'NOT_FOUND', message: '邀请无效' });
        if (new Date(inv.expiresAt).getTime() < Date.now()) {
          await store.deleteInvitation(input.token);
          throw new TRPCError({ code: 'BAD_REQUEST', message: '邀请已过期' });
        }
        if (await store.getMembership(inv.familyId, ctx.userId)) {
          throw new TRPCError({ code: 'CONFLICT', message: '你已是该家庭成员' });
        }
        const m = await store.addMembership({ familyId: inv.familyId, userId: ctx.userId, role: inv.role });
        await store.deleteInvitation(input.token);
        publishEvent({ kind: 'member.joined', familyId: inv.familyId, userId: ctx.userId, role: m.role, actorId: ctx.userId });
        return { familyId: inv.familyId, role: m.role };
      }),

    members: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await requireMembership(ctx, input.familyId); // 任何成员均可查看家庭成员
        const ms = await store.getMembershipsByFamily(input.familyId);
        return Promise.all(
          ms.map(async (m) => {
            const u = await store.getUserById(m.userId);
            return { userId: m.userId, name: u?.name ?? '', email: u?.email ?? '', role: m.role, joinedAt: m.joinedAt };
          }),
        );
      }),

    leave: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const m = await requireMembership(ctx, input.familyId);
        if (m.role === 'owner') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '家庭所有者不能直接离开，请先转让或解散' });
        }
        await store.removeMembership(m.id);
        publishEvent({ kind: 'member.left', familyId: input.familyId, userId: ctx.userId, actorId: ctx.userId });
        return { ok: true };
      }),

    /** 列出当前用户所属的全部家庭（含角色），供前端「家庭切换」使用 */
    list: authedProcedure.query(async ({ ctx }) => {
      const ms = await store.getMembershipsByUser(ctx.userId);
      const families = await Promise.all(
        ms.map(async (m) => {
          const f = await store.getFamily(m.familyId);
          return f ? { id: f.id, name: f.name, ownerId: f.ownerId, role: m.role } : null;
        }),
      );
      return families.filter((f): f is { id: string; name: string; ownerId: string; role: Role } => f !== null);
    }),

    removeMember: authedProcedure
      .input(z.object({ familyId: z.string().min(1), userId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageMembers');
        const target = await store.getMembership(input.familyId, input.userId);
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '该成员不存在' });
        if (target.role === 'owner') throw new TRPCError({ code: 'BAD_REQUEST', message: '所有者不可被移除' });
        if (target.userId === ctx.userId) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '不能移除自己，请使用「退出家庭」' });
        }
        await store.removeMembership(target.id);
        publishEvent({ kind: 'member.removed', familyId: input.familyId, userId: input.userId, actorId: ctx.userId });
        return { ok: true };
      }),

    updateRole: authedProcedure
      .input(z.object({ familyId: z.string().min(1), userId: z.string().min(1), role: roleSchema }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageMembers');
        if (input.role === 'owner' || input.role === 'guest') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '不能手动设为 owner 或 guest（owner 用转让，guest 仅限邀请）' });
        }
        const target = await store.getMembership(input.familyId, input.userId);
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '该成员不存在' });
        if (target.role === 'owner') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: '所有者角色不可改，请使用转让' });
        }
        const m = await store.updateMembershipRole(target.id, input.role);
        publishEvent({ kind: 'role.updated', familyId: input.familyId, userId: input.userId, role: m.role, actorId: ctx.userId });
        return { role: m.role };
      }),

    transferOwnership: authedProcedure
      .input(z.object({ familyId: z.string().min(1), userId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageFamily');
        const target = await store.getMembership(input.familyId, input.userId);
        if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: '目标成员不存在' });
        if (target.role === 'owner') throw new TRPCError({ code: 'BAD_REQUEST', message: '该成员已是所有者' });
        const me = await store.getMembership(input.familyId, ctx.userId);
        if (!me) throw new TRPCError({ code: 'NOT_FOUND', message: '你不是该家庭成员' });
        // 目标升为 owner，自己降为 admin —— 保证家庭始终有且仅有一个 owner
        await store.updateMembershipRole(target.id, 'owner');
        await store.updateMembershipRole(me.id, 'admin');
        publishEvent({ kind: 'ownership.transferred', familyId: input.familyId, from: ctx.userId, to: input.userId, actorId: ctx.userId });
        return { ok: true };
      }),
  }),

  // ===== 共享日历（家庭共享日程） =====
  calendarEvents: router({
    list: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await requireMembership(ctx, input.familyId);
        return store.listCalendarEvents(input.familyId);
      }),

    create: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          title: z.string().min(1, '请填写事件标题'),
          description: z.string().optional(),
          location: z.string().optional(),
          startAt: z.string().min(1, '请选择开始时间'),
          endAt: z.string().optional(),
          allDay: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'createEvent');
        const ev = await store.createCalendarEvent({
          familyId: input.familyId,
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          startAt: input.startAt,
          endAt: input.endAt ?? null,
          allDay: input.allDay ?? false,
          createdBy: ctx.userId,
        });
        publishEvent({ kind: 'calendar.created', familyId: input.familyId, eventId: ev.id, actorId: ctx.userId });
        return ev;
      }),

    update: authedProcedure
      .input(
        z.object({
          eventId: z.string().min(1),
          title: z.string().min(1).optional(),
          description: z.string().nullable().optional(),
          location: z.string().nullable().optional(),
          startAt: z.string().min(1).optional(),
          endAt: z.string().nullable().optional(),
          allDay: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const ev = await store.getCalendarEvent(input.eventId);
        if (!ev) throw new TRPCError({ code: 'NOT_FOUND', message: '日历事件不存在' });
        // 创建人可编辑自己的事件；改他人事件需 editEvent
        if (ev.createdBy !== ctx.userId) {
          await requirePermission(ctx, ev.familyId, 'editEvent');
        }
        const patch: Parameters<typeof store.updateCalendarEvent>[1] = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.location !== undefined) patch.location = input.location;
        if (input.startAt !== undefined) patch.startAt = input.startAt;
        if (input.endAt !== undefined) patch.endAt = input.endAt;
        if (input.allDay !== undefined) patch.allDay = input.allDay;
        const updated = await store.updateCalendarEvent(ev.id, patch);
        publishEvent({ kind: 'calendar.updated', familyId: ev.familyId, eventId: ev.id, actorId: ctx.userId });
        return updated;
      }),

    remove: authedProcedure
      .input(z.object({ eventId: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const ev = await store.getCalendarEvent(input.eventId);
        if (!ev) throw new TRPCError({ code: 'NOT_FOUND', message: '日历事件不存在' });
        await requireMembership(ctx, ev.familyId);
        // 删除他人事件仅 owner/admin；创建人可删自己的
        const me = await store.getMembership(ev.familyId, ctx.userId);
        const isOwnerOrAdmin = me && (me.role === 'owner' || me.role === 'admin');
        if (ev.createdBy !== ctx.userId && !isOwnerOrAdmin) {
          throw new TRPCError({ code: 'FORBIDDEN', message: '无权删除他人创建的日历事件' });
        }
        await store.deleteCalendarEvent(ev.id);
        publishEvent({ kind: 'calendar.deleted', familyId: ev.familyId, eventId: ev.id, actorId: ctx.userId });
        return { ok: true };
      }),
  }),

  // ===== 个人财务共享快照（家庭共享账本桥接） =====
  // 设计见 finance-share-design.md。server 仅存 owner 推送的快照，读取时按 viewer 过滤。
  sharedFinance: router({
    /** 读取：仅返回 viewer 可见项（scope=all 或 viewer 在 allowedUserIds） */
    listByFamily: authedProcedure
      .input(z.object({ familyId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'viewFinance');
        const all = await store.listSharedFinanceByFamily(input.familyId);
        return all.filter((it) => it.scope === 'all' || it.allowedUserIds.includes(ctx.userId));
      }),

    /** 推送/更新一项共享财务快照（owner 本人操作） */
    upsert: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          itemType: z.enum(['summary', 'income', 'expense', 'asset', 'debt', 'investment', 'budget']),
          itemKey: z.string().min(1),
          label: z.string().min(1),
          scope: z.enum(['all', 'specific']).default('all'),
          allowedUserIds: z.array(z.string()).default([]),
          snapshot: z.any(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageFinance');
        const row = await store.upsertSharedFinance({
          familyId: input.familyId,
          ownerUserId: ctx.userId,
          itemType: input.itemType,
          itemKey: input.itemKey,
          label: input.label,
          scope: input.scope,
          allowedUserIds: input.allowedUserIds,
          snapshot: input.snapshot,
        });
        publishEvent({ kind: 'sharedFinance.updated', familyId: input.familyId, actorId: ctx.userId, module: 'finance' });
        return row;
      }),

    /** 移除一项共享财务（N1：按 familyId 过滤防跨家庭 IDOR） */
    remove: authedProcedure
      .input(z.object({ familyId: z.string().min(1), id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageFinance');
        await store.removeSharedFinance(input.id, input.familyId);
        publishEvent({ kind: 'sharedFinance.updated', familyId: input.familyId, actorId: ctx.userId, module: 'finance' });
        return { ok: true };
      }),
  }),

  // ===== 通用个人模块共享快照（提醒/记事/脑图/心流/领域… 复用一套桥接） =====
  // server 仅存 owner 推送的快照，读取时按 viewer 过滤。module 判别各业务模块。
  sharedItems: router({
    /** 读取：仅返回 viewer 可见项（scope=all 或 viewer 在 allowedUserIds），可选按 module 过滤 */
    listByFamily: authedProcedure
      .input(z.object({ familyId: z.string().min(1), module: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'viewShared');
        const all = await store.listSharedItems(input.familyId, input.module);
        // 推送人始终可见自己共享的项；scope=all 或 viewer 在被授权列表中则对其他成员可见
        return all.filter(
          (it) => it.ownerUserId === ctx.userId || it.scope === 'all' || it.allowedUserIds.includes(ctx.userId),
        );
      }),

    /** 推送/更新一项共享快照（owner 本人操作，按 module+itemType+itemKey 唯一键 upsert） */
    upsert: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          module: z.string().min(1),
          itemType: z.string().min(1),
          itemKey: z.string().min(1),
          label: z.string().min(1),
          scope: z.enum(['all', 'specific']).default('all'),
          allowedUserIds: z.array(z.string()).default([]),
          snapshot: z.any(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        const row = await store.upsertSharedItem({
          familyId: input.familyId,
          ownerUserId: ctx.userId,
          module: input.module as SharedItemModule,
          itemType: input.itemType,
          itemKey: input.itemKey,
          label: input.label,
          scope: input.scope,
          allowedUserIds: input.allowedUserIds,
          snapshot: input.snapshot,
        });
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId, module: input.module });
        return row;
      }),

    /** 协作操作：标记完成 / 添加备注（仅更新 done/note，不动快照）。
     *  N1：要求 manageShared 权限（owner/admin/member），阻断 guest/child 越权写入；
     *  同时按 familyId 过滤目标项，杜绝跨家庭 IDOR。 */
    update: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          id: z.string().min(1),
          done: z.boolean().optional(),
          note: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        const patch: { done?: boolean; note?: string | null } = {};
        if (input.done !== undefined) patch.done = input.done;
        if (input.note !== undefined) patch.note = input.note;
        await store.updateSharedItem(input.id, input.familyId, patch);
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId });
        return { ok: true };
      }),

    /** 批量同步 owner 的个人模块共享快照：单次事务 + 单次广播，杜绝 N 次 upsert/remove 的广播风暴 */
    sync: authedProcedure
      .input(
        z.object({
          familyId: z.string().min(1),
          upserts: z
            .array(
              z.object({
                module: z.string().min(1),
                itemType: z.string().min(1),
                itemKey: z.string().min(1),
                label: z.string().min(1),
                scope: z.enum(['all', 'specific']).default('all'),
                allowedUserIds: z.array(z.string()).default([]),
                snapshot: z.any(),
              }),
            )
            .default([]),
          removes: z.array(z.string().min(1)).default([]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        await store.syncSharedItems(
          input.familyId,
          ctx.userId,
          input.upserts.map((u) => ({
            module: u.module as SharedItemModule,
            itemType: u.itemType,
            itemKey: u.itemKey,
            label: u.label,
            scope: u.scope,
            allowedUserIds: u.allowedUserIds,
            snapshot: u.snapshot,
          })),
          input.removes,
        );
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId });
        return { ok: true };
      }),

    /** 移除一项共享（要求 manageShared 权限，含他人共享的协作项；N1 同时按 familyId 过滤防跨家庭 IDOR） */
    remove: authedProcedure
      .input(z.object({ familyId: z.string().min(1), id: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        await requirePermission(ctx, input.familyId, 'manageShared');
        await store.removeSharedItem(input.id, input.familyId);
        publishEvent({ kind: 'sharedItems.updated', familyId: input.familyId, actorId: ctx.userId });
        return { ok: true };
      }),
  }),
});

// 供真实 HTTP 层解析 Authorization: Bearer <accessToken> 使用
export function ctxFromAuthorization(header: string | undefined): AuthContext {
  if (!header) return { userId: null };
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    return { userId: verifyAccess(token) };
  } catch {
    return { userId: null };
  }
}

export type AppRouter = typeof appRouter;
