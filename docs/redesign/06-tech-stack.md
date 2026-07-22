# 技术栈选型建议（最终方案）

## 1. 选型原则
保持团队已验证的技术连续性，**不引入陌生栈**，只在"双"的地方收敛为"单"。

## 2. 最终技术栈

| 领域 | 选型 | 决策依据 | 相对现状的变化 |
|---|---|---|---|
| 语言/运行时 | TypeScript + Node 22 | 沿用，零学习成本 | 不变 |
| 前端框架 | React 18 + Vite 5 | 沿用，已验证 PWA 构建 | 不变 |
| 样式 | Tailwind 3 + 统一 CSS 变量主题 | 解决 `--accent`/`--lc-*` 双令牌分裂 | **合并为单套语义令牌** |
| 状态 | Zustand 5 | 沿用 | 不变（删 `useModeStore` 的"选后端"语义，仅留能力开关） |
| 数据获取 | @trpc/react-query v11 | 沿用；**单客户端** | **删 `trpcLocal`** |
| API | tRPC v11（单 router） | 沿用；合并 engine+server 路由 | **删 engine/server 双进程** |
| 数据库 | **PGlite（文件型，可升真实 Postgres）** | Postgres 兼容、单文件、支持多用户；替代 sql.js | **弃用 sql.js/engine** |
| ORM | Drizzle ORM | 已在两端使用 | 统一到单 schema |
| 实时 | **WebSocket（SSE 降级）** | 统一通道，减故障面 | **删 engine SSE 专属闭环** |
| 反向代理/TLS | Caddy 2（内置、自动证书） | 自动 HTTPS，解决 PIN 卡死根因 | caddy 由独立容器→内置单实例 |
| 容器 | 单 `node:22-slim` + 多阶段构建 | 单镜像、零必填 env | 3 镜像→1 镜像 |
| 桌面壳 | Tauri 2（可选） | 沿用 | 不变 |
| 测试 | Vitest | 沿用；单库单客户端后用例收敛 | 双测试套件→单套 |

## 3. 明确**不采用**的方案（及理由）
- ❌ 重写到 Laravel/Livewire/Go/Rust：与现有 TS 资产割裂，风险与成本不可接受。
- ❌ 保留 sql.js 双库：个人/协作数据无法互通，是复杂度根因。
- ❌ 微服务化：家庭场景无需水平扩展，微服务只增复杂度。
- ❌ 外部消息队列：单实例部署，进程内事件总线足够。

## 4. 依赖收敛清单（待删除/合并）
- `packages/engine`（删除，逻辑并入 core）
- `packages/server`（合并为 core 的一部分）
- `packages/web`（删除，功能已迁入 web-collab）
- `trpcLocal` / `sseLocal`（删除）
- `--lc-*` 主题令牌（合并入统一主题）
- `ENGINE_API_TOKEN` 环境变量（单内核内无需）

## 5. 风险与对冲
- **PGlite 并发写**：家庭多人同时写需串行化；core 内用单写事务队列（已有 `writeTx` 模式可复用）。
- **迁移旧 sql.js 数据**：提供一次性迁移脚本（复用 `docs/migration-singleuser-to-collab.md` 思路），先备份后迁移。
- **caddy 自动证书**：Tailscale 不可用时降级自签 + localhost 兜底，PIN 始终可用。
