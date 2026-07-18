# dm-life 扩展设计方案：设置功能 + 联机版启动器

> 状态：设计稿（待评审，未进入开发）
> 日期：2026-07-13
> 决策来源：需求澄清 —— 整合架构 = **双应用 + 启动器**；设置归属 = **仅本地存储（localStorage）**

---

## 0. 需求对齐确认

| 需求项 | 本方案处理方式 |
|---|---|
| 1. 保留单机版所有功能 | `packages/web` 9 大 Tab 源码零改动，新模块以**增量挂载**方式接入 header，不触碰核心逻辑 |
| 2. 新增设置功能 | `web` 内新增 `settingsStore` + `SettingsPanel` 抽屉 + 「⚙ 设置」按钮，支持编辑/管理常用变量 |
| 3. 实现联机版功能 | 保持 `web-collab` + `server` 现状，新增「🤝 协作」启动器入口，从单机版一键进入联机版 |
| 4. 先出方案再开发 | 本文即为完整设计稿，评审通过后再分阶段实施 |

---

## 1. 总体原则

- **P1 — 单机零破坏**：现有 9 个功能 Tab、引擎、tRPC/SSE 闭环完全不动；新增内容全部落入新文件。
- **P2 — 增量挂载**：新 UI（设置按钮、抽屉、协作入口）只挂在 `App.tsx` 的 header 与根节点，不改现有组件树。
- **P3 — 设置本地化、即时生效**：存 `localStorage`，改动即持久化、即响应式生效；可「恢复默认」；支持用户自定义变量。
- **P4 — 双应用物理隔离**：`web` 与 `web-collab` **无代码依赖**，仅通过可配置的 URL 互相跳转；共享点只是 `localStorage` 里的少数地址字段。

---

## 2. 功能模块划分

### 2.1 单机版 `packages/web`（扩展后）

```
packages/web/src
├── App.tsx                      # 仅新增：设置按钮 + 协作按钮 + <SettingsPanel/> 挂载；theme 改读 settings
├── store/
│   ├── uiStore.ts               # 保留；theme 字段迁移走（见 §4.3）
│   └── settingsStore.ts         # 新增：zustand + persist(localStorage)
├── features/
│   ├── board / finance / ...    # 现有 9 Tab 不动
│   ├── settings/                # 新增
│   │   ├── SettingsButton.tsx   # header「⚙ 设置」入口
│   │   ├── SettingsPanel.tsx    # 右侧抽屉，分组渲染控件
│   │   ├── controls/            # Toggle / SelectField / NumberField / ColorField / KeyValueEditor
│   │   └── types.ts             # AppSettings 类型 + DEFAULT_SETTINGS
│   └── launcher/                # 新增（可选 Phase 5）
│       └── Launcher.tsx         # 模式选择卡片页（本地 / 协作）
└── lib/ (trpc, sse 不变)
```

### 2.2 联机版 `packages/web-collab` + `packages/server`（保持）

- 已完成 M2.3：注册 / 家庭 / 邀请 / RBAC / WebSocket 实时。本次**不重构**，仅可选在 topbar 加一个「← 单机版」回链。
- `packages/server` 不动（除非后续要做设置云同步，本次不做）。

### 2.3 共享点（唯一交集）

- `localStorage` 键 `dm-settings` 中的 `collabAppUrl` / `collabLocalUrl` 两个字段，`web` 与 `web-collab` 都可读（用作互相跳转地址）。其余设置各自独立、互不可见。

---

## 3. 单机版功能保留策略

| 对象 | 处理 | 理由 |
|---|---|---|
| `packages/web` 9 Tab 源码 | 不改 | 回归保障，零破坏 |
| `uiStore.ts` | 仅删除 `theme/setTheme/toggleTheme`（迁移到 settings），其余保留 | theme 是唯一与设置重叠的状态 |
| `packages/engine`（sql.js） | 完全不动 | 设置是前端 localStorage 范畴，不落库 |
| `packages/shared` | 不动 | 无跨包影响（已确认 collab 包零 import shared） |
| 回归基线 | engine vitest **41/41**、web `tsc --noEmit` **0 error**、web `vite build` 通过 | 新增代码需维持该基线并附新测试 |

---

## 4. 设置功能设计

### 4.1 数据结构（TypeScript，强类型主结构 + 自定义变量兜底）

```ts
// features/settings/types.ts
export type SettingValue = string | number | boolean;

export interface AppSettings {
  // —— 外观 ——
  theme: 'dark' | 'light';
  accentColor: string;                 // 默认 '#6366f1'
  density: 'comfortable' | 'compact';  // 显示密度

  // —— 时间与日历 ——
  weekStart: 0 | 1;                    // 0=周日, 1=周一
  dayStartHour: number;                // 每日起点小时 5..12（时间块视图用）

  // —— 领域 ——
  defaultDomain: string | null;        // 新建任务默认领域 key

  // —— 通知 / 提醒 ——
  soundEnabled: boolean;               // 响铃总开关
  reminderAdvanceMin: number;          // 提前提醒分钟 0..60

  // —— 协作启动器 ——
  collabAppUrl: string;                // 联机版地址，默认 'http://localhost:5174'
  collabLocalUrl: string;              // 单机版地址，默认 'http://localhost:5173'

  // —— 数据 ——
  autoBackup: boolean;                 // 本地自动备份开关（预留）

  // —— 自定义常用变量（用户自由增删）——
  custom: Record<string, SettingValue>;
}

export const DEFAULT_SETTINGS: AppSettings = { /* 上述默认值 */ };
```

### 4.2 持久化与容错

- 存储键：`dm-settings`（与现有 `dm-theme` 解耦，统一归口）。
- 机制：`zustand` + `persist` 中间件（storage = `localStorage`）。
- 容错：读取/解析失败（损坏、旧版）时回退 `DEFAULT_SETTINGS`，不白屏。
- 向后兼容：旧 `dm-theme` 值可在首次启动时迁移进 `settings.theme` 后清除。

### 4.3 theme 迁移（最小改动，二选一）

- **方案 A（推荐，干净）**：`settingsStore` 持有 `theme` 为单一真相源；`uiStore` 删除 `theme/setTheme/toggleTheme`；`App.tsx` 改读 `useSettings(s => s.theme)` 并保留「同步 `<html>` dark 类 + localStorage」逻辑（落到 settings 的 persist）；现有 Sun/Moon 按钮改调 `settings.toggleTheme`。
  - 改动点：uiStore（-3 字段）、App.tsx（theme 来源切换）、SettingsPanel（theme 控件）。风险低。
- **方案 B（保守）**：`uiStore.theme` 保留，`settings` 新增 mirror 字段并双向同步。
  - 缺点：状态分裂、易不一致。不推荐。

> 推荐 **方案 A**。

### 4.4 交互设计

- **入口**：header 右侧，「主题切换」按钮旁新增「⚙ 设置」按钮（带 `设置` 文字，避免图标不可读，呼应此前退出按钮优化）。
- **面板形态**：右侧滑出 **抽屉（drawer）**，半透明遮罩点击关闭；宽度 ~380px，内部分组可滚动。
- **分组**：
  1. 外观（主题 / 强调色 / 显示密度）
  2. 时间与日历（周起始 / 每日起点）
  3. 领域默认（新建任务默认领域下拉）
  4. 通知（响铃开关 / 提前提醒分钟）
  5. 协作启动器（联机版地址 / 单机版地址 + 「打开联机版」按钮）
  6. 自定义变量（key-value 编辑器，支持增/删/改，类型含 文本/数字/开关）
- **即时生效**：控件 `onChange` → `settingsStore.set(...)` → persist → 订阅组件响应式更新。
  - theme 立即切换；`defaultDomain` 影响命令面板新建任务；`collabAppUrl` 影响启动器跳转。
- **恢复默认**：抽屉底部「恢复默认」按钮（弹确认），清空 `custom` 并回填 `DEFAULT_SETTINGS`。

### 4.5 文件清单（新增）

| 文件 | 职责 |
|---|---|
| `store/settingsStore.ts` | 状态 + persist + `set/resetDefaults/updateCustom` |
| `features/settings/types.ts` | `AppSettings` / `DEFAULT_SETTINGS` |
| `features/settings/SettingsButton.tsx` | header 入口 |
| `features/settings/SettingsPanel.tsx` | 抽屉容器 + 分组渲染 |
| `features/settings/controls/Toggle.tsx` | 开关 |
| `features/settings/controls/SelectField.tsx` | 下拉（主题/密度/周起始/领域） |
| `features/settings/controls/NumberField.tsx` | 数字步进（dayStartHour / reminderAdvanceMin） |
| `features/settings/controls/ColorField.tsx` | 颜色（accentColor） |
| `features/settings/controls/KeyValueEditor.tsx` | 自定义变量增删改 |
| `App.tsx`（改） | 挂载按钮 + 抽屉 + theme 来源切换 |

---

## 5. 联机版启动器设计

### 5.1 目标

在**不合并两套代码**的前提下，让单机版用户能一键进入联机版（及反向），双应用通过可配置 URL 互联。

### 5.2 入口（Phase 4）

- `web` header 新增「🤝 协作」按钮 → `window.open(settings.collabAppUrl, '_blank')`。
- 首次进入若地址未启动：浏览器连接失败 → `SettingsPanel` 的协作分组内给出提示文案：
  > 启动联机版需在终端运行：
  > `npm run dev -w packages/server`
  > `npm run dev -w packages/web-collab`
  > （端口可在下方「联机版地址」中自定义）
- 端口冲突由 `collabAppUrl` 可配置解决（默认 5174，单机 5173）。

### 5.3 可选：独立 Launcher 页（Phase 5）

- 新增「模式选择」视图 `features/launcher/Launcher.tsx`：两张卡片「本地模式 / 协作模式」，点击分别开 `collabLocalUrl` / `collabAppUrl`。
- 若不做，仅用 header 按钮即可满足需求。

### 5.4 反向回链（可选）

- `web-collab` topbar 增加「← 单机版」链接，打开 `settings.collabLocalUrl`（或硬编码 `http://localhost:5173`）。

---

## 6. 模块关联关系

```
┌─────────────────────────┐         trpc/sse          ┌──────────────────────┐
│  packages/web (单机版)   │ ───────────────────────▶ │ packages/engine       │
│  · 9 Tabs（不动）        │                           │ (sql.js 本地库, 不动) │
│  · settingsStore         │                           └──────────────────────┘
│  · SettingsPanel/Button  │
│  · Launcher(协作入口)     │
└───────────┬─────────────┘
            │ 设置持久化
            ▼
     ┌──────────────────────┐   ← 共享点：仅 collabAppUrl / collabLocalUrl 两字段
     │ localStorage         │
     │ 键: dm-settings       │
     └──────────────────────┘
            │ 读取(回链地址)
            ▼
┌─────────────────────────┐         trpc/ws           ┌──────────────────────┐
│ packages/web-collab      │ ───────────────────────▶ │ packages/server       │
│ (联机版, 保持)           │                           │ (PGLite+WS, 不动)    │
│  · auth/家庭/任务/日历    │                           └──────────────────────┘
└───────────┬─────────────┘
            │ URL 跳转（无代码依赖）
            ▼  「🤝 协作」打开 collabAppUrl
      （双应用独立运行，仅 http 互联）
```

**关联要点**
- `web ──trpc/sse──▶ engine`：单机数据闭环，**不变**。
- `web ──设置──▶ settingsStore(localStorage)`：新增，离线。
- `web ──URL 跳转──▶ web-collab`：无代码依赖，仅 http。
- `web-collab ──trpc/ws──▶ server`：协作数据闭环，**不变**。
- 唯一共享：`localStorage['dm-settings']` 中 `collabAppUrl` / `collabLocalUrl`。

---

## 7. 测试与回归

| 类型 | 内容 | 通过标准 |
|---|---|---|
| 单元 | `settingsStore`：默认值、persist 往返、update、resetDefaults、custom 增删 | 全绿 |
| 单元 | `collabAppUrl` 解析/跳转 handler | 地址正确拼接 |
| 集成 | theme 迁移后 `App` 主题仍生效 | 切主题即时变化、刷新保留 |
| 回归 | engine vitest | **41/41 不变** |
| 回归 | web `tsc --noEmit` | **0 error** |
| 回归 | web `vite build` | 成功 |
| 冒烟 | 9 Tab 仍正常打开/操作 | 手动或组件测 |

---

## 8. 实施阶段（开发顺序，评审通过后执行）

- **P0 基线**：跑通 engine 41/41 + web tsc 0，确保起始绿色。
- **P1 settingsStore**：类型 + persist + 单测。
- **P2 SettingsPanel UI**：按钮 + 抽屉 + 各控件 + 分组 + 自定义变量编辑器。
- **P3 theme 迁移**：方案 A，删除 uiStore.theme，App 改读 settings（附冒烟）。
- **P4 协作启动器**：header「🤝 协作」按钮 + `collabAppUrl` 设置项 + 跳转 + 提示文案。
- **P5 可选**：独立 Launcher 页 + web-collab 反向回链 + 文档更新（`README`/`docs`）。
- **P6 收尾**：全量测试 + tsc + build + 回归，更新工作日志与记忆。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|---|---|
| theme 迁移误改 `uiStore` 导致白屏 | 方案 A 小步改动 + 单测 + 冒烟；旧 `dm-theme` 迁移后清除 |
| 双应用端口冲突 | `collabAppUrl` 可配置，文档明确 5173/5174 分工 |
| 设置项过多致 UI 臃肿 | 分组抽屉 + 自定义变量区按需扩展 |
| 误以为设置会云同步 | 明确本期仅本地；云同步列为后续（需 server 加 settings 接口） |

---

## 10. 后续可选项（非本期，供决策）

- 设置随账户云同步（需 `server` 新增 settings 存储 + 同步接口）。
- 单机版直接内嵌协作视图（架构 A，工作量更大）。
- 自定义变量导出/导入（备份与迁移）。
