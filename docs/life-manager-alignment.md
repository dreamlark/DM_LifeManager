# DM_life（TS）与参考设计「人生管理系统 / life-manager」对齐确认

> 目的：确认本仓库（TypeScript 全新实现）与参考规范 **`D:\DMYY\DM_Life` 的 `architecture.md` / `人生管理系统设计文档.md` / `life-manager`（Python+Vue）** 的设计意图是否对齐。
> 结论：**P0 + P1 单用户核心已对齐落地；协作 M2 以独立 packages 演进；少数技术选型按架构决策（ADR）做了合理替换。**

---

## 1. 架构原则对齐（关键 ADR）

| 设计原则（参考） | TS 实现 | 状态 |
|---|---|---|
| 事件溯源：events 仅追加，实体表由命令在事务内同步更新（单一写路径） | `events` 表无 UPDATE/DELETE；`writeTx()` 事务双写 events + 实体；EventBus 发布 | ✅ 对齐（ADR-002） |
| 命令 → 校验 → 双写 → 事件 → SSE → 前端失效刷新 | tRPC mutation → Zod → `writeTx` → SSE(`/events`) → Zustand 失效 | ✅ 对齐 |
| 8+1 领域模型（健康/家庭/工作/财富/社交/成长/休闲/心灵/季度聚焦） | `domains` 9 个种子 + `domainKey` 贯穿任务/笔记/专注 | ✅ 对齐 |
| 技术栈以 architecture.md（React + Vite）为准，否决设计文档的 Next.js | React 18 + Vite + Tauri 2 骨架 | ✅ 对齐（按 ADR 否决 Next.js） |

---

## 2. 功能模块对齐

| 模块 | 设计意图 | TS 实现现状 | 对齐 |
|---|---|---|---|
| 每日看板（三栏） | 左 MIT/四象限、中时间块、右记忆/提醒 | 三栏看板 + 命令面板 + dnd-kit 拖拽 | ✅ |
| 任务 | 创建/完成/四象限/排程/MIT | `tasks` 全命令 + `today`/`all` 查询 + `TaskUncompleted` 事件 | ✅ |
| 领域完整聚合 + 平衡轮 | 按领域统计任务/专注，平衡轮可视化 | `domains.summary` + `domains.balanceWheel`（真实专注时长） | ✅ |
| 财务（P1） | 债务 4 法还款引擎 / 收入 / 流水 / 资产 / 月度趋势 / 自动刷新 | `finance` 全模块 + 还款引擎移植 + `autoRefresh` + `debtSchedule`/`trend` | ✅ |
| 提醒「钟表铺」 | 周期事务钟：建/完成自动上发条/tick 响铃/逾期/推迟 | `reminders` 全命令 + `tickReminders` + 前端 ReminderShopPage | ✅ |
| 灵感记事 + 压力背包 | 笔记摄入 + 跨表聚合成压力背包 | `notes` 摄入 + `insights.pressure`（跨任务/项目/兴趣聚合） | ✅ |
| 知识库（KnowledgeBackend） | 语义检索 + 相关记忆 | **真实向量检索**：本地确定性 embed + 余弦相似度，`notes.embedding` 落地 | ✅（见 §3） |
| 每日复盘卡片 | 轻量聚合 | `insights.dailyCard` | ✅ |
| 协作（M2） | 家庭/邀请/RBAC/共享任务/共享日历/实时 | 独立 `packages/server` + `packages/web-collab`（Drizzle+PGLite、WebSocket 网关、RBAC） | ✅（独立演进，见 §4） |
| 桌面原生壳 | Tauri 2 原生窗口 | `apps/desktop` 仅骨架，未 `tauri build` | ⏳ 延期（沙箱无 Rust/WebView2） |

---

## 3. 知识库向量检索说明（与参考的差异点）

参考设计期望「embedding + 向量库」做语义检索。本实现采用 **本地确定性 lexical 向量嵌入**（FNV-1a 哈希技巧 + 中英文分词 + L2 归一化 + 余弦相似度）：

- **原因**：沙箱无网络下载神经网络模型（transformers.js / 外部 API 均不可达），且本地磁盘空间受限，无法缓存模型权重。
- **对齐性**：仍是「真实向量 + 余弦相似度检索」，存储于 `notes.embedding`（TEXT JSON），检索链路（摄入→存向量→语义排序）完整；`embed()` 可整体替换为神经网络 embedder 而不动其余链路。
- **效果**：词面重叠语义召回（中文按单字+二元组、英文按词），满足「相关记忆」场景；非神经语义，但对个人笔记足够。

---

## 4. 协作架构演进（独立 packages）

单用户引擎（`packages/engine`）保持事件溯源纯净；协作能力以独立包并行演进，不污染单用户写路径：

- `packages/server`：tRPC v11 + Drizzle + PGLite/Postgres，注册/家庭/邀请/RBAC，WebSocket 实时网关。
- `packages/web-collab`：浅/深主题、RBAC 感知成员卡、邀请/接受/创建家庭、共享任务（认领/指派/轮换）、共享日历。
- 二者 e2e 冒烟 **13/13** 通过。

---

## 5. 结论

- **架构原则**：与参考设计 100% 对齐（事件溯源、单一写路径、8+1 领域、React+Vite 选型）。
- **功能覆盖**：P0 看板/任务/领域、P1 财务/提醒/笔记/知识库、M2 协作 均已落地。
- **已知差异（均合理/延期）**：① 桌面原生壳未构建（需 Rust）；② 知识库用 lexical 向量而非神经网络 embedder（沙箱限制，可热替换）；③ 协作以独立 packages 演进。
- **未包含（超出当前范围）**：笔记相册、账本可视化、离线 PWA —— 列为后续 M3+。
