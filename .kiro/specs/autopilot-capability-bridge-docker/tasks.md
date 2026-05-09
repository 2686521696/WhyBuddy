# 实施任务：Autopilot Capability Bridge — Docker Analysis Sandbox

## 概述

本任务清单把 design 文档中的 19 步实现大纲收敛为 22 个可验证的代码任务，覆盖：

- `shared/blueprint/contracts.ts` 的 provenance 可选字段扩展
- `BlueprintServiceContext` 的 4 个可选依赖字段扩展
- `server/routes/blueprint/docker-analysis-sandbox/` 下 4 个新模块（policy / execution-plan / callback-waiter / bridge）及其 co-located 单测
- `server/index.ts` 的 blueprint callback dispatcher 中间件挂载
- `server/routes/blueprint.ts` 中 `createRouteGenerationSandboxDerivation` 的 async 改造与 docker 分支
- `buildCapabilityEvidence` 的 provenance 继承
- `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E
- 最终全量回归

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：1（契约） → 2（context 字段） → 3、4（policy + 单测） → 5、6（execution-plan + 单测） → 7、8（callback-waiter + 单测） → 9（子域纯模块 checkpoint） → 10、11（bridge 主逻辑 + 单测） → 12（完整子域 checkpoint） → 13（context 默认装配） → 14（server/index.ts 中间件） → 15、16、17（blueprint.ts 改造：async / adapter / evidence） → 18（async 传染 trace） → 19（既有子域回归 checkpoint） → 20（E2E 追加） → 21（SDK 透传） → 22（全量回归 + 最终验收）。

需求 9.3 明确锁定本 spec **不引入 PBT**；所有单测均为 example-based，共 ~13 条 co-located 单测 + 2 条 E2E。

## 任务列表

- [x] 1. 在 `shared/blueprint/contracts.ts` 扩展 provenance 可选字段
  - [x] 1.1 在 `BlueprintCapabilityInvocation.provenance` 类型中追加 5 个可选字段：`executionMode?: "real" | "simulated_fallback"`、`containerId?: string`、`artifactUrl?: string`、`logDigest?: string`、`error?: string`；不删除、不重命名、不修改任何既有字段（保留 `jobId` / `projectId` / `sourceId` / `routeSetId` / `routeId` / `specTreeId` / `nodeId` / `roleId` / `targetText` / `githubUrls` 原样）
  - [x] 1.2 在 `BlueprintCapabilityEvidence.provenance` 类型中追加同样 5 个可选字段，与 invocation 侧字段含义、命名、类型严格一致
  - [x] 1.3 在仓库根运行 `node --run check`，确认新增字段不引入新增 TS 错误（历史类型债不应扩大）；同时 grep 既有 `provenance:` 消费点确认没有因字段追加而断言失败
  - _Requirements: 3.7, 4.2, 4.4, 8.1, 8.3_

- [x] 2. 在 `server/routes/blueprint/context.ts` 扩展 `BlueprintServiceContext` 依赖字段
  - [x] 2.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 4 个可选字段：`executorClient?: ExecutorClient`、`executorCallbackDispatcher?: BlueprintExecutorCallbackDispatcher`、`dockerCapabilityPolicy?: DockerCapabilityPolicy`、`dockerCapabilityBridge?: DockerCapabilityBridge`
  - [x] 2.2 保持向后兼容：`buildBlueprintServiceContext(deps)` 在 `deps` 未提供这些字段时仍能构造出合法 Context，既有单测与 E2E 无感知（字段默认装配在任务 10 中处理，本任务只保证"类型可选且不传也不崩"）
  - [x] 2.3 运行 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.2_

- [x] 3. 新建 `server/routes/blueprint/docker-analysis-sandbox/policy.ts`
  - [x] 3.1 按 design §4.3 定义并导出 `DockerCapabilityPolicy` 接口（字段：`allowedImages` / `memoryLimit` / `cpuLimit` / `pidsLimit` / `networkPolicy` / `networkAllowlist?` / `securityLevel` / `maxCallbackTimeoutMs` / `maxDispatchTimeoutMs` / `maxLogLines` / `maxLogBytes`）
  - [x] 3.2 导出 `createDefaultDockerCapabilityPolicy()`，默认 `allowedImages: ["lobster-executor:ai", "lobster-executor:default", "node:20-slim"]` / `memoryLimit: "512m"` / `cpuLimit: "1.0"` / `pidsLimit: 256` / `networkPolicy: "none"` / `securityLevel: "strict"` / `maxCallbackTimeoutMs: 45000` / `maxDispatchTimeoutMs: 10000` / `maxLogLines: 50` / `maxLogBytes: 10240`
  - [x] 3.3 导出 `checkDockerCapabilityPolicy(policy, request)`：返回 `{ allowed: boolean, reason?: string }`；按 design §4.3 校验规则表实现（image 不在 allow-list / networkPolicy 冲突 / whitelist domain 不匹配）
  - [x] 3.4 支持环境变量覆盖 `maxCallbackTimeoutMs`（`BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS`）与 `maxDispatchTimeoutMs`（`BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_DISPATCH_TIMEOUT_MS`）；未设置时使用默认值
  - _Requirements: 2.4, 7.1, 7.2, 7.5_

- [x] 4. 新建 `server/routes/blueprint/docker-analysis-sandbox/policy.test.ts`
  - [x] 4.1 覆盖 4 条场景：默认 policy 接受 `"lobster-executor:default"` 镜像 / 默认 policy 拒绝 `"malicious:latest"` 并返回 `reason: "image not in allow-list"` / `networkPolicy === "none"` 时拒绝 `requestedNetwork === "bridge"` 并返回 `reason: "network policy denied"` / `networkPolicy === "whitelist"` 且 domain 不在 `networkAllowlist` 时拒绝并返回 `reason: "network allowlist denied"`
  - [x] 4.2 断言 `createDefaultDockerCapabilityPolicy()` 返回值的每个字段与 design §4.3 默认值严格一致
  - [x] 4.3 断言 `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS=60000` 环境变量覆盖生效（使用 `vi.stubEnv` 或等价机制）
  - _Requirements: 7.1, 7.2, 7.5, 9.2_

- [x] 5. 新建 `server/routes/blueprint/docker-analysis-sandbox/execution-plan.ts`
  - [x] 5.1 按 design §4.4 定义并导出 `BuildDockerExecutionPlanInput`（`bridgeInput` / `policy` / `image?`）与 `buildDockerCapabilityExecutionPlan(input): ExecutionPlan` 纯函数
  - [x] 5.2 实现 plan 字段填充：`version: EXECUTOR_CONTRACT_VERSION`、`missionId: "blueprint:{jobId}"`、`summary: "Blueprint docker analysis for route: {routeTitle}"`、`objective: "Analyze target {targetText} for route {routeId}."`、`requestedBy: "brain"`、`mode: "managed"`、`sourceText: targetText`、`steps[0] = { key: "docker-analysis", label: "Docker analysis", description: "Run deterministic repository analysis in a sealed container." }`
  - [x] 5.3 实现 `jobs[0]` 字段：`id: invocationId`（外层传入，HMAC 回调锚点）、`key: "docker-analysis"`、`kind: "analyze"`、`timeoutMs: Math.min(maxCallbackTimeoutMs, 30000)`、`payload.requiredCapabilities: ["runtime.docker"]`、`payload.image: options.image ?? "lobster-executor:default"`、`payload.memoryLimit / cpuLimit / pidsLimit / networkPolicy / securityLevel` 来自 policy、`payload.analysisInput: { routeId, routeTitle, targetText, githubUrls, projectId }`
  - [x] 5.4 实现 `metadata` 字段：`source: "blueprint-docker-capability-bridge"`、`blueprintJobId` / `routeSetId` / `routeId` / `capabilityId` 来自 bridgeInput
  - [x] 5.5 **禁止** 在本文件 `import { DockerRunner } from "../../../../services/lobster-executor/..."` / `new ExecutorClient(...)` / `import dockerode`；`ExecutionPlan` 类型从 `shared/executor/contracts.ts` 导入
  - _Requirements: 2.2, 2.5, 7.2_

- [x] 6. 新建 `server/routes/blueprint/docker-analysis-sandbox/execution-plan.test.ts`
  - [x] 6.1 覆盖 3 条场景：断言 `plan.jobs[0].id === input.bridgeInput.invocationId`（回调匹配锚点）/ 断言 `plan.jobs[0].payload.requiredCapabilities` 包含 `"runtime.docker"` / 断言 `plan.metadata.blueprintJobId === bridgeInput.jobId && plan.metadata.capabilityId === "docker-analysis-sandbox"`
  - [x] 6.2 断言 `plan.jobs[0].payload.analysisInput.githubUrls` 按 `request.githubUrls ?? []` 填充；`targetText` 缺失时 `plan.objective` 仍能正确构造而不崩溃
  - _Requirements: 2.2, 2.5, 9.2_

- [x] 7. 新建 `server/routes/blueprint/docker-analysis-sandbox/callback-waiter.ts`
  - [x] 7.1 按 design §4.5 定义并导出 `BlueprintExecutorCallbackDispatcher` 接口（方法：`awaitTerminal(jobId, timeoutMs): Promise<ExecutorEvent>`、`handleEvent(event: ExecutorEvent): void`、`collectLogs(jobId, maxLines, maxBytes): { getLogs, getDigest, dispose }`）
  - [x] 7.2 导出 `createBlueprintExecutorCallbackDispatcher(options: { now?, logger? }): BlueprintExecutorCallbackDispatcher`；内部用 `Map<string, { resolve, reject, timer, logCollector? }>` 维护 pending waiters
  - [x] 7.3 实现 `handleEvent`：当 `event.type === "job.completed" | "job.failed"` 且有 waiter 时 resolve + clearTimeout + delete；`job.log_stream` / `job.log` 在启用 `collectLogs` 时累计到内存，超过 `maxLines` / `maxBytes` 后丢弃后续行但保留 SHA-256 digest over 完整 scrubbed bytes
  - [x] 7.4 实现 `awaitTerminal`：超时通过 `setTimeout(() => reject(new Error("callback timeout")))` 实现；返回 Promise
  - [x] 7.5 **禁止** 在本文件 `import` `services/lobster-executor` 内部；仅使用 `ExecutorEvent` 类型（从 `shared/executor/contracts.ts`）
  - _Requirements: 2.6, 3.2, 3.6, 4.1_

- [x] 8. 新建 `server/routes/blueprint/docker-analysis-sandbox/callback-waiter.test.ts`
  - [x] 8.1 覆盖 3 条场景：先 `awaitTerminal(jobId, 5000)` 再 `handleEvent({ type: "job.completed", jobId, ... })` → Promise resolve 且 event 匹配 / `awaitTerminal(jobId, 100)` 但永不 `handleEvent` → Promise reject 且 `error.message === "callback timeout"` / `collectLogs(jobId, 50, 10240)` 订阅后 `handleEvent({ type: "job.log_stream", jobId, data: "..." })` → `getLogs()` 返回对应行且 `getDigest()` 返回非空字符串
  - [x] 8.2 使用 `vi.useFakeTimers()` 控制超时触发，避免真实等待拖慢测试
  - _Requirements: 2.6, 3.2, 3.6, 9.2_

- [x] 9. Checkpoint — 跑通子域 policy / execution-plan / callback-waiter 单测
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/docker-analysis-sandbox/policy.test.ts server/routes/blueprint/docker-analysis-sandbox/execution-plan.test.ts server/routes/blueprint/docker-analysis-sandbox/callback-waiter.test.ts`，确认 ~10 条单测全部通过；若失败必须修复对应模块后再继续。同时跑 `node --run check` 确认此时仓库无新增类型错误。
  - _Requirements: 9.2, 9.3_

- [x] 10. 新建 `server/routes/blueprint/docker-analysis-sandbox/bridge.ts`
  - [x] 10.1 按 design §4.2 定义并导出 `DockerCapabilityBridgeInput`（`capability` / `route` / `jobId` / `request` / `routeSet` / `createdAt` / `invocationId` / `roleId`）、`DockerCapabilityBridgeOutput`（`invocation` / `executorJobId?` / `additionalEvents`）、`DockerCapabilityBridge` 类型别名
  - [x] 10.2 导出工厂 `createDockerCapabilityBridge(ctx: BlueprintServiceContext): DockerCapabilityBridge`；按 design §4.6 伪代码实现主算法 8 步：早退（未注入 + `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED !== "true"`）→ `assertReachable` → `checkDockerCapabilityPolicy` → `buildDockerCapabilityExecutionPlan` → `dispatchPlan` + retry 1 次（`kind==="rejected"` 不重试）→ `dispatcher.collectLogs` + `awaitTerminal` → 终态判断 → 构造 real invocation
  - [x] 10.3 按 design §4.7 实现 `buildRealInvocation`：填充 `durationMs`（墙钟毫秒）/ `logs`（来自 collector）/ `outputSummary`（来自 `terminalEvent.summary` 或 artifacts 派生）/ `requestedBy: "docker-capability-bridge"` / `safetyGate.reason: "{label} approved for real Docker execution via lobster-executor."` / `provenance.executionMode: "real"` / `provenance.containerId / artifactUrl / logDigest`（可选填充）；其它字段与 simulated 路径形态等价
  - [x] 10.4 按 design §4.8 实现 `buildFallbackOutput(input, { reason })`：调用既有 `buildCapabilityOutputSummary()` / `buildCapabilityInvocationLogs()` / `deterministicCapabilityDuration()` 产出模板化字段；`requestedBy: "route-generation-sandbox-derivation"` 保留今日值；`provenance.executionMode: "simulated_fallback"` + `provenance.error: truncate(reason, 400)`
  - [x] 10.5 超时 / retry 耗尽 / rejected / health 失败 / policy 拒绝 / callback failed 6 类错误统一走 `buildFallbackOutput`；超时与 callback failed 时以 best-effort 方式调用 `ctx.executorClient.cancelJob?.(input.invocationId).catch(() => void 0)`（可选链兼容 `cancelJob` 未实现的情况）
  - [x] 10.6 日志级别：未配置场景使用 `ctx.logger.debug(...)`（dev 日常降噪）；其它失败场景使用 `ctx.logger.warn(...)` 并携带 `error` / `capabilityId` / `jobId` 上下文
  - [x] 10.7 **禁止** `import { DockerRunner, MockRunner } from "../../../../services/lobster-executor/..."`、**禁止** `new ExecutorClient(...)` 自己装配执行器、**禁止** `import dockerode`；所有执行器依赖必须通过 `ctx.executorClient` / `ctx.executorCallbackDispatcher` / `ctx.dockerCapabilityPolicy` 注入
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.5, 3.6, 4.1, 4.2, 4.5, 4.6, 6.1, 6.2, 7.1, 7.5_

- [x] 11. 新建 `server/routes/blueprint/docker-analysis-sandbox/bridge.test.ts`
  - [x] 11.1 **Happy path**：注入 fake `executorClient`（`assertReachable` 成功、`dispatchPlan` 返回 `{ response: { ok: true, accepted: true, jobId } }`）+ fake `executorCallbackDispatcher`（立即 `awaitTerminal` resolve 成 `{ type: "job.completed", status: "completed", summary: "...", metrics: { durationMs: 1834 }, artifacts: [{ url: "/executor/artifacts/analysis.json" }], payload: { containerId: "ctr_abc123" } }`）+ `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED=true`；断言 `output.invocation.provenance.executionMode === "real"` + `containerId === "ctr_abc123"` + `artifactUrl` 匹配 `/analysis\.json$/` + `durationMs > 0` + `outputSummary` 不来自 `buildCapabilityOutputSummary` 模板
  - [x] 11.2 **Timeout**：fake `executorClient.dispatchPlan` 成功但 `executorCallbackDispatcher.awaitTerminal` 永远 reject 为 `Error("callback timeout")`；断言 `output.invocation.provenance.executionMode === "simulated_fallback"` + `error === "callback timeout"` + `cancelJob` 被调用一次；断言 `outputSummary` / `logs` / `durationMs` 与 `buildCapabilityOutputSummary` / `buildCapabilityInvocationLogs` / `deterministicCapabilityDuration` 产出完全一致
  - [x] 11.3 **Unreachable**：fake `executorClient.assertReachable` 抛 `new ExecutorClientError("executor down", "unavailable")`；断言 `output.invocation.provenance.executionMode === "simulated_fallback"` + `error` 匹配 `/executor unreachable/` + `dispatchPlan` 未被调用；断言 `ctx.logger.warn` 被调用且参数包含 `"executor unreachable"`
  - [x] 11.4 所有 3 条单测均不启动真实 Docker、不发真实 HTTP 请求，完全通过 fake ctx 驱动
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.5, 6.4, 6.5, 9.2_

- [x] 12. Checkpoint — 跑通完整 docker-analysis-sandbox 子域测试
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/docker-analysis-sandbox/`，确认 ~13 条单测（4 policy + 3 execution-plan + 3 callback-waiter + 3 bridge）全部通过；此 checkpoint 保证 docker capability bridge 核心实现在接入外层之前已稳定。
  - _Requirements: 9.2, 9.3_

- [x] 13. 在 `buildBlueprintServiceContext` 中默认装配 bridge 与 dispatcher
  - [x] 13.1 在 `server/routes/blueprint/context.ts` 的 `buildBlueprintServiceContext(deps)` 中：若 `deps.executorCallbackDispatcher` 未提供，调用 `createBlueprintExecutorCallbackDispatcher({ now, logger })` 构造默认实例挂到 ctx 上；若 `deps.dockerCapabilityPolicy` 未提供，调用 `createDefaultDockerCapabilityPolicy()` 挂到 ctx 上；若 `deps.dockerCapabilityBridge` 未提供，调用 `createDockerCapabilityBridge(ctx)` 构造默认实例挂到 ctx 上
  - [x] 13.2 保持向后兼容：`deps.executorClient` 为 `undefined` 时 ctx 上 `executorClient` 仍为 `undefined`；bridge 内部会据此早退 fallback（不强行装配默认 `ExecutorClient`，避免在 dev 默认装配下拖慢响应）
  - [x] 13.3 新增字段的装配顺序：先解析 `logger` / `now`，再装配 `executorCallbackDispatcher`（依赖 `logger` / `now`），再装配 `dockerCapabilityPolicy`（纯数据），最后装配 `dockerCapabilityBridge`（依赖前三者 + `executorClient?`）
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.2_

- [x] 14. 在 `server/index.ts` 挂载 blueprint callback dispatcher 中间件
  - [x] 14.1 在 `app.use("/api/executor/events", installExecutorInterceptor(eventCollector, resolveMissionReplayId))` 之后追加第二个中间件：`app.use("/api/executor/events", (req, res, next) => { const event = req.body as ExecutorEvent | undefined; if (event && typeof event.jobId === "string") { blueprintCallbackDispatcher.handleEvent(event); } next(); })`
  - [x] 14.2 `blueprintCallbackDispatcher` 从 `BlueprintServiceContext` 或等价 DI 容器中获取；**不得** 在 `server/index.ts` 直接 `new createBlueprintExecutorCallbackDispatcher(...)` 并持有模块级单例 —— 应保证与注入给 blueprint router 的 dispatcher 是同一实例（design §4.5 接线策略）
  - [x] 14.3 验证中间件顺序：HMAC 签名校验（`verifyExecutorCallbackSignature`，`server/index.ts` 第 ~1291 行）在两者之前；blueprint dispatcher 仅读 `req.body` 并调 `next()`，不吞响应、不阻塞既有 mission runtime 事件处理
  - [x] 14.4 运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/executor-interceptor.test.ts`（若存在）或等价 executor 回调测试子集，确认中间件叠加未破坏既有事件落库
  - _Requirements: 1.8, 2.2, 2.6_

- [x] 15. 改造 `createRouteGenerationSandboxDerivation` 为 async 并接入 ctx 与 docker bridge 分支
  - [x] 15.1 在 `server/routes/blueprint.ts` 中把 `createRouteGenerationSandboxDerivation` 签名从 sync 改为 `async`，追加参数 `ctx: BlueprintServiceContext`
  - [x] 15.2 把内部 `const invocations = routeGenerationCapabilities.map((capability, index) => { ... })` 改为 `const invocations = await Promise.all(routeGenerationCapabilities.map(async (capability, index) => { ... }))`
  - [x] 15.3 在 map 回调中把 `createId("blueprint-capability-invocation")` 提前到分支之前生成；针对 `capability.id === "docker-analysis-sandbox" && ctx.dockerCapabilityBridge` 分支，调用 `await ctx.dockerCapabilityBridge({ capability, route, jobId, request, routeSet, createdAt, invocationId, roleId: invocationRoleId })` 并返回 `bridgeResult.invocation`
  - [x] 15.4 其它 capability（`mcp-github-source` / `aigc-spec-node` / `role-system-architecture` / `skill-svg-architecture`）分支**一行不改**：继续走 `buildCapabilityOutputSummary` / `buildCapabilityInvocationLogs` / `deterministicCapabilityDuration` 模板化组合
  - [x] 15.5 `ctx.dockerCapabilityBridge` 未注入时（理论上任务 13 默认装配后不会出现）走 else 分支（与其它 capability 相同的模板化代码），保证 ctx 无 bridge 也不崩
  - _Requirements: 1.1, 1.7, 2.1, 4.1, 4.3_

- [x] 16. 改造 `createRouteGenerationSandboxDerivation` 的 event payload：adapter 切换与新 provenance 字段透传
  - [x] 16.1 在 `createRouteGenerationSandboxDerivation` 聚合完 invocations 之后，针对 docker capability 提取真实 adapter：`const dockerInvocation = invocations.find(inv => inv.capabilityId === "docker-analysis-sandbox"); const dockerAdapter = dockerInvocation?.provenance?.executionMode === "real" ? "blueprint.runtime.docker.lobster-executor" : capability.adapter;`
  - [x] 16.2 在 `sandbox.job.started` / `sandbox.job.completed` / `sandbox.job.failed` 事件 payload 中，对应 docker capability 的 `adapter` 字段使用 `dockerAdapter`；trace `server/routes/blueprint.ts` 第 2940 / 3088 / 3091 行附近 event payload 构造代码并精确补丁
  - [x] 16.3 在 `capability.invoked` / `capability.completed` / `evidence.recorded` 事件 payload 中追加可选字段：`executionMode`、`containerId?`、`artifactUrl?`、`logDigest?`（从对应 invocation.provenance 透传）；**所有事件 `type` 仍通过 `BlueprintEventName` 常量构造，不出现裸字符串字面量**
  - [x] 16.4 `getDefaultRuntimeCapabilities()` 本身**不改**（docker capability adapter 仍为 `"blueprint.runtime.docker.simulated"` 作为 fallback 基线），保证既有 45 条 E2E 继续通过
  - _Requirements: 3.4, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 8.1, 8.2_

- [x] 17. 改造 `buildCapabilityEvidence` 继承 invocation 的新 provenance 字段
  - [x] 17.1 在 `buildCapabilityEvidence({ invocation, ... })` 内部，读取 `invocation.provenance.executionMode / containerId / artifactUrl / logDigest / error` 并原样回填到 evidence 的 `provenance` 对应字段
  - [x] 17.2 保证既有 evidence provenance 字段（`jobId` / `projectId` / `routeSetId` / `routeId` 等）一行不改，只追加 5 个可选字段的透传
  - [x] 17.3 real 路径下 evidence 的 `summary` 字段从 `invocation.outputSummary` 派生（与今天 simulated 路径同源），而不是新增独立 summary 生成器；保证需求 3.5 要求的"evidence summary 由容器真实产出派生"在不改 summary builder 的前提下成立
  - _Requirements: 3.5, 3.7, 4.2, 4.4, 8.3_

- [x] 18. Trace `createRouteGenerationSandboxDerivation` 所有调用点并追加 `await` + `ctx` 参数
  - [x] 18.1 在 `createGenerationJob`（`server/routes/blueprint.ts` 约第 2298 行）的调用点追加 `await` 与 `ctx` 参数：`await createRouteGenerationSandboxDerivation({ ...既有参数, ctx })`
  - [x] 18.2 运行 `grep -nE "createRouteGenerationSandboxDerivation\\(" server/ shared/ --include="*.ts"` 盘点所有匹配项；若除 `server/routes/blueprint.ts` 内部调用外还有其它函数级调用（例如测试文件直接调用），逐一追加 `await` + `ctx`，必要时把外层函数改为 `async`
  - [x] 18.3 运行 `node --run check` 确认 sync → async 改造未引入新 TS 错误（尤其是未丢失 `await` 导致 `Promise<T>` 被直接消费的情况）
  - _Requirements: 2.1, 6.1, 6.2_

- [x] 19. Checkpoint — 跑既有 48 条子域单测确认未回归
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint --exclude "server/routes/blueprint/docker-analysis-sandbox/**"`，确认既有 48 条子域 co-located 单测（handoff / spec-documents / artifact-memory / agent-crew 等）继续通过；若失败说明外层改造（任务 15-18）破坏了 invocation / evidence 字段形态等价性（需求 3.7 / 4.3），必须回到对应任务修复。
  - _Requirements: 3.7, 4.3, 8.2, 9.4_

- [x] 20. 在 `server/tests/blueprint-routes.test.ts` 追加 2 条 E2E 用例
  - [x] 20.1 追加 **Real-Docker mock path** 用例（需求 9.1a）：通过 `buildBlueprintServiceContext({ executorClient: fakeClient, executorCallbackDispatcher: fakeDispatcher })` 注入 fake executor，`fakeClient.assertReachable` 成功、`dispatchPlan` 返回 accepted、`fakeDispatcher.awaitTerminal` 解析为 `{ type: "job.completed", summary: "Docker analysis completed: 3 risks, 2 recommendations.", artifacts: [{ url: "/executor/artifacts/analysis.json" }], payload: { containerId: "ctr_abc123" } }`；`process.env.BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED = "true"`；`POST /api/blueprint/jobs`；断言对应 `docker-analysis-sandbox` invocation 的 `provenance.executionMode === "real"`、`provenance.containerId === "ctr_abc123"`、`provenance.artifactUrl` 匹配 `/analysis\.json$/`、`typeof provenance.logDigest === "string"`、`provenance.error` 为 `undefined`、`durationMs` 不等于 `deterministicCapabilityDuration` 产出、`outputSummary` 包含 `"Docker analysis completed"`；断言 sandbox.job.* 事件 payload 中 docker capability 的 `adapter === "blueprint.runtime.docker.lobster-executor"`
  - [x] 20.2 追加 **Fallback path** 用例（需求 9.1b）：`buildBlueprintServiceContext({ executorClient: fakeClient })`，`fakeClient.assertReachable` 抛 `new ExecutorClientError("executor down", "unavailable")`；`process.env.BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED = "true"`；`POST /api/blueprint/jobs`；断言对应 `docker-analysis-sandbox` invocation 的 `provenance.executionMode === "simulated_fallback"`、`provenance.error` 匹配 `/executor unreachable/`、`durationMs` 等于 `deterministicCapabilityDuration` 产出、`outputSummary` 来自 `buildCapabilityOutputSummary` 模板、`logs` 来自 `buildCapabilityInvocationLogs` 模板；断言 capability adapter 字符串为 `"blueprint.runtime.docker.simulated"`
  - [x] 20.3 两条用例共用一个 fake executor client helper（建议落在测试文件顶部或独立 `test-helpers/fake-executor-client.ts`），覆盖 `assertReachable` / `dispatchPlan` / `cancelJob?` / 事件调度 4 个分支；helper 不依赖真实 HTTP / Docker
  - [x] 20.4 用例 setup / teardown 正确清理 `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_ENABLED` 环境变量与临时 `specsRoot` 目录，避免污染其它用例
  - [x] 20.5 **不改写** `server/tests/blueprint-routes.test.ts` 中原有 45 条 E2E 用例的任一断言（需求 9.4 / 1.9）；仅以追加方式补 2 条
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.4, 9.1, 9.4_

- [x] 21. 确认 SDK normalizer 支持新 provenance 字段
  - [x] 21.1 检查 `client/src/lib/blueprint-api.ts` 与 `client/src/lib/blueprint-api/` 目录下是否存在 capability invocation / evidence provenance 的显式 normalizer
  - [x] 21.2 如使用对象 spread 或透明透传：确认无需改动，仅运行 SDK smoke 验证 5 个新字段（`executionMode` / `containerId` / `artifactUrl` / `logDigest` / `error`）能到达客户端
  - [x] 21.3 如使用显式字段映射：追加 5 行可选字段透传到 invocation provenance normalizer，同样追加 5 行到 evidence provenance normalizer；**不得** 修改任一既有字段映射行为，**不得** 为新字段默认值或类型强制（保持 `string | undefined`）
  - [x] 21.4 运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` 确认既有 9 条 SDK smoke 继续通过
  - _Requirements: 5.7, 8.3_

- [x] 22. 执行全量回归并完成最终验收
  - [x] 22.1 `node --run check` → 不应引入新增 TS 错误（若仓库已有历史类型债，新增改动不应扩大错误面）
  - [x] 22.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 45 + 2 = 47 条通过
  - [x] 22.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/docker-analysis-sandbox/` → ~13 条新增 co-located 单测通过（4 policy + 3 execution-plan + 3 callback-waiter + 3 bridge）
  - [x] 22.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint --exclude "server/routes/blueprint/docker-analysis-sandbox/**"` → 48 条既有子域单测继续通过
  - [x] 22.5 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [x] 22.6 人工核查 3 项边界：(a) real 路径下 capability event payload 的 `adapter === "blueprint.runtime.docker.lobster-executor"`；(b) fallback 路径下 capability event payload 的 `adapter === "blueprint.runtime.docker.simulated"`；(c) `services/lobster-executor/` 目录下源码**无**本 spec 引起的改动（需求 1.8 / design §1）
  - _Requirements: 1.9, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 4、6、8、11 是 example-based 单测（共 ~13 条），**不**包含 PBT（符合 Requirement 9.3、design §6.1）。
- 任务 20 只向 `server/tests/blueprint-routes.test.ts` **追加** 2 条新用例，不修改原有 45 条（符合 Requirement 1.9、9.4）。
- 任务 9、12、19 是 3 个中间 checkpoint，分别在子域纯模块、完整子域、外层改造后验证未回归；任务 22 是全量回归 + 最终验收。
- D1（工厂 DI）在任务 10.2 / 10.7 落地；D2（`BlueprintServiceContext` 可选注入）在任务 2 / 13 落地；D3（invocation 层替换，不改外层 orchestration）在任务 15 落地；D5（45s timeout）在任务 3.2 / 3.4 落地；D6（adapter 字符串）在任务 16.1 / 16.2 / 20.1 落地；D7（复用 `BlueprintEventName`）在任务 16.3 落地；D8（security policy）在任务 3 / 4 落地；D10（default test harness ≡ today's production behavior）在任务 13.2 / 20.5 / 22.4 落地。
- 任务 5.5 / 7.5 / 10.7 的"禁止 import"硬约束在 code review 阶段应直接拒绝违反者（与 routeset spec DI 硬约束对齐）。
- 任务 22 是强制的验证门禁，必须在所有实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 本 spec 完成后，工作流结束 —— 不在此 spec 内覆盖后续 capability（`mcp-github-source` / `aigc-spec-node` / `role-system-architecture`）的 bridge 化。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
