// ---------------------------------------------------------------------------
// driveState → visual mapping (pure functions, no store/i18n dependency)
// ---------------------------------------------------------------------------

type DriveState = string | undefined | null;

export interface StatusMapping {
  dotClass: string;
  labelZh: string;
  labelEn: string;
}

const STATUS_MAP: Record<string, StatusMapping> = {
  running: {
    dotClass: "bg-emerald-500 animate-pulse",
    labelZh: "自主执行中",
    labelEn: "Running",
  },
  executing: {
    dotClass: "bg-emerald-500 animate-pulse",
    labelZh: "自主执行中",
    labelEn: "Running",
  },
  planning: {
    dotClass: "bg-amber-500",
    labelZh: "规划中",
    labelEn: "Planning",
  },
  waiting: {
    dotClass: "bg-amber-500",
    labelZh: "等待接管",
    labelEn: "Waiting",
  },
  blocked: {
    dotClass: "bg-amber-500",
    labelZh: "等待接管",
    labelEn: "Waiting",
  },
  failed: {
    dotClass: "bg-red-500",
    labelZh: "异常",
    labelEn: "Error",
  },
  delivered: {
    dotClass: "bg-gray-400",
    labelZh: "已完成",
    labelEn: "Done",
  },
  done: {
    dotClass: "bg-gray-400",
    labelZh: "已完成",
    labelEn: "Done",
  },
  idle: {
    dotClass: "bg-gray-400",
    labelZh: "待命中",
    labelEn: "Standby",
  },
};

const FALLBACK_STATUS: StatusMapping = {
  dotClass: "bg-gray-400",
  labelZh: "待命中",
  labelEn: "Standby",
};

export function getStatusMapping(driveState: DriveState): StatusMapping {
  if (!driveState) return FALLBACK_STATUS;
  return STATUS_MAP[driveState] ?? FALLBACK_STATUS;
}

export function getStatusLabel(driveState: DriveState, locale: string): string {
  const mapping = getStatusMapping(driveState);
  return locale.startsWith("en") ? mapping.labelEn : mapping.labelZh;
}
