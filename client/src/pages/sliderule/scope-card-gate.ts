/**
 * 范围卡闸（PR-3 UI 壳）。
 *
 * 拦截点是 requestRehearsal / runTurn 全入口，不是 ComposerDock.doSend。
 * 只拦 doSend 的话，sliderule:resend-prompt → sendMessage 仍会直 POST
 * /drive-full-stream——2026-08 交互流程把这件事写成失败 PR。
 *
 * PR-4：确认走 confirmControlScope → POST /control-turn-stream
 * forcedTool:rehearse。本文件的 intercept 只留给 skip 语义单测，产品新烧
 * 一律 POST，未确认由服务端 park。
 *
 * 时间口径只许 SCOPE_CARD_TIME_COPY。未标定的分钟数不许进产品 DOM。
 */
export type RehearsalIntervention = {
  intent?: string;
  text?: string;
  targetArtifactId?: string;
  answeredGapIds?: string[];
};

export type RehearsalCall = {
  userText: string;
  intervention?: RehearsalIntervention;
  resumeRun?: { runId: string };
  mode?: "repair";
};

export type ScopeCardDevice = "desktop" | "phone" | "unspecified";

export type ScopeCardVariant = "full" | "thin";

export type ScopeCardPending = {
  userText: string;
  restatement: string;
  variant: ScopeCardVariant;
  device: ScopeCardDevice;
  intervention?: RehearsalIntervention;
  mode?: "repair";
  /** 账户/会话「下一场沿用」。localStorage 未写时用来 hydrate 勾选。 */
  charterReuseNext?: boolean;
};

/** 墙上钟 v1。禁止把未标定分钟数写进产品 UI。 */
export const SCOPE_CARD_TIME_COPY = "大约数分钟，第一页会先出现";

/** 取证是 opt-in；默认不亮这一步，免得钟从空心第 1 格起跳。 */
export const SCOPE_CARD_EVIDENCE_STEP = "澄清与取证";

/** 默认 rehearse 从「起草 SPEC」起（M8）。 */
export const SCOPE_CARD_STEPS_FROM_SPEC = [
  "起草 SPEC",
  "页面生成",
  "数据结构",
  "权限工作流",
  "完整性检查",
] as const;

export const SCOPE_CARD_CONFIRM_LABEL = "开始推演";
export const SCOPE_CARD_REVISE_LABEL = "先改范围";

export function scopeCardSteps(includeEvidence: boolean): string[] {
  return includeEvidence
    ? [SCOPE_CARD_EVIDENCE_STEP, ...SCOPE_CARD_STEPS_FROM_SPEC]
    : [...SCOPE_CARD_STEPS_FROM_SPEC];
}

export function restateAppGoal(userText: string): string {
  const t = (userText || "").trim();
  const stripped = t
    .replace(
      /^(请)?(帮我)?(做一?个|搭建|设计一?个|构建|开发一?个|建一?个|来一?个|create|build|design)\s*/i,
      ""
    )
    .replace(/[。！？.!?]+$/u, "")
    .trim();
  return stripped || t;
}

/**
 * 跳卡：续播 / 补齐缺口 / 质疑 / G_READY 答卡 / 打包交付。
 * 这些不是点火闸；产品流不停 G_READY，ClarificationCard 本 PR 不当闸。
 */
export function shouldSkipScopeCard(call: RehearsalCall): boolean {
  if (call.resumeRun) return true;
  if (call.mode === "repair") return true;
  const intent = call.intervention?.intent;
  if (
    intent === "challenge" ||
    intent === "clarify" ||
    intent === "generate_plan"
  ) {
    return true;
  }
  return false;
}

export function decideScopeCardGate(
  call: RehearsalCall,
  ctx: {
    confirmed?: boolean;
    hasExistingGoal: boolean;
    device?: ScopeCardDevice;
  }
): { action: "drive" } | { action: "park"; pending: ScopeCardPending } {
  if (ctx.confirmed || shouldSkipScopeCard(call)) {
    return { action: "drive" };
  }
  const userText = (call.userText || "").trim();
  if (!userText) return { action: "drive" };
  return {
    action: "park",
    pending: {
      userText,
      restatement: restateAppGoal(userText),
      variant: ctx.hasExistingGoal ? "thin" : "full",
      device: ctx.device ?? "unspecified",
      intervention: call.intervention,
      mode: call.mode,
    },
  };
}

/**
 * 活路径闸：park 则不得调用 drive（drive 才是 POST /drive-full-stream）。
 * 确认走 confirmed:true，才允许 drive。
 */
export async function interceptRehearsalRequest(
  call: RehearsalCall,
  ctx: {
    confirmed?: boolean;
    hasExistingGoal: boolean;
    device?: ScopeCardDevice;
  },
  drive: (call: RehearsalCall) => Promise<void> | void,
  park: (pending: ScopeCardPending) => void
): Promise<"parked" | "driven"> {
  const decision = decideScopeCardGate(call, ctx);
  if (decision.action === "park") {
    park(decision.pending);
    return "parked";
  }
  await drive(call);
  return "driven";
}
