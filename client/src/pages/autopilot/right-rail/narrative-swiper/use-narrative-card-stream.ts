/**
 * Autopilot 右栏底部叙事 Swiper — `useNarrativeCardStream` hook
 *
 * 本 hook 合并 6 路 store slice 为统一的 NarrativeCardStream，供
 * `<NarrativeSwiper>` 消费。设计契约对应：
 *
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   §Requirement 3：现有 4 个组件到叙事卡片的数据源映射
 *   - 3.1：6 类 Card_Source
 *   - 3.2：复用 derive-mirofish-stream-entries.ts
 *   - 3.4：同 sourceEntryId 原地更新不触发入队动效
 *   - 3.6：单路 derive 失败不影响其他来源
 *   §Requirement 6：阶段切换与卡片生命周期
 *   - 6.1：Stage_Transition 后 600ms 退场动效（由 NarrativeSwiper 处理）
 *   - 6.2：保留最近 N=2 张跨阶段卡片作为"上一幕回声"
 *   - 6.3：跨阶段卡片不参与 Auto_Rotation 主轮播
 *   - 6.4：5 秒内回切恢复旧阶段卡片队列
 *   - 6.5：同 stage 内超 Capacity_Limit 仍按 FIFO，不引入回声例外
 *   - 6.6：不清空左下 Expanded_Console_Panel 历史日志
 *   §Requirement 9：性能与稳定性
 *   - 9.2：节流入队（source, 1s）桶
 *   - 9.3：不在每次卡片切换中触发右栏主区重渲染
 *   - 9.5：卸载时清理所有定时器
 *
 * 关键约束：
 * 1. 不修改 `useBlueprintRealtimeStore` 的对外 API（Req 10.1）。
 * 2. 复用 `deriveMiroFishStreamEntries` 已有派生逻辑（Req 3.2）。
 * 3. 新增 `deriveRoleStatusNarrativeCards` / `deriveFleetActivationNarrativeCards`
 *    两个纯函数，不耦合 store。
 * 4. 调用 `routeMiroFishEntry()` 过滤 `console-only`（Req 4.1）。
 * 5. 节流入队：`(source, 1s)` 桶，桶内仅入队最新 1 条（Req 9.2）。
 * 6. 容量裁剪到 ≤ capacity；同 `sourceEntryId` 原地更新不触发入队动效（Req 3.4）。
 * 7. 单路 derive 失败用 `try/catch` 包裹，不影响其他来源（Req 3.6）。
 * 8. 卸载时清理 timer（Req 9.5）。
 * 9. 跨阶段回声 N=2：stage 切换时保留旧阶段最后 2 张卡片作为 echo（Req 6.2）。
 */

import { useEffect, useRef, useState } from "react";

import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import type {
  RolePhase,
  AgentProgressEntry,
  CapabilityStatus,
} from "@/lib/blueprint-realtime-store";
import type { AgentReasoningEntry } from "@shared/blueprint/agent-reasoning";
import type { BlueprintGenerationArtifact } from "@shared/blueprint/contracts";

import { deriveMiroFishStreamEntries } from "../mirofish-stream/derive-mirofish-stream-entries";
import type { MiroFishStreamEntry } from "../mirofish-stream/mirofish-stream-types";
import { routeMiroFishEntry } from "../right-rail-console-routing";

import type {
  NarrativeCard,
  NarrativeCardStream,
  CardSource,
  Stage,
} from "./narrative-card-types";

// ─── Hook Options ──────────────────────────────────────────────────────────

export interface UseNarrativeCardStreamOptions {
  /** 当前 Stage；由 AutopilotRightRail 传入。 */
  stage: Stage;
  /** 容量上限，默认 8。 */
  capacity?: number;
}

// ─── 节流桶常量 ─────────────────────────────────────────────────────────────

/** 每个 source 的节流窗口（毫秒）。 */
const THROTTLE_WINDOW_MS = 1000;

/** 跨阶段回声保留张数（Req 6.2）。 */
const ECHO_COUNT = 2;

/** 回切恢复窗口（毫秒）（Req 6.4）。 */
const STAGE_RESTORE_WINDOW_MS = 5000;

// ─── 纯函数：deriveRoleStatusNarrativeCards ────────────────────────────────

/**
 * 从 `rolePhases` 派生 role-status 类型的 NarrativeCard 列表。
 *
 * 每个活跃角色（phase 不为 idle / sleeping）生成一张卡片。
 * 纯函数，不耦合 store。
 */
export function deriveRoleStatusNarrativeCards(
  rolePhases: Record<string, RolePhase>
): NarrativeCard[] {
  const cards: NarrativeCard[] = [];
  const now = Date.now();

  for (const [roleId, phase] of Object.entries(rolePhases)) {
    if (phase === "idle" || phase === "sleeping") continue;

    cards.push({
      id: `role-status-${roleId}-${phase}`,
      source: "role-status",
      stage: "global",
      headline: `${formatRoleName(roleId)}: ${phase}`,
      severity: phase === "failed" ? "danger" : "info",
      occurredAt: now,
      sourceEntryId: `role-status-${roleId}`,
      routing: "narrative-only",
    });
  }

  return cards;
}

// ─── 纯函数：deriveFleetActivationNarrativeCards ───────────────────────────

/**
 * 从 `agentProgress` 派生 fleet-activation 类型的 NarrativeCard 列表。
 *
 * 取最近的进度条目生成卡片。
 * 纯函数，不耦合 store。
 */
export function deriveFleetActivationNarrativeCards(
  agentProgress: ReadonlyArray<AgentProgressEntry>
): NarrativeCard[] {
  const cards: NarrativeCard[] = [];

  for (const entry of agentProgress) {
    cards.push({
      id: `fleet-activation-${entry.id}`,
      source: "fleet-activation",
      stage: "global",
      headline: entry.message ?? `${formatRoleName(entry.roleId)} ${entry.type}`,
      actorAvatar: entry.roleId,
      severity: entry.type === "failed" ? "danger" : "info",
      occurredAt: entry.timestamp,
      sourceEntryId: entry.id,
      routing: "narrative-only",
    });
  }

  return cards;
}

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

/** 从 roleId 生成可读角色名。 */
function formatRoleName(roleId: string): string {
  if (!roleId) return "Unknown";
  return roleId
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * 将 MiroFishStreamEntry 转为 NarrativeCard。
 * 仅处理 routing 不为 console-only 的 entry。
 */
function miroFishEntryToNarrativeCard(
  entry: MiroFishStreamEntry
): NarrativeCard | null {
  const decision = routeMiroFishEntry(entry);
  if (decision.target === "console-only") return null;

  const sourceMap: Record<string, CardSource> = {
    reasoning: "reasoning",
    capability_invocation: "capability",
    node_completed: "artifact",
    route_decision: "route-decision",
    artifact_created: "artifact",
    system_note: "reasoning",
  };

  const source: CardSource = sourceMap[entry.kind] ?? "reasoning";
  const occurredAt = entry.timestamp
    ? new Date(entry.timestamp).getTime()
    : Date.now();

  let headline = "";
  switch (entry.kind) {
    case "reasoning":
      headline = entry.thought ?? entry.phase ?? "Reasoning";
      break;
    case "capability_invocation":
      headline = `Capability: ${entry.capabilityId} (${entry.status})`;
      break;
    case "node_completed":
      headline = `Node completed: ${entry.nodeTitle}`;
      break;
    case "route_decision":
      headline = `Route: ${entry.routeTitle}`;
      break;
    case "artifact_created":
      headline = `Artifact: ${entry.title}`;
      break;
    case "system_note":
      headline = entry.message;
      break;
  }

  return {
    id: `mirofish-${entry.id}`,
    source,
    stage: "global",
    headline,
    severity: entry.tone === "danger" ? "danger" : entry.tone === "warning" ? "warning" : "info",
    occurredAt,
    sourceEntryId: entry.id,
    routing: decision.target === "both" ? "both" : "narrative-only",
  };
}

/**
 * 过滤卡片：只保留属于当前 stage 或 global 的卡片。
 */
function filterByStage(cards: NarrativeCard[], stage: Stage): NarrativeCard[] {
  return cards.filter((card) => card.stage === stage || card.stage === "global");
}

// ─── Hook 实现 ─────────────────────────────────────────────────────────────

/**
 * 合并 6 路 store slice 为统一的 NarrativeCardStream。
 *
 * 实现要点：
 * 1. 通过 selector 读取 5 路 slice，每路浅比较防抖。
 * 2. 复用 `deriveMiroFishStreamEntries` 派生 reasoning / capability / artifact /
 *    route_decision / node_completed entries。
 * 3. `rolePhases` / `agentProgress` 走新增纯函数。
 * 4. 调用 `routeMiroFishEntry()` 过滤 `console-only`。
 * 5. 节流入队：`(source, 1s)` 桶，桶内仅入队最新 1 条。
 * 6. 容量裁剪到 ≤ capacity；同 `sourceEntryId` 原地更新不触发入队动效。
 * 7. 单路 derive 失败用 `try/catch` 包裹。
 * 8. 卸载时清理 timer。
 * 9. 跨阶段回声 N=2：stage 切换时保留旧阶段最后 2 张卡片（Req 6.2-6.5）。
 */
export function useNarrativeCardStream(
  opts: UseNarrativeCardStreamOptions
): NarrativeCardStream {
  const { stage, capacity = 8 } = opts;

  // ─── 5 路 selector（浅比较防抖） ─────────────────────────────────────────
  const agentReasoning = useBlueprintRealtimeStore(
    (s) => s.agentReasoning.entries
  );
  const capabilityStatuses = useBlueprintRealtimeStore(
    (s) => s.capabilityStatuses
  );
  const rolePhases = useBlueprintRealtimeStore((s) => s.rolePhases);
  const agentProgress = useBlueprintRealtimeStore((s) => s.agentProgress);
  // latestJob.artifacts — 当前 store 没有直接暴露 artifacts slice，
  // 使用空数组作为 fallback；后续 task 3.5 挂载时由 props 传入。
  const artifacts: ReadonlyArray<BlueprintGenerationArtifact> = [];

  // ─── 内部状态 ────────────────────────────────────────────────────────────
  const [cards, setCards] = useState<NarrativeCard[]>([]);
  const [echoCount, setEchoCount] = useState(0);

  // 节流桶：Map<CardSource, { timer: ReturnType<typeof setTimeout>; latest: NarrativeCard }>
  const throttleBucketsRef = useRef<
    Map<CardSource, { timer: ReturnType<typeof setTimeout>; latest: NarrativeCard }>
  >(new Map());

  // 用于卸载时清理所有 timer
  const mountedRef = useRef(true);

  // ─── 跨阶段回声状态（Req 6.2 / 6.4） ────────────────────────────────────
  /** 上一个 stage 标识。 */
  const previousStageRef = useRef<Stage>(stage);
  /** 上一个 stage 的完整卡片队列快照（用于 5s 内回切恢复）。 */
  const previousQueueRef = useRef<NarrativeCard[]>([]);
  /** 回切恢复计时器。 */
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 可恢复的 stage（5s 窗口内有效）。 */
  const restorableStageRef = useRef<Stage | null>(null);

  // ─── Stage 切换检测（Req 6.2 / 6.4） ────────────────────────────────────

  useEffect(() => {
    const prevStage = previousStageRef.current;
    if (prevStage === stage) return;

    // 检查是否在 5s 内回切到上一 stage（Req 6.4）
    if (restorableStageRef.current === stage) {
      // 恢复旧阶段卡片队列
      const restoredQueue = previousQueueRef.current;
      setCards(restoredQueue);
      setEchoCount(0);
      // 清理恢复计时器
      if (restoreTimerRef.current !== null) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      restorableStageRef.current = null;
      previousStageRef.current = stage;
      return;
    }

    // 正常 stage 切换：保存当前队列快照，取最后 N=2 张作为 echo
    setCards((prev) => {
      // 保存完整快照用于 5s 回切恢复
      previousQueueRef.current = prev;
      restorableStageRef.current = prevStage;

      // 取旧队列最后 N=2 张作为 echo 卡片
      const echoCards = prev.slice(-ECHO_COUNT);
      setEchoCount(echoCards.length);
      return echoCards;
    });

    // 启动 5s 恢复窗口计时器（Req 6.4）
    if (restoreTimerRef.current !== null) {
      clearTimeout(restoreTimerRef.current);
    }
    restoreTimerRef.current = setTimeout(() => {
      restorableStageRef.current = null;
      restoreTimerRef.current = null;
    }, STAGE_RESTORE_WINDOW_MS);

    previousStageRef.current = stage;
  }, [stage]);

  // ─── 入队逻辑 ────────────────────────────────────────────────────────────

  /**
   * 将一批候选卡片通过节流桶入队。
   * - 同 sourceEntryId 原地更新不触发入队动效。
   * - 每个 source 1s 内仅入队最新 1 条。
   * - 容量裁剪到 ≤ capacity（echo 卡片不计入容量）。
   * - 同 stage 内超 Capacity_Limit 仍按 FIFO（Req 6.5）。
   */
  const enqueueCards = (candidates: NarrativeCard[]) => {
    if (!mountedRef.current) return;

    setCards((prev) => {
      let next = [...prev];
      // echo 卡片位于队列起始，不参与新 stage 的容量计算
      const currentEchoCount = echoCount;

      for (const card of candidates) {
        // 同 sourceEntryId 原地更新（在非 echo 区域查找）
        if (card.sourceEntryId) {
          const existingIdx = next.findIndex(
            (c, idx) => idx >= currentEchoCount && c.sourceEntryId === card.sourceEntryId
          );
          if (existingIdx !== -1) {
            next[existingIdx] = { ...card, occurredAt: Date.now() };
            continue;
          }
        }

        // 节流桶：同 source 1s 内仅入队最新 1 条
        const bucket = throttleBucketsRef.current.get(card.source);
        if (bucket) {
          // 桶内已有 pending，只更新 latest
          bucket.latest = card;
          continue;
        }

        // 无 pending 桶，直接入队并创建桶
        next.push(card);
        const timer = setTimeout(() => {
          if (!mountedRef.current) return;
          const b = throttleBucketsRef.current.get(card.source);
          if (b) {
            throttleBucketsRef.current.delete(card.source);
            // 桶到期时入队 latest（如果与已入队的不同）
            enqueueCards([b.latest]);
          }
        }, THROTTLE_WINDOW_MS);
        throttleBucketsRef.current.set(card.source, { timer, latest: card });
      }

      // 容量裁剪：echo 卡片不计入容量，只裁剪非 echo 部分（Req 6.5）
      const nonEchoCards = next.slice(currentEchoCount);
      if (nonEchoCards.length > capacity) {
        const trimmed = nonEchoCards.slice(nonEchoCards.length - capacity);
        next = [...next.slice(0, currentEchoCount), ...trimmed];
      }

      return next;
    });
  };

  // ─── 派生 effect ─────────────────────────────────────────────────────────

  useEffect(() => {
    const allCards: NarrativeCard[] = [];

    // 1. MiroFish 流式 entries（reasoning / capability / artifact / route / node）
    try {
      const miroFishEntries = deriveMiroFishStreamEntries({
        agentReasoning: agentReasoning as AgentReasoningEntry[],
        capabilityStatuses: capabilityStatuses as Record<string, CapabilityStatus>,
        artifacts: artifacts as BlueprintGenerationArtifact[],
      });

      for (const entry of miroFishEntries) {
        const card = miroFishEntryToNarrativeCard(entry);
        if (card) allCards.push(card);
      }
    } catch {
      // Req 3.6：单路 derive 失败不影响其他来源
    }

    // 2. Role status cards
    try {
      const roleCards = deriveRoleStatusNarrativeCards(rolePhases);
      allCards.push(...roleCards);
    } catch {
      // Req 3.6
    }

    // 3. Fleet activation cards
    try {
      const fleetCards = deriveFleetActivationNarrativeCards(agentProgress);
      allCards.push(...fleetCards);
    } catch {
      // Req 3.6
    }

    // 过滤：只保留当前 stage 或 global
    const filtered = filterByStage(allCards, stage);

    // 入队
    if (filtered.length > 0) {
      enqueueCards(filtered);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentReasoning, capabilityStatuses, rolePhases, agentProgress, stage]);

  // ─── 卸载清理 ───────────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 清理所有节流桶 timer
      for (const bucket of throttleBucketsRef.current.values()) {
        clearTimeout(bucket.timer);
      }
      throttleBucketsRef.current.clear();
      // 清理恢复计时器
      if (restoreTimerRef.current !== null) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
    };
  }, []);

  // ─── 返回 ───────────────────────────────────────────────────────────────

  return {
    cards,
    echoCount,
  };
}
