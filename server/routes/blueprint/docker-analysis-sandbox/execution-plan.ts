/**
 * Docker Capability Bridge — ExecutionPlan 构造（Task 5）
 *
 * 本文件提供把一次 `docker-analysis-sandbox` capability 调用映射成
 * `shared/executor/contracts.ts` 中 `ExecutionPlan` 的纯函数。
 *
 * 设计约束（硬约束，code review 阶段应直接拒绝违反者）：
 *
 * - 本文件是 **纯函数**：无 I/O、无模块级可变状态、无定时器、无日志副作用。
 * - **禁止** `import { DockerRunner, MockRunner } from "../../../../services/lobster-executor/..."`。
 * - **禁止** `new ExecutorClient(...)` 自行装配执行器。
 * - **禁止** `import "dockerode"`；所有 Docker 相关类型通过 `shared/executor/contracts.ts` 间接消费。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 *
 * - requirements 2.2 / 2.5：派发 plan 必须回到当前 `BlueprintGenerationRequest`
 *   的 `targetText` / `githubUrls` / `projectId` / route 的 `id` / `title`；
 *   HMAC 回调以 `plan.jobs[0].id === bridgeInput.invocationId` 为匹配锚点。
 * - requirements 7.2：plan 中的资源与网络策略字段由 `DockerCapabilityPolicy`
 *   透传，保证不比 executor 默认更宽松（policy 默认值本身已对齐 executor 默认）。
 * - design §4.4：plan 字段填充表、`missionId: "blueprint:{jobId}"` 前缀约定、
 *   `requiredCapabilities: ["runtime.docker"]` 锁定、`timeoutMs` 上限语义。
 *
 * 关键设计点：
 *
 * 1. `plan.jobs[0].id` 必须等于 `bridgeInput.invocationId`。这是 HMAC 回调
 *    匹配的唯一锚点：executor 侧 `job.completed` / `job.failed` 事件的
 *    `jobId` 字段会回传相同值，bridge 用它从 `callback-waiter` 取出等待者。
 * 2. `missionId` 格式为 `blueprint:{jobId}` 前缀，与 mission runtime 的真实
 *    mission id 命名空间明确分离，便于 executor 侧日志、replay 与运维区分
 *    "这是 blueprint 派发而非 mission 派发"。
 * 3. `mode: "managed"` 与 `kind: "analyze"` 均为 `shared/executor/contracts.ts`
 *    中 `EXECUTION_RUN_MODES` / `EXECUTION_JOB_KINDS` 枚举的合法成员；
 *    若上游枚举未来变动，本文件必须同步跟随而非各自维护别名。
 * 4. `timeoutMs = min(policy.maxCallbackTimeoutMs, 30000)`：job-level
 *    timeout 与 callback-level timeout 分别负责容器执行墙钟与回调等待墙钟；
 *    job-level 上限锁到 30s，让 executor 侧能提前取消超时容器，剩余 buffer
 *    留给 HMAC 回调传输。
 * 5. `payload.analysisInput` 明确承载 route / request 上下文 —— 需求 2.5
 *    要求派发载荷能追溯到当前请求，这里是唯一入口。
 */

import type { ExecutionPlan } from "../../../../shared/executor/contracts.js";
import { EXECUTOR_CONTRACT_VERSION } from "../../../../shared/executor/contracts.js";
import type {
  DockerCapabilityBridgeInput,
  DockerCapabilityPolicy,
} from "./types.js";

/**
 * `buildDockerCapabilityExecutionPlan()` 的输入形状。
 *
 * 字段语义：
 *
 * - `bridgeInput`：单次 bridge 调用传入的上下文（详见 `./types.ts`）；
 *   本函数从中读取 `invocationId` / `jobId` / `capability.id` / `route.*` /
 *   `request.*` / `routeSet.id`。
 * - `policy`：`DockerCapabilityPolicy` 对象，提供 allow-list、资源上限、
 *   网络策略、安全级别、回调超时等；本函数将其字段映射到 `plan.jobs[0].payload`。
 * - `image?`：可选的容器镜像覆盖。默认使用 `"lobster-executor:default"`
 *   （与 executor 侧默认镜像对齐）；调用方若显式指定必须事先通过
 *   `checkDockerCapabilityPolicy(policy, { image })` 校验。
 */
export interface BuildDockerExecutionPlanInput {
  readonly bridgeInput: DockerCapabilityBridgeInput;
  readonly policy: DockerCapabilityPolicy;
  readonly image?: string;
}

/**
 * 默认 Docker 镜像。
 *
 * 与 `shared/executor/contracts.ts` 中 `ExecutorCapabilities.image.defaultImage`
 * 命名对齐（executor 侧默认装配的容器镜像）。未来若要求 blueprint 使用专用
 * 分析镜像（如 `blueprint-analyzer:v1`），应在独立 spec 中扩展 allow-list
 * 并把默认值迁移到 bridge 注入参数，而非在本文件内硬切。
 */
const DEFAULT_DOCKER_IMAGE = "lobster-executor:default";

/**
 * Job-level 超时上限（毫秒）。
 *
 * 设计语义：
 *
 * - `policy.maxCallbackTimeoutMs` 是 bridge 等待 HMAC 回调终态的墙钟上限
 *   （默认 45 秒），**包含** 容器实际执行时间 + 回调传输时间 + HMAC 校验延迟。
 * - `jobs[0].timeoutMs` 是 executor 侧对容器执行的墙钟上限；我们取
 *   `min(callback上限, 30s)` —— 30 秒留给容器执行，剩余 15 秒留给回调传输。
 * - 这个 30s 上限与 `services/lobster-executor/src/config.ts` 默认
 *   `timeoutMs = 30000` 对齐；调整时需同步检查 executor 侧默认。
 */
const MAX_JOB_TIMEOUT_MS = 30_000;

/**
 * 把一次 bridge 调用输入转换成可派发给 `ExecutorClient.dispatchPlan()` 的
 * `ExecutionPlan`。
 *
 * 纯函数行为：
 *
 * - 输入相同 → 输出严格相同（同样的字段、同样的嵌套对象值）。
 * - 不读取 `process.env`、不调用 `Date.now()`、不打印日志、不发起 I/O。
 * - 字段填充完全对应 design §4.4 表格；任何新增字段必须同步更新 design。
 *
 * 对外契约：
 *
 * - `plan.jobs[0].id === input.bridgeInput.invocationId`（回调匹配锚点）。
 * - `plan.jobs[0].payload.requiredCapabilities` 固定为 `["runtime.docker"]`，
 *   让 `ExecutorClient.validatePlanCapabilities()` 在派发前校验 executor
 *   能力；若 executor 当前为 native / mock 则提前抛 `rejected` 错误。
 * - `plan.metadata.source === "blueprint-docker-capability-bridge"` 是
 *   下游 executor 日志、replay、运维面识别派发来源的稳定字符串。
 */
export function buildDockerCapabilityExecutionPlan(
  input: BuildDockerExecutionPlanInput,
): ExecutionPlan {
  const { bridgeInput, policy } = input;
  const image = input.image ?? DEFAULT_DOCKER_IMAGE;
  const jobTimeoutMs = Math.min(policy.maxCallbackTimeoutMs, MAX_JOB_TIMEOUT_MS);

  // `targetText` 缺失时仍需构造合法 objective；使用固定降级字符串，避免
  // 拼出 `"Analyze target undefined for route ..."` 这种 noise。
  const targetTextForObjective = bridgeInput.request.targetText ?? "(no target)";

  return {
    version: EXECUTOR_CONTRACT_VERSION,
    missionId: `blueprint:${bridgeInput.jobId}`,
    summary: `Blueprint docker analysis for route: ${bridgeInput.route.title}`,
    objective: `Analyze target ${targetTextForObjective} for route ${bridgeInput.route.id}.`,
    requestedBy: "brain",
    mode: "managed",
    sourceText: bridgeInput.request.targetText,
    steps: [
      {
        key: "docker-analysis",
        label: "Docker analysis",
        description:
          "Run deterministic repository analysis in a sealed container.",
      },
    ],
    jobs: [
      {
        id: bridgeInput.invocationId,
        key: "docker-analysis",
        label: "Docker analysis",
        description:
          "Run deterministic repository analysis in a sealed container.",
        kind: "analyze",
        timeoutMs: jobTimeoutMs,
        payload: {
          requiredCapabilities: ["runtime.docker"],
          image,
          memoryLimit: policy.memoryLimit,
          cpuLimit: policy.cpuLimit,
          pidsLimit: policy.pidsLimit,
          networkPolicy: policy.networkPolicy,
          securityLevel: policy.securityLevel,
          analysisInput: {
            routeId: bridgeInput.route.id,
            routeTitle: bridgeInput.route.title,
            targetText: bridgeInput.request.targetText,
            githubUrls: bridgeInput.request.githubUrls ?? [],
            projectId: bridgeInput.request.projectId,
          },
        },
      },
    ],
    metadata: {
      source: "blueprint-docker-capability-bridge",
      blueprintJobId: bridgeInput.jobId,
      routeSetId: bridgeInput.routeSet.id,
      routeId: bridgeInput.route.id,
      capabilityId: bridgeInput.capability.id,
    },
  };
}
