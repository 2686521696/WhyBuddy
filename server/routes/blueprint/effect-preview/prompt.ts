/**
 * Locale-aware, deterministic prompt builder for the Effect Preview LLM
 * service.
 *
 * Per design §4.5 / requirements 2.5 / 3.1 / 3.2:
 *
 * - `EFFECT_PREVIEW_PROMPT_ID` is the stable prompt version identifier,
 *   written into `BlueprintEffectPreview.provenance.promptId` and the
 *   emitted `BlueprintEventName.PreviewGenerated` event payload.
 * - `buildEffectPreviewPrompt(input)` is pure: no runtime / business
 *   imports, no network calls, no model / provider / apiKey hard-coding.
 *   The only runtime dependency is `node:crypto` for SHA-256 fingerprinting.
 *
 * The `userPayload` object literal uses a fixed key insertion order so
 * `JSON.stringify(..., null, 2)` yields byte-identical output across
 * repeated calls with the same input. Array orderings are normalised to
 * keep determinism:
 *
 *  - `sourceDocuments` sorted by `id` lexicographically.
 *  - `clarification.answers` sorted by `questionId` lexicographically
 *    (non-mutating copy).
 *  - `capabilityInvocations` / `capabilityEvidence` sorted by `id`.
 *  - `primaryRoute.steps` preserves the original input order.
 *  - `githubUrls` preserves the original input order.
 *  - `sourceDocuments[*].contentSnippet` truncated to
 *    {@link MAX_SOURCE_DOCUMENT_CONTENT_SNIPPET_LENGTH} characters to
 *    keep prompts bounded and avoid payload drift when upstream document
 *    bodies grow.
 *
 * Hard constraints (task 5.6 / design §4.5):
 *
 *  - No `import` of `callLLMJson`, `getAIConfig`, module-level `fetch`.
 *  - Only `import type` from `shared/blueprint` + a pure sha256 helper.
 */

import { createHash } from "node:crypto";

import type {
  BlueprintCapabilityEvidence,
  BlueprintCapabilityInvocation,
  BlueprintClarificationAnswer,
  BlueprintClarificationSession,
  BlueprintGenerationJob,
  BlueprintProjectDomainContext,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecTreeNode,
} from "../../../../shared/blueprint/index.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Stable prompt version identifier. Bump the trailing version when the
 * `userPayload` schema / systemMessage contract changes in a way that
 * would invalidate historical `promptFingerprint` comparisons.
 */
export const EFFECT_PREVIEW_PROMPT_ID = "blueprint.effect-preview.v1";

/**
 * Upper bound (characters) for `sourceDocuments[*].contentSnippet` in the
 * rendered `userPayload`. Chosen to stay well under typical LLM context
 * budgets when multiple SPEC documents accompany a single preview; the
 * exact value is local-only because `policy.ts` intentionally does not
 * own any prompt-shape fields (design §4.3 / task 5.6 keeps `prompt.ts`
 * free of runtime / business imports so the `EffectPreviewLlmPolicy`
 * cannot be imported here).
 */
const MAX_SOURCE_DOCUMENT_CONTENT_SNIPPET_LENGTH = 4000;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface EffectPreviewPromptPayload {
  promptId: string;
  systemMessage: string;
  userMessage: string;
  /** Deterministic object used to render `userMessage`; exposed for tests / audits. */
  userPayload: Record<string, unknown>;
  /** `"sha256:<hex>"` of `systemMessage + "\n\n" + userMessage`. */
  promptFingerprint: string;
}

export interface BuildEffectPreviewPromptInput {
  job: BlueprintGenerationJob;
  specTreeNode: BlueprintSpecTreeNode;
  sourceDocuments: BlueprintSpecDocument[];
  primaryRoute?: BlueprintRouteCandidate;
  clarificationSession?: BlueprintClarificationSession;
  domainContext?: BlueprintProjectDomainContext;
  capabilityInvocations?: BlueprintCapabilityInvocation[];
  capabilityEvidence?: BlueprintCapabilityEvidence[];
  includeDrafts: boolean;
  locale: "zh-CN" | "en-US";
}

// ---------------------------------------------------------------------------
// System messages (locale-aware)
// ---------------------------------------------------------------------------

const SYSTEM_MESSAGE_ZH_CN = `你是 /autopilot 管线中的 Effect Preview 生成器，当前任务是为给定的 SPEC Tree 节点产出一份"完成后长什么样"的效果预演。

给定用户的目标描述、澄清问答摘要、所选主路线的 steps / stages 摘要、目标节点的 id / title / summary / type / dependencies / outputs / priority、节点归属的 SPEC Documents 摘要，以及可选的 capability invocations 与 capability evidence 摘要，请以严格 JSON 形式返回该节点完成后的预演内容。

约束：
1. 必须返回合法 JSON，不得包含 Markdown 代码块围栏、不得返回任何解释性前置文字。
2. JSON 根对象必须包含：
   - "summary": 预演概要（字符串，trim 后非空，1..500 字符）
   - "architectureNotes": 架构要点数组，长度 1..8，每项 1..400 字符
   - "prototypeNotes": 原型/交互提示数组，长度 1..12，每项 1..400 字符
   - "progressPlan": 进度计划数组，长度 1..20，每项为 { title, summary, target } 三元组
   - "runtimeProjection": 运行时投影 { hudState, consoleLines, logTimeline, browserPreview? }
3. runtimeProjection.hudState 必须包含：
   - "title": HUD 顶部标题（字符串，1..200，trim 后非空）
   - "summary": HUD 概要（字符串，1..500，trim 后非空）
   - "progressPercent": 0 到 100 的浮点或整数
   - （可选）"status": "preview" 或 "completed"
   - （可选）"stage": "intake" / "routeset" / "spec_tree" / "spec_document" / "effect_preview" / "prompt_package" / "engineering_handoff"
   - （可选）"badges": 状态徽章数组（长度 0..8，每项 1..64 字符）
   - （可选）"activeNodeId": 当前活动节点 id
4. runtimeProjection.consoleLines：操作员可见的 console 行数组，长度 1..40，每项 1..500 字符，trim 后非空。
5. runtimeProjection.logTimeline：时间线事件数组，长度 1..40，每项：
   - "level": "info" / "warning" / "success"
   - "message": 1..500 字符，trim 后非空
   - （可选）"id": 本预演内唯一的 kebab/字符串标识，<=64 字符
   - （可选）"timestamp": ISO 8601 或形如 "+00:12.345" 的偏移
6. （可选）runtimeProjection.browserPreview：{ title, summary, url? } 用于浏览器端镜像 / 截图卡片；若节点无浏览器可视化效果可省略。
7. progressPlan[*].title 在本预演内唯一（不区分大小写）。
8. 不得引用外部 URL、真实邮箱、API 密钥字面量；敏感标识请抽象化。
9. 预演内容应围绕 specTreeNode 的 title / summary / outputs / dependencies、sourceDocuments 的 summary 与 primaryRoute 的 steps 推导，体现"节点完成后用户将看到什么、操作员将观察到什么"。`;

const SYSTEM_MESSAGE_EN_US = `You are the /autopilot Effect Preview generator. For a given SPEC Tree node, produce a "what it looks like when done" preview grounded in the user's goal, clarification answers, the selected primary route's steps / stages, the target node's id / title / summary / type / dependencies / outputs / priority, the SPEC Documents summaries attached to that node, and optional capability invocation / capability evidence summaries. Return the result as strict JSON.

Constraints:
1. Return a single JSON object. Do NOT wrap in Markdown code fences. Do NOT include any prose before or after.
2. The root object MUST include:
   - "summary": preview summary string (trim non-empty, 1..500 chars).
   - "architectureNotes": string[] of 1..8 entries, each 1..400 chars.
   - "prototypeNotes": string[] of 1..12 entries, each 1..400 chars.
   - "progressPlan": array of 1..20 { title, summary, target } milestones.
   - "runtimeProjection": { hudState, consoleLines, logTimeline, browserPreview? }.
3. runtimeProjection.hudState MUST include:
   - "title": HUD headline string (1..200, trim non-empty).
   - "summary": HUD summary string (1..500, trim non-empty).
   - "progressPercent": number in [0, 100].
   - (optional) "status": "preview" | "completed".
   - (optional) "stage": "intake" | "routeset" | "spec_tree" | "spec_document" | "effect_preview" | "prompt_package" | "engineering_handoff".
   - (optional) "badges": string[] of 0..8 entries, each 1..64 chars.
   - (optional) "activeNodeId": id of the currently active node.
4. runtimeProjection.consoleLines: operator-visible console lines, 1..40 entries, each 1..500 chars, trim non-empty.
5. runtimeProjection.logTimeline: timeline events, 1..40 entries. Each entry:
   - "level": "info" | "warning" | "success".
   - "message": 1..500 chars, trim non-empty.
   - (optional) "id": kebab / slug identifier unique within this preview, <=64 chars.
   - (optional) "timestamp": ISO 8601 string or offset form (e.g. "+00:12.345").
6. (optional) runtimeProjection.browserPreview: { title, summary, url? } for a browser-facing mirror / screenshot card; omit when the node has no browser-visible effect.
7. progressPlan[*].title MUST be unique within this preview (case-insensitive).
8. Do NOT reference external URLs, real email addresses, or API key literals; abstract sensitive identifiers.
9. Derive the preview from specTreeNode.title / summary / outputs / dependencies, the sourceDocuments summaries, and primaryRoute.steps so it describes what the user will see and what the operator will observe once the node is done.`;

// ---------------------------------------------------------------------------
// Helpers (pure)
// ---------------------------------------------------------------------------

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function compareById<T extends { id: string }>(a: T, b: T): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function compareByQuestionId(
  a: BlueprintClarificationAnswer,
  b: BlueprintClarificationAnswer,
): number {
  if (a.questionId < b.questionId) return -1;
  if (a.questionId > b.questionId) return 1;
  return 0;
}

function truncateSnippet(value: string, max: number): string {
  if (typeof value !== "string") return "";
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function projectSourceDocument(
  document: BlueprintSpecDocument,
): Record<string, unknown> {
  return {
    id: document.id,
    type: document.type,
    title: document.title,
    summary: document.summary,
    status: document.status,
    contentSnippet: truncateSnippet(
      document.content ?? "",
      MAX_SOURCE_DOCUMENT_CONTENT_SNIPPET_LENGTH,
    ),
  };
}

function projectSpecTreeNode(
  node: BlueprintSpecTreeNode,
): Record<string, unknown> {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    summary: node.summary,
    status: node.status,
    priority: node.priority,
    // Preserve original input order for dependencies / outputs (design §4.5).
    dependencies: [...node.dependencies],
    outputs: [...node.outputs],
    routeId: node.routeId,
    routeStepId: node.routeStepId,
  };
}

function projectPrimaryRoute(
  route: BlueprintRouteCandidate | undefined,
): Record<string, unknown> | undefined {
  if (!route) return undefined;
  return {
    id: route.id,
    title: route.title,
    summary: route.summary,
    rationale: route.rationale,
    // `primaryRoute.steps` preserves the original order (design §4.5).
    steps: route.steps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description,
      role: step.role,
    })),
    capabilities: route.capabilities.map((capability) => ({
      id: capability.id,
      label: capability.label,
    })),
  };
}

function buildIntakeBlock(
  job: BlueprintGenerationJob,
): Record<string, unknown> {
  const githubUrls = Array.isArray(job.request.githubUrls)
    ? // `githubUrls` preserves the original input order (design §4.5).
      [...job.request.githubUrls]
    : [];
  return {
    targetText: job.request.targetText,
    githubUrls,
  };
}

function buildClarificationBlock(
  session: BlueprintClarificationSession | undefined,
): Record<string, unknown> | undefined {
  if (!session) return undefined;
  // Non-mutating copy before sorting; source array must not be mutated.
  const answers = [...session.answers]
    .sort(compareByQuestionId)
    .map((answer) => ({
      questionId: answer.questionId,
      answer: answer.answer,
    }));
  return {
    strategyId: session.strategyId,
    templateId: session.templateId,
    answers,
  };
}

function buildProjectContextBlock(
  job: BlueprintGenerationJob,
  domainContext: BlueprintProjectDomainContext | undefined,
): Record<string, unknown> | undefined {
  const projectId = domainContext?.projectId ?? job.request.projectId;
  const sourceId = job.request.sourceId;
  if (projectId === undefined && sourceId === undefined && !domainContext) {
    return undefined;
  }
  // `BlueprintProjectDomainContext` does not currently expose `domain` /
  // `notes`; pass through `projectId` + `sourceId` only so the payload
  // shape stays stable even when those fields are added later.
  return {
    projectId,
    sourceId,
  };
}

function buildUpstreamEvidenceBlock(
  invocations: BlueprintCapabilityInvocation[] | undefined,
  evidence: BlueprintCapabilityEvidence[] | undefined,
): Record<string, unknown> | undefined {
  const hasInvocations = Array.isArray(invocations) && invocations.length > 0;
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0;
  if (!hasInvocations && !hasEvidence) return undefined;
  const block: Record<string, unknown> = {};
  if (hasInvocations) {
    block.capabilityInvocations = [...invocations!]
      .sort(compareById)
      .map((invocation) => ({
        id: invocation.id,
        capability: invocation.capabilityLabel,
        adapter: invocation.kind,
        status: invocation.status,
        summary: invocation.outputSummary,
      }));
  }
  if (hasEvidence) {
    block.capabilityEvidence = [...evidence!]
      .sort(compareById)
      .map((item) => ({
        id: item.id,
        label: item.capabilityLabel,
        summary: item.summary,
        kind: item.kind,
      }));
  }
  return block;
}

function buildOutputSchemaBlock(): Record<string, unknown> {
  return {
    summary: "string (1..500, trim 后非空)",
    architectureNotes: "array[1..8] of string (each 1..400, trim 后非空)",
    prototypeNotes: "array[1..12] of string (each 1..400, trim 后非空)",
    progressPlan:
      "array[1..20] of { title, summary, target } (title unique per preview, case-insensitive)",
    runtimeProjection: {
      hudState:
        "{ title (1..200), summary (1..500), progressPercent (0..100), status?, stage?, badges?, activeNodeId? }",
      consoleLines:
        "array[1..40] of string (each 1..500, trim 后非空)",
      logTimeline:
        "array[1..40] of { level: 'info'|'warning'|'success', message (1..500), id?, timestamp? }",
      browserPreview:
        "optional { title (1..200), summary (1..500), url? }",
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a deterministic prompt payload for the Effect Preview LLM call.
 *
 * Determinism guarantees (design §4.5):
 *
 *  - Same `(job, specTreeNode, sourceDocuments, primaryRoute,
 *    clarificationSession, domainContext, capabilityInvocations,
 *    capabilityEvidence, includeDrafts, locale)` tuple → byte-identical
 *    `userMessage` and `promptFingerprint`.
 *  - Optional sub-payloads omit themselves via `undefined` so
 *    `JSON.stringify` drops the key entirely instead of emitting `null`.
 *  - Array orderings are normalised as described at the top of this
 *    file.
 */
export function buildEffectPreviewPrompt(
  input: BuildEffectPreviewPromptInput,
): EffectPreviewPromptPayload {
  const systemMessage =
    input.locale === "zh-CN" ? SYSTEM_MESSAGE_ZH_CN : SYSTEM_MESSAGE_EN_US;

  const sortedDocuments = [...input.sourceDocuments]
    .sort(compareById)
    .map(projectSourceDocument);

  // Fixed key insertion order → fixed JSON.stringify output order.
  // Order: promptId / specTreeNode / sourceDocuments / primaryRoute /
  // intake / clarification / projectContext / upstreamEvidence /
  // includeDrafts / outputSchema (task 5.3).
  const userPayload: Record<string, unknown> = {
    promptId: EFFECT_PREVIEW_PROMPT_ID,
    specTreeNode: projectSpecTreeNode(input.specTreeNode),
    sourceDocuments: sortedDocuments,
    primaryRoute: projectPrimaryRoute(input.primaryRoute),
    intake: buildIntakeBlock(input.job),
    clarification: buildClarificationBlock(input.clarificationSession),
    projectContext: buildProjectContextBlock(input.job, input.domainContext),
    upstreamEvidence: buildUpstreamEvidenceBlock(
      input.capabilityInvocations,
      input.capabilityEvidence,
    ),
    includeDrafts: input.includeDrafts,
    outputSchema: buildOutputSchemaBlock(),
  };

  const userMessage = JSON.stringify(userPayload, null, 2);
  const promptFingerprint =
    "sha256:" + sha256Hex(systemMessage + "\n\n" + userMessage);

  return {
    promptId: EFFECT_PREVIEW_PROMPT_ID,
    systemMessage,
    userMessage,
    userPayload,
    promptFingerprint,
  };
}
