# M2 实时 WebSocket 网关 — 交付说明

> 联机版「M2 协作核心」已选定的优先模块：实时 WebSocket 网关（在线状态 + 实时推送 + 通知）。
> 任务 #166–#172 全部完成，端到端验证 **14/14 全绿**。

## 交付能力

- **实时推送**：家庭成员任何变更（加入/移除/离队/改角色/转让所有者/建家庭/发邀请）通过 WebSocket 即时广播给同家庭在线成员，**无需手动刷新页面**。
- **在线状态（presence）**：基于 WS 连接维护每个家庭的在线成员集合，成员卡实时显示「在线」绿点。
- **通知雏形**：关键协作事件（成员加入 / 角色变更 / 所有者转让 / 成员移除或离队）在接收端弹出轻量 toast 提示。
- **断线自愈**：Web 端 WS 客户端带指数退避自动重连（1s→10s 封顶），短暂断网后无缝恢复。

## 分层实现

### 服务端（`packages/server/src`）
| 文件 | 职责 |
|---|---|
| `realtime/eventBus.ts` | 进程内发布订阅（`publishEvent` / `subscribeEvents`），定义 7 类 `RealtimeEvent`（均带 `familyId`），`setMaxListeners(0)` |
| `realtime/hub.ts` | `WebSocketServer({server, path:'/ws'})` 挂到既有 HTTP 服务；`?token=` 经 `verifyAccess` 鉴权（失败 `ws.close(1008)`）；维护 `clients/userFamilies/familyOnline` 三张 Map + 心跳 25s；多标签页连接按连接清理，全部断开才移出在线集合 |
| `router.ts` | 7 处关键 mutation 成功后各插 `publishEvent(...)`：`families.create` / `invite` / `acceptInvite` / `removeMember` / `updateRole` / `leave` / `transferOwnership` |
| `http-server.ts` | `server.listen` 前 `attachHub(server)`（line 65），不干扰 `/trpc`、健康检查与 CORS |

### Web 端（`packages/web-collab`）
| 文件 | 职责 |
|---|---|
| `src/lib/realtime.ts` | Zustand `useRealtimeStore`（status / online / notify）+ `onBoardEvent(cb)` 订阅集；`connectRealtime()` 按 `location.protocol` 决 ws/wss、`?token=access`、指数退避重连；presence→`setOnline`，event→广播监听 + 按 kind 弹 `pushNotify` |
| `src/App.tsx` | `accessToken && view==='board'` 时连接，否则断开；`logout` 先断开 |
| `src/components/FamilyBoard.tsx` | 订阅 `onBoardEvent`，`e.familyId===currentFamilyId` 时 `refreshMembers`；成员卡 `.online` 绿边 + `.online-dot`；3 秒 toast 通知 |
| `vite.config.ts` | 代理 `'/ws'` 加 `ws:true`（WebSocket 升级必须） |
| `src/styles.css` | `.member-card.online` / `.online-dot` / `@keyframes toast-in` / `.toast` |

## 关键缺陷修复（本次）
- **Zustand v5 无限渲染循环（致命）**：原选择器 `(s)=> currentFamilyId ? s.online[currentFamilyId] ?? [] : []` 每次返回新数组，触发 "getSnapshot should be cached" + "Maximum update depth exceeded" → FamilyBoard 白屏。改为模块级 `const EMPTY: string[] = []` 稳定引用解决。

## 验证结果
- 服务端 `tsc -p packages/server`：exit 0
- 服务端 `vitest`：**15/15**
- Web 端 `tsc -p packages/web-collab`：exit 0
- 端到端（系统 Chrome + Playwright，真实浏览器双上下文）：**14/14**
  - ✅ alice 看板（实时推送）出现成员 bob，**无需 reload**
  - ✅ alice 看板显示 bob 在线（presence 推送）— online=1
  - ✅ owner 对 bob 卡片可见「改角色 / 转让所有者」
  - ✅ owner 提升 bob 为管理员（写路径，徽章实时更新）
  - ✅ 主题切换、无运行时错误

## 下一步建议（待你确认）
M2 协作核心的下一个子模块，二选一：
1. **共享任务（认领 · 指派 · 轮换）**——家庭成员对同一任务池认领/指派/轮换负责人，配合实时推送即时同步。
2. **共享日历**——家庭成员日程/任务在同一日历视图聚合，变更实时可见。

> 本地预览：用洁净端口重启即可（`PORT=xxxx PGLITE_DIR=<真实路径> npm run start -w @dm-life/server` + `VITE_SERVER_PORT=xxxx npm run dev -w @dm-life/web-collab`）。需要我直接拉起一个可访问的预览实例也可以说一声。
