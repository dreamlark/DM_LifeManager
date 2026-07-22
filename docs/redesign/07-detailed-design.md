# 软件详细设计（最终方案 · 分阶段）

> 本文给出可落地的模块设计与本会话已实现的 P1 细节、P2/P3 的实施步骤。

## 阶段 P1（本会话实现）

### P1.1 All-in-One 部署
**新增 `Dockerfile.allinone`**（多阶段）：
- 阶段 build：复制根 `package.json` + `packages/*/package.json`，`npm install --include=dev`（先 rm Windows lockfile），`npm run build -w packages/web-collab`，`npm run build` core（P2 后）。
- 阶段 runtime：`node:22-slim`，装入 engine+server+web-collab 构建物 + caddy 二进制（或 apk add caddy）+ 启动编排脚本。
- `EXPOSE 8080`；`USER node`；`VOLUME /data`。

**新增 `apps/allinone/index.mjs`（编排器）**：
- 以子进程拉起：engine（`npm start -w packages/engine`）、server（`npm start -w packages/server`）、caddy（`caddy run --config /etc/caddy/Caddyfile`）。
- 环境变量缺省自填充：`JWT_SECRET`/`ENGINE_API_TOKEN` 缺失时 `crypto.randomBytes` 生成并写入 `/data/.env.auto`（幂等，已存在则复用）。
- 监听子进程退出，任一非预期退出则整体退出（容器 restart 自愈）。

**新增 `docker-compose.simple.yml`**：单服务 `dm-life`，`ports: ["8080:8080"]`，`volumes: ["./data:/data"]`，`pull_policy: always`，无 `environment` 必填项。

**新增内置 `caddy.auto.conf`**：与现行 `caddy.conf` 路由一致，但站点块用 `:8080`，并预留 `tls` 自动段（P3 启用）。

### P1.2 前端统一
- **弃用 `packages/web`**：`package.json` 标记 `"private": true` 并在 README 注明"已归档，功能在 web-collab"；根 `package.json` workspaces 移除 `packages/web`（保留以兼容旧构建，加注释）。实际构建只出 web-collab。
- **统一主题 `packages/web-collab/src/styles/theme.css`**：
  - 定义 `--bg-base/--surface/--surface-2/--border/--text/--text-muted/--accent/--accent-soft` 等语义变量；`:root`（浅）与 `.dark`（深）各一版。
  - `tailwind.config.ts` 的 `colors` 全部引用 `rgb(var(--xxx)/<alpha>)`；删除 `--lc-*` 与 `--accent` hex 双轨。
  - `styles.css` / `tailwind.css` 统一 `@import` 该文件。
- **统一外壳 `AppShell.tsx`**：顶栏（模式/主题/账户）+ 响应式侧栏；`LocalApp` 与协作视图均作为 `<AppShell>` 的 children，共享导航与组件，不再各自复制顶栏。
- 个人/协作卡片、按钮、对话框统一基础组件（玻璃卡、磁性按钮、`FloatingIcon`）。

## 阶段 P2（内核合并 · 设计 + 增量步骤）

1. **建 `packages/core`**：初始化单 `initTRPC`；把 engine router（tasks/finance/reminder/notes/mindmap/flow/domains/interests/calendar…）与 server router（auth/family/share/rbac/ws）挂到同一 `appRouter`，按 `ctx.familyMode` 分流。
2. **单库**：core 内只连一个 PGlite（`/data/dm-life.pglite`）。个人模式启动即建本地 Family + owner；协作模式复用家庭/成员表。
3. **单实时**：WS 网关统管；SSE 仅作降级。`eventBus` 单一实例。
4. **前端**：删 `trpcLocal`/`sseLocal`，全量改引用单一 `trpc`；`useModeStore` 改存"当前家庭能力集"。
5. **迁移脚本 `scripts/migrate-sqljs-to-pglite.mjs`**：读旧 `/data/engine/dm-life.db` → 写 PGlite 本地家庭（先备份）。
6. **清理**：删 `packages/engine`、`packages/server` 目录；删 `ENGINE_API_TOKEN`；更新 `Dockerfile.allinone` 只构建 core。
> 每步独立可验证（vitest + tsc + build），灰度开关 `USE_CORE=1` 控制新旧路径，便于回滚。

## 阶段 P3（体验闭环 · 建于 P2 之上）

1. **首次向导 `FirstRunWizard.tsx`**：DB 空 → 引导建账户/PIN + 自动密钥；写入 `/data/.env.auto`。
2. **自动 HTTPS**：caddy 启动时若检测到 `tailscale` 命令可用 → `tailscale cert` 自动签发并 reload；否则生成自签并信任 localhost 始终可用；`DISABLE_HTTPS=1` 逃生。
3. **自检 `/healthz` + 设置页系统状态**：五项绿/黄/红 + 操作建议。
4. **升级回滚**：compose 升级前 `cp -r /data /data.bak-<digest>`；提供回滚说明。PWA 离线缓存已建。

## 验收标准（最终态）
- 部署：粘贴 1 段 compose → 启动 → 浏览器开 `https://机器名.ts.net:8080` → 向导 → 可用。
- 功能：个人/协作视觉一致；数据互通；实时刷新 < 200ms。
- 测试：core vitest 全绿；web-collab `tsc --noEmit` 0 error + `vite build` 通过。
- 安全：默认 HTTPS；非 root 容器；PIN/JWT 本地加密。
