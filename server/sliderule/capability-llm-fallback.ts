/**
 * Deterministic capability outputs when real LLM / pool calls fail.
 * Returns the raw executor contract with provenance llm_fallback so sessions
 * keep progressing instead of 500 → client hardcoded pilot text.
 */

import type { V5CapabilityId } from "../../shared/blueprint/contracts.js";
import type { V5SessionState } from "../../shared/blueprint/v5-reasoning-state.js";
import type { ReasoningEvent } from "../../shared/blueprint/sliderule-reasoning-events.js";
import { buildStructuredReport } from "../../shared/blueprint/sliderule-report-builder.js";
import { goalStatusUserLabel } from "../../shared/blueprint/sliderule-turn-route.js";
import { isDialogueCapability, type DialogueCapabilityId } from "./dialogue-exec-map.js";
import { isDeliberationCapability } from "./deliberation-exec-map.js";

export type CapabilityFallbackArgs = {
  capabilityId: string;
  state: V5SessionState;
  inputArtifactIds?: string[];
  roleId?: string;
  turnId: string;
  reason?: string;
};

export type CapabilityFallbackResult = {
  title: string;
  summary: string;
  content: string;
  provenance: "llm_fallback";
  degraded: true;
  degradedReason: string;
  events?: ReasoningEvent[];  // V5.3 P2.4
};

function goalText(state: V5SessionState): string {
  return String(state.goal?.text || "本轮推演目标").trim();
}

function statusLabel(state: V5SessionState): string {
  return goalStatusUserLabel(state.goal?.status);
}

function tag(reason?: string): string {
  const r = String(reason || "llm_unavailable").slice(0, 80);
  return `[llm_fallback:${r}]`;
}

function dialogueFallback(
  cap: DialogueCapabilityId,
  state: V5SessionState,
  roleId: string | undefined,
  reason?: string
): CapabilityFallbackResult {
  const goal = goalText(state);
  const status = statusLabel(state);
  const role = roleId || "综合";

  const bodies: Record<DialogueCapabilityId, { title: string; summary: string; body: string }> = {
    "intent.clarify": {
      title: "需求澄清（降级）",
      summary: `围绕「${goal.slice(0, 40)}」的模板澄清`,
      body:
        `【当前理解】\n` +
        `你想推演的是：${goal}。当前结论状态为「${status}」。\n\n` +
        `【已经明确的】\n` +
        `目前仅有用户目标一句话；外部 LLM 暂不可用，以下为规则模板继续推进。\n\n` +
        `【最需要回答的问题】\n` +
        `1. 本期范围边界是什么？（默认假设：先做 MVP 核心路径）\n` +
        `2. 成功的验收标准是什么？（默认假设：可演示端到端主流程）\n` +
        `3. 有哪些硬约束（合规/性能/成本）？（默认假设：小团队 4 周内可交付）\n\n` +
        `请直接补充第 1 点，或回复「按默认假设继续」。`,
    },
    "route.generate": {
      title: "路线草案（降级）",
      summary: `为「${goal.slice(0, 40)}」生成 2 条模板路线`,
      body:
        `路线一：渐进交付\n` +
        `**思路**：先打通主路径，再补治理与扩展点。\n` +
        `**适合的前提**：时间紧、需要尽快验证价值。\n` +
        `**主要代价**：早期技术债需在第二期偿还。\n` +
        `**第一周做什么**：梳理主流程 · 定 MVP 范围 · 列出阻塞问题\n\n` +
        `路线二：平台化底座\n` +
        `**思路**：先建可复用底座，再叠加业务特性。\n` +
        `**适合的前提**：预期多模块长期演进。\n` +
        `**主要代价**：首版可见成果较晚。\n` +
        `**第一周做什么**：画边界上下文 · 定接口契约 · 选存储与权限模型`,
    },
    "route.compare": {
      title: "路线对比（降级）",
      summary: "模板对比：渐进交付 vs 平台化底座",
      body:
        `本轮没有可用的 LLM 路线对比；以下基于常见两条候选做条件式结论：\n\n` +
        `**上线速度**：渐进交付更快。\n` +
        `**长期演进成本**：平台化底座更低。\n` +
        `**风险集中点**：渐进交付在权限/数据模型返工；平台化在过度设计。\n` +
        `**小团队适配**：渐进交付更扛住人少维护。\n\n` +
        `【条件式结论】\n` +
        `如果你最看重 4 周内见到可用成果 → 选渐进交付。\n` +
        `如果你最看重 一年后扩展成本 → 选平台化底座。`,
    },
    "requirement.write": {
      title: "需求草案（降级）",
      summary: `「${goal.slice(0, 40)}」P0 模板需求`,
      body:
        `**目标与边界**\n` +
        `目标：${goal}。本期不做：非核心报表、全自动运维、跨租户高级策略。\n\n` +
        `**功能需求**\n` +
        `P0-1 用户能完成主流程闭环|验收:主路径 E2E 用例通过\n` +
        `P0-2 关键操作可审计|验收:审计日志含操作者/时间/对象\n` +
        `P0-3 权限最小集合可用|验收:未授权访问返回 403\n\n` +
        `**非功能需求**\n` +
        `P0-NF1 主列表 1000 条数据首屏 ≤ 3s（内网演示环境）\n\n` +
        `**未决依赖**\n` +
        `依赖澄清问题 #1；不解决会阻塞 P0-1 范围定义。`,
    },
    "gap.ask": {
      title: "阻塞缺口（降级）",
      summary: `「${goal.slice(0, 40)}」模板阻塞问题`,
      body:
        `【阻塞缺口】\n` +
        `- 面向谁使用？缺少用户群将无法选路线。\n` +
        `- 核心成功标准是什么？缺少验收指标无法写需求。\n` +
        `- 本期明确不做什么？\n` +
        `（需用户从 INTAKE 补充，禁止 LLM 自答确认）`,
    },
    "question.expand": {
      title: "扩展追问（降级）",
      summary: "阻塞缺口展开模板",
      body:
        `【扩展问题】\n` +
        `1. 用户群与场景？\n   默认假设：企业内部工具\n   风险：假设错误会导致路线全偏\n` +
        `2. 权限与数据范围？\n   默认假设：RBAC + 部门隔离\n   风险：后期改造成本高\n` +
        `（需用户补充，系统不得自答确认）`,
    },
  };

  const block = bodies[cap];
  // V5.3 P2.4: emit think events for fallback with "模板兜底" meta
  const fbRunId = `fb-${Date.now()}`;
  // (simple 1-2 think; full makeEventSequence imported in caller if needed; here return shape)
  const fbEvents: any[] = [
    { kind: "think", text: "使用模板兜底生成结果", meta: { source: "template_fallback", reason: reason || "llm_unavailable" } },
  ];
  return {
    title: block.title,
    summary: `${block.summary} ${tag(reason)}`,
    content: `${block.body}\n\n（${role} 视角 · LLM 暂不可用，左侧 Flow 仍可继续质疑与续跑）`,
    provenance: "llm_fallback",
    degraded: true,
    degradedReason: reason || "llm_unavailable",
    events: fbEvents,
  };
}

function riskFallback(state: V5SessionState, roleId: string | undefined, reason?: string): CapabilityFallbackResult {
  const goal = goalText(state);
  return {
    title: "风险扫描（降级）",
    summary: `针对「${goal.slice(0, 40)}」的模板风险 ${tag(reason)}`,
    content:
      `【范围风险】目标「${goal}」若边界未冻结，容易在第二期范围膨胀。\n` +
      `【权限/数据风险】跨角色数据可见性未定义时，易出现越权或误共享。\n` +
      `【交付风险】外部 LLM 不可用时，需依赖规则模板 + 用户补充，结论可信度降级为待细化。\n` +
      `【缓解】优先补齐 P0 验收标准；在 Flow 节点上质疑任一风险条目以触发重推演。\n` +
      `（${roleId || "安全"} 视角）`,
    provenance: "llm_fallback",
    degraded: true,
    degradedReason: reason || "llm_unavailable",
  };
}

function deliberationFallback(
  capabilityId: V5CapabilityId,
  state: V5SessionState,
  reason?: string
): CapabilityFallbackResult {
  const goal = goalText(state);
  const lines: Record<string, string> = {
    "counter.argue": `针对「${goal}」：过早追求完备方案可能拖慢验证；建议先锁定 MVP 再扩展。`,
    "critique.generate": `质疑点：当前材料是否足以支撑「${statusLabel(state)}」结论？需更多可验证证据。`,
    "rebuttal.resolve": `回应：在信息不足时，显式假设优于沉默推断；待用户确认默认假设后继续。`,
    "synthesis.merge": `综合：保留分歧——速度优先与底座优先仍待用户取舍；不宣布唯一答案。`,
  };
  const content = lines[capabilityId] || `针对「${goal}」的审议降级输出。`;
  return {
    title: `${capabilityId}（降级）`,
    summary: `头脑风暴协议降级 ${tag(reason)}`,
    content,
    provenance: "llm_fallback",
    degraded: true,
    degradedReason: reason || "deliberation_degraded",
  };
}

export function buildCapabilityLlmFallback(
  args: CapabilityFallbackArgs
): CapabilityFallbackResult | null {
  const { capabilityId, state, roleId, reason } = args;

  if (isDialogueCapability(capabilityId)) {
    return dialogueFallback(capabilityId, state, roleId, reason);
  }
  if (capabilityId === "risk.analyze") {
    return riskFallback(state, roleId, reason);
  }
  if (capabilityId === "report.write") {
    const built = buildStructuredReport({
      state,
      inputArtifactIds: args.inputArtifactIds || [],
      roleId,
    });
    return {
      title: built.title,
      summary: `${built.summary} ${tag(reason)}`,
      content: built.content,
      provenance: "llm_fallback",
      degraded: true,
      degradedReason: reason || "report_template",
    };
  }
  if (isDeliberationCapability(capabilityId)) {
    return deliberationFallback(capabilityId as V5CapabilityId, state, reason);
  }
  return null;
}

export function isLlmContentHijackError(message: string): boolean {
  return /hijacked|llm content hijacked/i.test(message);
}