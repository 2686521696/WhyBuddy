/**
 * P0 · C_GAP → C_QEXP → G_READY readiness chain (V5.1).
 * Scheduling + gap lifecycle — zero LLM.
 */

import type { V5CapabilityId } from "./contracts.js";
import type { CoverageGap, V5SessionState } from "./v5-reasoning-state.js";
import { userClearsReadiness } from "./sliderule-interactive-gates.js";

/**
 * 规约维度信号:目标文本是否提及「用户群 / 平台 / 核心场景·验收 / 范围边界」。
 * 命中越少→越欠规约。澄清问题(buildSimulatedClarifyQuestions)只针对缺失的维度发问,
 * 与 isUnderSpecifiedGoal 共用同一组判定(单一真相)。
 */
const SPEC_DIMENSIONS: Array<{
  key: "users" | "platform" | "scenario" | "scope";
  test: RegExp;
}> = [
  { key: "users", test: /用户|面向|客户|企业|个人|团队|学生|老人|儿童|开发者|商家|to ?[cb]/i },
  { key: "platform", test: /平台|web|网页|ios|android|安卓|小程序|桌面|客户端|saas|api|浏览器/i },
  { key: "scenario", test: /场景|流程|用于|目标是|核心|kpi|指标|验收|成功标准|解决/i },
  { key: "scope", test: /范围|不做|边界|mvp|仅|只做|首期|第一期|优先/i },
];

/**
 * V4-style clarification templates for SlideRule readiness.
 * Reference V4 CLARIFICATION_QUESTION_BLUEPRINTS + generateClarificationQuestionsWithLlm.
 * Fixed structure (dimensions + required fields), LLM fills tailored content + options.
 * Simulator uses these directly (no LLM). Real gap.ask LLM prompt now references templates.
 * 长期: 把 SLIDERULE_CLARIFICATION_TEMPLATES 合并到 V4 的全局 BLUEPRINTS (避免重复)，使 SlideRule 澄清使用统一 V4 generator + 策略。
 */
export const SLIDERULE_CLARIFICATION_TEMPLATES: Array<{
  id: string;
  key: "users" | "platform" | "scenario" | "scope";
  kind: string;  // V4 alignment, e.g. "audience" or "blueprint-question-audience"
  promptTemplate: string;
  type: ClarifyQuestionType;
  optionsTemplate?: string[];
  contextTemplate: string;
  defaultAnswerTemplate?: string;
}> = [
  {
    id: "users",
    key: "users",
    kind: "audience",
    promptTemplate: `「{goal}」主要面向谁使用?`,
    type: "single_choice",
    optionsTemplate: ["个人 / C 端用户", "企业 / 团队内部", "开发者 / 技术人员", "多方平台(撮合)"],
    contextTemplate: "用户群决定技术路线、交互复杂度与合规要求",
    defaultAnswerTemplate: "个人 / C 端用户",
  },
  {
    id: "platform",
    key: "platform",
    kind: "platform",
    promptTemplate: "优先在什么平台落地?",
    type: "single_choice",
    optionsTemplate: ["Web", "移动端(iOS/Android)", "小程序", "桌面端"],
    contextTemplate: "平台影响实现栈、发布方式与能力边界",
    defaultAnswerTemplate: "Web",
  },
  {
    id: "scenario",
    key: "scenario",
    kind: "success-criteria",
    promptTemplate: "核心成功标准 / 验收指标是什么?",
    type: "free_text",
    contextTemplate: "缺少可验收指标无法写 P0 需求",
  },
  {
    id: "scope",
    key: "scope",
    kind: "scope",
    promptTemplate: "本期范围边界:明确不做什么?",
    type: "free_text",
    contextTemplate: "界定边界避免范围漂移",
  },
];

/** 欠规约:目标过短或提及的规约维度 < 2 → 需要先澄清(用户选定「欠规约即澄清」)。 */
export function isUnderSpecifiedGoal(goalText: string): boolean {
  const t = (goalText || "").trim();
  if (!t) return true;
  if (t.length >= 80) return false; // 长描述视为已充分规约
  const hits = SPEC_DIMENSIONS.filter((d) => d.test.test(t)).length;
  return hits < 2;
}

export function openReadinessBlockingGaps(state: V5SessionState): CoverageGap[] {
  const contract = state.coverageContract;
  const blocking = new Set(contract?.blockingGapIds || []);
  return (state.coverageGaps || []).filter(
    (g) =>
      g.status === "open" &&
      (g.kind === "open_question" || g.kind === "missing_capability") &&
      (blocking.size === 0 || blocking.has(g.id))
  );
}

export function hasTrustedGapAskArtifact(state: V5SessionState): boolean {
  const stales = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).some(
    (a) =>
      a.producedBy?.capabilityId === "gap.ask" &&
      (a.trustLevel === "gated_pass" || a.trustLevel === "audited") &&
      !stales.has(a.id)
  );
}

/** True when ORCH should run gap.ask → question.expand before risk/report. */
export function needsReadinessChain(state: V5SessionState, userText: string): boolean {
  if (userClearsReadiness(userText, state)) return false;
  // 显式能力指令(收敛/交付/报告/结构化/路线/风险/预览…)不被澄清前置抢占 ——
  // 澄清只在用户「仅丢下一个欠规约目标、未点名具体能力」时触发。
  if (
    /报告|可行性|总结|收敛|report|落地|交付|路线|对比|预览|风险|安全|结构|拆解|structure|decompose|需求树|spec/.test(
      userText
    )
  )
    return false;
  if (state.goal?.status === "clear" || state.deliveryPhase === "shipping") return false;

  const openQ = openReadinessBlockingGaps(state).filter((g) => g.kind === "open_question");
  if (openQ.length > 0) return true;

  const goalText = state.goal?.text || "";
  // 欠规约即澄清(用户选定):仅在「会话起步」(尚无任何能力运行)且目标欠规约时,放行一次澄清轮 ——
  // 已经有推演产物/运行后(如已跑 risk/synthesis、brainstorm)不再回头打断,澄清只发生在最前。
  // 由 buildSimulatedClarifyQuestions 只对缺失维度发问;每会话一次、卡片可跳过。
  const isEarly = (state.capabilityRuns || []).length === 0;
  if (isEarly && isUnderSpecifiedGoal(goalText) && !hasTrustedGapAskArtifact(state)) return true;

  return false;
}

/** Picker prepend for S11: gap.ask then question.expand. */
export function pickReadinessChainCapabilities(
  state: V5SessionState
): Array<{ capabilityId: V5CapabilityId; roleId: string }> {
  const recent = new Set(
    (state.capabilityRuns || []).slice(-8).map((r) => r.capabilityId as V5CapabilityId)
  );
  const picks: Array<{ capabilityId: V5CapabilityId; roleId: string }> = [];
  if (!recent.has("gap.ask")) {
    picks.push({ capabilityId: "gap.ask", roleId: "规划" });
  }
  if (!recent.has("question.expand")) {
    picks.push({ capabilityId: "question.expand", roleId: "规划" });
  }
  return picks;
}

/**
 * 结构化澄清问题（gap.ask 产出，喂澄清卡片）。
 * 词汇对齐 V4 `BlueprintClarificationQuestion`（prompt/type/options:string[]/defaultAnswer/context）。
 */
export type ClarifyQuestionType = "free_text" | "single_choice" | "multi_choice";
/** 
 * 词汇对齐 V4 `BlueprintClarificationQuestion`。
 * 增加 kind 以支持 V4 风格的模板/策略区分 (如 target-first, risk-first 等)。
 */
export interface ClarifyQuestion {
  id?: string;
  kind?: string;  // V4 alignment, e.g. "audience", "platform", "scenario", "scope", or blueprint question id
  prompt: string;
  type?: ClarifyQuestionType;
  options?: string[];
  defaultAnswer?: string;
  context?: string;
}

/**
 * 模拟器 gap.ask 的结构化澄清问题(带选项),只针对目标缺失的规约维度发问。
 * 让澄清卡片在 server-llm / pilot / demo 所有执行器模式下都有选项(server clarify-json 之外的兜底)。
 * 现在基于 V4-style SLIDERULE_CLARIFICATION_TEMPLATES (固定模板结构 + goal 填充),
 * 参考 V4 CLARIFICATION_QUESTION_BLUEPRINTS + generateClarificationQuestionsWithLlm 模式。
 */
export function buildSimulatedClarifyQuestions(goalText: string): ClarifyQuestion[] {
  const goal = (goalText || "目标").trim();
  // V4-style: use templates (fixed structure), fill with goal (no LLM in simulator).
  const missingKeys = SPEC_DIMENSIONS.filter((d) => !d.test.test(goal)).map((d) => d.key);
  const questions = SLIDERULE_CLARIFICATION_TEMPLATES
    .filter((t) => missingKeys.includes(t.key))
    .map((t) => ({
      prompt: t.promptTemplate.replace("{goal}", goal),
      kind: t.kind,
      type: t.type,
      options: t.optionsTemplate,
      defaultAnswer: t.defaultAnswerTemplate,
      context: t.contextTemplate,
    } as ClarifyQuestion));
  // Guarantee at least one (core scenario).
  if (questions.length === 0) {
    const t = SLIDERULE_CLARIFICATION_TEMPLATES.find((t) => t.key === "scenario")!;
    questions.push({
      prompt: t.promptTemplate,
      kind: t.kind,
      type: t.type,
      context: t.contextTemplate,
    } as ClarifyQuestion);
  }
  // 小幅多样性：对 free_text 的 prompt 做轻微 goal 定制，避免完全固定句子
  // （LLM 路径下 generateSlideRuleClarifyQuestions + V4 generator 会产出更具针对性的变体）
  return questions.map((q) => {
    if (q.type === "free_text" && q.prompt && goal) {
      // 极简个性化：如果 goal 较长，prompt 里带入一点关键片段提示
      const hint = goal.length > 12 ? `（针对「${goal.slice(0, 18)}...」）` : "";
      if (!q.prompt.includes(hint) && q.prompt.includes("是什么")) {
        q.prompt = q.prompt.replace("是什么?", `是什么? ${hint}`);
      }
    }
    return q;
  });
}

/**
 * V4-aligned generator for SlideRule clarification questions.
 * - Simulator path: pure template fill (buildSimulatedClarifyQuestions).
 * - LLM path (in dialogue-exec-map gap.ask): prompt now instructs to follow templates exactly (see TASK_PROMPTS). Now directly calls V4 generateClarificationQuestionsWithLlm in executor for full budget/filtering/multi-round logic.
 * This mirrors V4's "fixed blueprints + LLM to instantiate specific questions based on current goal/input".
 * 
 * For non-dialogue paths (e.g. direct readiness call), pass a generator (e.g. the V4 one) when useLLM=true.
 * Long term: merge SLIDERULE_CLARIFICATION_TEMPLATES into V4 global BLUEPRINTS.
 */
export async function generateSlideRuleClarifyQuestions(
  goalText: string,
  useLLM: boolean = false,
  generator?: (input: any) => Promise<{ questions: any[] }>
): Promise<ClarifyQuestion[]> {
  if (useLLM && generator) {
    // 暴露给非-dialogue 路径 (e.g. readiness 直接调用 V4 generator)
    // 传入 templates 作为 blueprint + goal 作为 input
    const templateQuestions = SLIDERULE_CLARIFICATION_TEMPLATES.map(t => ({
      id: t.id,
      kind: t.kind,
      prompt: t.promptTemplate.replace("{goal}", goalText),
      required: true,
      routeDimension: t.key,
      readinessSignal: t.key,
    } as any));
    const intake = { id: "sliderule-direct", targetText: goalText, githubUrls: [], sources: [], domainNotes: "", assets: [] } as any;
    const strategy = { id: "sliderule-readiness", label: "SlideRule", templateId: "sliderule-readiness", summary: "Readiness using V4 templates" } as any;
    const result = await generator({ intake, strategy, templateQuestions, now: new Date().toISOString(), locale: "zh-CN" } as any);
    return (result.questions || []).map((q: any) => ({
      prompt: q.prompt,
      kind: q.kind,
      type: q.type || (q.options?.length ? "single_choice" : "free_text"),
      options: q.options,
      defaultAnswer: q.defaultAnswer,
      context: q.context,
    } as ClarifyQuestion));
  }
  // For consistency, always start from templates.
  // In real LLM flow (gap.ask), the prompt embeds the templates and asks LLM to output matching clarify-json.
  // Here we provide the simulator (fixed) version for non-LLM modes.
  return buildSimulatedClarifyQuestions(goalText);
}

/** 解析 gap.ask content 内的 ```clarify-json 围栏块 → 结构化问题 + 去块后的可读正文。 */
export function extractClarifyBlock(content: string): {
  questions: ClarifyQuestion[] | null;
  cleanedContent: string;
} {
  const re = /```clarify-json\s*([\s\S]*?)```/i;
  const m = content.match(re);
  if (!m) return { questions: null, cleanedContent: content };
  let questions: ClarifyQuestion[] | null = null;
  try {
    const parsed = JSON.parse(m[1].trim());
    const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : null;
    if (Array.isArray(arr)) {
      const validKinds = new Set(SLIDERULE_CLARIFICATION_TEMPLATES.map(t => t.kind));
      questions = arr
        .map((q: any) => {
          const prompt = String(q?.prompt ?? q?.question ?? "").trim();
          if (!prompt) return null;
          const options = Array.isArray(q.options)
            ? q.options
                .map((o: any) => (typeof o === "string" ? o : o?.label))
                .filter((o: any) => typeof o === "string" && o.trim())
                .slice(0, 4)
                .map((o: string) => o.trim().slice(0, 80))
            : undefined;
          const rawType = String(q?.type || "").trim();
          const type: ClarifyQuestionType =
            rawType === "single_choice" || rawType === "multi_choice" || rawType === "free_text"
              ? (rawType as ClarifyQuestionType)
              : options && options.length > 0
                ? "single_choice"
                : "free_text";
          let kind = typeof q?.kind === "string" ? q.kind : undefined;
          if (kind && !validKinds.has(kind)) kind = undefined; // only allow our V4-style kinds
          return {
            prompt: prompt.slice(0, 240),
            kind,
            type,
            options: options && options.length > 0 ? options : undefined,
            defaultAnswer:
              typeof (q?.defaultAnswer ?? q?.recommended) === "string"
                ? String(q.defaultAnswer ?? q.recommended).trim().slice(0, 80)
                : undefined,
            context: typeof q?.context === "string" ? q.context.trim().slice(0, 160) : undefined,
          } as ClarifyQuestion;
        })
        .filter((q): q is ClarifyQuestion => q !== null)
        .slice(0, 6);
    }
  } catch {
    questions = null;
  }

  // 严格 schema 校验 against our V4-style templates (like V4), but lenient for V4 kinds (e.g. "blueprint-question-*")
  if (questions) {
    const validKinds = new Set(SLIDERULE_CLARIFICATION_TEMPLATES.map(t => t.kind));
    questions = questions.filter((q: ClarifyQuestion) => {
      if (q.kind && !validKinds.has(q.kind) && !q.kind.startsWith("blueprint-question-")) return false;
      if (!q.prompt) return false;
      return true;
    });
  }

  const cleanedContent = content.replace(re, "").replace(/\n{3,}/g, "\n\n").trim();
  return { questions: questions && questions.length > 0 ? questions : null, cleanedContent };
}

/** Extract blocking questions from gap.ask artifact body. */
export function extractBlockingQuestions(content: string): string[] {
  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (/^[-*•]\s+/.test(line) && (line.includes("?") || line.includes("？"))) {
      out.push(line.replace(/^[-*•]\s+/, "").slice(0, 200));
    } else if (/^\d+[.)]\s+/.test(line) && (line.includes("?") || line.includes("？"))) {
      out.push(line.replace(/^\d+[.)]\s+/, "").slice(0, 200));
    } else if (/^【.+问题/.test(line) || /^问题\s*\d/.test(line)) {
      out.push(line.slice(0, 200));
    }
  }
  if (out.length === 0 && content.trim()) {
    out.push(content.trim().slice(0, 200));
  }
  return out.slice(0, 5);
}

/** After gap.ask commit: materialize open_question gaps + blockingGapIds. */
export function gapsFromGapAskContent(
  content: string,
  turnId: string,
  artifactId: string
): CoverageGap[] {
  const now = new Date().toISOString();
  const questions = extractBlockingQuestions(content);
  return questions.map((label, i) => ({
    id: `gap-q-${turnId}-${i}`,
    kind: "open_question" as const,
    label,
    status: "open" as const,
    reason: `gap.ask artifact ${artifactId}`,
    createdAt: now,
  }));
}

/** After gap.ask commit: materialize open_question gaps from STRUCTURED clarify questions (with options).
 * 完全对齐 V4 BlueprintClarificationQuestion schema (prompt/type/options/defaultAnswer/context + kind 扩展点)。
 */
export function gapsFromClarifyQuestions(
  questions: ClarifyQuestion[],
  turnId: string,
  artifactId: string
): CoverageGap[] {
  const now = new Date().toISOString();
  return questions.map((q, i) => ({
    id: `gap-q-${turnId}-${i}`,
    kind: "open_question" as const,
    label: q.prompt.slice(0, 240),
    status: "open" as const,
    reason: `gap.ask artifact ${artifactId}`,
    createdAt: now,
    clarifyType: q.type ?? (q.options && q.options.length > 0 ? "single_choice" : "free_text"),
    options: q.options && q.options.length > 0 ? q.options : undefined,
    defaultAnswer: q.defaultAnswer,
    context: q.context,
    clarifyKind: q.kind,  // V4 alignment, renamed to avoid clobbering CoverageGap.kind discriminant
    questionId: q.id || `gap-q-${turnId}-${i}`,
  }));
}

export function mergeGapAskIntoState(
  state: V5SessionState,
  gaps: CoverageGap[]
): V5SessionState {
  if (gaps.length === 0) return state;
  const existing = state.coverageGaps || [];
  const contract = state.coverageContract;
  const newIds = gaps.map((g) => g.id);
  const mergedGaps = [...existing];
  for (const g of gaps) {
    if (!mergedGaps.some((x) => x.id === g.id)) mergedGaps.push(g);
  }
  const blocking = new Set(contract?.blockingGapIds || []);
  for (const id of newIds) blocking.add(id);
  return {
    ...state,
    coverageGaps: mergedGaps,
    coverageContract: contract
      ? { ...contract, blockingGapIds: [...blocking] }
      : contract,
  };
}

/** INTAKE: user supplement resolves open_question blocking gaps. */
export function resolveReadinessGapsFromUserText(
  state: V5SessionState,
  userText: string
): V5SessionState {
  if (!userClearsReadiness(userText, state)) return state;
  const now = new Date().toISOString();
  let changed = false;
  const gaps = (state.coverageGaps || []).map((g) => {
    if (g.status !== "open" || g.kind !== "open_question") return g;
    changed = true;
    return { ...g, status: "resolved" as const, updatedAt: now };
  });
  return changed ? { ...state, coverageGaps: gaps } : state;
}

/**
 * 澄清卡片回答：按 gap id 精确把这些 open_question gap 置 resolved（支持部分回答）。
 * 比启发式整批解析更可靠 —— 卡片提交时带 answeredGapIds。
 */
export function resolveReadinessGapsByIds(
  state: V5SessionState,
  answeredGapIds: string[]
): V5SessionState {
  if (!answeredGapIds || answeredGapIds.length === 0) return state;
  const target = new Set(answeredGapIds);
  const now = new Date().toISOString();
  let changed = false;
  const gaps = (state.coverageGaps || []).map((g) => {
    if (g.status !== "open" || g.kind !== "open_question" || !target.has(g.id)) return g;
    changed = true;
    return { ...g, status: "resolved" as const, updatedAt: now };
  });
  return changed ? { ...state, coverageGaps: gaps } : state;
}