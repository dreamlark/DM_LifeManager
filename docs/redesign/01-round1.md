# 设计优化 · 第一轮：部署收敛 + UI 表层统一（Minimal Convergence）

> 目标：用**最小代码改动**先解决最容易感知的两个痛点——NAS 部署繁琐、个人/协作界面风格不一致。
> 本轮**不触碰**内部业务架构（engine/server 双后端、双数据库保留），只做"包一层"和"换层皮"。

## 1. 现状痛点（对应待解决问题）

| 痛点 | 现状事实 | 用户体感 |
|---|---|---|
| 部署繁琐 | 4 个服务（engine/server/frontend/caddy）、3 个 GHCR 镜像、需要 `.env`（`JWT_SECRET`/`ENGINE_API_TOKEN` 强制必填）、需要手写 `caddy.conf` 绝对路径、GitHub 包需手动设 Public | 飞牛上"部分运行"、改一行要重部署、token 配错就 401 |
| UI 不一致 | `packages/web`（单机版）与 `packages/web-collab`（联机版）是两份代码；联机版内部 `LocalApp`（个人）与协作外壳用不同主题令牌（`--accent` hex vs `--lc-*` RGB） | 切"个人/协作"模式像换了个 App，配色/圆角/间距对不上 |
| 复杂度高 | 双 tRPC 客户端（`trpc` + `trpcLocal`）、双数据闭环（SSE + WS）、三容器编排 | 排错时要同时看 engine/server/caddy 三处日志 |

## 2. 第一轮方案

### 2.1 部署：单镜像 All-in-One（零必填配置）
- 新增 `Dockerfile.allinone`：在一个 `node:22-slim` 容器内，构建并装入 engine + server + web-collab 静态包 + caddy。
- 新增 `apps/allinone` 启动编排脚本：容器内以子进程方式拉起 engine、server、caddy（caddy 监听 `:8080` 并路由 `/engine`、`/trpc`、`/ws`、`/health`、静态资源）。
- **零必填环境变量**：若 `JWT_SECRET`/`ENGINE_API_TOKEN` 缺失，启动时自动生成并写入挂载卷（持久化），个人模式默认不强制令牌。
- 新增 `docker-compose.simple.yml`：只有 **1 个服务、1 个端口（8080）**，无需 `.env`、无需 `caddy.conf`、无需手动设包可见性。

```yaml
services:
  dm-life:
    image: ghcr.io/dreamlark/dm-life:latest
    restart: unless-stopped
    pull_policy: always
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
```

→ NAS 操作从"准备 3 个文件 + 4 个服务 + 设 Public"降为"粘贴 1 段 compose、点启动"。

### 2.2 UI：统一为单一前端 + 单一主题
- **弃用 `packages/web`**：功能已 100% 迁入 `packages/web-collab`（见 `docs/migration-singleuser-to-collab.md`），旧包仅保留作为归档，不再维护、不再构建。
- **统一主题令牌**：新增 `packages/web-collab/src/styles/theme.css`，把 `--accent` 与 `--lc-*` 两套合并为**一套语义令牌**（`--bg-base`/`--surface`/`--accent`/`--text-*`），浅色/深色各一版；`tailwind.config.ts` 与 `styles.css` 全部引用同一套，删除 `--lc-*` 别名。
- **统一应用外壳 `AppShell`**：顶栏（模式切换 / 主题 / 退出）+ 侧边导航抽成单一组件，个人模式 `LocalApp` 与协作视图都套这个外壳，组件级共享而非复制。
- 个人/协作的卡片、按钮、对话框统一调用同一组基础组件（`FloatingIcon`、玻璃卡、磁性按钮等）。

## 3. 本轮收益与遗留

**已解决**：部署步骤减 80%；个人/协作视觉风格一致；单前端心智模型。
**遗留（交给后续轮次）**：
- 内部仍是 engine + server 双后端、双数据库 → 复杂度、排错面未降。
- 双 tRPC 客户端仍在，前端仍有两套请求链路。
- 安全上下文（PIN 依赖 HTTPS）仍需用户手动处理证书。

## 4. 判定
- 精简：★★☆（部署层精简，代码层未动）
- 稳定：★★★（少服务 = 少故障点，且零必填配置消除"配错即崩"）
- 高效：★★☆（启动快了，但内部冗余仍在）
- 便捷：★★★★（NAS 部署一步到位）
