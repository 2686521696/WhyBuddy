/**
 * spec-generation-perceived-performance / Task 1.1
 *
 * `deriveGenerationState` —— SPEC 树生成感知性能增强的逻辑核心（纯函数）。
 *
 * 它把若干既有/瞬态信号折算成一个显式的生成状态机（Generation_State_Machine）：
 *
 *   idle | pending | success | failure | empty
 *
 * 折算输入：
 * - 父级 In_Flight_Lock（`specDocsGenerating`：'all' | 'single' | null）
 * - 父级错误（`specDocsError` → `error`）
 * - 瞬态乐观标记（点击同步置入的 `optimistic`）
 * - 权威投影派生（`authoritativeHasDocs` / `authoritativeSpecTreeReady` /
 *   `authoritativeSettled`，均只读 `latestJob` + `rightRailView`）
 * - 注入的当前时间 `now`（performance.now()）与超时阈值 `timeoutMs`
 *
 * 设计约束（见 design.md）：
 * - 本函数不是新的真相源，而是对既有状态的一次只读投影。
 * - 不读取 store、不产生副作用、不依赖外部时间（`now` 由入参注入），
 *   因此完全可被属性测试（PBT）覆盖。
 */

export type GenerationScope = "all" | "single";

export type GenerationPhase =
  | "idle"
  | "pending"
  | "success"
  | "failure"
  | "empty";

/** 瞬态乐观标记。仅 UI，不入真相源。 */
export interface OptimisticMark {
  scope: GenerationScope;
  /** performance.now() 时间戳，用于超时判定 */
  startedAt: number;
}

export interface DeriveGenerationStateInput {
  /** 父级 In_Flight_Lock：'all' | 'single' | null */
  inFlight: GenerationScope | null;
  /** 父级既有错误（来自 specDocsError），存在即 failure 候选 */
  error: { message?: string; detail?: string } | null;
  /** 瞬态乐观标记（点击同步置入） */
  optimistic: OptimisticMark | null;
  /** 权威：当前 scope 下是否已存在任何节点文档 */
  authoritativeHasDocs: boolean;
  /** 权威：specTree 是否就绪（hasPersistedSpecTree 语义） */
  authoritativeSpecTreeReady: boolean;
  /** 权威：本次请求结果是否已被确认（job 版本/文档计数前进） */
  authoritativeSettled: boolean;
  /** 当前时间（performance.now()），用于超时判定，便于测试注入 */
  now: number;
  /** 超时阈值，默认 60000ms */
  timeoutMs?: number;
}

export interface GenerationStateView {
  phase: GenerationPhase;
  /** 当前进行中范围，用于 CTA disabled 与重试范围记忆 */
  scope: GenerationScope | null;
  /** 是否因超时落入 failure（驱动 toast 文案分支） */
  timedOut: boolean;
}

/** 默认超时阈值：60 秒（60000ms）。 */
export const DEFAULT_GENERATION_TIMEOUT_MS = 60000;

/**
 * 折算生成状态机（纯函数）。
 *
 * 优先级自上而下：
 *   1. 有 `error` → `failure`（保留旧内容）。
 *   2. 有 `optimistic` 或 `inFlight !== null`：
 *        - 若 `optimistic` 且 `now - optimistic.startedAt >= timeoutMs`
 *          → `failure`（`timedOut = true`）。
 *        - 否则 → `pending`。
 *   3. 已 `authoritativeSettled`：`authoritativeHasDocs ? success : empty`。
 *   4. 其余 → `idle`。
 *
 * 关键不变式：只要处于第 2 档（in-flight / 未超时乐观标记），无论权威投影
 * 是否还在中间态，结果恒为 `pending`，从而满足"不回退 idle、不误判 empty"。
 */
export function deriveGenerationState(
  input: DeriveGenerationStateInput
): GenerationStateView {
  const {
    inFlight,
    error,
    optimistic,
    authoritativeHasDocs,
    authoritativeSettled,
    now,
    timeoutMs = DEFAULT_GENERATION_TIMEOUT_MS,
  } = input;

  // 进行中范围：优先取乐观标记的 scope，其次取 In_Flight_Lock 的范围。
  const scope: GenerationScope | null = optimistic?.scope ?? inFlight ?? null;

  // (1) error 优先级最高 → 恒 failure（与乐观标记、并发锁、权威投影无关）。
  if (error !== null) {
    return { phase: "failure", scope, timedOut: false };
  }

  // (2) in-flight / 乐观标记档。
  const hasOptimistic = optimistic !== null;
  const inFlightActive = inFlight !== null;
  if (hasOptimistic || inFlightActive) {
    // 超时判定仅对乐观标记成立（startedAt 来源于乐观标记）。
    if (hasOptimistic && now - optimistic.startedAt >= timeoutMs) {
      return { phase: "failure", scope, timedOut: true };
    }
    return { phase: "pending", scope, timedOut: false };
  }

  // (3) 已确认终态：由权威是否有文档唯一决定 success / empty。
  if (authoritativeSettled) {
    return {
      phase: authoritativeHasDocs ? "success" : "empty",
      scope,
      timedOut: false,
    };
  }

  // (4) 其余 → idle。
  return { phase: "idle", scope, timedOut: false };
}
