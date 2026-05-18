# 实施任务清单：Autopilot LLM-Driven Spec Generation

## 概览

本任务清单按照 design 中的模块边界拆解，把 `spec_tree` / `spec_docs` 阶段从模板/模拟生成升级为真实 LLM 推理驱动。所有新模块以中文 JSDoc 编写，不引入 `any`，不修改既有 `agent-reasoning-bridge.ts` / `callback-receiver.ts` / `lite-agent-runtime.ts` / `llm-call.ts` 内部实现，保持 TypeScript 113 错误基线与 5140+ 测试通过状态。

落地节奏：先 prompt + JSON schema + 诊断扩展 + env 旗标三件“底座”并行；再两个 derivation / generation 工厂；再装配 context 与 handler 接线；最后补 example-based 测试与 TS 基线校验，并保留一份手动集成 smoke 备忘。

## 任务

- [x] 1. 实现 prompt 构造器与 JSON schema（`server/routes/blueprint/llm-spec-prompts.ts`）
  - [x] 1.1 新建 `llm-spec-prompts.ts` 骨架与 `import type` 引用
    - 创建文件并以 `import type` 引入 `BlueprintRouteCandidate` / `BlueprintRouteSet` / `BlueprintSpecTreeNode`，确保不引起 runtime 副作用
    - 导出 `SPEC_TREE_PROMPT_ID = "blueprint.spec-tree-llm.v1"` 与 `SPEC_DOCS_PROMPT_ID = "blueprint.spec-docs-llm.v1"` 常量，全部中文 JSDoc
    - _Implements Req 1.4, 2.3, 6.2_
  - [x] 1.2 定义 `SpecTreeLlmResponseSchema` 与 `SpecDocsLlmResponseSchema`
    - 用 zod 严格化 `min/max`：spec_tree `nodes.length 1..64`、`title 1..200`、`summary 1..2000`、`type` 五枚举、`priority 0..100`
    - spec_docs `requirements/design/tasks` 各 `1..20000` 字符串
    - _Implements Req 1.2, 1.7, 2.2, 6.2_
  - [x] 1.3 实现 `buildSpecTreePrompt(input)` 与 `buildSpecDocsPrompt(input)`
    - prompt JSON 模式提示语固定为“You MUST respond with a valid JSON object matching the schema...”
    - spec_tree prompt 包含 `targetText` / `routeSet.routes` 摘要 / `primaryRoute.steps` / 可选 `repoTreeDigest` / 可选 `keyFiles`
    - spec_docs prompt 包含节点元数据 / `parentSummary` / `siblingSummaries` / `primaryRouteSummary` / 可选仓库片段
    - _Implements Req 1.4, 2.1, 2.3, 5.3_
  - [x] 1.4 实现 prompt fingerprint 计算
    - 使用 Node 内建 `crypto.createHash("sha256")` 对 `systemMessage + "\n\n" + userMessage` 取摘要，作为 `PromptPayload.promptFingerprint`
    - 同样输入两次调用应得到相同 fingerprint（顺序稳定，无随机字段）
    - _Implements Req 1.3, 6.2_
  - [x] 1.5 实现 `parseSpecTreeLlmResponse` / `parseSpecDocsLlmResponse`
    - 接收 `unknown`：若是字符串则 `JSON.parse` 包 try/catch；若 parse 失败返回 `{ ok: false, reason: "non-json response" }`
    - 通过 `safeParse` 后失败返回 `{ ok: false, reason: "schema validation failed: <issue.message>" }`
    - 成功返回 `{ ok: true, data }`，全部不抛错
    - _Implements Req 1.6, 1.7, 2.6, 6.2_
  - [ ]* 1.6 编写 prompt 模块单元测试（`server/routes/blueprint/__tests__/llm-spec-prompts.test.ts`）
    - 覆盖 fingerprint 稳定性、schema 接受合法样例、schema 拒绝越界 / 缺字段 / 非 JSON
    - 使用 vitest，无任何外部依赖 mock
    - _Implements Req 1.6, 1.7, 2.6, 6.3_

- [x] 2. 实现 spec tree LLM 推导工厂（`server/routes/blueprint/spec-tree-llm-derivation.ts`）
  - [x] 2.1 定义 DI 依赖与对外接口
    - 声明 `SpecTreeLlmDerivationDeps` / `SpecTreeLlmDerivationRequest` / `SpecTreeLlmDerivationResult` / `SpecTreeLlmDerivation`
    - `import type` 引入 `LlmCallFn`、`LiteAgentRuntime`、`McpToolAdapterDependency`、`BlueprintLogger`、`BlueprintRuntimeDiagnosticsStore`
    - 全部字段使用显式类型，禁用 `any`，对外仅导出 `createSpecTreeLlmDerivation` 工厂
    - _Implements Req 1.1, 1.3, 6.2_
  - [x] 2.2 实现旗标与依赖检测短路
    - 读取 `BLUEPRINT_SPEC_TREE_LLM_ENABLED` / `BUILD_TARGET`；任一为关或 test，且无 stage 级 stub 时直接返回 `{ generationSource: "template", contextTier: "fallback" }`，不调诊断
    - apiKey 缺失（通过 `getAIConfig().apiKey` 或既有方式判定）时同样早退；只在装配阶段记录 `recordBridgeConfiguration("specTreeLlm", { enabledByConfig, dependencyReady })`
    - _Implements Req 4.2, 4.4, 4.5, 2.7_
  - [x] 2.3 实现 Tier 1 仓库上下文抓取
    - 通过 `mcpToolAdapter.execute` 拉取 file tree 与关键配置文件（package.json / tsconfig.json / Cargo.toml / pom.xml）
    - 命中 `BLUEPRINT_SPEC_TREE_LLM_MAX_REPO_TOKENS`（默认 32000）按优先级截断；MCP 阶段独立超时 ≤ 整体 timeout 的 1/3
    - 抓取失败 / 未注入 mcpToolAdapter / status 非 completed 时降级到 Tier 2，`contextTier = "route-only"` 并写诊断 warn
    - _Implements Req 1.4, 5.1, 5.2, 5.3, 5.4_
  - [x] 2.4 构造 `AgentJobInput` 并驱动 Lite Agent 循环
    - `roleId = "blueprint-spec-tree-llm"`、`tools` 包含 `mcp.github`（仅当 adapter 存在）+ `builtin.finish`、`budget = { maxIterations: 8, maxTokens: 16000, maxDurationMs: <env timeout> }`
    - 使用 `Promise.race` 把 `liteAgentRuntime.run(input)` 与 `setTimeout(reject, BLUEPRINT_SPEC_TREE_LLM_TIMEOUT_MS)` 竞速
    - `liteAgentRuntime` 未注入时退回 `llmCall` 直调（仍标 `generationSource: "llm"`，warn log）
    - _Implements Req 1.1, 1.5, 3.1, 3.6_
  - [x] 2.5 解析、校验并构造 `BlueprintSpecTree`
    - 调用 `parseSpecTreeLlmResponse` 校验 schema；通过后扁平化为 `BlueprintSpecTreeNode[]` 并校验关系（必须有 root、无环、无孤儿）
    - 任一阶段失败：返回 `{ generationSource: "template", contextTier: "fallback", fallbackReason }`，`fallbackReason` 含 `"schema validation failed"` / `"tree construction failed: <reason>"`
    - 成功：填充 `tree` / `promptId` / `model` / `promptFingerprint` / `responseDigest`
    - _Implements Req 1.2, 1.6, 1.7_
  - [x] 2.6 写入诊断与脱敏
    - Tier 1 / Tier 2 成功调用 `recordBridgeInvocation("specTreeLlm", { mode: "real", error?: "<degraded reason>" })`
    - Tier 3 fallback 调用 `recordBridgeInvocation("specTreeLlm", { mode: "simulated_fallback", error })`
    - error 经 `applyAgentCrewRedaction` 脱敏后截断到 ≤ 400 字符；`recordBridgeInvocation` 自身抛错时静默吞掉并 debug log
    - _Implements Req 1.6, 4.5, 6.2_
  - [x] 2.7 失败传播边界与日志层级
    - `derive()` 永不抛错；任何异常 `try/catch` 捕获后转 fallback
    - `debug` 用于 env-off 早退，`warn` 用于 MCP 路径失败 / schema 失败 / 超时，不上 `error`
    - _Implements Req 1.5, 1.6, 4.5_

- [x] 3. 实现 spec docs LLM 生成工厂（`server/routes/blueprint/spec-docs-llm-generation.ts`）
  - [x] 3.1 定义 DI 依赖与对外接口
    - 声明 `SpecDocsLlmGenerationDeps` / `SpecDocsLlmGenerationRequest` / `SpecDocsLlmNodeOutput` / `SpecDocsLlmGenerationResult` / `SpecDocsLlmGeneration`
    - 与 spec-tree 复用 `SpecTreeLlmDerivationDeps` 形状，`import type` 引入相关类型，全部字段显式类型
    - _Implements Req 2.1, 2.2, 6.2_
  - [x] 3.2 实现旗标与早退路径
    - 读取 `BLUEPRINT_SPEC_DOCS_LLM_ENABLED` / `BUILD_TARGET`，关闭或测试态全部节点直接 `template`
    - apiKey 缺失同样早退，全部节点 `generationSource: "template"`，`overallSource: "template"`
    - 在装配阶段记录 `recordBridgeConfiguration("specDocsLlm", { enabledByConfig, dependencyReady })`
    - _Implements Req 2.7, 4.2, 4.5_
  - [x] 3.3 实现按节点串行 root-first DFS 处理
    - 维护 `parentSummaryMap: Map<nodeId, summary>`，每个节点完成后写入 ≤ 200 字摘要供子节点 prompt 复用
    - 使用 `for...of await`，禁止 `Promise.all`；按 `request.nodes` 入参顺序处理
    - 测试态可通过断言调用顺序验证串行
    - _Implements Req 2.3, 2.4_
  - [x] 3.4 实现单节点 LLM 调用与超时
    - 单节点用 `Promise.race` + `BLUEPRINT_SPEC_DOCS_LLM_TIMEOUT_MS`（默认 180000ms）独立计时，不累计
    - 用 `parseSpecDocsLlmResponse` 校验，失败标该节点 `generationSource: "template"` 并填 `fallbackReason`
    - 成功填充 `requirements / design / tasks` 与 provenance（promptId / model / promptFingerprint / responseDigest）
    - _Implements Req 2.1, 2.2, 2.5, 2.6_
  - [x] 3.5 实现单节点降级隔离
    - 单节点失败仅影响该节点，兄弟节点继续按 LLM 路径处理
    - 全部成功 → `overallSource: "llm"`；任一降级 → `"mixed"`；全部降级 → `"template"`
    - 每个节点失败均独立调用 `recordBridgeInvocation("specDocsLlm", ...)`，便于诊断聚合统计降级节点数
    - _Implements Req 2.5, 2.6_
  - [x] 3.6 错误脱敏与日志层级
    - 复用 `applyAgentCrewRedaction` 对 `fallbackReason` 脱敏并截断 ≤ 400 字符
    - 日志层级与 spec-tree 工厂一致：`debug`/`warn`/不上 `error`
    - `generate()` 永不抛错
    - _Implements Req 2.6, 6.2_

- [x] 4. 扩展诊断 store（`server/routes/blueprint/runtime-enablement/diagnostics-store.ts`）
  - [x] 4.1 追加 `BridgeId` 与 `BRIDGE_IDS`
    - 在现有 `BridgeId` union 末尾追加 `"specTreeLlm" | "specDocsLlm"`
    - 在 `BRIDGE_IDS` 数组末尾追加同样两个常量字面量，保持顺序为追加，避免破坏既有索引语义
    - _Implements Req 1.6, 2.6_
  - [x] 4.2 验证现有 API 满足新桥需求
    - 确认 `recordBridgeInvocation(bridgeId, { mode, error? })` 与 `recordBridgeConfiguration(bridgeId, { enabledByConfig, dependencyReady })` 无需新增方法即可承载
    - 不修改 `BridgeDiagnosticEntry` 字段，确保 `snapshot()` 自动按新 `BRIDGE_IDS` 输出新两条 entry
    - _Implements Req 1.6, 2.6, 6.3_
  - [ ]* 4.3 补充 diagnostics-store 单元测试
    - 在既有 `diagnostics-store.test.ts`（或新增 `diagnostics-store.spec-llm.test.ts`）追加：调用 `recordBridgeConfiguration("specTreeLlm", ...)` 与 `recordBridgeInvocation("specTreeLlm", { mode: "real" })` 后 `snapshot()` 中能看到对应 entry，计数正确
    - 同样覆盖 `"specDocsLlm"`
    - _Implements Req 1.6, 2.6, 6.3_

- [x] 5. 装配新工厂到 BlueprintServiceContext（`server/routes/blueprint/context.ts`）
  - [x] 5.1 扩展 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps`
    - 新增可选字段 `specTreeLlmDerivation?: SpecTreeLlmDerivation` 与 `specDocsLlmGeneration?: SpecDocsLlmGeneration`
    - 通过 `import type` 引入新工厂类型，保留可选语义，避免破坏既有装配路径
    - _Implements Req 1.1, 2.1, 6.2_
  - [x] 5.2 在 `buildBlueprintServiceContext` 中按 DI 顺序构造工厂
    - 在 `runtimeDiagnostics` / `llm` / `mcpToolAdapter` / `liteAgentRuntime` / `logger` / `now` 全部就位后构造工厂
    - 优先 `deps.specTreeLlmDerivation` / `deps.specDocsLlmGeneration` 注入；缺省时调用 `createSpecTreeLlmDerivation` / `createSpecDocsLlmGeneration`
    - `llmCall` 字段使用与 `liteAgentRuntime` 同源的 `LlmCallFn`（必要时复用 `createLlmCall(...)` 实例）
    - _Implements Req 1.1, 2.1, 4.5_
  - [x] 5.3 在装配阶段调用 `recordBridgeConfiguration`
    - 按 `BLUEPRINT_SPEC_TREE_LLM_ENABLED` / `BLUEPRINT_SPEC_DOCS_LLM_ENABLED` 与依赖就绪情况调用 `recordBridgeConfiguration("specTreeLlm" | "specDocsLlm", { enabledByConfig, dependencyReady })`
    - 让 `GET /api/blueprint/diagnostics` 首屏即显示正确 `mode`（`enabled` / `disabled`）
    - _Implements Req 1.6, 2.6, 4.5_

- [x] 6. handler 集成（`server/routes/blueprint.ts`）
  - [x] 6.1 spec_tree handler 注入 env-gated LLM 分支（约 line 9300）
    - 计算 `llmEnabled = process.env.BLUEPRINT_SPEC_TREE_LLM_ENABLED === "true"` 与 `isTest = process.env.BUILD_TARGET === "test"`
    - 当 `llmEnabled && !isTest && ctx.specTreeLlmDerivation` 时优先调 `derivation.derive(...)`，成功即用其 `tree` 与 provenance
    - 失败 / 未启用 / fallback：保留既有模板路径不动
    - _Implements Req 1.1, 1.5, 4.2, 4.4_
  - [x] 6.2 spec_docs handler 注入 env-gated LLM 分支（约 line 9128）
    - 与 spec_tree 同构调用 `ctx.specDocsLlmGeneration.generate(...)`
    - 按 `perNode[i].generationSource` 决定：`"llm"` 用 LLM 输出 markdown；`"template"` 走既有模板该节点
    - 多节点混合时各自独立 artifact，整体 `overallSource` 写入 batch-level provenance
    - _Implements Req 2.1, 2.2, 2.5, 2.6, 4.2, 4.4_
  - [x] 6.3 写入 provenance 字段
    - artifact `payload.provenance.generationSource` 写 `"llm"` / `"llm_fallback"` / `"template"`，与现有 `BlueprintSpecTree.provenance` 字段对齐
    - 写入 `promptId` / `model` / `promptFingerprint` / `responseDigest` / `error?`，全部经脱敏
    - _Implements Req 1.3, 2.2, 6.2_
  - [x] 6.4 保留既有模板路径作为 fallback
    - 不删除既有 `buildTemplateSpecTree` 与对应模板文档生成入口
    - 仅在前置 LLM 分支返回 `tree` / 文档时跳过模板路径，否则模板继续兜底
    - _Implements Req 1.5, 1.6, 2.5, 2.6_

- [x] 7. 环境旗标接线（`.env.example`）
  - [x] 7.1 追加 5 条 LLM spec 生成相关环境变量
    - `BLUEPRINT_SPEC_TREE_LLM_ENABLED=false`（默认关闭，opt-in）
    - `BLUEPRINT_SPEC_DOCS_LLM_ENABLED=false`
    - `BLUEPRINT_SPEC_TREE_LLM_TIMEOUT_MS=180000`
    - `BLUEPRINT_SPEC_DOCS_LLM_TIMEOUT_MS=180000`
    - `BLUEPRINT_SPEC_TREE_LLM_MAX_REPO_TOKENS=32000`
    - 每条都加中文 `#` 注释说明用途与默认值
    - _Implements Req 1.5, 2.5, 4.1, 4.2, 5.2_
  - [x] 7.2 在 `.env.example` 中显式说明 `BUILD_TARGET=test` 强锁行为
    - 在新增段落开头写明：`BUILD_TARGET=test` 时上述 LLM 旗标视为 `false`，集成测试可通过 `vi.stubEnv` 单独打开
    - _Implements Req 2.7, 4.4_

- [x] 8. spec tree LLM 推导测试（`server/routes/blueprint/__tests__/spec-tree-llm-derivation.test.ts`）
  - [x] 8.1 搭建 vitest 测试骨架与共享 fake
    - 手写 fake `llmCall` / `mcpToolAdapter` / `liteAgentRuntime` / `diagnostics` / `logger`
    - `vi.stubEnv` 控制 `BLUEPRINT_SPEC_TREE_LLM_ENABLED` / `BUILD_TARGET` / `BLUEPRINT_SPEC_TREE_LLM_TIMEOUT_MS`
    - 不依赖真实 `agent-reasoning-bridge.ts` 行为
    - _Implements Req 6.3_
  - [x] 8.2 测试用例 1-4：旗标与早退路径
    - #1 happy path Tier 1：`generationSource: "llm"` / `contextTier: "full"` / `tree.nodes.length > 0` / `provenance.promptFingerprint` 非空
    - #2 旗标 `"false"`：早退 template，不调 `liteAgentRuntime.run` 与 `recordBridgeInvocation`
    - #3 `BUILD_TARGET=test` 强锁：同 #2
    - #4 apiKey 缺失：同 #2
    - _Implements Req 1.1, 1.3, 2.7, 4.2, 4.4, 4.5_
  - [x] 8.3 测试用例 5-7：MCP 与 Agent 异常
    - #5 mcpToolAdapter 未注入 → Tier 2：`generationSource: "llm"` / `contextTier: "route-only"` / prompt 不含 repo digest
    - #6 adapter.execute reject → Tier 2 同上
    - #7 liteAgentRuntime.run reject → Tier 3：`generationSource: "template"` / `fallbackReason` 含 `"agent threw"`
    - _Implements Req 1.5, 1.6, 5.4_
  - [x] 8.4 测试用例 8-11：超时与解析失败
    - #8 run 永不 resolve + 短 timeout：`fallbackReason` 含 `"timeout"`
    - #9 非 JSON 返回：`fallbackReason` 含 `"non-json response"`
    - #10 schema 不全：`fallbackReason` 含 `"schema validation failed"`
    - #11 schema 通过但缺 root：`fallbackReason` 含 `"tree construction failed"`
    - _Implements Req 1.5, 1.6, 1.7_
  - [x] 8.5 测试用例 12-15：诊断、脱敏、fingerprint
    - #12 Tier 1 成功：`recordBridgeInvocation("specTreeLlm", { mode: "real" })` 调用 1 次
    - #13 错误脱敏：LLM 错误消息含 `sk-test-1234`，`fallbackReason` 不含原始 key
    - #14 错误截断：1000 字错误 → `fallbackReason.length <= 400`
    - #15 promptFingerprint 稳定：同输入连调两次，两次 fingerprint 相等
    - _Implements Req 1.3, 1.6, 6.2_

- [x] 9. spec docs LLM 生成测试（`server/routes/blueprint/__tests__/spec-docs-llm-generation.test.ts`）
  - [x] 9.1 搭建 vitest 测试骨架与共享 fake
    - 复用 spec-tree 测试中的 fake 模式：fake `llmCall` / `liteAgentRuntime` / `diagnostics` / `logger`
    - `vi.stubEnv` 控制 `BLUEPRINT_SPEC_DOCS_LLM_ENABLED` / `BUILD_TARGET` / `BLUEPRINT_SPEC_DOCS_LLM_TIMEOUT_MS`
    - _Implements Req 6.3_
  - [x] 9.2 测试用例 1-3：单节点与上下文传递
    - #1 单节点 happy path：`perNode[0].generationSource: "llm"`，三段 markdown 都非空
    - #2 多节点全成功：`overallSource: "llm"`，顺序与输入一致
    - #3 父子上下文传递：第二个节点 prompt 用 capture mock 验证含第一个节点 summary
    - _Implements Req 2.1, 2.2, 2.3, 2.4_
  - [x] 9.3 测试用例 4-7：降级、超时、隔离
    - #4 第二节点 LLM 抛错：该节点 `template`，其它节点保持 `llm`，`overallSource: "mixed"`
    - #5 全部节点失败：`overallSource: "template"`
    - #6 旗标关闭：全节点 `template`
    - #7 节点 0 超时不阻塞：节点 1 仍按 LLM 路径完成
    - _Implements Req 2.5, 2.6, 2.7, 4.2, 4.4_
  - [x] 9.4 测试用例 8-10：诊断、schema、串行
    - #8 3 节点全成功：`recordBridgeInvocation("specDocsLlm")` 调用 3 次
    - #9 LLM 返回缺 `tasks` 字段：该节点降级，`fallbackReason` 含 `"schema"`
    - #10 串行验证：mock 计时断言节点 1 仅在节点 0 完成后开始
    - _Implements Req 2.4, 2.6, 4.5_

- [x] 10. checkpoint - 工程基线校验
  - [x] 10.1 运行 `node --run check` 并比对 113 错误基线
    - 运行后记录新错误数；不超过 113 视为通过；超过则定位新代码引入的错误并修复
    - 不允许通过 `// @ts-ignore` / `as any` 伪装通过
    - _Implements Req 6.1, 6.2_
  - [x] 10.2 运行 `npx vitest run` 全量回归
    - 5140+ 既有测试必须全部通过；新增 prompt / derivation / generation / diagnostics 测试一并跑通
    - 失败用例先查是否 `BUILD_TARGET=test` 旗标早退失效，再判断业务错误
    - _Implements Req 6.3_
  - [x] 10.3 ensure all tests pass, ask the user if questions arise

- [ ]* 11. 手动集成 smoke 备忘（仅在具备真实 LLM key 与 Docker 环境时执行）
  - [ ]* 11.1 在 `.kiro/specs/autopilot-llm-spec-generation/` 内整理一份 `manual-smoke.md`
    - 复制 design 中“集成测试（既有 agent-reasoning-bridge.test.ts 扩展）”小节的手动验证条目，附上可执行命令与期望事件序列
    - 保留为可选文档任务，便于后续真实环境复核
    - _Implements Req 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 12. Quality Uplift Wave — 把 spec docs 输出对齐 ai-enabled-sandbox 质量基线
  - [x] 12.1 升级 `buildSpecDocsPrompt` system message
    - 在 `server/routes/blueprint/llm-spec-prompts.ts` 的 `SPEC_DOCS_SYSTEM_MESSAGE` 中追加 "Authoring structure"段落，要求 LLM 输出按 Req 7.1 / 7.2 / 7.3 的章节骨架编写
    - 列出 requirements 章节：`## 简介` / `## 术语表` / `## 需求` / 至少 3 个 `### 需求 N: …` 子块（含 `**用户故事:**` 与 `#### 验收标准`，每条用 EARS 关键词）
    - 列出 design 章节：`## 概述` / `## 架构` / `## 组件与接口` / `## 数据模型` / `## 正确性属性` / `## 错误处理` / `## 测试策略`，要求 `## 架构` 至少嵌一个 ` ```mermaid ` 块、`## 组件与接口` 至少一个 TS interface 块、`## 正确性属性` 至少 3 条带 `**Validates: ...**`
    - 列出 tasks 章节：`# Implementation Plan: <node title>` / `## Overview` / `## Tasks`，至少 3 个 `- [ ] N.` 顶层任务，每条含 `_Requirements: x.y_` 反引用，至少一个 Checkpoint
    - 保持 promptId 不变 (`blueprint.spec-docs-llm.v1`)，因为是 prompt 文本扩张而非 schema 不向后兼容变更；`promptFingerprint` 自动随之刷新
    - _Implements Req 7.4_
  - [x] 12.2 扩展 `BuildSpecDocsPromptInput.outputSchema` 字段说明
    - 在 `buildSpecDocsPrompt` 内的 `userPayload.outputSchema` 由 "string, 1..20000 chars, Markdown" 升级为对象，每个 doc 字段附带 `requiredHeadings: string[]`
    - 增补 `userPayload.exampleOutline` 字段：枚举 requirements / design / tasks 三组必备 H2 / H3 标题列表，引导 LLM 依此组织
    - 字段顺序固定（`promptId / node / parentSummary? / siblingSummaries / primaryRouteSummary / relevantRepoExcerpts? / outputSchema / exampleOutline`），保证 fingerprint 字节稳定
    - _Implements Req 7.4_
  - [x] 12.3 在 `parseSpecDocsLlmResponse` 中增加结构最小集校验
    - 校验 `requirements` 含 `## 简介` 与 `## 需求`；`design` 含 `## 概述` 与 `## 架构`；`tasks` 含 `## Tasks`
    - 任一缺失：返回 `{ ok: false, reason: "structural validation failed: missing <section>" }`，复用既有 zod safeParse 失败的同构降级路径
    - 保留既有 zod 边界校验（1..20000 字符）；结构校验失败与 schema 失败合并为同一 `fallbackReason` 前缀语义 "schema/structural validation failed"
    - _Implements Req 7.6_
  - [x] 12.4 重写 `buildSpecDocumentBody` / `buildSpecDocumentSectionLines` 模板
    - 在 `server/routes/blueprint.ts` 中把现有 6 行占位重写为按 Req 7.5 的多章节骨架
    - 共享一个 `buildStructuredFallbackBody(node, type, primaryRouteSummary, locale)` helper：从 `BlueprintSpecTreeNode.title / summary / dependencies / outputs / priority / type` 派生章节内容
    - requirements 模板：填 `## 简介` / `## 术语表`（基于 dependencies / outputs 列出术语）/ `## 需求` 至少 3 条 EARS 风格 `### 需求 N` 块，缺 LLM 内容时以 `_(Pending LLM enrichment.)_` 占位但保持 H2 / H3 完整
    - design 模板：填 `## 概述` / `## 架构`（含 placeholder ` ```mermaid graph TB ... ``` ` 块，节点用 node.title 与 dependencies 名）/ `## 组件与接口`（提供占位 TS interface stub）/ `## 数据模型` / `## 正确性属性`（至少 3 条占位 + Validates ref）/ `## 错误处理` / `## 测试策略`
    - tasks 模板：填 `# Implementation Plan: <title>` / `## Overview` / `## Tasks` 至少 3 条 `- [ ] N.`，每条 `_Requirements: x.y_`，至少一条 Checkpoint
    - 保留既有 `buildReusableRoleFindingLines` 输出（如有）作为底部尾段
    - 实施变更：`buildSpecDocumentSectionLines` 老 6 行占位辅助函数已删除，避免 dead code 扩大 TS 错误面
    - _Implements Req 7.1, 7.2, 7.3, 7.5_
  - [x] 12.5 抽取 `buildStructuredFallbackBody` 辅助层并共享 zh-CN / en-US 文案
    - H2 / H3 章节标题硬编码在 `buildStructuredFallbackBody` 内：requirements / design 走中文 H2，tasks 保留英文 `# Implementation Plan` / `## Overview` / `## Tasks`（与现有工具兼容）
    - 当前实现按 spec 默认 zh-CN locale，未引入额外 i18n locale 选择参数；后续如需 en-US 路径再扩展（与 Req 7.9 的 zh-CN 主路径一致）
    - 该 helper 既被模板兜底路径使用，又为 LLM 失败后的 fallback 路径产出同形结构
    - _Implements Req 7.9_
  - [x] 12.6 右栏 SPEC 树工作台卡片 body 升级为结构化预览
    - 新增 `client/src/pages/autopilot/right-rail/spec-tree-workbench/specMarkdownPreview.ts`：纯函数 `buildSpecMarkdownPreview(markdown)` 拆首个 H2 + 前 3 行非标题段落
    - 在 `SpecDocPreviewBlock.tsx` 标题 / 摘要下方追加 preview 区块：`firstH2` 显示为加粗小字，3 行段落用 `<ul><li line-clamp-1>` 渲染
    - 不修改受保护文件 `MiroFishCardStream.tsx`
    - 增补 `__tests__/specMarkdownPreview.test.ts` 6 个用例覆盖 undefined / 无 H2 / 多行段落 / 截断 / 列表项 / 立即遇到下个标题
    - _Implements Req 7.7, 7.9_
  - [x] 12.7 兼容性回归与基线核对
    - `node ./node_modules/vitest/vitest.mjs run server/routes/blueprint/spec-documents server/routes/blueprint/__tests__ --config vitest.config.server.ts` → 113/113 passed
    - `node ./node_modules/vitest/vitest.mjs run client/src/pages/autopilot/right-rail/spec-tree-workbench/__tests__` → 26/26 passed
    - `node ./node_modules/vitest/vitest.mjs run server/tests/blueprint-routes.test.ts -t "generates and reads node-level" --config vitest.config.server.ts` → 1/1 passed（更新过的 1772 断言）
    - 同步更新 `server/tests/blueprint-routes.test.ts` 三处旧断言：1772 area `# Requirements:` / `## Derived Content` → `# 需求文档：` / `## 简介` / `## 需求`；4696 area negative assertions 改为针对新章节骨架；4790 area 按 `firstType` 分支断言三类 doc 的对应 H2
    - 同步更新 `server/routes/blueprint/__tests__/spec-docs-llm-generation.test.ts` 中 `makeValidDocsResponse` fixture，让其满足新结构最小集校验
    - `node --run check` → TS 错误数 116（与改动前 116 完全一致）
    - 已知 2 处预先存在失败：`generateSpecDocuments produces LLM-driven content when spec-documents llm is enabled` / `generateSpecDocuments falls back to template when spec-documents llm call throws` 的 `expected 34 to be 33` mock call counter 失败，已通过 `git stash` 验证与本 wave 无关
    - _Implements Req 7.8, 7.10_
  - [x] 12.8 Checkpoint — ensure all tests pass, ask the user if questions arise
    - 关键回归全绿；TS 116 基线不变；Quality Uplift 路径正常工作
    - 2 处预先存在 blueprint-routes mock counter 失败留作单独跟进，不属于本 wave 引入
    - _Implements Req 7.10, 6.3_

## 备注

- 标 `*` 的子任务为可选，仅在希望进一步加固类型安全 / 文档时执行；模型不会在主线实现中触碰这些子任务
- 顶层任务（1-11）均为必做，禁止 `*` 后缀
- 每条任务 `_Implements Req X.Y_` 注释直接对应 `requirements.md` 中的细分 acceptance criteria，便于追溯
- 严格遵循 design 约束：不修改 `agent-reasoning-bridge.ts` / `callback-receiver.ts` / `lite-agent-runtime.ts` / `llm-call.ts` 内部实现，全部通过工厂与 `import type` 接入
- 所有新代码 / JSDoc / 日志 / 错误消息使用中文；schema 字符串字面量与 promptId 保持英文以确保 LLM provider 兼容
- 任务编号顺序与 design `Components and Interfaces` 章节一一对应，便于实施期间快速定位

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "7.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "4.2", "7.2"] },
    { "id": 2, "tasks": ["1.5", "1.6", "4.3"] },
    { "id": 3, "tasks": ["2.1", "3.1"] },
    { "id": 4, "tasks": ["2.2", "2.3", "2.4", "3.2", "3.3"] },
    { "id": 5, "tasks": ["2.5", "2.6", "2.7", "3.4", "3.5", "3.6"] },
    { "id": 6, "tasks": ["5.1"] },
    { "id": 7, "tasks": ["5.2", "5.3"] },
    { "id": 8, "tasks": ["6.1", "6.2"] },
    { "id": 9, "tasks": ["6.3", "6.4"] },
    { "id": 10, "tasks": ["8.1", "9.1"] },
    { "id": 11, "tasks": ["8.2", "8.3", "8.4", "8.5", "9.2", "9.3", "9.4"] },
    { "id": 12, "tasks": ["10.1", "10.2"] },
    { "id": 13, "tasks": ["11.1"] },
    { "id": 14, "tasks": ["12.1", "12.2", "12.3", "12.5"] },
    { "id": 15, "tasks": ["12.4", "12.6"] },
    { "id": 16, "tasks": ["12.7"] },
    { "id": 17, "tasks": ["12.8"] }
  ]
}
```
