# 实施任务：Autopilot Capability Bridge — MCP GitHub Source

## 概述

本任务清单把 design 文档中的 22 步实现大纲收敛为 25 个可验证的代码任务，覆盖：

- `shared/blueprint/contracts.ts` 的 provenance 可选字段扩展（复用 Docker 桥已追加的 `executionMode` / `error`，新增 7 个可选字段）
- `BlueprintServiceContext` 的 4 个可选依赖字段扩展
- `server/routes/blueprint/mcp-github-source/` 下 6 个新模块（policy / url-parser / mcp-request / http-fetcher / summary-derivation / bridge）及其 co-located 单测
- `buildBlueprintServiceContext` 的默认装配
- `server/index.ts` 的主线 `mcpToolAdapter` 与默认 HTTP fetcher 装配（**不改动** `/api/executor/events` 中继链）
- `server/routes/blueprint.ts` 中 `createRouteGenerationSandboxDerivation` 的 mcp-github-source 分支（Docker 桥已改为 async）
- `buildCapabilityEvidence` 的 provenance 继承（与 Docker 桥共用点，仅追加白名单字段）
- `server/tests/blueprint-routes.test.ts` 追加 3 条 E2E（Real-MCP / Real-HTTP / Fallback）
- 最终全量回归

每个任务都对应明确的落点文件、函数与验收标准；所有任务均为本 spec 的必做项，不引入 `*` 可选标记。

依赖顺序：1（契约） → 2（context 字段） → 3、4（policy + 单测） → 5、6（url-parser + 单测） → 7、8（mcp-request + 单测） → 9、10（http-fetcher + 单测） → 11、12（summary-derivation + 单测） → 13（纯模块 checkpoint） → 14、15（bridge 主逻辑 + 单测） → 16（完整子域 checkpoint） → 17（context 默认装配） → 18（server/index.ts 装配） → 19、20（blueprint.ts 改造：分支 / adapter） → 21（evidence 继承） → 22（既有子域回归 checkpoint） → 23（E2E 追加） → 24（SDK 透传） → 25（全量回归 + 最终验收）。

需求 9.3 明确锁定本 spec **不引入 PBT**；所有单测均为 example-based，共 ~28 条 co-located 单测 + 3 条 E2E。

## 任务列表

- [x] 1. 在 `shared/blueprint/contracts.ts` 扩展 provenance 可选字段
  - [x] 1.1 在 `BlueprintCapabilityInvocation.provenance` 类型中追加 7 个可选字段：`executionPath?: "mcp" | "http"`、`repoUrl?: string`、`commitSha?: string`、`fetchedAt?: string`、`defaultBranch?: string`、`apiResponseDigest?: string`、`mcpToolName?: string`;`executionMode` / `error` 由 Docker 桥 spec 追加，本 spec 直接复用；不删除、不重命名、不修改任何既有字段（保留 `jobId` / `projectId` / `sourceId` / `routeSetId` / `routeId` / `specTreeId` / `nodeId` / `roleId` / `targetText` / `githubUrls` 原样）
  - [x] 1.2 在 `BlueprintCapabilityEvidence.provenance` 类型中追加同样 7 个可选字段，与 invocation 侧字段含义、命名、类型严格一致
  - [x] 1.3 在仓库根运行 `node --run check`，确认新增字段不引入新增 TS 错误（历史类型债不应扩大）；同时 grep 既有 `provenance:` 消费点确认没有因字段追加而断言失败
  - _Requirements: 3.4, 3.5, 3.7, 4.2, 4.4, 8.1, 8.3_

- [x] 2. 在 `server/routes/blueprint/context.ts` 扩展 `BlueprintServiceContext` 依赖字段
  - [x] 2.1 在 `BlueprintServiceContext` 与 `BlueprintServiceContextDeps` 上追加 4 个可选字段：`mcpToolAdapter?: McpToolAdapterDependency`、`httpFetcher?: BlueprintHttpFetcher`、`mcpGithubCapabilityPolicy?: McpGithubCapabilityPolicy`、`mcpGithubCapabilityBridge?: McpGithubCapabilityBridge`
  - [x] 2.2 `McpToolAdapterDependency` 接口只暴露 `execute(request: McpToolExecutionRequest): Promise<McpToolExecutionResult>`;类型从 `server/tool/api/mcp-tool-adapter.ts` 仅 `import type`，不 import 类本身或单例
  - [x] 2.3 保持向后兼容：`buildBlueprintServiceContext(deps)` 在 `deps` 未提供这些字段时仍能构造出合法 Context，既有单测与 E2E 无感知（字段默认装配在任务 17 中处理，本任务只保证"类型可选且不传也不崩"）
  - [x] 2.4 运行 `node --run check` 确认类型扩展未引入新 TS 错误
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.2_

- [x] 3. 新建 `server/routes/blueprint/mcp-github-source/policy.ts`
  - [x] 3.1 按 design §4.3 定义并导出 `McpGithubCapabilityPolicy` 接口（字段：`allowedHttpOrigins` / `requireHttps` / `maxResponseBodyBytes` / `maxInvocationTimeoutMs` / `mcpToolName` / `mcpServerId` / `maxLogLines` / `maxLogBytes` / `redactionKeywords` / `redactedEmailPattern` / `redactedGithubPatPattern`）
  - [x] 3.2 导出 `createDefaultMcpGithubCapabilityPolicy()`，默认值按 design §2.D8：`allowedHttpOrigins: ["https://api.github.com"]` / `requireHttps: true` / `maxResponseBodyBytes: 1_048_576` / `maxInvocationTimeoutMs: 30_000` / `mcpToolName: "github.get_repository"` / `mcpServerId: "github"` / `maxLogLines: 50` / `maxLogBytes: 10_240` / `redactionKeywords: ["authorization","x-github-token","token","api_key","apikey","secret","password","bearer","access_token"]` / PAT 与 email 正则按 design
  - [x] 3.3 导出 `checkMcpGithubHttpPolicy(policy, url): { allowed: boolean; reason?: string }`：按 design §4.3 规则表实现（`new URL(url)` 解析失败 → `"invalid url"`；scheme 非 https → `"https required"`；origin 不在 allow-list → `"allow-list rejected"`）;allow-list 比较采用 `url.origin === allowedOrigin`，拒绝 substring 前缀攻击
  - [x] 3.4 导出 `applyMcpGithubCapabilityRedaction(value: string, policy): string`：纯函数实现，覆盖 GitHub PAT 替换、email 替换、`redactionKeywords` 的 key:value 对替换（case-insensitive），无外部依赖
  - [x] 3.5 导出 `redactMcpArguments(args, policy): Record<string, unknown>`：浅层 key 遍历；敏感 key 整值置 `"[redacted]"`，string value 走 `applyMcpGithubCapabilityRedaction`
  - [x] 3.6 支持环境变量覆盖 `maxInvocationTimeoutMs`（`BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS`）；未设置时使用默认值 30_000
  - _Requirements: 2.4, 7.1, 7.2, 7.3, 7.4_

- [x] 4. 新建 `server/routes/blueprint/mcp-github-source/policy.test.ts`
  - [x] 4.1 `checkMcpGithubHttpPolicy`：默认 policy 接受 `https://api.github.com/repos/a/b`;拒绝 `http://api.github.com/repos/a/b` 并返回 `reason: "https required"`;拒绝 `https://evil.example/...` 并返回 `reason: "allow-list rejected"`;拒绝 `"not a url"` 并返回 `reason: "invalid url"`
  - [x] 4.2 `applyMcpGithubCapabilityRedaction`：替换 `Authorization: Bearer ghp_xxx` 中的 value 为 `[redacted]`;替换形如 `ghp_` 前缀 + 36 位 base62 的 token 为 `[redacted-github-token]`;替换 email 为 `[redacted-email]`
  - [x] 4.3 `redactMcpArguments`：对 `{token: "abc", owner: "foo"}` 返回 `{token: "[redacted]", owner: "foo"}`;对 `{owner: "foo", repo: "bar"}` 原样返回
  - [x] 4.4 断言 `createDefaultMcpGithubCapabilityPolicy()` 返回值的每个字段与 design §2.D8 默认值严格一致
  - [x] 4.5 断言 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS=15000` 环境变量覆盖生效（使用 `vi.stubEnv` 或等价机制）
  - _Requirements: 2.4, 7.1, 7.2, 7.4, 9.2_

- [x] 5. 新建 `server/routes/blueprint/mcp-github-source/url-parser.ts`
  - [x] 5.1 按 design §4.4 定义并导出 `parseGithubUrl(raw: string): { owner: string; repo: string } | null` 纯函数：必须通过 `new URL(raw)` 解析;host 必须是 `github.com` 或 `www.github.com`;path segments 至少有 `[owner, repo]` 两段;`repo` 尾部去 `.git` 后缀;`owner` 在系统入口黑名单（`orgs`、`marketplace`、`features`）时返回 `null`;不满足任一规则返回 `null`;scheme 校验留给 policy 层（不在 url-parser 内耦合）
  - [x] 5.2 导出 `buildGithubRepoApiUrl(ownerRepo, options?: { apiBase?: string }): string`:默认 `apiBase` 为 `"https://api.github.com"`;返回 `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  - [x] 5.3 **禁止** 在本文件 `import` 任何 HTTP 客户端或 undici;纯函数 only
  - _Requirements: 2.5, 2.6, 7.1_

- [x] 6. 新建 `server/routes/blueprint/mcp-github-source/url-parser.test.ts`
  - [x] 6.1 `parseGithubUrl("https://github.com/owner/repo")` → `{owner: "owner", repo: "repo"}`
  - [x] 6.2 `parseGithubUrl("https://github.com/owner/repo.git")` → `{owner: "owner", repo: "repo"}`（去 `.git` 后缀）
  - [x] 6.3 `parseGithubUrl("https://github.com/owner/repo/tree/main")` → `{owner: "owner", repo: "repo"}`（忽略尾部 path）
  - [x] 6.4 `parseGithubUrl("https://github.com/orgs/foo")` → `null`（系统入口黑名单）
  - [x] 6.5 `parseGithubUrl("not a url")` → `null`;`parseGithubUrl("https://github.com/owner")` → `null`（缺 repo）
  - [x] 6.6 `buildGithubRepoApiUrl({owner: "a", repo: "b"})` → `"https://api.github.com/repos/a/b"`;自定义 `apiBase` 生效
  - _Requirements: 2.5, 9.2_

- [x] 7. 新建 `server/routes/blueprint/mcp-github-source/mcp-request.ts`
  - [x] 7.1 按 design §4.5 / §2.D9 定义并导出 `BuildMcpToolRequestInput`（`bridgeInput` / `policy` / `ownerRepo` / `remainingTimeoutMs`）与 `buildMcpToolRequest(input): McpToolExecutionRequest` 纯函数
  - [x] 7.2 字段填充：`serverId: policy.mcpServerId`、`toolName: policy.mcpToolName`、`input: Inspect GitHub repository ${owner}/${repo} for route ${routeId}.`、`arguments: { owner, repo }`、`context: []`、`workflowId: undefined`、`stage: "route_generation"`、`metadata: { bridge: "blueprint-mcp-github-capability-bridge", invocationId, jobId, routeId }`、`agentId: bridgeInput.roleId`、`token: undefined`、`timeoutMs: Math.min(remainingTimeoutMs, 30_000)`、`requireApproval: false`
  - [x] 7.3 **禁止** 在本文件 `import { McpToolAdapter }` / `InternalMcpToolInvoker`;`McpToolExecutionRequest` 类型从 `server/tool/api/mcp-tool-adapter.ts` 仅 `import type`
  - _Requirements: 2.3, 7.4_

- [x] 8. 新建 `server/routes/blueprint/mcp-github-source/mcp-request.test.ts`
  - [x] 8.1 断言 `buildMcpToolRequest(...)` 的 `serverId === policy.mcpServerId`、`toolName === policy.mcpToolName`;断言 `arguments` 等于 `{owner, repo}` 且不含 `token` / 其它键
  - [x] 8.2 断言 `timeoutMs = min(remainingTimeoutMs, 30_000)`（例如 remaining=45_000 → clamp 到 30_000）
  - [x] 8.3 断言 `agentId === bridgeInput.roleId`、`metadata.bridge === "blueprint-mcp-github-capability-bridge"`、`metadata.invocationId` / `jobId` / `routeId` 透传
  - _Requirements: 2.3, 9.2_

- [x] 9. 新建 `server/routes/blueprint/mcp-github-source/http-fetcher.ts`
  - [x] 9.1 按 design §4.6 定义并导出 `BlueprintHttpFetcher` 接口（`fetch(url, options?: { timeoutMs?, headers?, signal? }): Promise<BlueprintHttpResponse>`）、`BlueprintHttpResponse` 类型（`status` / `statusText?` / `headers` / `body` / `finalUrl`）、`McpGithubFetcherError`（`kind: "timeout" | "network" | "non_2xx" | "body_too_large" | "invalid_url"`）
  - [x] 9.2 导出 `createDefaultBlueprintHttpFetcher(options: { maxResponseBodyBytes, defaultTimeoutMs }): BlueprintHttpFetcher`:基于 `undici.fetch` 的薄包装;强制 https（非 https URL 抛 `invalid_url`）;通过 `AbortController` + `setTimeout` 实现超时;响应 body 流式读取，累计字节超过 `maxResponseBodyBytes` 立即 `controller.abort()` 并抛 `body_too_large`;HTTP status 非 2xx 抛 `non_2xx`;网络错误抛 `network`
  - [x] 9.3 请求 header 白名单：仅允许 `Accept` / `User-Agent` 等非敏感 header 透传;**不接受** `Authorization` / `Cookie` / `X-GitHub-Token` 等敏感 header（fetcher 内部显式过滤）
  - [x] 9.4 `finalUrl` 取 `response.url`（标准 fetch 行为）;若 redirect 后的 URL 非 https 抛 `invalid_url`
  - [x] 9.5 **本文件是整个 bridge 代码树内唯一允许 `import { fetch } from "undici"` 的文件**;`bridge.ts` 内 SHALL NOT `import` `undici`;装配点在 `server/index.ts` 的 composition root 或测试 `buildBlueprintServiceContext({ httpFetcher: ... })`
  - _Requirements: 2.3, 2.4, 7.1, 7.2, 7.3_

- [x] 10. 新建 `server/routes/blueprint/mcp-github-source/http-fetcher.test.ts`
  - [x] 10.1 使用 `undici` 的 `MockAgent` 或本地 http server 构造 fake 上游:正常 200 + 小 body → 返回 `{status: 200, body, finalUrl}`;断言 response body 内容一致
  - [x] 10.2 body 超过 `maxResponseBodyBytes` 阈值 → 抛 `McpGithubFetcherError({ kind: "body_too_large" })`;断言上游流被及时 abort
  - [x] 10.3 上游 delay 超过 `timeoutMs` → 抛 `McpGithubFetcherError({ kind: "timeout" })`
  - [x] 10.4 非 https URL（`http://...`）→ 抛 `McpGithubFetcherError({ kind: "invalid_url" })`;上游 404 / 500 → 抛 `McpGithubFetcherError({ kind: "non_2xx" })`
  - _Requirements: 2.4, 7.1, 7.3, 9.2_

- [x] 11. 新建 `server/routes/blueprint/mcp-github-source/summary-derivation.ts`
  - [x] 11.1 按 design §4.7 定义 `GithubRepoMetadata` 类型（`name?` / `fullName?` / `description?` / `language?` / `defaultBranch?` / `stargazersCount?` / `pushedAt?` / `htmlUrl?` / `visibility?`）
  - [x] 11.2 导出 `extractGithubMetadataFromJson(body: string): GithubRepoMetadata | null`:`JSON.parse` body；解析失败返回 `null`;从 GitHub REST `/repos/{owner}/{repo}` 响应字段 `name` / `full_name` / `description` / `language` / `default_branch` / `stargazers_count` / `pushed_at` / `html_url` / `visibility` 映射；**只取白名单字段**，不取 `owner.email` / `owner.url` 等敏感字段
  - [x] 11.3 导出 `extractGithubMetadataFromMcpResult(result): GithubRepoMetadata | null`:首试 `result.response` 为对象时按 GitHub REST 字段映射；降级 1：`result.response` 为 string 尝试 `JSON.parse`；降级 2：`result.output` 为 string 尝试 `JSON.parse`;都失败返回 `null`
  - [x] 11.4 导出 `deriveGithubOutputSummary(metadata, policy): string`:模板 `repo {fullName} · {language ?? "unknown"} · {stargazersCount ?? 0}★ · default branch {defaultBranch ?? "main"} · last pushed {pushedAt ?? "unknown"}`;返回前经 `applyMcpGithubCapabilityRedaction` 二次脱敏
  - [x] 11.5 导出 `sha256Digest(text: string): string`:使用 `node:crypto` 的 `createHash("sha256")`;返回 64 字符 hex lowercase
  - [x] 11.6 导出 `extractCommitShaFromEtag(etag: string | undefined): string | undefined`:从 GitHub REST 的 `etag` 响应头（形如 `W/"<sha1>"` 或 `"<sha1>"`）提取 sha1;非 hex 内容或 `undefined` 返回 `undefined`
  - _Requirements: 3.3, 3.5, 7.4_

- [x] 12. 新建 `server/routes/blueprint/mcp-github-source/summary-derivation.test.ts`
  - [x] 12.1 `extractGithubMetadataFromJson` 正确解析一段真实 shape 的 GitHub REST response JSON;断言每个白名单字段被映射
  - [x] 12.2 `extractGithubMetadataFromMcpResult` 对 `result.response` 为对象、为 string、为 `undefined` 三种场景各一条断言
  - [x] 12.3 `deriveGithubOutputSummary` 模板渲染包含 `fullName` / `language` / `stargazersCount` / `defaultBranch` / `pushedAt`;缺失字段用默认值
  - [x] 12.4 `sha256Digest("hello")` 返回确定的 hex 摘要;`extractCommitShaFromEtag('W/"abc123"')` → `"abc123"`;`extractCommitShaFromEtag(undefined)` → `undefined`
  - _Requirements: 3.3, 3.5, 9.2_

- [x] 13. Checkpoint — 跑通子域 policy / url-parser / mcp-request / http-fetcher / summary-derivation 纯模块单测
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/mcp-github-source/policy.test.ts server/routes/blueprint/mcp-github-source/url-parser.test.ts server/routes/blueprint/mcp-github-source/mcp-request.test.ts server/routes/blueprint/mcp-github-source/http-fetcher.test.ts server/routes/blueprint/mcp-github-source/summary-derivation.test.ts`，确认 ~23 条单测全部通过;若失败必须修复对应模块后再继续。同时跑 `node --run check` 确认此时仓库无新增类型错误。
  - _Requirements: 9.2, 9.3_

- [x] 14. 新建 `server/routes/blueprint/mcp-github-source/bridge.ts`
  - [x] 14.1 按 design §4.2 定义并导出 `McpGithubCapabilityBridgeInput`（`capability` / `route` / `jobId` / `request` / `routeSet` / `createdAt` / `invocationId` / `roleId`）、`McpGithubCapabilityBridgeOutput`（`invocation` / `executionPath?: "mcp" | "http"` / `additionalEvents`）、`McpGithubCapabilityBridge` 类型别名
  - [x] 14.2 导出工厂 `createMcpGithubCapabilityBridge(ctx: BlueprintServiceContext): McpGithubCapabilityBridge`;按 design §4.8 伪代码实现三段式降级主算法 7 步：早退（`ENABLED !== "true"` 且两条路径都未注入 → fallback）→ URL 解析（`parseGithubUrl` null → fallback `"no github url"`）→ 建立整体超时预算 → MCP 路径（若 adapter 可用）→ 预算检查 → HTTP 路径（若 fetcher 可用）→ 都失败 fallback
  - [x] 14.3 按 design §4.9.1 实现 `buildRealMcpOutput`：填充 `durationMs`（墙钟毫秒）/ `logs`（`buildMcpPathLogs` 脱敏后）/ `outputSummary`（来自 `extractGithubMetadataFromMcpResult` + `deriveGithubOutputSummary`；metadata 为 null 时降级到中性 summary）/ `requestedBy: "mcp-github-capability-bridge"` / `safetyGate.reason: "{label} approved for real MCP execution via {mcpToolName}."` / `provenance.executionMode: "real"` / `provenance.executionPath: "mcp"` / `provenance.repoUrl / fetchedAt / defaultBranch / mcpToolName`;`commitSha` 从 `mcpResult.response.commit_sha` / `latest_commit_sha` 提取;`apiResponseDigest` V1 不填充（MCP result shape 不稳定）
  - [x] 14.4 按 design §4.9.2 实现 `buildRealHttpOutput`：填充 `durationMs` / `logs`（`buildHttpPathLogs` 脱敏后）/ `outputSummary`（来自 `extractGithubMetadataFromJson` + `deriveGithubOutputSummary`）/ `requestedBy: "mcp-github-capability-bridge"` / `safetyGate.reason: "{label} approved for real HTTP execution via GitHub REST API."` / `provenance.executionMode: "real"` / `provenance.executionPath: "http"` / `provenance.repoUrl / fetchedAt / defaultBranch` / `apiResponseDigest: sha256Digest(body)` / `commitSha: extractCommitShaFromEtag(response.headers.etag)` / `mcpToolName: undefined`
  - [x] 14.5 按 design §4.10 实现 `buildFallbackOutput(input, { reason })`：调用既有 `buildCapabilityOutputSummary()` / `buildCapabilityInvocationLogs()` / `deterministicCapabilityDuration()` 产出模板化字段;`requestedBy: "route-generation-sandbox-derivation"` 保留今日值;`provenance.executionMode: "simulated_fallback"` + `provenance.executionPath: undefined` + `provenance.error: truncate(reason, 400)`
  - [x] 14.6 三段式降级语义：MCP 成功 → 直接返回 real-MCP，不填 `provenance.error`;MCP 失败（异常或 `status !== "completed"`）+ HTTP 成功 → 返回 real-HTTP，**不填** `provenance.error`（中间成功降级不留噪音，需求 4.6）;MCP 失败 + HTTP 失败 → fallback，`provenance.error` 合并两端原因并 truncate 到 400 字符;URL 被 policy 拒绝 / body 超限 / 超时等场景按 design §4.8 表格填充对应 `error`
  - [x] 14.7 日志级别：未配置场景使用 `ctx.logger.debug(...)`（dev 日常降噪）;MCP 路径失败但 HTTP 接管成功使用 `ctx.logger.debug(...)`（中间降级不刷 warn）;两条路径都失败 / policy 拒绝 / 整体超时使用 `ctx.logger.warn(...)` 并携带 `error` / `capabilityId` / `jobId` 上下文
  - [x] 14.8 **禁止** `import { McpToolAdapter, InternalMcpToolInvoker } from "../../../tool/api/mcp-tool-adapter.js"`、**禁止** `new McpToolAdapter(...)` 自己装配执行器、**禁止** `import { fetch } from "undici"` 或模块级 `fetch()`、**禁止** `import "node-fetch"` / `"got"`;所有 MCP / HTTP 能力必须通过 `ctx.mcpToolAdapter` / `ctx.httpFetcher` / `ctx.mcpGithubCapabilityPolicy` 注入
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.5, 4.6, 6.1, 6.2, 7.1, 7.4, 7.5, 7.6_

- [x] 15. 新建 `server/routes/blueprint/mcp-github-source/bridge.test.ts`
  - [x] 15.1 **Happy MCP path**（需求 9.2 happy）：注入 fake `mcpToolAdapter`（`execute` 返回 `{ok: true, status: "completed", response: {name, full_name, default_branch, stargazers_count, pushed_at, html_url, language, visibility, commit_sha}, output, metadata}`）+ `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED=true`;断言 `output.executionPath === "mcp"` + `output.invocation.provenance.executionMode === "real"` + `mcpToolName === "github.get_repository"` + `repoUrl === "https://github.com/{owner}/{repo}"` + `commitSha` 填充 + `defaultBranch === "main"` + `durationMs > 0` + `outputSummary` 包含 `full_name` 和 `language`
  - [x] 15.2 **Happy HTTP path**（需求 9.2 happy 第二条）：不注入 mcp，注入 fake `httpFetcher`（返回 200 + GitHub REST JSON body + ETag header）;断言 `output.executionPath === "http"` + `provenance.executionMode === "real"` + `repoUrl` 填充 + `apiResponseDigest` 匹配 `/^[a-f0-9]{64}$/` + `commitSha` 从 ETag 提取 + `defaultBranch === "main"` + `mcpToolName === undefined`
  - [x] 15.3 **MCP fails, HTTP succeeds**：fake `mcpToolAdapter.execute` 抛错 + fake `httpFetcher` 返回成功;断言 `output.executionPath === "http"` + `provenance.executionMode === "real"` + `provenance.error === undefined`（中间成功降级不留噪音，需求 4.6）+ `ctx.logger.debug` 被调用
  - [x] 15.4 **Both fail → fallback**（需求 9.2 timeout/error）：fake mcp 抛错 + fake fetcher 抛 `McpGithubFetcherError({ kind: "timeout" })`;断言 `output.executionPath === undefined` + `provenance.executionMode === "simulated_fallback"` + `provenance.error` 同时包含 `"http:"` 和 `"mcp:"` 两段;断言 `outputSummary` / `logs` / `durationMs` 与 `buildCapabilityOutputSummary` / `buildCapabilityInvocationLogs` / `deterministicCapabilityDuration` 产出完全一致
  - [x] 15.5 **Unreachable/missing**（需求 9.2 unreachable）：`mcpToolAdapter` / `httpFetcher` 均未注入 + `ENABLED=true` → `provenance.error === "bridge not configured"`;或 `githubUrls: []` → `provenance.error === "no github url"`;或 `githubUrls: ["https://evil.example/foo"]` + 仅注入 fetcher → `provenance.error` 匹配 `/allow-list rejected|no github url/`（`parseGithubUrl` 会把非 github host 判为 null → `"no github url"`）
  - [x] 15.6 所有 5 条单测均不启动真实 MCP 工具、不发真实 HTTP 请求，完全通过 fake ctx 驱动;不依赖外网，不依赖真实 MCP 工具目录
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.5, 4.6, 6.4, 6.5, 9.2_

- [x] 16. Checkpoint — 跑通完整 mcp-github-source 子域测试
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/mcp-github-source/`，确认 ~28 条单测（6 policy + 6 url-parser + 3 mcp-request + 4 http-fetcher + 4 summary-derivation + 5 bridge）全部通过;此 checkpoint 保证 mcp-github bridge 核心实现在接入外层之前已稳定。
  - _Requirements: 9.2, 9.3_

- [x] 17. 在 `buildBlueprintServiceContext` 中默认装配 bridge 与 policy
  - [x] 17.1 在 `server/routes/blueprint/context.ts` 的 `buildBlueprintServiceContext(deps)` 中：若 `deps.mcpGithubCapabilityPolicy` 未提供，调用 `createDefaultMcpGithubCapabilityPolicy()` 挂到 ctx 上;若 `deps.mcpGithubCapabilityBridge` 未提供，调用 `createMcpGithubCapabilityBridge(ctx)` 构造默认实例挂到 ctx 上
  - [x] 17.2 保持向后兼容：`deps.mcpToolAdapter` 为 `undefined` 时 ctx 上 `mcpToolAdapter` 仍为 `undefined`;`deps.httpFetcher` 为 `undefined` 时 ctx 上 `httpFetcher` 仍为 `undefined`;bridge 内部会据此早退 fallback（不强行装配默认 fetcher 或 mcp adapter，避免在 dev 默认装配下拖慢响应或触发外网）
  - [x] 17.3 新增字段的装配顺序：先解析 `logger` / `now`，再装配 `mcpGithubCapabilityPolicy`（纯数据），最后装配 `mcpGithubCapabilityBridge`（依赖前两者 + 可选 `mcpToolAdapter` / `httpFetcher`）;顺序相对 Docker 桥的 executorCallbackDispatcher / dockerCapabilityPolicy / dockerCapabilityBridge 后，互不影响
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.2_

- [x] 18. 在 `server/index.ts` 装配主线 `mcpToolAdapter` 与可选默认 HTTP fetcher
  - [x] 18.1 若环境变量 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED === "true"`：把主线已装配的 `mcpToolAdapter` 实例（对应 `/api/mcp` 主线执行入口，`server/index.ts` 已装配的 `McpToolAdapter` 单例）以 `McpToolAdapterDependency` 形状传入 `buildBlueprintServiceContext({ mcpToolAdapter: existingInstance })`;不新建第二个 `McpToolAdapter`，也不持有模块级并行单例
  - [x] 18.2 可选装配 `createDefaultBlueprintHttpFetcher({ maxResponseBodyBytes: 1_048_576, defaultTimeoutMs: 30_000 })`，通过 `httpFetcher` 字段传入 `buildBlueprintServiceContext`;环境变量未设或为其它值时 `httpFetcher` 保持 `undefined`，bridge 自动降级到 fallback
  - [x] 18.3 **不改动** `/api/executor/events` 中继链：本 spec 与 Docker 桥不同，没有 callback dispatcher，不需要追加 blueprint dispatcher 中间件;design §2.D11 / 7.5 已明确
  - [x] 18.4 **不新增路由**、**不改动** `/api/mcp` 主线执行入口;本 spec 只消费既有 `mcpToolAdapter.execute(request)` 能力
  - _Requirements: 1.8, 2.2, 6.1, 6.2, 6.3_

- [x] 19. 改造 `createRouteGenerationSandboxDerivation` 的 capability 分支：新增 mcp-github-source 分支
  - [x] 19.1 在 `server/routes/blueprint.ts` 中 `createRouteGenerationSandboxDerivation` 的 capability map 循环内（Docker 桥 spec 已改为 async）：在 `capability.id === "docker-analysis-sandbox"` 分支之后，新增 `capability.id === "mcp-github-source" && ctx.mcpGithubCapabilityBridge` 分支，调用 `await ctx.mcpGithubCapabilityBridge({ capability, route, jobId, request, routeSet, createdAt, invocationId, roleId: invocationRoleId })` 并返回 `{ invocation: bridgeResult.invocation, executionPath: bridgeResult.executionPath }`
  - [x] 19.2 其它 capability（`aigc-spec-node` / `role-system-architecture` / `skill-svg-architecture`）分支**一行不改**：继续走 `buildCapabilityOutputSummary` / `buildCapabilityInvocationLogs` / `deterministicCapabilityDuration` 模板化组合
  - [x] 19.3 `ctx.mcpGithubCapabilityBridge` 未注入时（理论上任务 17 默认装配后不会出现）走 else 分支（与其它 capability 相同的模板化代码），保证 ctx 无 bridge 也不崩
  - [x] 19.4 `invocationId = createId("blueprint-capability-invocation")` 保持由外层生成（Docker 桥 spec 已实现），本 spec 沿用;real / fallback 两条路径共享同一 id
  - _Requirements: 1.1, 1.7, 2.1, 4.1, 4.3_

- [x] 20. 改造 `createRouteGenerationSandboxDerivation` 的 event payload：adapter 切换与新 provenance 字段透传
  - [x] 20.1 在 `createRouteGenerationSandboxDerivation` 聚合完 invocations 之后，针对 mcp-github capability 提取真实 adapter：`const mcpGithubResult = invocations.find(({invocation}) => invocation.capabilityId === "mcp-github-source"); const mcpGithubAdapter = mcpGithubResult?.executionPath === "mcp" ? "blueprint.runtime.mcp.github.real" : mcpGithubResult?.executionPath === "http" ? "blueprint.runtime.mcp.github.http" : capability.adapter;`
  - [x] 20.2 在 `sandbox.job.started` / `sandbox.job.completed` / `sandbox.job.failed` 事件 payload 中，对应 mcp-github capability 的 `adapter` 字段使用 `mcpGithubAdapter`;trace `server/routes/blueprint.ts` 第 2940 / 3088 / 3091 行附近 event payload 构造代码并精确补丁
  - [x] 20.3 在 `capability.invoked` / `capability.completed` / `evidence.recorded` 事件 payload 中追加可选字段：`executionMode`、`executionPath?`、`repoUrl?`、`mcpToolName?`、`error?`（从对应 invocation.provenance 透传）;**所有事件 `type` 仍通过 `BlueprintEventName` 常量构造，不出现裸字符串字面量**（需求 5.6）
  - [x] 20.4 `getDefaultRuntimeCapabilities()` 本身**不改**（mcp-github capability adapter 仍为 `"blueprint.runtime.mcp.github.simulated"` 作为 fallback 基线），保证既有 47 条 E2E 继续通过
  - _Requirements: 3.4, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 8.1, 8.2_

- [x] 21. 改造 `buildCapabilityEvidence` 继承 invocation 的新 provenance 字段
  - [x] 21.1 在 `buildCapabilityEvidence({ invocation, ... })` 内部，读取 `invocation.provenance.executionMode / executionPath / repoUrl / commitSha / fetchedAt / defaultBranch / apiResponseDigest / mcpToolName / error` 并原样回填到 evidence 的 `provenance` 对应字段;Docker 桥 spec 已追加 `executionMode / containerId / artifactUrl / logDigest / error` 白名单，本 spec 追加 6 个新字段到同一白名单
  - [x] 21.2 保证既有 evidence provenance 字段（`jobId` / `projectId` / `routeSetId` / `routeId` 等）一行不改，只追加 6 个可选字段的透传
  - [x] 21.3 real 路径下 evidence 的 `summary` 字段从 `invocation.outputSummary` 派生（与今天 simulated 路径同源），而不是新增独立 summary 生成器;保证需求 3.5 要求的"evidence summary 由真实仓库元数据派生"在不改 summary builder 的前提下成立
  - _Requirements: 3.5, 3.7, 4.2, 4.4, 8.3_

- [x] 22. Checkpoint — 跑既有 47 E2E + 48 条子域单测确认未回归
  - 在仓库根运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint --exclude "server/routes/blueprint/mcp-github-source/**" --exclude "server/routes/blueprint/docker-analysis-sandbox/**"`，确认既有 48 条子域 co-located 单测（handoff / spec-documents / artifact-memory / agent-crew 等）继续通过;同时跑 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` 确认既有 47 条 E2E（Docker 桥 spec 已追加 2 条，当前基线 45 + 2 = 47）继续通过;若失败说明外层改造（任务 19-21）破坏了 invocation / evidence 字段形态等价性（需求 3.7 / 4.3），必须回到对应任务修复。
  - _Requirements: 3.7, 4.3, 8.2, 9.4_

- [x] 23. 在 `server/tests/blueprint-routes.test.ts` 追加 3 条 E2E 用例
  - [x] 23.1 追加 **Real-MCP path** 用例（需求 9.1a）：通过 `buildBlueprintServiceContext({ mcpToolAdapter: fakeMcp })` 注入 fake MCP 适配器（`execute` 返回 `{ok: true, status: "completed", response: {name: "dashboard", full_name: "example/dashboard", language: "TypeScript", default_branch: "main", stargazers_count: 42, pushed_at: "2026-04-01T00:00:00Z", html_url: "https://github.com/example/dashboard", visibility: "public", commit_sha: "abc123def456"}, output, metadata: {serverId: "github", toolName: "github.get_repository", timeoutMs: 30000}}`）;`process.env.BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED = "true"`;`POST /api/blueprint/jobs` 带 `githubUrls: ["https://github.com/example/dashboard"]`;断言对应 `mcp-github-source` invocation 的 `provenance.executionMode === "real"`、`provenance.executionPath === "mcp"`、`provenance.mcpToolName === "github.get_repository"`、`provenance.repoUrl === "https://github.com/example/dashboard"`、`provenance.defaultBranch === "main"`、`provenance.commitSha === "abc123def456"`、`provenance.error` 为 `undefined`、`durationMs` 不等于 `deterministicCapabilityDuration` 产出、`outputSummary` 包含 `"example/dashboard"` 和 `"TypeScript"`;断言对应 capability 的 `adapter === "blueprint.runtime.mcp.github.real"` 且不含 `.simulated` 子串
  - [x] 23.2 追加 **Real-HTTP path** 用例（需求 9.1b）：通过 `buildBlueprintServiceContext({ httpFetcher: fakeFetcher })` 注入 fake fetcher（返回 `{status: 200, body: JSON.stringify({name, full_name: "example/dashboard", default_branch: "main", ...}), headers: {"content-type": "application/json", etag: 'W/"abc123def4567890..."'}, finalUrl: "https://api.github.com/repos/example/dashboard"}`）**不注入 mcpToolAdapter**;`process.env.BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED = "true"`;`POST /api/blueprint/jobs`;断言对应 invocation 的 `provenance.executionMode === "real"`、`provenance.executionPath === "http"`、`provenance.repoUrl` 填充、`provenance.fetchedAt` 匹配 `/^\d{4}-\d{2}-\d{2}T/`、`typeof provenance.apiResponseDigest === "string"` 且匹配 `/^[a-f0-9]{64}$/`、`provenance.commitSha` 从 ETag 提取、`provenance.mcpToolName === undefined`、`provenance.error === undefined`;断言对应 capability 的 `adapter === "blueprint.runtime.mcp.github.http"` 且不含 `.simulated` 子串
  - [x] 23.3 追加 **Fallback path** 用例（需求 9.1c）：`buildBlueprintServiceContext({ httpFetcher: throwingFetcher })`（`fetch` 抛 `new McpGithubFetcherError("upstream 500", "non_2xx")`）**不注入 mcpToolAdapter**;`process.env.BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED = "true"`;`POST /api/blueprint/jobs`;断言对应 invocation 的 `provenance.executionMode === "simulated_fallback"`、`provenance.executionPath === undefined`、`provenance.error` 包含 `"http:"`、`durationMs` 等于 `deterministicCapabilityDuration` 产出、`outputSummary` 来自 `buildCapabilityOutputSummary` 模板、`logs` 来自 `buildCapabilityInvocationLogs` 模板;断言对应 capability 的 `adapter === "blueprint.runtime.mcp.github.simulated"`
  - [x] 23.4 三条用例共用一个 fake MCP adapter + fake fetcher helper（建议落在测试文件顶部或独立 `test-helpers/fake-mcp-github-bridge.ts`），覆盖 `execute` / `fetch` / 抛错 4 个分支;helper 不依赖真实 MCP 工具目录 / 不依赖外网
  - [x] 23.5 用例 setup / teardown 正确清理 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_ENABLED` 环境变量与临时 `specsRoot` 目录，避免污染其它用例
  - [x] 23.6 **不改写** `server/tests/blueprint-routes.test.ts` 中原有 47 条 E2E 用例的任一断言（需求 9.4 / 1.9）;仅以追加方式补 3 条（对应 Docker 桥 spec 的 +2 条之后，累计 47 + 3 = 50 条）
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.2, 4.3, 4.4, 9.1, 9.4_

- [x] 24. 确认 SDK normalizer 支持新 provenance 字段
  - [x] 24.1 检查 `client/src/lib/blueprint-api.ts` 与 `client/src/lib/blueprint-api/` 目录下是否存在 capability invocation / evidence provenance 的显式 normalizer
  - [x] 24.2 如使用对象 spread 或透明透传：确认无需改动，仅运行 SDK smoke 验证 7 个新字段（`executionPath` / `repoUrl` / `commitSha` / `fetchedAt` / `defaultBranch` / `apiResponseDigest` / `mcpToolName`）能到达客户端
  - [x] 24.3 如使用显式字段映射：追加 7 行可选字段透传到 invocation provenance normalizer，同样追加 7 行到 evidence provenance normalizer;**不得** 修改任一既有字段映射行为，**不得** 为新字段默认值或类型强制（保持 `string | undefined`）
  - [x] 24.4 运行 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` 确认既有 9 条 SDK smoke 继续通过
  - _Requirements: 5.7, 8.3_

- [x] 25. 执行全量回归并完成最终验收
  - [x] 25.1 `node --run check` → 不应引入新增 TS 错误（若仓库已有历史类型债，新增改动不应扩大错误面）
  - [x] 25.2 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/tests/blueprint-routes.test.ts` → 47 + 3 = 50 条通过（Docker 桥已追加 2 条到 45 基线得到 47，本 spec 再追加 3 条）
  - [x] 25.3 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint/mcp-github-source/` → ~28 条新增 co-located 单测通过（6 policy + 6 url-parser + 3 mcp-request + 4 http-fetcher + 4 summary-derivation + 5 bridge）
  - [x] 25.4 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts server/routes/blueprint --exclude "server/routes/blueprint/mcp-github-source/**" --exclude "server/routes/blueprint/docker-analysis-sandbox/**"` → 48 条既有子域单测继续通过
  - [x] 25.5 `node ./node_modules/vitest/vitest.mjs run --config vitest.config.server.ts client/src/lib/blueprint-api/` → 9 条 SDK smoke 继续通过
  - [x] 25.6 人工核查 4 项边界：(a) Real-MCP 路径下 capability event payload 的 `adapter === "blueprint.runtime.mcp.github.real"`;(b) Real-HTTP 路径下 capability event payload 的 `adapter === "blueprint.runtime.mcp.github.http"`;(c) fallback 路径下 capability event payload 的 `adapter === "blueprint.runtime.mcp.github.simulated"`;(d) `server/tool/api/mcp-tool-adapter.ts` 源码**无**本 spec 引起的改动（需求 1.8 / design §1）;同时 grep `server/routes/blueprint/mcp-github-source/bridge.ts` 确认无 `import { McpToolAdapter }` / `import { InternalMcpToolInvoker }` / `import "undici"` / 模块级 `fetch()` 调用（需求 2.3 / design §2.D1 硬约束）
  - _Requirements: 1.8, 1.9, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 9.4, 9.6_

## 说明

- 本任务清单所有任务均为必做项，不含 `*` 可选标记（spec 范围聚焦、体量可控）。
- 每个任务都在 footer 中引用至少 1 个 EARS requirement id，便于追溯。
- 任务 4、6、8、10、12、15 是 example-based 单测（共 ~28 条），**不**包含 PBT（符合 Requirement 9.3、design §6.1）。
- 任务 23 只向 `server/tests/blueprint-routes.test.ts` **追加** 3 条新用例（Real-MCP / Real-HTTP / Fallback），不修改原有 47 条（符合 Requirement 1.9、9.4）；Docker 桥 spec 先追加 2 条到 45 基线得到 47，本 spec 再追加 3 条，累计 50 条。
- 任务 13、16、22 是 3 个中间 checkpoint，分别在子域纯模块、完整子域、外层改造后验证未回归；任务 25 是全量回归 + 最终验收。
- D1（工厂 DI）在任务 14.2 / 14.8 落地；D2（`BlueprintServiceContext` 可选注入）在任务 2 / 17 落地；D3（三段式降级 MCP → HTTP → fallback）在任务 14.2 / 14.6 落地；D4（invocation 层替换，不改外层 orchestration）在任务 19 落地；D5（30s timeout）在任务 3.2 / 3.6 / 7.2 落地；D6（adapter 字符串 + `executionPath` 字段）在任务 20.1 / 20.2 / 23 落地；D7（复用 `BlueprintEventName`）在任务 20.3 落地；D8（security policy + 脱敏）在任务 3 / 4 落地；D9（MCP 工具名约定 `github.get_repository`）在任务 3.2 / 7.2 落地；D10（default test harness ≡ today's production behavior）在任务 17.2 / 23.6 / 25.4 落地。
- 任务 5.3 / 7.3 / 9.5 / 14.8 的"禁止 import"硬约束在 code review 阶段应直接拒绝违反者（与 Docker 桥 spec 对齐）：
  - `bridge.ts` 不 `import { McpToolAdapter, InternalMcpToolInvoker }` / 不 `new McpToolAdapter()` / 不 `import "undici"` / 不调用模块级 `fetch()`
  - `http-fetcher.ts` 是整个子域内**唯一**允许 `import { fetch } from "undici"` 的文件；bridge.ts 仅消费 `BlueprintHttpFetcher` 接口
  - `url-parser.ts` / `mcp-request.ts` / `summary-derivation.ts` / `policy.ts` 均为纯模块，不允许任何 HTTP 客户端 import
- 任务 18.3 明确本 spec **不改动** `/api/executor/events` 中继链（与 Docker 桥不同）：本 spec 没有 callback dispatcher 需求，MCP 路径走主线 `McpToolAdapter.execute` 同步 Promise，HTTP 路径走一次同步 `fetch()`。
- 任务 25 是强制的验证门禁，必须在所有实现任务完成后执行；任何一步失败都必须回到对应实现任务修复后再跑整套回归。
- 超时上限锁定为 **30s**（环境变量 `BLUEPRINT_MCP_CAPABILITY_BRIDGE_TIMEOUT_MS` 可覆盖），与 Docker 桥的 45s 区分（Docker 容器启动 + HMAC 回调需要更长预算；本 spec 的 MCP 工具 + 一次 GitHub API GET 不应超过这个量级）。
- 本 spec 完成后，工作流结束 —— 不在此 spec 内覆盖后续 capability（`aigc-spec-node` / `role-system-architecture`）的 bridge 化。用户可通过 `tasks.md` 中的 "Start task" 入口逐项执行。
