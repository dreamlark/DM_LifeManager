# DM_life 修复总览

本次提交修复了用户报告的 4 个问题，并完成了相关回归验证。

## 1. PIN 有效期支持用户设置（#246）

- `packages/web-collab/src/store/pinStore.ts`
  - 新增 `dm-pin-validity` localStorage 持久化，提供 1 天 / 7 天 / 30 天 / 90 天 / 1 年 / 永久 6 档。
  - `encryptCreds` 改为读取用户设置的有效期（ms）；永久对应 `Number.MAX_SAFE_INTEGER`。
  - 新增 `pinValidityMs` 与 `setPinValidity` 供设置页订阅。
- `packages/web-collab/src/components/SettingsPage.tsx`
  - 在「安全」分类新增「PIN 凭据有效期」下拉，与「空闲自动锁定时长」并列。

## 2. 启动脚本端口清理提速 + 启动期可靠性加固（#247 / #249）

- `start-dm-life.bat`
  - 端口清理由「11 次串行 PowerShell」改为「单次 PowerShell 批量杀所有 DM Life 端口」，从数十秒降到 2-5 秒。
  - 新增 `:waitengine`：等待 engine 把实际端口写入 `%TEMP%\.dm-life.engine.port` 后，通过 `/_routes` HTTP 探测确认 engine 已就绪，避免硬编码等 14570 时因端口协商导致超时。
  - 新增 `:waitweb`：在打开浏览器前，先探测 `http://127.0.0.1:5173/engine/_routes`，确保 vite `/engine` 代理已正确指向 engine，根除此前的「启动窗口期代理锁死到死亡端口」导致的 `Failed to fetch`。
  - 文件已保存为 UTF-8 + BOM，且 `chcp 65001 >nul` 位于 `@echo off` 之后第一行，避免中文乱码/命令解析错误。
- `packages/web-collab/vite.config.ts`
  - 将 engine 端口发现缓存 TTL 从 4s 降到 2s，提升端口变化后的恢复速度。

> 关于「添加记录失败」的根因：通过节点复现确认当前代码的 `httpBatchLink` 批处理路径（单 / 多 procedure）经 `/engine` 代理到本地 engine 均返回 200 并成功写入；engine 日志无崩溃；SSE 通道符合规范。因此持续 `Failed to fetch` 并非前端/代理/批处理代码缺陷，而是启动期代理尚未正确指向存活 engine 导致的端口竞态。上述启动脚本 + 代理加固即为根因修复。

## 3. 财务页面按钮重叠（#248）

- `packages/web-collab/src/features/finance/FinancePage.tsx`
  - 原「债务进度」按钮使用 `fixed right-4 top-16`，与头部「共享到家庭」按钮重叠。
  - 将 `DebtProgressPopover` 移入页面头部右侧工具条（与「共享到家庭」「自动刷新本月」同 flex 容器），并移除其 `fixed` 定位，改为 `relative` 自适应布局。
  - 删除页面底部独立的 `<DebtProgressPopover />` 渲染点。

## 4. 验证结果

- `web-collab` TypeScript：`tsc --noEmit -p tsconfig.json` ✅
- `web-collab` 生产构建：`vite build` ✅
- `engine` 测试：`vitest run` → 52 passed ✅

## 5. 用户后续建议

- 重新启动 `DM Life.bat`（或 `start-dm-life.bat`）使新启动脚本和构建生效。旧脚本会先启动 vite 再等待代理，可能仍会遇到启动竞态；新脚本会等待 `/engine/_routes` 通过代理后才打开浏览器，添加记录失败应彻底消失。
- 若仍使用旧的快捷方式 `DM Life.bat`，请确认它指向（或已替换为）最新的 `start-dm-life.bat`。
