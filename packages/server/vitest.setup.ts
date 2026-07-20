// 测试环境专用：放宽限流阈值。
// 限流按客户端 IP 分流，而单测通过 appRouter.createCaller 直连、无真实 IP（ctx.ip=unknown），
// 所有调用落在同一 rl:*:unknown 桶，既有用例（多次 register/login）会很快撞上生产默认上限。
// 这里在 router 模块加载前把阈值调高，仅作用于测试；限流核心逻辑由 rate-limit.test.ts
// 用显式小阈值直接覆盖，不受此处影响。生产默认（10/20/60）保持不变。
process.env.RATE_REGISTER_LIMIT = process.env.RATE_REGISTER_LIMIT ?? '100000';
process.env.RATE_LOGIN_LIMIT = process.env.RATE_LOGIN_LIMIT ?? '100000';
process.env.RATE_REFRESH_LIMIT = process.env.RATE_REFRESH_LIMIT ?? '100000';
