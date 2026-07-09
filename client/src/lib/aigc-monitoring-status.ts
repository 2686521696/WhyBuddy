import type {
  AigcMonitoringExecutionStatus,
  AigcMonitoringNodeExecutionStatus,
} from "@shared/aigc-monitoring";

export type AigcMonitoringStatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface AigcMonitoringStatusPresentation {
  status: string | null | undefined;
  label: string;
  shortLabel: string;
  tone: AigcMonitoringStatusTone;
  className: string;
}

export interface AigcMonitoringStatusOptions {
  locale?: string | null | undefined;
  short?: boolean;
}

type MonitoringKnownStatus =
  | AigcMonitoringExecutionStatus
  | AigcMonitoringNodeExecutionStatus;

interface MonitoringStatusDefinition {
  labelZh: string;
  labelEn: string;
  shortZh?: string;
  shortEn?: string;
  tone: AigcMonitoringStatusTone;
}

const TONE_CLASS_NAMES: Record<AigcMonitoringStatusTone, string> = {
  neutral: "border-stone-200 bg-stone-50 text-stone-600",
  info: "border-sky-200 bg-sky-50 text-sky-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
};

const STATUS_DEFINITIONS: Record<
  MonitoringKnownStatus,
  MonitoringStatusDefinition
> = {
  PENDING: {
    labelZh: "待执行",
    labelEn: "Pending",
    shortZh: "待执行",
    shortEn: "Pending",
    tone: "neutral",
  },
  EXECUTING: {
    labelZh: "执行中",
    labelEn: "Executing",
    shortZh: "进行中",
    shortEn: "Running",
    tone: "info",
  },
  EXECUTED: {
    labelZh: "已完成",
    labelEn: "Executed",
    shortZh: "已完成",
    shortEn: "Done",
    tone: "success",
  },
  EXCEPTION: {
    labelZh: "执行异常",
    labelEn: "Exception",
    shortZh: "异常",
    shortEn: "Error",
    tone: "danger",
  },
  WAITING_INPUT: {
    labelZh: "等待输入",
    labelEn: "Waiting input",
    shortZh: "等待输入",
    shortEn: "Waiting",
    tone: "warning",
  },
  FORCE_TERMINATED: {
    labelZh: "强制终止",
    labelEn: "Force terminated",
    shortZh: "已终止",
    shortEn: "Terminated",
    tone: "danger",
  },
};

function isChineseLocale(locale?: string | null | undefined): boolean {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh");
}

function fallbackLabel(
  locale: string | null | undefined,
  status: string | null | undefined
): string {
  if (!status) {
    return isChineseLocale(locale) ? "未记录" : "Unknown";
  }

  return status;
}

function resolveDefinition(status: string | null | undefined) {
  if (!status) {
    return null;
  }

  return STATUS_DEFINITIONS[status as MonitoringKnownStatus] ?? null;
}

export function getAigcMonitoringToneClassName(
  tone: AigcMonitoringStatusTone
): string {
  return TONE_CLASS_NAMES[tone];
}

export function getAigcMonitoringStatusPresentation(
  status: string | null | undefined,
  options: AigcMonitoringStatusOptions = {}
): AigcMonitoringStatusPresentation {
  const definition = resolveDefinition(status);
  const chinese = isChineseLocale(options.locale);

  if (!definition) {
    const label = fallbackLabel(options.locale, status);
    return {
      status,
      label,
      shortLabel: label,
      tone: "neutral",
      className: TONE_CLASS_NAMES.neutral,
    };
  }

  const label = chinese ? definition.labelZh : definition.labelEn;
  const shortLabel = chinese
    ? (definition.shortZh ?? definition.labelZh)
    : (definition.shortEn ?? definition.labelEn);

  return {
    status,
    label,
    shortLabel,
    tone: definition.tone,
    className: TONE_CLASS_NAMES[definition.tone],
  };
}

export function getAigcMonitoringStatusLabel(
  status: string | null | undefined,
  options: AigcMonitoringStatusOptions = {}
): string {
  const presentation = getAigcMonitoringStatusPresentation(status, options);
  return options.short ? presentation.shortLabel : presentation.label;
}

export function getAigcMonitoringStatusClassName(
  status: string | null | undefined
): string {
  return getAigcMonitoringStatusPresentation(status).className;
}
