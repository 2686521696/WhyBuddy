/**
 * Vitest 全局启动前置（`autopilot-capability-runtime-enablement` Task 13）。
 *
 * 唯一职责：若测试环境未显式设置 `process.env.BUILD_TARGET`，则写入
 * `"test"`。resolver（`server/routes/blueprint/runtime-enablement/resolver.ts`）
 * 会据此把 5 条 capability bridge 的 tier-1 env gate 强制解析为 `"false"`,
 * 保持既有 5140+ 测试的默认兼容性（requirement 1.2 / 7.6 / 8.1）。
 *
 * 约束：
 * - SHALL NOT 覆盖用户显式设置的 `BUILD_TARGET`（例如 `vi.stubEnv("BUILD_TARGET", "production")` 场景）。
 * - SHALL NOT 动任何其他环境变量；resolver 的其它门禁（`AUTOPILOT_REAL_RUNTIME` /
 *   `BLUEPRINT_*_ENABLED`）继续保留它们的原语义。
 * - SHALL NOT 引入任何副作用模块；本文件仅做 `process.env` 赋值。
 */
if (!process.env.BUILD_TARGET) {
  process.env.BUILD_TARGET = "test";
}
