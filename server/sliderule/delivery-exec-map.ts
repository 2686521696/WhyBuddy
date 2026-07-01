/**
 * S19 · Delivery chain executors for /sliderule execute-capability.
 * document.draft → traceability.matrix → task.write → handoff.package
 *
 * LEGACY COMPAT SHELL ONLY (task 14).
 * Under default SLIDERULE_V5_BACKEND=python, delivery capability execution contract
 * is owned by Python: slide-rule-python/routes/sliderule_full.py + services/capability_maps.py
 * + sliderule_llm/capabilities.py (native LLM prompts) .
 * Node route delegates delivery caps via isPythonV5Cap before reaching this map.
 * This module is retained only as explicit thin compatibility for legacy env.
 * Direct calls here do not represent active Node backend API ownership.
 */

import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import {
  buildHandoffPackageContent,
  buildPromptPackContent,
} from "../../shared/blueprint/sliderule-delivery-chain.js";
import type { RawExecutorResult } from "./capability-exec-map.js";

export type DeliveryCapabilityId =
  | "document.draft"
  | "traceability.matrix"
  | "task.write"
  | "instruction.package"
  | "handoff.package";

const DELIVERY_CAPS = new Set<string>([
  "document.draft",
  "traceability.matrix",
  "task.write",
  "instruction.package",
  "handoff.package",
]);

function trustedArtifacts(state: V5SessionState) {
  const stale = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).filter(
    (a) => (a.trustLevel === "gated_pass" || a.trustLevel === "audited") && !stale.has(a.id)
  );
}

function byKind(state: V5SessionState, kind: string) {
  return trustedArtifacts(state).filter((a) => a.kind === kind);
}

export function isDeliveryCapability(capabilityId: string): capabilityId is DeliveryCapabilityId {
  return DELIVERY_CAPS.has(capabilityId);
}

export async function executeDeliveryCapabilityMapped(
  capabilityId: DeliveryCapabilityId,
  state: V5SessionState,
  inputArtifactIds: string[] = []
): Promise<RawExecutorResult> {
  const goal = state.goal?.text || "目标";
  const trees = byKind(state, "spec_tree");
  const reports = byKind(state, "report");
  const risks = byKind(state, "risk");
  const docs = byKind(state, "doc");

  switch (capabilityId) {
    case "document.draft": {
      const report = reports[reports.length - 1];
      const tree = trees[trees.length - 1];
      const sections = [
        `# Requirements\n${tree?.content?.slice(0, 800) || report?.summary || goal}`,
        `# Design\n${risks.map((r) => r.summary).join("\n") || "（待风险材料）"}`,
        `# Tasks\n- MVP 任务来自 SPEC Tree\n- 验收标准引用 report 章节`,
      ];
      return {
        title: "规格文档草案",
        summary: "requirements · design · tasks.md 骨架",
        content: sections.join("\n\n"),
        provenance: "ai_generated",
      };
    }
    case "traceability.matrix": {
      const rows = [
        "| 需求 | 设计 | 任务 | 证据 | 用例 |",
        "|---|---|---|---|---|",
        `| REQ-1 ${goal.slice(0, 40)} | DES-1 | TASK-1 | ${reports[0]?.id || "report"} | EARS-1 |`,
      ];
      if (trees[0]) {
        rows.push(`| SPEC root | 结构树 | 拆解 | ${trees[0].id} | tree-review |`);
      }
      return {
        title: "可追溯矩阵",
        summary: "需求↔设计↔任务↔证据↔用例",
        content: rows.join("\n"),
        provenance: "ai_generated",
      };
    }
    case "task.write": {
      const tree = trees[trees.length - 1];
      return {
        title: "工程任务清单",
        summary: "可执行任务 + 依赖",
        content:
          `【Tasks】\n` +
          `1. 实现核心 RBAC 模型（blockedBy: 无）\n` +
          `2. 接入审计日志（blockedBy: 1）\n` +
          `3. 验收用例对齐 report（blockedBy: 2）\n` +
          (tree ? `\n来源 SPEC: ${tree.title}` : ""),
        provenance: "ai_generated",
      };
    }
    case "instruction.package": {
      return {
        title: "提示词包",
        summary: "给工程 agent 的可执行实现指令 (C_PACK)",
        content: buildPromptPackContent(state),
        provenance: "ai_generated",
      };
    }
    case "handoff.package": {
      return {
        title: "工程交接包",
        summary: "md · zip · 台账 · 验收 · 未决项",
        content: buildHandoffPackageContent(state),
        provenance: "ai_generated",
      };
    }
    default:
      return {
        title: "交付能力",
        summary: "未识别",
        content: "",
        provenance: "ai_generated",
      };
  }
}