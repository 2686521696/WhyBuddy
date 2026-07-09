import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  LoaderCircle,
  MessageSquare,
  Send,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import {
  normalizeWebAigcHitlFormData,
  readWebAigcHitlFieldDefinitions,
  type DecisionType,
  type MissionDecision,
  type MissionDecisionSubmission,
  type MissionDecisionOption,
  type WebAigcHitlAttachmentValue,
  type WebAigcHitlFieldDefinition,
  type WebAigcHitlFieldValue,
} from "@shared/mission/contracts";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  workspaceCalloutClass,
  workspaceToneClass,
  type WorkspaceTone,
} from "@/components/workspace/workspace-tone";
import { useI18n } from "@/i18n";
import { submitMissionDecision } from "@/lib/mission-client";
import { cn } from "@/lib/utils";

interface DecisionPanelProps {
  missionId: string;
  decision: MissionDecision;
  onDecisionSubmitted?: () => void;
}

type ParamCollectionDraft = Record<string, WebAigcHitlFieldValue | undefined>;

type ParamCollectionSubmissionMetadata = {
  nodeType: "param_collection";
  sessionId?: string;
  nodeId?: string;
  interactionId?: string;
  branchKey?: string;
  formData: Record<string, WebAigcHitlFieldValue>;
};

type RequestInfoSubmission = {
  optionId?: string;
  freeText: string;
};

type DecisionContextNotice = {
  label: string;
  detail: string;
};

export function buildParamCollectionSubmission(
  decision: MissionDecision,
  draft: ParamCollectionDraft
): {
  metadata?: ParamCollectionSubmissionMetadata;
  fieldErrors: Record<string, string>;
  error?: string;
} {
  const fields = readWebAigcHitlFieldDefinitions(decision.payload);
  if (
    decision.payload?.nodeType !== "param_collection" ||
    fields.length === 0
  ) {
    return {
      fieldErrors: {},
    };
  }

  const normalized = normalizeWebAigcHitlFormData(fields, draft);
  if (normalized.errors.length > 0) {
    return {
      fieldErrors: normalized.fieldErrors,
      error: normalized.errors[0],
    };
  }

  return {
    metadata: {
      nodeType: "param_collection",
      sessionId:
        typeof decision.payload?.sessionId === "string"
          ? decision.payload.sessionId
          : undefined,
      nodeId:
        typeof decision.payload?.nodeId === "string"
          ? decision.payload.nodeId
          : undefined,
      interactionId:
        typeof decision.payload?.interactionId === "string"
          ? decision.payload.interactionId
          : undefined,
      branchKey:
        typeof decision.payload?.branchKey === "string"
          ? decision.payload.branchKey
          : undefined,
      formData: normalized.value,
    },
    fieldErrors: {},
  };
}

export function buildParamCollectionDecisionSubmission(
  decision: MissionDecision,
  optionId: string,
  draft: Record<string, WebAigcHitlFieldValue | undefined>
): {
  submission?: MissionDecisionSubmission;
  fieldErrors: Record<string, string>;
  error?: string;
} {
  const trimmedOptionId = optionId.trim();
  if (!trimmedOptionId) {
    return {
      fieldErrors: {},
      error: "A submission option is required.",
    };
  }

  const paramCollection = buildParamCollectionSubmission(decision, draft);
  if (paramCollection.error) {
    return paramCollection;
  }

  if (!paramCollection.metadata) {
    return {
      fieldErrors: {},
      error: "This decision does not collect structured parameters.",
    };
  }

  return {
    submission: {
      optionId: trimmedOptionId,
      metadata: paramCollection.metadata,
    },
    fieldErrors: {},
  };
}

export function buildRequestInfoSubmission(
  decision: MissionDecision,
  freeText: string
): {
  submission?: RequestInfoSubmission;
  error?: string;
} {
  const trimmed = freeText.trim();
  if (!trimmed) {
    return {
      error: "Please provide the requested information.",
    };
  }

  if (decision.allowFreeText === true) {
    return {
      submission: {
        freeText: trimmed,
      },
    };
  }

  const clarificationOption = decision.options?.find(
    option => option.requiresComment
  );
  if (clarificationOption?.requiresComment) {
    return {
      submission: {
        optionId: clarificationOption.id,
        freeText: trimmed,
      },
    };
  }

  return {
    error: "This clarification step does not accept free-text submissions.",
  };
}

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

function resolveDecisionType(decision: MissionDecision): DecisionType {
  return decision.type ?? "custom-action";
}

function isPayloadRecord(
  value: MissionDecision["payload"]
): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function payloadNodeType(decision: MissionDecision): string | null {
  if (!isPayloadRecord(decision.payload)) {
    return null;
  }
  return typeof decision.payload.nodeType === "string"
    ? decision.payload.nodeType
    : null;
}

function payloadString(
  decision: MissionDecision,
  key: string
): string | null {
  if (!isPayloadRecord(decision.payload)) {
    return null;
  }
  const value = decision.payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatTokenLabel(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map(token => `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

function localizeNodeType(locale: string, value: string): string {
  switch (value) {
    case "param_collection":
      return t(locale, "参数采集", "Param Collection");
    case "confirm_judge":
      return t(locale, "确认判断", "Confirm Judge");
    case "selection":
      return t(locale, "选择", "Selection");
    default:
      return formatTokenLabel(value);
  }
}

function payloadRecordList(
  decision: MissionDecision,
  key: string
): Array<Record<string, unknown>> {
  if (!isPayloadRecord(decision.payload)) {
    return [];
  }
  const value = decision.payload[key];
  return Array.isArray(value)
    ? value.filter(
        item =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      )
    : [];
}

function candidateValue(
  candidate: Record<string, unknown>,
  key: string
): string | null {
  const value = candidate[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function candidateLabel(candidate: Record<string, unknown>): string | null {
  return (
    candidateValue(candidate, "label") ||
    candidateValue(candidate, "title") ||
    candidateValue(candidate, "optionId") ||
    candidateValue(candidate, "routeId")
  );
}

function candidateRouteId(candidate: Record<string, unknown>): string | null {
  return (
    candidateValue(candidate, "routeId") ||
    candidateValue(candidate, "id") ||
    candidateValue(candidate, "optionId")
  );
}

function buildDecisionContextNotices(
  decision: MissionDecision,
  fields: WebAigcHitlFieldDefinition[],
  locale: string
): DecisionContextNotice[] {
  const notices: DecisionContextNotice[] = [];
  const nodeType = payloadNodeType(decision);
  const branchKey = payloadString(decision, "branchKey");
  const sessionId = payloadString(decision, "sessionId");
  const interactionId = payloadString(decision, "interactionId");
  const candidates = payloadRecordList(decision, "candidateRoutes");
  const recommendedRouteId = payloadString(decision, "recommendedRouteId");
  const recommendedRoute = recommendedRouteId
    ? candidates.find(candidate => candidateRouteId(candidate) === recommendedRouteId)
    : null;

  if (nodeType === "confirm_judge") {
    notices.push({
      label: t(locale, "节点", "Node"),
      detail: branchKey
        ? t(
            locale,
            `${localizeNodeType(locale, nodeType)} 将使用 branchKey "${branchKey}" 路由后续分支。`,
            `${localizeNodeType(locale, nodeType)} routes the next branch with branchKey "${branchKey}".`
          )
        : t(
            locale,
            `${localizeNodeType(locale, nodeType)} 将根据人工确认结果切换后续分支。`,
            `${localizeNodeType(locale, nodeType)} will switch the next branch from the human confirmation result.`
          ),
    });
  }

  if (nodeType === "param_collection" && fields.length > 0) {
    const fieldLabels = fields
      .map(field => field.label)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");

    notices.push({
      label: t(locale, "表单数据", "Form Data"),
      detail: t(
        locale,
        `将提交结构化表单数据${fieldLabels ? `：${fieldLabels}` : ""}。`,
        `Structured form data will be submitted${fieldLabels ? `: ${fieldLabels}` : ""}.`
      ),
    });
  }

  if (resolveDecisionType(decision) === "request-info" && decision.allowFreeText) {
    notices.push({
      label: t(locale, "输入方式", "Input"),
      detail: t(
        locale,
        "当前步骤接受自由文本补充说明。",
        "This step accepts a free-text clarification response."
      ),
    });
  }

  if (
    resolveDecisionType(decision) === "multi-choice" &&
    candidates.length > 0
  ) {
    notices.push({
      label: t(locale, "路线选择", "Route Selection"),
      detail: recommendedRoute
        ? t(
            locale,
            `推荐路线：${candidateLabel(recommendedRoute) ?? recommendedRouteId ?? ""}。`,
            `Recommended route: ${candidateLabel(recommendedRoute) ?? recommendedRouteId ?? ""}.`
          )
        : t(
            locale,
            "当前多选步骤将提交所选路线的结构化元数据。",
            "This multi-choice step will submit structured metadata for the selected route."
          ),
    });
    notices.push({
      label: t(locale, "提交语义", "Submission"),
      detail: t(
        locale,
        "会记录所选路线、路线标签、路线 ID；若填写评论，则作为改线原因提交。",
        "The submission records the selected route option, route label, and route id; any comment is submitted as the route change reason."
      ),
    });
  }

  const metadataRefs = [
    sessionId ? `${t(locale, "Session", "Session")}: ${sessionId}` : null,
    interactionId
      ? `${t(locale, "Interaction", "Interaction")}: ${interactionId}`
      : null,
    branchKey ? `${t(locale, "Branch", "Branch")}: ${branchKey}` : null,
  ].filter(Boolean) as string[];

  if (metadataRefs.length > 0 && nodeType !== "confirm_judge") {
    notices.push({
      label: t(locale, "上下文", "Context"),
      detail: metadataRefs.join(" | "),
    });
  }

  return notices;
}

function snapshotDecisionOption(option: MissionDecisionOption) {
  return {
    id: option.id,
    label: option.label,
    description: option.description,
    action: option.action,
    severity: option.severity,
    requiresComment: option.requiresComment === true,
  };
}

function snapshotDecisionField(field: WebAigcHitlFieldDefinition) {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required === true,
    placeholder: field.placeholder,
    defaultValue: field.defaultValue,
    options: field.options?.map(option => ({
      value: option.value,
      label: option.label,
    })),
  };
}

export function buildDecisionInteractionKey(
  decision: MissionDecision
): string {
  const payload =
    decision.payload && typeof decision.payload === "object"
      ? (decision.payload as Record<string, unknown>)
      : undefined;

  return JSON.stringify({
    decisionId:
      typeof decision.decisionId === "string" ? decision.decisionId : undefined,
    type: resolveDecisionType(decision),
    prompt: decision.prompt,
    placeholder: decision.placeholder,
    allowFreeText: decision.allowFreeText === true,
    options: (decision.options ?? []).map(snapshotDecisionOption),
    payload: {
      nodeType:
        typeof payload?.nodeType === "string" ? payload.nodeType : undefined,
      sessionId:
        typeof payload?.sessionId === "string" ? payload.sessionId : undefined,
      nodeId: typeof payload?.nodeId === "string" ? payload.nodeId : undefined,
      interactionId:
        typeof payload?.interactionId === "string"
          ? payload.interactionId
          : undefined,
      branchKey:
        typeof payload?.branchKey === "string" ? payload.branchKey : undefined,
      fields: readWebAigcHitlFieldDefinitions(decision.payload).map(
        snapshotDecisionField
      ),
    },
  });
}

function severityClasses(severity?: "info" | "warn" | "danger"): string {
  switch (severity) {
    case "info":
      return `${workspaceToneClass("info")} hover:bg-[rgba(91,137,165,0.22)]`;
    case "warn":
      return `${workspaceToneClass("warning")} hover:bg-accent`;
    case "danger":
      return `${workspaceToneClass("danger")} hover:bg-[rgba(180,93,77,0.2)]`;
    default:
      return `${workspaceToneClass("neutral")} hover:bg-[rgba(255,255,255,0.82)]`;
  }
}

function surfaceTextareaClass(size: "md" | "lg" | "xl" = "md"): string {
  return cn(
    "border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.68)] text-sm text-stone-700",
    size === "md"
      ? "min-h-16 rounded-[14px]"
      : size === "lg"
        ? "min-h-20 rounded-[18px] leading-6"
        : "min-h-24 rounded-[18px] leading-6"
  );
}

function decisionTone(type: DecisionType): WorkspaceTone {
  if (type === "approve") return "success";
  if (type === "reject" || type === "escalate") return "danger";
  if (type === "request-info" || type === "multi-choice") return "info";
  return "neutral";
}

function typeIcon(type: DecisionType) {
  switch (type) {
    case "approve":
      return <CheckCircle2 className="size-4 text-emerald-600" />;
    case "reject":
      return <XCircle className="size-4 text-red-600" />;
    case "request-info":
      return <MessageSquare className="size-4 text-blue-600" />;
    case "escalate":
      return <ShieldAlert className="size-4 text-red-600" />;
    case "multi-choice":
      return <HelpCircle className="size-4 text-violet-600" />;
    default:
      return <Send className="size-4 text-stone-600" />;
  }
}

function buildInitialParamCollectionDraft(
  fields: WebAigcHitlFieldDefinition[]
): ParamCollectionDraft {
  return Object.fromEntries(
    fields.map(field => [field.key, field.defaultValue])
  );
}

function normalizeParamCollectionTextInput(
  field: WebAigcHitlFieldDefinition,
  value: string
): WebAigcHitlFieldValue | undefined {
  if (field.type === "number") {
    return value.trim() === "" ? undefined : value;
  }
  return value;
}

function buildAttachmentInputValue(
  value: string,
  previous?: WebAigcHitlAttachmentValue
): WebAigcHitlAttachmentValue | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  return {
    kind: "attachment",
    ref: trimmed,
    name: previous?.name,
    url: previous?.url,
    mimeType: previous?.mimeType,
    size: previous?.size,
    source: previous?.source ?? "manual",
  };
}

function normalizeAttachmentMetadataPatch(
  field: "name" | "url" | "mimeType" | "size",
  value: string
): string | number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (field === "size") {
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return trimmed;
}

function ParamCollectionField({
  field,
  value,
  error,
  locale,
  disabled,
  onChange,
}: {
  field: WebAigcHitlFieldDefinition;
  value: WebAigcHitlFieldValue | undefined;
  error?: string;
  locale: string;
  disabled: boolean;
  onChange: (value: WebAigcHitlFieldValue | undefined) => void;
}) {
  const fieldLabel = field.required ? `${field.label} *` : field.label;
  const placeholder =
    field.placeholder || t(locale, "请输入内容", "Enter a value");

  if (field.type === "textarea") {
    return (
      <div className="space-y-2">
        <Label htmlFor={`param-field-${field.key}`}>{fieldLabel}</Label>
        <Textarea
          id={`param-field-${field.key}`}
          value={typeof value === "string" ? value : ""}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? "true" : "false"}
          className={surfaceTextareaClass("lg")}
        />
        {error ? (
          <div className="text-xs text-[var(--workspace-danger)]">{error}</div>
        ) : null}
      </div>
    );
  }

  if (field.type === "selection" && Array.isArray(field.options)) {
    return (
      <div className="space-y-2">
        <Label htmlFor={`param-field-${field.key}`}>{fieldLabel}</Label>
        <Select
          disabled={disabled}
          value={typeof value === "string" ? value : undefined}
          onValueChange={nextValue => onChange(nextValue)}
        >
          <SelectTrigger
            id={`param-field-${field.key}`}
            className="w-full rounded-[14px] border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.68)]"
            aria-invalid={error ? "true" : "false"}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {error ? (
          <div className="text-xs text-[var(--workspace-danger)]">{error}</div>
        ) : null}
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="space-y-2">
        <Label htmlFor={`param-field-${field.key}`}>{fieldLabel}</Label>
        <div className="flex items-center gap-3 rounded-[14px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.68)] px-3 py-3">
          <Checkbox
            id={`param-field-${field.key}`}
            checked={value === true}
            disabled={disabled}
            onCheckedChange={checked => onChange(checked === true)}
          />
          <Label
            htmlFor={`param-field-${field.key}`}
            className="text-sm font-medium text-stone-700"
          >
            {field.placeholder ||
              t(locale, "勾选表示是", "Check to mark as true")}
          </Label>
        </div>
        {error ? (
          <div className="text-xs text-[var(--workspace-danger)]">{error}</div>
        ) : null}
      </div>
    );
  }

  if (field.type === "attachment") {
    const attachmentValue =
      value && typeof value === "object" && "kind" in value
        ? (value as WebAigcHitlAttachmentValue)
        : undefined;

    const patchAttachmentField = (
      key: "ref" | "name" | "url" | "mimeType" | "size",
      nextValue: string
    ) => {
      if (key === "ref") {
        onChange(buildAttachmentInputValue(nextValue, attachmentValue));
        return;
      }

      const normalized = normalizeAttachmentMetadataPatch(key, nextValue);
      const current = attachmentValue ?? { kind: "attachment", source: "manual" };
      const hasAnyValue =
        Boolean(current.ref) ||
        Boolean(current.name) ||
        Boolean(current.url) ||
        Boolean(current.mimeType) ||
        typeof current.size === "number";

      if (!hasAnyValue && normalized === undefined) {
        onChange(undefined);
        return;
      }

      const nextAttachment: WebAigcHitlAttachmentValue = {
        ...current,
        kind: "attachment",
      };

      if (key === "name") {
        nextAttachment.name =
          typeof normalized === "string" ? normalized : undefined;
      } else if (key === "url") {
        nextAttachment.url =
          typeof normalized === "string" ? normalized : undefined;
      } else if (key === "mimeType") {
        nextAttachment.mimeType =
          typeof normalized === "string" ? normalized : undefined;
      } else {
        nextAttachment.size =
          typeof normalized === "number" ? normalized : undefined;
      }

      if (!nextAttachment.ref && !nextAttachment.name && !nextAttachment.url) {
        onChange(undefined);
        return;
      }

      onChange(nextAttachment);
    };

    return (
      <div className="space-y-2">
        <Label htmlFor={`param-field-${field.key}`}>{fieldLabel}</Label>
        <div className="space-y-2 rounded-[16px] border border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.68)] p-3">
          <Input
            id={`param-field-${field.key}`}
            value={attachmentValue?.ref ?? ""}
            onChange={event => patchAttachmentField("ref", event.target.value)}
            placeholder={
              field.placeholder ||
              t(locale, "输入附件引用 ID", "Enter attachment reference")
            }
            disabled={disabled}
            aria-invalid={error ? "true" : "false"}
            className="h-10 rounded-[14px] border-[var(--workspace-panel-border)] bg-white/70"
          />
          <Input
            value={attachmentValue?.name ?? ""}
            onChange={event => patchAttachmentField("name", event.target.value)}
            placeholder={t(locale, "附件名称（可选）", "Attachment name (optional)")}
            disabled={disabled}
            className="h-10 rounded-[14px] border-[var(--workspace-panel-border)] bg-white/70"
          />
          <Input
            value={attachmentValue?.url ?? ""}
            onChange={event => patchAttachmentField("url", event.target.value)}
            placeholder={t(locale, "附件 URL（可选）", "Attachment URL (optional)")}
            disabled={disabled}
            className="h-10 rounded-[14px] border-[var(--workspace-panel-border)] bg-white/70"
          />
        </div>
        {error ? (
          <div className="text-xs text-[var(--workspace-danger)]">{error}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={`param-field-${field.key}`}>{fieldLabel}</Label>
      <Input
        id={`param-field-${field.key}`}
        type={field.type === "number" ? "number" : "text"}
        value={
          typeof value === "number"
            ? String(value)
            : typeof value === "string"
              ? value
              : ""
        }
        onChange={event =>
          onChange(normalizeParamCollectionTextInput(field, event.target.value))
        }
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error ? "true" : "false"}
        className="h-10 rounded-[14px] border-[var(--workspace-panel-border)] bg-[rgba(255,255,255,0.68)]"
      />
      {error ? (
        <div className="text-xs text-[var(--workspace-danger)]">{error}</div>
      ) : null}
    </div>
  );
}

function OptionCard({
  option,
  selected,
  disabled,
  onSelect,
  locale,
}: {
  option: MissionDecisionOption;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  locale: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={option.label}
      disabled={disabled}
      onClick={() => onSelect(option.id)}
      className={cn(
        "w-full rounded-[18px] border px-3.5 py-3 text-left transition-colors",
        selected
          ? "workspace-tone-success ring-2 ring-[rgba(94,139,114,0.22)] ring-offset-2 ring-offset-transparent"
          : severityClasses(option.severity),
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <div className="text-sm font-semibold">{option.label}</div>
      {option.description && (
        <div className="mt-1 text-xs leading-5 opacity-80">
          {option.description}
        </div>
      )}
      {option.requiresComment ? (
        <div className="mt-2 text-[11px] font-medium opacity-75">
          {t(locale, "需要评论", "Comment required")}
        </div>
      ) : null}
    </button>
  );
}

function ApproveRejectLayout({
  options,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
  locale,
}: {
  options: MissionDecisionOption[];
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
  locale: string;
}) {
  const approveOpt = options.find(
    option =>
      option.action === "approve" ||
      /approve|\u901a\u8fc7|\u6279\u51c6/i.test(option.label)
  );
  const rejectOpt = options.find(
    option =>
      option.action === "reject" ||
      /reject|\u62d2\u7edd|\u9a73\u56de/i.test(option.label)
  );
  const remaining = options.filter(
    option => option !== approveOpt && option !== rejectOpt
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {approveOpt ? (
          <div className="space-y-2">
            <Button
              type="button"
              disabled={submitting}
              aria-label={approveOpt.label}
              onClick={() =>
                onSubmit(approveOpt.id, commentTexts[approveOpt.id])
              }
              className="w-full rounded-[18px] border border-[rgba(94,139,114,0.28)] bg-[var(--workspace-success)] text-white hover:bg-[#537860]"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              {approveOpt.label}
            </Button>
            {approveOpt.requiresComment ? (
              <Textarea
                value={commentTexts[approveOpt.id] ?? ""}
                onChange={event =>
                  onCommentChange(approveOpt.id, event.target.value)
                }
                placeholder={t(
                  locale,
                  "必须填写原因",
                  "Required: provide a reason"
                )}
                aria-label={t(
                  locale,
                  `${approveOpt.label} 的补充说明`,
                  `Comment for ${approveOpt.label}`
                )}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ) : null}

        {rejectOpt ? (
          <div className="space-y-2">
            <Button
              type="button"
              disabled={submitting}
              aria-label={rejectOpt.label}
              onClick={() => onSubmit(rejectOpt.id, commentTexts[rejectOpt.id])}
              className="w-full rounded-[18px] border border-[rgba(180,93,77,0.28)] bg-[var(--workspace-danger)] text-white hover:bg-[#a85445]"
            >
              {submitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              {rejectOpt.label}
            </Button>
            {rejectOpt.requiresComment ? (
              <Textarea
                value={commentTexts[rejectOpt.id] ?? ""}
                onChange={event =>
                  onCommentChange(rejectOpt.id, event.target.value)
                }
                placeholder={t(
                  locale,
                  "必须填写原因",
                  "Required: provide a reason"
                )}
                aria-label={t(
                  locale,
                  `${rejectOpt.label} 的补充说明`,
                  `Comment for ${rejectOpt.label}`
                )}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {remaining.map(option => (
        <div key={option.id} className="space-y-2">
          <button
            type="button"
            disabled={submitting}
            aria-label={option.label}
            onClick={() => onSubmit(option.id, commentTexts[option.id])}
            className={cn(
              "w-full rounded-[18px] border px-3.5 py-3 text-left text-sm font-semibold transition-colors",
              severityClasses(option.severity),
              submitting && "cursor-not-allowed opacity-50"
            )}
          >
            {option.label}
          </button>
          {option.requiresComment ? (
            <Textarea
              value={commentTexts[option.id] ?? ""}
              onChange={event => onCommentChange(option.id, event.target.value)}
              placeholder={t(
                locale,
                "必须填写原因",
                "Required: provide a reason"
              )}
              aria-label={t(
                locale,
                `${option.label} 的补充说明`,
                `Comment for ${option.label}`
              )}
              aria-required="true"
              className={surfaceTextareaClass()}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MultiChoiceLayout({
  options,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
  locale,
}: {
  options: MissionDecisionOption[];
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
  locale: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={t(locale, "决策选项", "Decision options")}
        className="grid gap-2"
      >
        {options.map(option => (
          <div key={option.id} className="space-y-2">
            <OptionCard
              option={option}
              selected={selectedId === option.id}
              disabled={submitting}
              onSelect={setSelectedId}
              locale={locale}
            />
            {option.requiresComment && selectedId === option.id ? (
              <Textarea
                value={commentTexts[option.id] ?? ""}
                onChange={event =>
                  onCommentChange(option.id, event.target.value)
                }
                placeholder={t(
                  locale,
                  "必须填写原因",
                  "Required: provide a reason"
                )}
                aria-label={t(
                  locale,
                  `${option.label} 的补充说明`,
                  `Comment for ${option.label}`
                )}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ))}
      </div>
      <Button
        type="button"
        disabled={submitting || !selectedId}
        onClick={() =>
          selectedId && onSubmit(selectedId, commentTexts[selectedId])
        }
        className="w-full rounded-[18px]"
      >
        {submitting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        {t(locale, "提交选择", "Submit Selection")}
      </Button>
    </div>
  );
}

function RequestInfoLayout({
  decision,
  submitting,
  onSubmitFreeText,
  locale,
}: {
  decision: MissionDecision;
  submitting: boolean;
  onSubmitFreeText: (freeText: string) => void;
  locale: string;
}) {
  const [text, setText] = useState("");

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={event => setText(event.target.value)}
        placeholder={
          decision.placeholder ??
          t(locale, "请补充所需信息...", "Provide the requested information...")
        }
        aria-label={t(locale, "补充信息", "Information response")}
        aria-required="true"
        className={surfaceTextareaClass("xl")}
      />
      <Button
        type="button"
        disabled={submitting || !text.trim()}
        onClick={() => onSubmitFreeText(text)}
        className="w-full rounded-[18px]"
      >
        {submitting ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <Send className="size-4" />
        )}
        {t(locale, "提交信息", "Submit Information")}
      </Button>
    </div>
  );
}

function EscalateLayout({
  options,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
  locale,
}: {
  options: MissionDecisionOption[];
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
  locale: string;
}) {
  const primary = options[0];

  return (
    <div className="space-y-3">
      <div
        className={workspaceCalloutClass(
          "danger",
          "flex items-center gap-2 px-3.5 py-2.5 text-[var(--workspace-danger)]"
        )}
      >
        <AlertTriangle className="size-4 shrink-0 text-red-600" />
        <span className="text-sm font-medium text-red-800">
          {t(
            locale,
            "高优先级：这条决策需要立刻处理",
            "High priority: this decision requires immediate attention"
          )}
        </span>
      </div>

      {options.map(option => (
        <div key={option.id} className="space-y-2">
          <Button
            type="button"
            disabled={submitting}
            aria-label={option.label}
            onClick={() => onSubmit(option.id, commentTexts[option.id])}
            className={cn(
              "w-full rounded-[18px]",
              option === primary
                ? "border border-[rgba(180,93,77,0.28)] bg-[var(--workspace-danger)] text-white hover:bg-[#a85445]"
                : "workspace-control border-[var(--workspace-panel-border)] bg-white/70 text-stone-800 hover:bg-white/85"
            )}
          >
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ShieldAlert className="size-4" />
            )}
            {option.label}
          </Button>
          {option.requiresComment ? (
            <Textarea
              value={commentTexts[option.id] ?? ""}
              onChange={event => onCommentChange(option.id, event.target.value)}
              placeholder={t(
                locale,
                "必须填写原因",
                "Required: provide a reason"
              )}
              aria-label={t(
                locale,
                `${option.label} 的补充说明`,
                `Comment for ${option.label}`
              )}
              aria-required="true"
              className={surfaceTextareaClass()}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function CustomActionLayout({
  options,
  decision,
  submitting,
  onSubmit,
  commentTexts,
  onCommentChange,
  locale,
}: {
  options: MissionDecisionOption[];
  decision: MissionDecision;
  submitting: boolean;
  onSubmit: (optionId: string, freeText?: string) => void;
  commentTexts: Record<string, string>;
  onCommentChange: (optionId: string, text: string) => void;
  locale: string;
}) {
  const [freeText, setFreeText] = useState("");

  return (
    <div className="space-y-3">
      {decision.allowFreeText ? (
        <Textarea
          value={freeText}
          onChange={event => setFreeText(event.target.value)}
          placeholder={
            decision.placeholder ??
            t(locale, "可选：补充说明...", "Optional note...")
          }
          aria-label={t(locale, "决策备注", "Decision note")}
          className={surfaceTextareaClass("lg")}
        />
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(option => (
          <div key={option.id} className="space-y-2">
            <button
              type="button"
              disabled={submitting}
              aria-label={option.label}
              onClick={() =>
                onSubmit(
                  option.id,
                  commentTexts[option.id] ||
                    (decision.allowFreeText ? freeText : undefined)
                )
              }
              className={cn(
                "w-full rounded-[18px] border px-3.5 py-3 text-left transition-colors",
                severityClasses(option.severity),
                submitting && "cursor-not-allowed opacity-50"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{option.label}</div>
                  {option.description ? (
                    <div className="mt-1 line-clamp-2 text-xs leading-5 opacity-80">
                      {option.description}
                    </div>
                  ) : null}
                </div>
                {submitting ? (
                  <LoaderCircle className="size-4 shrink-0 animate-spin" />
                ) : (
                  <Send className="size-4 shrink-0 opacity-50" />
                )}
              </div>
            </button>
            {option.requiresComment ? (
              <Textarea
                value={commentTexts[option.id] ?? ""}
                onChange={event =>
                  onCommentChange(option.id, event.target.value)
                }
                placeholder={t(
                  locale,
                  "必须填写原因",
                  "Required: provide a reason"
                )}
                aria-label={t(
                  locale,
                  `${option.label} 的补充说明`,
                  `Comment for ${option.label}`
                )}
                aria-required="true"
                className={surfaceTextareaClass()}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DecisionPanel({
  missionId,
  decision,
  onDecisionSubmitted,
}: DecisionPanelProps) {
  const { locale } = useI18n();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentTexts, setCommentTexts] = useState<Record<string, string>>({});
  const decisionInteractionKey = useMemo(
    () => buildDecisionInteractionKey(decision),
    [decision]
  );
  const paramCollectionFields = useMemo(
    () => readWebAigcHitlFieldDefinitions(decision.payload),
    [decisionInteractionKey]
  );
  const initialParamCollectionDraft = useMemo(
    () => buildInitialParamCollectionDraft(paramCollectionFields),
    [paramCollectionFields]
  );
  const decisionContextNotices = useMemo(
    () => buildDecisionContextNotices(decision, paramCollectionFields, locale),
    [decisionInteractionKey, locale, paramCollectionFields]
  );
  const [paramCollectionDraft, setParamCollectionDraft] = useState<ParamCollectionDraft>(
    () => initialParamCollectionDraft
  );
  const [paramCollectionErrors, setParamCollectionErrors] = useState<
    Record<string, string>
  >({});

  const type = resolveDecisionType(decision);
  const options = decision.options ?? [];
  const isParamCollection =
    decision.payload?.nodeType === "param_collection" &&
    type === "request-info" &&
    paramCollectionFields.length > 0;
  const primaryOptionId = options[0]?.id;

  useEffect(() => {
    setError(null);
    setCommentTexts({});
    setParamCollectionDraft(initialParamCollectionDraft);
    setParamCollectionErrors({});
  }, [decisionInteractionKey, initialParamCollectionDraft]);

  const handleCommentChange = useCallback((optionId: string, text: string) => {
    setCommentTexts(previous => ({ ...previous, [optionId]: text }));
  }, []);

  const handleParamCollectionFieldChange = useCallback(
    (fieldKey: string, value: WebAigcHitlFieldValue | undefined) => {
      setParamCollectionDraft(previous => ({
        ...previous,
        [fieldKey]: value,
      }));
      setParamCollectionErrors(previous => {
        if (!(fieldKey in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[fieldKey];
        return next;
      });
    },
    []
  );

  const handleSubmit = useCallback(
    async (optionId: string, freeText?: string) => {
      const option = options.find(current => current.id === optionId);
      if (option?.requiresComment && (!freeText || !freeText.trim())) {
        setError(
          t(
            locale,
            `选项“${option.label}”必须填写原因。`,
            `A comment is required for "${option.label}".`
          )
        );
        return;
      }

      let submissionRequest: MissionDecisionSubmission = {
        optionId: optionId.trim(),
        freeText: freeText?.trim() || undefined,
      };
      if (isParamCollection) {
        const submission = buildParamCollectionSubmission(
          decision,
          paramCollectionDraft
        );
        if (submission.error) {
          setParamCollectionErrors(submission.fieldErrors);
          setError(submission.error);
          return;
        }
        const paramCollectionRequest = buildParamCollectionDecisionSubmission(
          decision,
          optionId,
          paramCollectionDraft
        );
        if (!paramCollectionRequest.submission) {
          setParamCollectionErrors(paramCollectionRequest.fieldErrors);
          setError(
            paramCollectionRequest.error ??
              t(
                locale,
                "当前步骤无法提交结构化参数",
                "This step could not submit the structured parameters"
              )
          );
          return;
        }
        submissionRequest = paramCollectionRequest.submission;
      }

      setSubmitting(true);
      setError(null);

      try {
        await submitMissionDecision(missionId, submissionRequest);
        onDecisionSubmitted?.();
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : t(locale, "提交决策失败", "Failed to submit decision")
        );
      } finally {
        setSubmitting(false);
      }
    },
    [
      decision,
      isParamCollection,
      locale,
      missionId,
      onDecisionSubmitted,
      options,
      paramCollectionDraft,
    ]
  );

  const handleSubmitFreeText = useCallback(
    async (freeText: string) => {
      const request = buildRequestInfoSubmission(decision, freeText);
      if (!request.submission) {
        setError(
          request.error ??
            t(
              locale,
              "当前澄清步骤不支持自由文本提交",
              "This clarification step does not accept free-text submissions"
            )
        );
        return;
      }

      setSubmitting(true);
      setError(null);

      try {
        await submitMissionDecision(missionId, request.submission);
        onDecisionSubmitted?.();
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : t(locale, "提交决策失败", "Failed to submit decision")
        );
      } finally {
        setSubmitting(false);
      }
    },
    [decision, locale, missionId, onDecisionSubmitted]
  );

  return (
    <Card
      className={cn(
        "workspace-panel rounded-[28px] shadow-[0_24px_60px_rgba(112,84,51,0.08)]",
        type === "escalate"
          ? "border-[rgba(180,93,77,0.24)] bg-[linear-gradient(180deg,rgba(255,251,249,0.96),rgba(248,233,229,0.92))]"
          : "border-[var(--workspace-panel-border)]"
      )}
    >
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-stone-900">
          {typeIcon(type)}
          {t(locale, "需要人工决策", "Decision Required")}
        </CardTitle>
        <CardDescription
          className={cn(
            "text-sm leading-6",
            workspaceToneClass(decisionTone(type))
          )}
        >
          {decision.prompt}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        {decisionContextNotices.length > 0 ? (
          <div
            data-testid="decision-panel-context"
            className={workspaceCalloutClass(
              "info",
              "space-y-2 px-3.5 py-3 text-sm text-stone-700"
            )}
          >
            {decisionContextNotices.map(notice => (
              <div key={`${notice.label}:${notice.detail}`} className="leading-6">
                <span className="font-semibold text-stone-900">
                  {notice.label}:
                </span>{" "}
                <span>{notice.detail}</span>
              </div>
            ))}
          </div>
        ) : null}

        {type === "approve" || type === "reject" ? (
          <ApproveRejectLayout
            key={`approve-reject-${decisionInteractionKey}`}
            options={options}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
            locale={locale}
          />
        ) : type === "multi-choice" ? (
          <MultiChoiceLayout
            key={`multi-choice-${decisionInteractionKey}`}
            options={options}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
            locale={locale}
          />
        ) : type === "request-info" ? (
          isParamCollection ? (
            <div
              key={`param-collection-${decisionInteractionKey}`}
              className="space-y-4"
            >
              <div className="grid gap-3">
                {paramCollectionFields.map(field => (
                  <ParamCollectionField
                    key={field.key}
                    field={field}
                    value={paramCollectionDraft[field.key]}
                    error={paramCollectionErrors[field.key]}
                    locale={locale}
                    disabled={submitting}
                    onChange={value =>
                      handleParamCollectionFieldChange(field.key, value)
                    }
                  />
                ))}
              </div>
              <Button
                type="button"
                disabled={submitting || !primaryOptionId}
                onClick={() => primaryOptionId && handleSubmit(primaryOptionId)}
                className="w-full rounded-[18px]"
              >
                {submitting ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {t(locale, "提交参数", "Submit Parameters")}
              </Button>
            </div>
          ) : (
            <RequestInfoLayout
              key={`request-info-${decisionInteractionKey}`}
              decision={decision}
              submitting={submitting}
              onSubmitFreeText={handleSubmitFreeText}
              locale={locale}
            />
          )
        ) : type === "escalate" ? (
          <EscalateLayout
            key={`escalate-${decisionInteractionKey}`}
            options={options}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
            locale={locale}
          />
        ) : (
          <CustomActionLayout
            key={`custom-action-${decisionInteractionKey}`}
            options={options}
            decision={decision}
            submitting={submitting}
            onSubmit={handleSubmit}
            commentTexts={commentTexts}
            onCommentChange={handleCommentChange}
            locale={locale}
          />
        )}

        {error ? (
          <div
            role="alert"
            className={workspaceCalloutClass(
              "danger",
              "px-3 py-2 text-sm text-[var(--workspace-danger)]"
            )}
          >
            {error}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

