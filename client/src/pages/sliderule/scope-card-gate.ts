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
import {
  defaultArchetype,
  defaultDevice,
  isWiredArchetype,
  isWiredDevice,
  wiredArchetypes,
  wiredDevices,
} from "./product-archetypes";
import type { ProductCharter } from "./product-charter";
import {
  loadPreferredDevice,
  loadProductArchetype,
  loadStoredPreferredDevice,
  loadStoredProductArchetype,
} from "./user-prefs";

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

/** 设备档跟账本走，含判定哨兵 unspecified。不许再手抄 desktop|phone。 */
export type ScopeCardDevice = string;

export type ScopeCardVariant = "full" | "thin";

export type ScopeCardChoice = {
  device: string;
  productArchetype: string;
  /** 规划器勾选。缺省 = 五件套全开。 */
  tools?: string[];
  /**
   * 这张卡上的宪章。确认必须带上（哪怕是 {}），runTurn 才不会回头去
   * loadProductCharter() 把上一场企业服务 POST 进股票分析器。
   */
  productCharter?: ProductCharter;
};

export type ScopeCardPending = {
  userText: string;
  restatement: string;
  variant: ScopeCardVariant;
  device: ScopeCardDevice;
  productArchetype?: string;
  wiredArchetypes?: Array<{ id: string; label: string }>;
  wiredDevices?: Array<{ id: string; label: string }>;
  tools?: string[];
  intervention?: RehearsalIntervention;
  mode?: "repair";
  /** 账户/会话「下一场沿用」。localStorage 未写时用来 hydrate 勾选。 */
  charterReuseNext?: boolean;
};

/** 墙上钟 v1。禁止把未标定分钟数写进产品 UI。 */
export const SCOPE_CARD_TIME_COPY = "大约数分钟，第一页会先出现";

/** 取证是 opt-in；默认不亮这一步，免得钟从空心第 1 格起跳。 */
export const SCOPE_CARD_EVIDENCE_STEP = "澄清与取证";

/** 公开五件套。人话跟今天范围卡「将跑」逐字相同。 */
export const SCOPE_CARD_PUBLIC_TOOLS = [
  { id: "spec", label: "起草 SPEC" },
  { id: "pages", label: "页面生成" },
  { id: "structure", label: "数据结构" },
  { id: "bind", label: "权限工作流" },
  { id: "closure", label: "完整性检查" },
] as const;

/** 默认 rehearse 从「起草 SPEC」起（M8）。 */
export const SCOPE_CARD_STEPS_FROM_SPEC = SCOPE_CARD_PUBLIC_TOOLS.map(
  row => row.label
);

export const SCOPE_CARD_CONFIRM_LABEL = "开始推演";
export const SCOPE_CARD_REVISE_LABEL = "先改范围";

export function normalizeScopeTools(raw?: string[] | null): string[] {
  const wanted = new Set((raw || []).map(item => String(item).trim()));
  const chosen = SCOPE_CARD_PUBLIC_TOOLS.map(row => row.id).filter(id =>
    wanted.has(id)
  );
  return chosen.length > 0
    ? chosen
    : SCOPE_CARD_PUBLIC_TOOLS.map(row => row.id);
}

export function scopeCardStepsFromTools(tools?: string[] | null): string[] {
  const chosen = new Set(normalizeScopeTools(tools));
  return SCOPE_CARD_PUBLIC_TOOLS.filter(row => chosen.has(row.id)).map(
    row => row.label
  );
}

export function scopeCardSteps(includeEvidence: boolean): string[] {
  return includeEvidence
    ? [SCOPE_CARD_EVIDENCE_STEP, ...SCOPE_CARD_STEPS_FROM_SPEC]
    : [...SCOPE_CARD_STEPS_FROM_SPEC];
}

/**
 * ⚠ **未接线**，只有单测在用（见 `scope-card.test.tsx`：
 *   「interceptRehearsalRequest 是未接线 helper 单测；活路径 skip 在 POST
 *   mode=repair」，同文件还有一条断言 requestFn 里**不含**
 *   interceptRehearsalRequest）。活路径上的范围卡是服务端 `control_scope_card`
 *   事件送来的。
 *
 * 复述句的唯一权威在 `slide-rule-python/services/rehearsal_control.py`
 * （`_restatement_chain` / `_restate`）。那边 2026-08-27 补了「纯确认不算
 * 复述句」的守卫——用户回一句「就按上面这个推演」时不许拿它当标题。
 * 这一份**故意不跟着补**：补了就多出一对要同步的实现，正是 CLAUDE.md §4
 * 要防的事。谁要把它重新接上活路径，先去读那边的守卫，别照着这份的
 * `stripped || t` 抄回来。
 */
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
 * 范围卡上的原型 / 设备档。新建会话时作曲家选的是授予，卡上锁死置灰。
 *
 * ⚠ 2026-09-01 真机「团子的一天」：空态选了平板 / 自由类型，park 事件
 * 画出桌面/PC 还能点。形态不在卡上改；localStorage 是空态那两颗钮写下
 * 的，pending 里的推断档不是授予。
 */
export function lockScopeMorphology(pending?: {
  device?: string;
  productArchetype?: string;
}): { device: string; productArchetype: string } {
  const storedDevice = loadStoredPreferredDevice();
  const storedArch = loadStoredProductArchetype();
  return {
    device: storedDevice && isWiredDevice(storedDevice)
      ? storedDevice
      : isWiredDevice(pending?.device)
        ? String(pending?.device)
        : defaultDevice(),
    productArchetype: storedArch && isWiredArchetype(storedArch)
      ? storedArch
      : isWiredArchetype(pending?.productArchetype)
        ? String(pending?.productArchetype)
        : defaultArchetype(),
  };
}

/**
 * 刷新后续停泊卡：会话里的授予是权威，localStorage 只是最后兜底。
 *
 * ⚠ 2026-08-30 真机：hydrate 写 `device: loadPreferredDevice()`，点过
 * 平板的卡刷新回来变 desktop。对照 grok PermissionState——磁盘上的
 * grant 压过客户端随手记的默认档。
 * ⚠ 2026-09-01：卡面锁死走 lockScopeMorphology（作曲家优先）。这里仍认
 * last_card，给刷新时的 pending 骨架用；画面和确认 POST 不吃这份推断。
 */
export function hydrateParkedScope(state: {
  awaitDetail?: string | null;
  goal?: {
    text?: string;
    preferredDevice?: string;
    productArchetype?: string;
    tools?: string[];
  } | null;
  controlTranscript?: Array<{
    kind?: string;
    device?: string;
    productArchetype?: string;
    variant?: string;
    text?: string;
    tools?: string[];
  } | null>;
}): ScopeCardPending {
  const lastCard = [...(state.controlTranscript ?? [])]
    .reverse()
    .find(row => row && row.kind === "scope_card");
  const wiredDev = (raw: unknown): string | undefined => {
    const value = String(raw ?? "").trim();
    return isWiredDevice(value) ? value : undefined;
  };
  const wiredArch = (raw: unknown): string | undefined => {
    const value = String(raw ?? "").trim();
    return isWiredArchetype(value) ? value : undefined;
  };
  const restatement = String(state.awaitDetail || lastCard?.text || "").trim();
  return {
    userText: restatement,
    restatement,
    variant: lastCard?.variant === "thin" || lastCard?.variant === "full"
      ? lastCard.variant
      : state.goal?.text?.trim()
        ? "thin"
        : "full",
    device:
      wiredDev(lastCard?.device) ??
      wiredDev(state.goal?.preferredDevice) ??
      loadPreferredDevice(),
    productArchetype:
      wiredArch(lastCard?.productArchetype) ??
      wiredArch(state.goal?.productArchetype) ??
      defaultArchetype(),
    tools: normalizeScopeTools(
      lastCard?.tools && lastCard.tools.length > 0
        ? lastCard.tools
        : state.goal?.tools
    ),
    wiredArchetypes: wiredArchetypes(),
    wiredDevices: wiredDevices(),
  };
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
