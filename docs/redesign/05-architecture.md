# 软件架构设计（最终方案）

## 1. 架构总览

```
                        ┌─────────────────────────────────────────────┐
   浏览器 / PWA         │            dm-life 容器 (1 个)               │
   (任意设备)          │                                             │
   ───────────────────▶│  :8080 (caddy, 自动 HTTPS)                  │
                        │     │                                       │
                        │     ├─ /trpc*      ──▶ core 进程 (Node)      │
                        │     ├─ /ws*        ──▶ core 实时网关         │
                        │     ├─ /healthz    ──▶ 自检面板             │
                        │     └─ /*          ──▶ 静态前端 (web-collab) │
                        │                                             │
                        │  core 进程:                                │
                        │   单 tRPC router（local+collab 合一）       │
                        │   单 PGlite 库 (/data/dm-life.pglite)      │
                        │   单事件总线 + 单实时通道 (WS, SSE 降级)     │
                        │   首次向导 / 密钥自生成                      │
                        └─────────────────────────────────────────────┘
                                    │
                              挂载卷 /data  (持久化)
```

## 2. 逻辑分层

| 层 | 组件 | 职责 | 现状对应 |
|---|---|---|---|
| 接入层 | caddy（内置） | TLS 终止、路由、静态托管、自动证书 | 独立 caddy 容器 |
| 应用层 | `packages/core` | 统一 tRPC 业务 API、实时网关、事件溯源、鉴权 | engine + server 合并 |
| 存储层 | PGlite（单库） | 个人家庭 + 协作家庭统一数据；events 仅追加 | sql.js + PGlite → 单 PGlite |
| 表现层 | `packages/web-collab` | 单一 SPA，统一主题与外壳，mode=能力开关 | web + web-collab → 单 web-collab |

## 3. 数据模型统一（核心决策）

- **家庭（Family）为中心**：每个部署自举为一个 Family。
  - 个人模式：首次向导自动建 1 个 owner 的本地 Family，无成员。
  - 协作模式：同一 Family 模型，可邀请多名成员，带 RBAC（owner/admin/member/child/guest）。
- **共享桥接消失**：原先 `sharedItems` 在 engine↔server 间搬运的逻辑，因同库而天然消失；"共享"= 把某模块的行标记为 `family_visible=true`。
- **事件溯源保留**：`events` 表仅追加，命令处理器双写 events+实体，经事件总线广播 → 前端失效刷新/WS 推送。此 ADR 不变，仅在单库内实现。

## 4. 实时通道统一
- 单一 WebSocket 网关（`/ws`）承载个人与协作的实时更新。
- SSE `/events` 作为**降级通道**保留（极端环境 WS 不可用时前端自动回退）。
- 前端只订阅一个实时客户端，按当前家庭上下文过滤事件。

## 5. 鉴权模型
- 个人模式：本地 PIN（Web Crypto 加密 VaultBlob），无网络账户。
- 协作模式：JWT（server 签发，`JWT_SECRET` 自动生成）。
- engine 令牌机制（`ENGINE_API_TOKEN`）在单内核下不再需要——core 内部调用不加网络边界，删除该 footgun。

## 6. 部署与运维
- 单镜像、单 compose、单卷、零必填 env。
- `/healthz` 自检：`core` 进程、DB 连通、静态前端、WS、证书 五项状态。
- 升级：compose 拉 `:latest`；升级前自动 `cp -r /data /data.bak-<digest>`；失败回滚。

## 7. 非功能属性
- **性能**：单进程无跨容器转发；首屏 < 1.5s（静态资源 + 长缓存）；实时推送 < 200ms。
- **安全**：默认 HTTPS；PIN/JWT 本地加密；容器非 root（uid 1000）。
- **可维护**：故障域 2 个（core / caddy）；排错只需看 core 日志 + `/healthz`。
- **可移植**：fnOS / 任意 Docker 主机 / 纯本地 `docker run` 均一行启动。
