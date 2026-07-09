import type { WorkflowInputAttachment } from "@shared/workflow-input";

import {
  buildLaunchRoutePlan,
  type LaunchRouteCandidateId,
  type LaunchRouteCandidateMode,
  type LaunchRouteKind,
  type UnifiedLaunchInput,
} from "./launch-router";

export type AutopilotLaunchExampleKind =
  | "analysis"
  | "generation"
  | "implementation"
  | "research"
  | "attachment"
  | "advanced-execution";

export type LaunchDestinationConfidence = "low" | "medium" | "high";

export interface AutopilotLaunchExample {
  kind: AutopilotLaunchExampleKind;
  label: string;
  englishLabel: string;
  description: string;
  input: UnifiedLaunchInput;
  routeId: LaunchRouteCandidateId;
}

export interface LaunchDestinationPreview {
  goal: string;
  request: string | null;
  deliverable: string;
  deliverables: string[];
  constraints: string[];
  timeline: string | null;
  successCriteria: string[];
  missingInfo: string[];
  lockState: string | null;
  missingFields: Array<
    "goal" | "deliverable" | "constraints" | "timeline" | "successCriteria"
  >;
  confidence: LaunchDestinationConfidence;
  attachmentInfluence: {
    count: number;
    names: string[];
    summary: string;
    affectsRoute: boolean;
  };
  route: {
    kind: LaunchRouteKind;
    recommendedRouteId: LaunchRouteCandidateId;
    mode: LaunchRouteCandidateMode;
    requiresAdvancedRuntime: boolean;
    needsClarification: boolean;
  };
}

export type LaunchDestinationPreviewInput = Omit<
  UnifiedLaunchInput,
  "runtimeMode" | "text"
> & {
  text?: unknown;
  runtimeMode?: UnifiedLaunchInput["runtimeMode"];
  destinationText?: unknown;
  destination?: unknown;
  goal?: unknown;
  request?: unknown;
  deliverable?: unknown;
  deliverables?: unknown;
  constraints?: unknown;
  successCriteria?: unknown;
  success_criteria?: unknown;
  missingInfo?: unknown;
  missingInformation?: unknown;
  lockState?: unknown;
  lock_state?: unknown;
};

export const AUTOPILOT_LAUNCH_EXAMPLES: AutopilotLaunchExample[] = [
  {
    kind: "analysis",
    label: "分析",
    englishLabel: "Analysis",
    description:
      "整理已有信息并交付可验收的分析摘要，走当前支持的标准 mission 路线。",
    routeId: "standard-route",
    input: {
      text:
        "今天内整理支付告警排查结论，交付一页分析摘要，约束是只使用已有日志，成功标准是指出根因、影响范围和下一步处理建议。",
      runtimeMode: "advanced",
      attachments: [],
    },
  },
  {
    kind: "generation",
    label: "生成",
    englishLabel: "Generation",
    description: "生成文案或说明稿，不要求浏览器、终端或外部执行能力。",
    routeId: "standard-route",
    input: {
      text:
        "本周内完成会员续费页改版说明稿，交付产品说明和验收清单，约束是兼容移动端和现有埋点，成功标准是方案可被设计和研发直接评审。",
      runtimeMode: "advanced",
      attachments: [],
    },
  },
  {
    kind: "implementation",
    label: "实现",
    englishLabel: "Implementation",
    description: "拆解实现计划和验收路径，但不直接承诺运行未接入的真实执行器。",
    routeId: "standard-route",
    input: {
      text:
        "本周内完成任务详情页接管记录的前端实现计划，交付组件拆分、接口字段和验收清单，约束是复用现有任务数据结构，成功标准是研发可以按计划分步落地。",
      runtimeMode: "advanced",
      attachments: [],
    },
  },
  {
    kind: "research",
    label: "研究",
    englishLabel: "Research",
    description: "做资料整理、对比和结论沉淀，避免触发浏览器自动化等未确认能力。",
    routeId: "standard-route",
    input: {
      text:
        "明天前完成竞品任务自动驾驶入口研究，交付对比表和三条设计建议，约束是只基于已收集资料，成功标准是能支持下一轮首页信息架构评审。",
      runtimeMode: "advanced",
      attachments: [],
    },
  },
  {
    kind: "attachment",
    label: "附件处理",
    englishLabel: "Attachment",
    description: "结合附件或表格整理 brief，会进入当前支持的 deep/workflow 预览路线。",
    routeId: "deep-route",
    input: {
      text:
        "根据附件里的需求文档和表格，先整理 brief，再拆出工作包和角色分工，月底前交付排期、风险清单和验收标准。",
      runtimeMode: "advanced",
      attachments: [
        {
          id: "example-brief",
          name: "需求简报.md",
          mimeType: "text/markdown",
          size: 2048,
          content: "# 需求简报",
          excerpt: "会员增长项目需要拆解产品、设计、研发和数据工作。",
          excerptStatus: "parsed",
        },
      ],
    },
  },
  {
    kind: "advanced-execution",
    label: "高级执行",
    englishLabel: "Advanced execution",
    description: "需要浏览器、终端或沙箱能力时，只在 frontend 模式下提示运行时升级。",
    routeId: "upgrade-runtime",
    input: {
      text:
        "在沙箱里打开浏览器验证支付页面，抓取日志并输出测试结果、回滚建议和验收标准，今天完成。",
      runtimeMode: "frontend",
      attachments: [],
    },
  },
];

function normalizePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readPath(source: unknown, path: string): unknown {
  if (!isRecord(source)) return undefined;
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function readPreviewText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? normalizePreviewText(value)
    : null;
}

function pickPreviewText(source: unknown, paths: string[]): string | null {
  for (const path of paths) {
    const text = readPreviewText(readPath(source, path));
    if (text) return text;
  }
  return null;
}

function readPreviewTextFromValue(value: unknown): string | null {
  const direct = readPreviewText(value);
  if (direct || !isRecord(value)) return direct;

  return pickPreviewText(value, [
    "value",
    "description",
    "title",
    "item",
    "name",
    "question",
    "text",
    "label",
    "summary",
    "clarification",
    "suggestedClarification",
    "suggested_clarification",
  ]);
}

function readPreviewItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .flatMap(item => {
            if (typeof item === "string") {
              return splitPreviewItemsStable(item);
            }
            const text = readPreviewTextFromValue(item);
            return text ? [text] : [];
          })
          .filter(Boolean)
      )
    );
  }
  const single = readPreviewTextFromValue(value);
  return splitPreviewItemsStable(single);
}

function collectPreviewItems(source: unknown, paths: string[]): string[] {
  return Array.from(
    new Set(paths.flatMap(path => readPreviewItems(readPath(source, path))))
  );
}

const PREVIEW_TEXT_PATHS = [
  "text",
  "destinationText",
  "destination.destinationText",
  "destination.destination_text",
  "destination.request",
  "destination.userRequest",
  "destination.user_request",
  "destination.prompt",
  "destination.sourceInput.text",
  "sourceInput.text",
  "request",
];

const PREVIEW_GOAL_PATHS = [
  "destination.goal",
  "destination.destinationGoal",
  "destination.destination_goal",
  "destination.objective",
  "destination.summary",
  "destination.title",
  "normalizedGoal.title",
  "mappedWorkflowInput.goal",
  "mappedMissionContext.title",
  "goal",
  "destinationSummary",
  "destinationText",
];

const PREVIEW_REQUEST_PATHS = [
  "destination.request",
  "destination.userRequest",
  "destination.user_request",
  "destination.originalRequest",
  "destination.original_request",
  "destination.prompt",
  "destination.context",
  "destination.description",
  "destination.sourceInput.text",
  "sourceInput.text",
  "request",
  "text",
  "destinationText",
];

const PREVIEW_CONSTRAINT_PATHS = [
  "destination.constraints",
  "destination.constraint",
  "destination.limitations",
  "destination.requirements.constraints",
  "destination.parser.constraints",
  "constraints",
  "constraint",
  "limitations",
  "mappedMissionContext.reviewInput.constraints",
  "mappedWorkflowInput.plannerInput.constraints",
];

const PREVIEW_SUCCESS_CRITERIA_PATHS = [
  "destination.successCriteria",
  "destination.success_criteria",
  "destination.acceptanceCriteria",
  "destination.acceptance_criteria",
  "destination.doneCriteria",
  "destination.done_criteria",
  "destination.definitionOfDone",
  "destination.definition_of_done",
  "destination.requirements.successCriteria",
  "destination.requirements.success_criteria",
  "destination.parser.successCriteria",
  "destination.parser.success_criteria",
  "successCriteria",
  "success_criteria",
  "acceptanceCriteria",
  "acceptance_criteria",
  "mappedMissionContext.reviewInput.successCriteria",
  "mappedWorkflowInput.plannerInput.successCriteria",
];

const PREVIEW_DELIVERABLE_PATHS = [
  "destination.deliverables",
  "destination.deliverable",
  "destination.deliverableText",
  "destination.deliverable_text",
  "destination.outputs",
  "destination.output",
  "destination.artifacts",
  "destination.expectedDeliverables",
  "destination.expected_deliverables",
  "destination.parser.deliverables",
  "destination.parser.deliverable",
  "normalizedGoal.expectedDeliverables",
  "normalizedGoal.expected_deliverables",
  "outputs.deliverables",
  "outputs.deliverable",
  "deliverables",
  "deliverable",
];

const PREVIEW_MISSING_INFO_PATHS = [
  "destination.missingInfo",
  "destination.missingInformation",
  "destination.missing_info",
  "destination.missingFields",
  "destination.missing_fields",
  "destination.parser.missingInfo",
  "destination.parser.missingInformation",
  "missingInfo",
  "missingInformation",
  "missing_info",
  "mappedMissionContext.reviewInput.missingInformation",
];

const PREVIEW_LOCK_STATE_PATHS = [
  "destination.lockState",
  "destination.lock_state",
  "destination.goalLockState",
  "destination.goal_lock_state",
  "destination.lock.state",
  "destination.lock.status",
  "destination.status",
  "lockState",
  "lock_state",
];

const PREVIEW_LOCK_BOOLEAN_PATHS = [
  "destination.locked",
  "destination.isLocked",
  "destination.is_locked",
  "destination.confirmed",
  "destination.isConfirmed",
  "destination.is_confirmed",
  "destination.lock.locked",
  "destination.lock.confirmed",
];

function normalizePreviewLockState(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[\s_]+/g, "-");

  if (normalized === "confirmed" || normalized === "goal-locked") {
    return "locked";
  }
  if (
    normalized === "changed" ||
    normalized === "updated" ||
    normalized === "edited"
  ) {
    return "modified";
  }
  if (
    normalized === "needs-reconfirmation" ||
    normalized === "requires-reconfirm" ||
    normalized === "requires-confirmation" ||
    normalized === "needs-clarification" ||
    normalized === "clarification-needed" ||
    normalized === "missing-info" ||
    normalized === "missing-information" ||
    normalized === "blocked"
  ) {
    return "needs-reconfirm";
  }
  return value;
}

function pickPreviewLockState(source: unknown): string | null {
  const explicit = normalizePreviewLockState(
    pickPreviewText(source, PREVIEW_LOCK_STATE_PATHS)
  );
  if (explicit) return explicit;
  return PREVIEW_LOCK_BOOLEAN_PATHS.some(path => readPath(source, path) === true)
    ? "locked"
    : null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = normalizePreviewText(match?.[1] ?? "");
    if (value) return value;
  }
  return null;
}

function splitPreviewItems(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\s*(?:[;；、，,]|以及|和|并|与)\s*/g)
    .map(normalizePreviewText)
    .filter(Boolean)
    .slice(0, 4);
}

function truncatePreviewSection(value: string): string {
  const boundaries = [
    "成功标准是",
    "验收标准是",
    "验收清单",
    "约束是",
    "限制是",
    "要求是",
    "交付",
    "输出",
    "产出",
    "success criteria",
    "constraints",
    "deliverable",
  ];
  const lower = value.toLowerCase();
  let boundary = value.length;
  for (const label of boundaries) {
    const index = lower.indexOf(label.toLowerCase());
    if (index > 0 && index < boundary) {
      boundary = index;
    }
  }
  return value.slice(0, boundary);
}

function splitPreviewItemsStable(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/\s*(?:[;；、，,]|\n+|\band\b|\balso\b|以及|并|与)\s*/gi)
    .map(normalizePreviewText)
    .map(item => item.replace(/[.。]+$/g, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

function truncatePreviewSectionStable(value: string): string {
  const boundaries = [
    "success criteria",
    "success criterion",
    "acceptance criteria",
    "definition of done",
    "constraints",
    "requirements",
    "limitations",
    "timeline",
    "deadline",
    "deliverable",
    "deliverables",
  ];
  const lower = value.toLowerCase();
  let boundary = value.length;
  for (const label of boundaries) {
    const index = lower.indexOf(label);
    if (index > 0 && index < boundary) {
      boundary = index;
    }
  }
  return value.slice(0, boundary);
}

function inferGoal(text: string): string {
  return (
    firstMatch(text, [
      /(?:目标是|目标为|目的地是|我要|需要|请|帮我)\s*([^，。；;]+)/i,
      /^([^，。；;]+)/,
    ]) ?? "待澄清目的地"
  );
}

function inferDeliverable(text: string): string {
  const stableDeliverable = firstMatch(text, [
    /(?:deliverables?|outputs?|produce)(?:\s*(?:is|are))?[：:\s]*([^。\n]+)/i,
  ]);
  if (stableDeliverable) {
    const items = splitPreviewItemsStable(
      truncatePreviewSectionStable(stableDeliverable)
    );
    if (items.length > 0) return items.join(", ");
  }

  return (
    firstMatch(text, [
      /(?:交付|输出|产出|deliverable(?:s)?(?: is| are|:)?)[：:\s]*([^，。；;]+)/i,
      /(?:给出|提供)\s*([^，。；;]*(?:报告|方案|摘要|清单|结果|建议)[^，。；;]*)/i,
    ]) ?? "待确认交付物"
  );
}

function inferTimeline(text: string): string | null {
  return firstMatch(text, [
    /(今天(?:内|完成)?|明天(?:前|内)?|本周(?:内|前)?|下周(?:内|前)?|月底前|本月内)/i,
    /(?:deadline|before|by)\s+([^，。；;]+)/i,
  ]);
}

function inferConstraints(text: string): string[] {
  const stable = splitPreviewItemsStable(
    truncatePreviewSectionStable(
      firstMatch(text, [
        /(?:constraints?|requirements?|limitations?)(?:\s*(?:are|is))?[：:\s]*([^。\n]+)/i,
      ]) ?? ""
    )
  );
  if (stable.length > 0) return stable;

  const explicit = splitPreviewItems(
    truncatePreviewSection(
      firstMatch(text, [
        /(?:约束是|限制是|要求是|constraints?(?: are| is|:)?)[：:\s]*([^。]+)/i,
        /(?:注意|必须)\s*([^。]*(?:兼容|预算|风险|回滚|日志|权限|合规|SLA|测试)[^。]*)/i,
      ]) ?? ""
    )
  );
  return explicit.length > 0 ? explicit : [];
}

function inferSuccessCriteria(text: string): string[] {
  const stable = splitPreviewItemsStable(
    truncatePreviewSectionStable(
      firstMatch(text, [
        /(?:success criteria|acceptance criteria|definition of done)(?:\s*(?:are|is))?[：:\s]*([^。\n]+)/i,
      ]) ?? ""
    )
  );
  if (stable.length > 0) return stable;

  const explicit = splitPreviewItems(
    truncatePreviewSection(
      firstMatch(text, [
        /(?:成功标准是|验收标准是|验收清单是|success criteria(?: are| is|:)?)[：:\s]*([^。]+)/i,
        /(?:可被|能够|可以)\s*([^。]*(?:评审|验收|发布|执行)[^。]*)/i,
      ]) ?? ""
    )
  );
  return explicit.length > 0 ? explicit : [];
}

function buildAttachmentInfluence(attachments: WorkflowInputAttachment[]) {
  const names = attachments
    .map(attachment => normalizePreviewText(attachment.name))
    .filter(Boolean)
    .slice(0, 4);

  if (attachments.length === 0) {
    return {
      count: 0,
      names,
      summary: "未附加材料，预览仅基于目的地文本。",
      affectsRoute: false,
    };
  }

  return {
    count: attachments.length,
    names,
    summary: `已附 ${attachments.length} 个材料，启动预览会优先把附件视为 destination context。`,
    affectsRoute: true,
  };
}

function buildMissingFields(input: {
  text: string;
  goal: string;
  deliverable: string;
  constraints: string[];
  timeline: string | null;
  successCriteria: string[];
}) {
  const missing: LaunchDestinationPreview["missingFields"] = [];
  if (!input.goal || (input.text.length > 0 && input.text.length < 12)) {
    missing.push("goal");
  }
  if (input.deliverable === "待确认交付物") missing.push("deliverable");
  if (input.constraints.length === 0) missing.push("constraints");
  if (!input.timeline) missing.push("timeline");
  if (input.successCriteria.length === 0) missing.push("successCriteria");
  return missing;
}

function inferConfidence(
  missingFields: LaunchDestinationPreview["missingFields"],
  attachmentCount: number
): LaunchDestinationConfidence {
  if (missingFields.length <= 1) return "high";
  if (missingFields.length <= 3 || attachmentCount > 0) return "medium";
  return "low";
}

export function buildLaunchDestinationPreview(
  input: LaunchDestinationPreviewInput
): LaunchDestinationPreview {
  const text = pickPreviewText(input, PREVIEW_TEXT_PATHS) ?? "";
  const attachments = input.attachments ?? [];
  const routePlan = buildLaunchRoutePlan({
    text,
    attachments,
    runtimeMode: input.runtimeMode ?? "advanced",
  });
  const recommendedCandidate =
    routePlan.candidates.find(
      candidate => candidate.id === routePlan.recommendedRouteId
    ) ?? routePlan.candidates[0];
  const goal = pickPreviewText(input, PREVIEW_GOAL_PATHS) ?? inferGoal(text);
  const request = pickPreviewText(input, PREVIEW_REQUEST_PATHS);
  const deliverables = collectPreviewItems(input, PREVIEW_DELIVERABLE_PATHS);
  const deliverable =
    deliverables.length > 0 ? deliverables.join(", ") : inferDeliverable(text);
  const explicitConstraints = collectPreviewItems(
    input,
    PREVIEW_CONSTRAINT_PATHS
  );
  const constraints =
    explicitConstraints.length > 0 ? explicitConstraints : inferConstraints(text);
  const timeline = inferTimeline(text);
  const explicitSuccessCriteria = collectPreviewItems(
    input,
    PREVIEW_SUCCESS_CRITERIA_PATHS
  );
  const successCriteria =
    explicitSuccessCriteria.length > 0
      ? explicitSuccessCriteria
      : inferSuccessCriteria(text);
  const missingInfo = collectPreviewItems(input, PREVIEW_MISSING_INFO_PATHS);
  const lockState = pickPreviewLockState(input);
  const missingFields = buildMissingFields({
    text,
    goal,
    deliverable,
    constraints,
    timeline,
    successCriteria,
  });
  const attachmentInfluence = buildAttachmentInfluence(attachments);

  return {
    goal,
    request,
    deliverable,
    deliverables:
      deliverables.length > 0
        ? deliverables
        : missingFields.includes("deliverable")
          ? []
          : [deliverable],
    constraints,
    timeline,
    successCriteria,
    missingInfo,
    lockState,
    missingFields,
    confidence: inferConfidence(missingFields, attachments.length),
    attachmentInfluence,
    route: {
      kind: routePlan.decision.kind,
      recommendedRouteId: routePlan.recommendedRouteId,
      mode: recommendedCandidate.mode,
      requiresAdvancedRuntime: routePlan.decision.requiresAdvancedRuntime,
      needsClarification: routePlan.decision.needsClarification,
    },
  };
}
