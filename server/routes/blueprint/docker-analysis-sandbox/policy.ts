/**
 * Docker Capability Bridge — 安全与资源策略实现（Task 3）
 *
 * 本文件提供 Docker capability bridge 运行期的策略对象与校验函数：
 *
 * - `DockerCapabilityPolicy`：策略形状（从 `./types.ts` 单一来源再导出，
 *   避免出现第二份竞争定义）。
 * - `createDefaultDockerCapabilityPolicy()`：生成符合 design §4.3 默认值
 *   的策略实例；支持通过环境变量覆盖回调 / 派发超时。
 * - `checkDockerCapabilityPolicy(policy, request)`：对一次派发请求做
 *   allow-list / network policy / whitelist domain 三类校验，返回
 *   `{ allowed, reason? }`。
 *
 * 设计约束（硬约束，code review 阶段应直接拒绝违反者）：
 *
 * - 不得 `import` `services/lobster-executor/*` 内部实现；
 *   资源约束最终由 executor 侧 `security-policy.ts` 强制执行，
 *   本文件只做形状映射与 allow-list 校验。
 * - 模块加载时不得有任何 I/O 或环境变量读取副作用；环境变量覆盖
 *   必须在 `createDefaultDockerCapabilityPolicy()` 被调用时才读取，
 *   保证 `vi.stubEnv(...)` 在测试中对后续调用立即生效。
 * - 不得在本文件 `new ExecutorClient(...)` 或持有任何模块级单例。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 *
 * - requirements 2.4 / 7.1 / 7.2 / 7.5：allow-list、资源上限、
 *   policy 拒绝时回退 simulated fallback 的触发源。
 * - design §4.3：默认策略表、校验规则表、环境变量覆盖口径。
 */

import type { DockerCapabilityPolicy } from "./types.js";

/**
 * Re-export `DockerCapabilityPolicy` 从 `./types.ts` 的 canonical 定义，
 * 让下游消费者既可以 `import from "./policy.js"`（与校验函数同源），也可以
 * `import from "./types.js"`（与 bridge 其它类型同源），两路最终指向同一类型。
 *
 * 这里使用 `export type ... from` 形态，保证不引入运行时实体。
 */
export type { DockerCapabilityPolicy } from "./types.js";

/**
 * `checkDockerCapabilityPolicy()` 的请求形状。
 *
 * 设计要点：
 *
 * - `requestedNetwork` 为可选：一些调用方（例如默认走 `networkPolicy: "none"`
 *   的沙箱作业）不显式传入 network 参数，只要策略本身不允许 `bridge` 就不会
 *   被拒绝。
 * - `requestedNetworkDomain` 仅在 `policy.networkPolicy === "whitelist"` 路径下
 *   参与判断；未提供时视为未匹配任何白名单条目，将被拒绝。
 * - `whitelist` 分支本期暂未在 `requestedNetwork` 枚举中暴露给调用方主动选择，
 *   因为当前唯一 allow-list 中的镜像均不需要外网访问；但策略侧仍保留了
 *   `networkPolicy === "whitelist"` 的校验通路，以便后续扩展无需变更签名。
 */
export interface DockerCapabilityPolicyRequest {
  /** 本次派发请求的容器镜像（精确匹配 allow-list） */
  readonly image: string;
  /** 本次派发请求的网络模式（未指定时不触发 network policy 冲突判定） */
  readonly requestedNetwork?: "none" | "bridge";
  /** 当 `policy.networkPolicy === "whitelist"` 时要访问的单一域名 */
  readonly requestedNetworkDomain?: string;
}

/**
 * `checkDockerCapabilityPolicy()` 的返回形状。
 *
 * - `allowed: true` → 派发请求可以继续；`reason` 必为 `undefined`。
 * - `allowed: false` → 调用方按需求 4 / 7.5 走 simulated fallback；
 *   `reason` 为一个简短、脱敏后的原因字符串，便于写入
 *   `BlueprintCapabilityInvocation.provenance.error`（上限 400 字符，
 *   由 bridge 统一截断）。
 */
export interface DockerCapabilityPolicyResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

/**
 * 环境变量名常量，集中定义避免散落字面量。
 *
 * 这两个环境变量的语义见 design §2 D5：
 *
 * - `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS`：
 *   bridge 等待 HMAC 回调终态（`job.completed` / `job.failed`）的上限。
 * - `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_DISPATCH_TIMEOUT_MS`：
 *   单次 `POST /api/executor/jobs` 派发 HTTP 请求本身的超时。
 */
const ENV_CALLBACK_TIMEOUT_MS =
  "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS";
const ENV_DISPATCH_TIMEOUT_MS =
  "BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_DISPATCH_TIMEOUT_MS";

/**
 * 默认策略常量 —— 严格对齐 design §4.3。
 *
 * 选型依据：
 *
 * - `allowedImages`：三个受控镜像，其中 `lobster-executor:*` 由 executor 侧
 *   构建脚本维护，`node:20-slim` 用于兼容既有 AI 分析脚本。任何新增镜像
 *   都必须先进入该 allow-list 才能被派发。
 * - `memoryLimit: "512m"` / `cpuLimit: "1.0"` / `pidsLimit: 256`：对齐
 *   `shared/executor/contracts.ts` 中 `SecurityResourceLimits` 的默认值。
 * - `networkPolicy: "none"`：默认网络完全隔离；`whitelist` 分支保留给未来
 *   明确需要外网访问的 capability。
 * - `securityLevel: "strict"`：透传 executor 侧 strict 模板
 *   （`capDrop: ALL`、`readonlyRootfs: true` 等）。
 * - `maxCallbackTimeoutMs: 45000`：设计锁定 45 秒（< 60 秒需求上限，
 *   预留 15 秒 buffer）。
 * - `maxDispatchTimeoutMs: 10000`：与 `ExecutorClient` 默认 HTTP 超时一致，
 *   不覆盖。
 * - `maxLogLines: 50` / `maxLogBytes: 10240`：invocation.logs 展示上限，
 *   超过后丢弃后续行但保留 SHA-256 digest。
 *
 * 这些常量不直接导出，通过 `createDefaultDockerCapabilityPolicy()` 访问，
 * 以便未来扩展环境变量覆盖时保持单一入口。
 */
const DEFAULT_ALLOWED_IMAGES = Object.freeze([
  "lobster-executor:ai",
  "lobster-executor:default",
  "node:20-slim",
]) as readonly string[];
const DEFAULT_MEMORY_LIMIT = "512m";
const DEFAULT_CPU_LIMIT = "1.0";
const DEFAULT_PIDS_LIMIT = 256;
const DEFAULT_NETWORK_POLICY: "none" | "bridge" | "whitelist" = "none";
const DEFAULT_SECURITY_LEVEL: "strict" | "balanced" | "permissive" = "strict";
const DEFAULT_MAX_CALLBACK_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_DISPATCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_LOG_LINES = 50;
const DEFAULT_MAX_LOG_BYTES = 10_240;

/**
 * 解析一个环境变量为正整数毫秒，失败时返回默认值。
 *
 * 解析规则（与任务 3.4 口径一致）：
 *
 * - 使用 `Number.parseInt(value, 10)`，避免 `Number("")` 返回 `0`、
 *   `Number("1e2")` 做科学计数法解析这类语义漂移。
 * - 解析结果必须同时满足 `Number.isFinite` 与 `> 0`，否则回退默认值；
 *   这自动覆盖了：未设置、空字符串、非数字、`"0"`、`"-100"`、`"Infinity"`、
 *   `"NaN"` 等所有异常取值。
 *
 * 每次调用都会重新读取 `process.env`，与任务说明一致，保证 `vi.stubEnv`
 * 在测试中对后续调用立即生效。
 */
function readPositiveMsEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

/**
 * 生成符合 design §4.3 默认值的 `DockerCapabilityPolicy` 实例。
 *
 * 返回的对象在结构上是"新鲜的"：`allowedImages` 数组是 `DEFAULT_ALLOWED_IMAGES`
 * 的浅拷贝，调用方可以安全地读取而不担心意外修改默认常量。
 *
 * 环境变量覆盖行为（见任务 3.4）：
 *
 * - `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_CALLBACK_TIMEOUT_MS` 未设置或无效 →
 *   使用 `DEFAULT_MAX_CALLBACK_TIMEOUT_MS` (45000)；
 * - `BLUEPRINT_DOCKER_CAPABILITY_BRIDGE_DISPATCH_TIMEOUT_MS` 未设置或无效 →
 *   使用 `DEFAULT_MAX_DISPATCH_TIMEOUT_MS` (10000)；
 * - 设为合法正整数字符串 → 用该整数覆盖对应字段。
 *
 * 其它字段（镜像 allow-list、资源上限、网络策略、安全级别、日志上限）
 * 不支持运行期覆盖：它们属于"策略基线"而非"调优旋钮"，测试若需变更可以
 * 显式注入 `ctx.dockerCapabilityPolicy = { ... }`（见 design §4.2 / D10）。
 */
export function createDefaultDockerCapabilityPolicy(): DockerCapabilityPolicy {
  return {
    allowedImages: [...DEFAULT_ALLOWED_IMAGES] as readonly string[],
    memoryLimit: DEFAULT_MEMORY_LIMIT,
    cpuLimit: DEFAULT_CPU_LIMIT,
    pidsLimit: DEFAULT_PIDS_LIMIT,
    networkPolicy: DEFAULT_NETWORK_POLICY,
    securityLevel: DEFAULT_SECURITY_LEVEL,
    maxCallbackTimeoutMs: readPositiveMsEnv(
      ENV_CALLBACK_TIMEOUT_MS,
      DEFAULT_MAX_CALLBACK_TIMEOUT_MS,
    ),
    maxDispatchTimeoutMs: readPositiveMsEnv(
      ENV_DISPATCH_TIMEOUT_MS,
      DEFAULT_MAX_DISPATCH_TIMEOUT_MS,
    ),
    maxLogLines: DEFAULT_MAX_LOG_LINES,
    maxLogBytes: DEFAULT_MAX_LOG_BYTES,
  };
}

/**
 * 对一次 Docker 派发请求做策略校验。
 *
 * 校验规则（严格对应 design §4.3 与 requirements 4.1 / 7.1 / 7.5 的
 * 拒绝文案锁定）：
 *
 * 1. `request.image` 不在 `policy.allowedImages` 中 →
 *    `{ allowed: false, reason: "image not in allow-list" }`
 * 2. `policy.networkPolicy === "none"` 且 `request.requestedNetwork === "bridge"` →
 *    `{ allowed: false, reason: "network policy denied" }`
 * 3. `policy.networkPolicy === "whitelist"` 且 `request.requestedNetworkDomain`
 *    未命中 `policy.networkAllowlist` →
 *    `{ allowed: false, reason: "network allowlist denied" }`
 * 4. 其它 → `{ allowed: true }`
 *
 * 实现细节：
 *
 * - 规则按 1 → 2 → 3 顺序短路返回；任何一条命中就不再检查后续规则。
 *   这样 `reason` 字符串是确定的，便于 task 4 的单测断言。
 * - 规则 3 的 "未命中" 定义为：`networkAllowlist` 未配置、为空数组、或
 *   `requestedNetworkDomain` 未提供 / 不在列表中 —— 任一情况都拒绝，
 *   以保证 `whitelist` 模式下的默认行为是"拒绝未知域名"。
 * - `reason` 字符串保持与需求文档中 EARS 引用一致的锁定字面量；
 *   不得在未来改动中随意重命名或翻译（下游单测与 E2E 直接断言）。
 */
export function checkDockerCapabilityPolicy(
  policy: DockerCapabilityPolicy,
  request: DockerCapabilityPolicyRequest,
): DockerCapabilityPolicyResult {
  // Rule 1: image allow-list.
  if (!policy.allowedImages.includes(request.image)) {
    return { allowed: false, reason: "image not in allow-list" };
  }

  // Rule 2: network policy conflict — "none" policy cannot satisfy a "bridge" request.
  if (
    policy.networkPolicy === "none" &&
    request.requestedNetwork === "bridge"
  ) {
    return { allowed: false, reason: "network policy denied" };
  }

  // Rule 3: whitelist domain not matched.
  if (policy.networkPolicy === "whitelist") {
    const allowlist = policy.networkAllowlist ?? [];
    const domain = request.requestedNetworkDomain;
    if (domain === undefined || !allowlist.includes(domain)) {
      return { allowed: false, reason: "network allowlist denied" };
    }
  }

  return { allowed: true };
}
