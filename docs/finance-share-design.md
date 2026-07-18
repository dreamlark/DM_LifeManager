# 个人财务 → 家庭共享页面 功能设计方案

> 目标：把**个人模式（单机版 engine）**里的财务数据，按用户自选 + 权限范围，展示到**协作模式（server 家庭库）**的家庭共享看板，并实时同步、保持一致。

---

## 1. 需求 → 实现点映射

| # | 用户需求 | 实现策略 |
|---|----------|----------|
| ① | 勾选/拖拽筛选要共享的财务项 | `FinanceShareConfig` 配置面板：左池（个人财务项分组）+ 右清单（已选），支持**复选框勾选**与 **dnd-kit 拖拽**两种方式加入；每项可设共享范围 |
| ② | 家庭页实时同步 + 数据一致 | 配置保存时把当前数值**快照**推到 server；个人端订阅 engine SSE，财务变更后**防抖重推**快照；server 落库后 `publishEvent` → WS 广播 → 家庭成员 `onBoardEvent` 即时刷新。共享端永远展示 owner 最近一次推送的快照，保证一致 |
| ③ | 逐项权限控制（共享范围） | 每项带 `scope`：`all`（全家人，需 `viewFinance`）/ `specific`（指定成员 allowlist，如"仅配偶"=选配偶）。server `listByFamily` 按 viewer 过滤 |
| ④ | 图表/列表 + 按时间/类别筛选 | `FamilyFinanceBoard`：手写 SVG 图表（收入vs支出柱状、类别环形、净资产卡片）+ 列表；顶部按**月份区间**（时间）与**类别**（收入/支出/资产/债务/投资/总览）筛选 |

---

## 2. 架构与数据流

两套存储隔离是核心矛盾，本方案用 **"个人端快照 + 协作端引用"** 桥接：

```
[个人模式 · engine :14570]                 [协作模式 · server :4100]
  trpcLocal.finance.*  (内存)                families / memberships / shared_finance_items (PGLite)
        │                                            ▲
        │ ① 用户勾选/拖拽配置                          │ ③ 家庭成员读取(按权限过滤)
        ▼                                            │
  FinanceShareConfig                                 │
        │ ② 推送 {itemType,itemKey,snapshot,scope}    │
        ├────────── trpc.sharedFinance.upsert ───────┤
        │                                            │
        │  engine SSE 财务变更                         │ publishEvent('sharedFinance.updated')
        │  ──防抖重推快照──▶ upsert                     │
        │                                            │ WS Hub 广播
        │                                     onBoardEvent ▶ FamilyFinanceBoard 刷新
```

- **个人端无需家庭概念**：local 模式渲染 `FinancePage`，但 `trpc`（协作客户端）+ authStore 令牌仍在，可跨模式调用 server。
- **家庭端不回源 engine**：只存快照，避免 server 反向依赖 engine（进程/鉴权都不通）。

---

## 3. 数据模型（server 新增表）

### 3.1 `packages/server/src/db/schema.ts`
```ts
export const sharedFinanceItems = pgTable(
  'shared_finance_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull().references(() => families.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    itemType: varchar('item_type', { length: 24 }).notNull(), // summary|income|expense|asset|debt|investment|budget
    itemKey: varchar('item_key', { length: 128 }).notNull(),  // 实体 id 或 '*'（聚合）
    label: varchar('label', { length: 128 }).notNull(),
    scope: varchar('scope', { length: 16 }).notNull().default('all'), // all | specific
    allowedUserIds: jsonb('allowed_user_ids').$type<string[]>().notNull().default([]),
    snapshot: jsonb('snapshot').notNull(),   // 数值快照：保证家庭端一致
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    famIdx: index('sfi_family_idx').on(t.familyId),
    ownerIdx: index('sfi_owner_idx').on(t.familyId, t.ownerUserId),
  }),
);
```

### 3.2 `packages/server/src/db/ensure.ts`（DDL 数组末尾追加）
```sql
CREATE TABLE IF NOT EXISTS shared_finance_items (
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
);
CREATE INDEX IF NOT EXISTS sfi_family_idx ON shared_finance_items(family_id);
CREATE INDEX IF NOT EXISTS sfi_owner_idx ON shared_finance_items(family_id, owner_user_id);
```
> 开发/测试走 `ensureSchema` 自动建表；生产环境另补一条 `migrations/` 脚本。

### 3.3 snapshot（JSONB）形态示例
```json
{
  "value": 12345.6,
  "currency": "CNY",
  "period": "2026-07",
  "breakdown": [{ "label": "工资", "value": 8000 }, { "label": "投资收益", "value": 2000 }],
  "updatedAt": "2026-07-13T12:00:00.000Z"
}
```
- 聚合类（summary/预算）：`breakdown` 带分项。
- 单笔类（某收入源/某资产/某债务）：`value` 为该笔金额，`breakdown` 可空。

---

## 4. 服务端（packages/server）

### 4.1 `store.ts` 新增 CRUD
- `upsertSharedFinance(input)`：`ON CONFLICT (family_id, owner_user_id, item_type, item_key)` 更新，否则插入；返回行。
- `listSharedFinanceByFamily(familyId)`：取该 family 全量（权限过滤在 router 层按 viewer 做）。
- `removeSharedFinance(id)`。

### 4.2 `router.ts` 新增 `sharedFinance` router
```ts
sharedFinance: {
  // 读取：仅返回 viewer 可见项（scope=all 或 viewer 在 allowedUserIds）
  listByFamily: authedProcedure
    .input(z.object({ familyId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requirePermission(ctx, input.familyId, 'viewFinance');
      const all = await store.listSharedFinanceByFamily(input.familyId);
      return all.filter(it => it.scope === 'all' || it.allowedUserIds.includes(ctx.userId));
    }),

  upsert: authedProcedure
    .input(z.object({
      familyId: z.string(),
      itemType: z.enum(['summary','income','expense','asset','debt','investment','budget']),
      itemKey: z.string(),
      label: z.string(),
      scope: z.enum(['all','specific']).default('all'),
      allowedUserIds: z.array(z.string()).default([]),
      snapshot: z.any(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePermission(ctx, input.familyId, 'manageFinance');
      const row = await store.upsertSharedFinance({ ...input, ownerUserId: ctx.userId });
      publishEvent({ kind: 'sharedFinance.updated', familyId: input.familyId, actorId: ctx.userId });
      return row;
    }),

  remove: authedProcedure
    .input(z.object({ familyId: z.string(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requirePermission(ctx, input.familyId, 'manageFinance');
      await store.removeSharedFinance(input.id);
      publishEvent({ kind: 'sharedFinance.updated', familyId: input.familyId, actorId: ctx.userId });
    }),
}
```

### 4.3 `realtime/eventBus.ts` 增加事件类型
```ts
| { kind: 'sharedFinance.updated'; familyId: string; actorId: string }
```
（前端 `realtime.ts` 的 `handleMessage` 已通用派发 `event` 类型，`onBoardEvent` 直接可用，仅需补一类 notify 文案可选。）

### 4.4 RBAC
复用现有 `viewFinance` / `manageFinance`（见 `rbac.ts`）。`child`/`guest` 无 `viewFinance` → 在家庭端看不到任何财务（复用 `FamilyBoard` 的 `child-notice` 模式）。

---

## 5. 前端（packages/web-collab）

### 5.1 配置面板 `FinanceShareConfig.tsx`（个人模式 · 挂在 `FinancePage` 头部按钮）
- **入口**：`FinancePage` 头部新增「共享到家庭」按钮 → 打开 Modal。
- **左池（个人财务项，经 `trpcLocal` 拉取）**：
  - 总览 `summary`（1 张卡）
  - 收入源 `trpcLocal.finance.incomes.list`
  - 资产 `trpcLocal.finance.assets.list`（含投资子类）
  - 债务 `trpcLocal.finance.debts.list`
  - 支出类别：由 `trpcLocal.finance.transactions.list`（kind=expense）按 `category` 聚合
  - 投资：资产中 `assetClass='investment'` 子集
  - 预算：派生自 `summary` 的月度收入/支出口径（**待确认**）
- **右清单（已选共享项）**：每项显示 label + 范围选择器（全家人 / 指定成员）+ 当"指定成员"时渲染家庭成员多选（`trpc.families.members`，需已登录协作）。
- **交互**：复选框勾选 **或** dnd-kit 拖拽（左池项 `useDraggable` → 右清单 `useDroppable` + 可重排）加入清单。
- **保存**：对每项用当前本地数据算 `snapshot` → `trpc.sharedFinance.upsert`。
- **实时重推**：订阅 engine SSE（复用 `useEventStreamLocal` 思路，监听 `finance.*` 事件）→ 防抖 800ms → 重新计算已选项的 snapshot 并 `upsert`（仅当 owner 已登录协作且有所属家庭）。

> 若用户未登录协作（`familyStore.currentFamilyId` 为空）：面板提示「请先在协作模式创建/加入家庭后再共享」。

### 5.2 家庭财务看板 `FamilyFinanceBoard.tsx`（协作模式 · `App.tsx` 新增 tab `finance`）
- **读取**：`trpc.sharedFinance.listByFamily`（server 已按权限+范围过滤）。
- **权限门**：`!can(myRole,'viewFinance')` → 显示「财务金额对你隐藏」提示，不渲染任何数字。
- **可视化（零依赖手写 SVG）**：
  - 净资产 / 总资产 / 总负债 概览卡片
  - 收入 vs 支出 柱状图（按 owner 或聚合）
  - 支出类别 环形图（donut）
  - 共享项列表/表格（按 owner 分组，含 label / 数值 / 范围徽标 / 更新时间）
- **筛选**：顶部「时间」月份区间选择 + 「类别」下拉（收入/支出/资产/债务/投资/总览）。
- **实时**：`onBoardEvent(e => e.kind==='sharedFinance.updated' && e.familyId===currentFamilyId)` → `utils.sharedFinance.listByFamily.invalidate()`。

### 5.3 `App.tsx` 改动
```ts
type BoardTab = 'members' | 'tasks' | 'calendar' | 'finance';
// 顶部分段控件增加「财务」按钮 → 渲染 <FamilyFinanceBoard />
```

### 5.4 图表实现
手写三种 SVG 组件（零新增依赖，规避 C 盘 ENOSPC）：
- `BarChart`（收入/支出对比，圆角柱 + accent 渐变）
- `DonutChart`（支出类别占比，hover 高亮扇区）
- `Sparkline`（趋势，可选）
统一使用现有 CSS 变量（`--accent` 等）保持深浅色主题一致。

---

## 6. 实时同步机制（满足需求②）

1. owner 在个人模式编辑财务 → engine 经 SSE 推送 `finance.*` 事件。
2. `FinanceShareConfig` 的 SSE 监听触发 → 防抖 800ms → 重新计算所拥有共享项的 snapshot → `trpc.sharedFinance.upsert`（逐项）。
3. server 落库新快照 → `publishEvent({kind:'sharedFinance.updated', familyId})`。
4. WS Hub 向该 family 在线连接广播 → 家庭成员 `onBoardEvent` → `listByFamily` 失效刷新 → 看板实时更新。

> 若 owner 离线，家庭端展示其**最近一次推送**的快照（可接受的最终一致）。

---

## 7. 权限范围模型（关键决策 · 待确认）

当前 `memberships.role` 仅有 owner/admin/member/child/guest，**无"配偶"语义字段**。两方案：
- **A（推荐）**：用 `scope='specific'` + `allowedUserIds` 成员多选，"仅配偶可见"=在家庭成员里勾选配偶。零 schema 改动，立即可用。
- **B**：给 `memberships` 加 `relationship` 字段（spouse/child/...），UI 预设"仅配偶"。更语义化，但需改 schema + 成员关系管理 UI，工作量更大。

---

## 8. 实施步骤（顺序）

1. **server**：`schema.ts` 加表 → `ensure.ts` 加 DDL → `store.ts` CRUD → `router.ts` `sharedFinance` → `eventBus.ts` 事件类型。
2. **shared**：`AppRouter` 类型自动含 `sharedFinance`（router 合并即生效）。
3. **web-collab `FinanceShareConfig`**：dnd-kit 双模式选择 + 范围 + SSE 实时重推。
4. **web-collab `FamilyFinanceBoard`**：SVG 图表 + 列表 + 时间/类别筛选 + RBAC + `onBoardEvent`。
5. **装配**：`App.tsx` 加 `finance` tab；`FinancePage` 头部加「共享到家庭」按钮。
6. **验证**：本地 `node_modules/.bin/tsc --noEmit` + `vite build` + e2e 冒烟（alice 共享 → bob 实时可见、范围过滤生效）。

---

## 9. 已知局限 / 待确认

- **预算实体缺失**：引擎财务模块无独立"预算"，需确认派生（方案 A）还是暂不共享（方案 B）。见下方提问。
- **配偶概念缺失**：见 §7，默认走 `specific` allowlist。
- **快照终一致**：owner 离线期间家庭端展示最后推送值（设计内可接受）。
- **依赖**：不新增 npm 包；图表手写 SVG，拖拽用已有 `@dnd-kit`。

---

## 10. 验收标准

- [ ] 个人端可勾选/拖拽选择要共享的财务项，并设"全家人/指定成员"范围。
- [ ] 保存后，协作模式家庭成员的「财务」tab 实时出现对应数据（SSE→重推→WS→刷新）。
- [ ] 范围=指定成员时，非允许成员在家庭端看不到该项；无 `viewFinance` 角色看不到任何财务。
- [ ] 家庭端以图表+列表呈现，支持按月份（时间）与类别筛选。
- [ ] `tsc --noEmit` 与 `vite build` 通过；e2e 冒烟覆盖共享/过滤/实时。
