/**
 * SlideRule V5.3 · 执行事件模型（ReasoningEvent）
 *
 * 这是 #4「多角色/自主执行在 Flow 上可见化」的核心新中间层:
 * artifact = 结果,capabilityRun = 粗运行记录,**ReasoningEvent = 一次能力执行内的有序思考/动作步**。
 * 投影层据此把"过程"画成可见、可展开、可交互的推理链(角色立场/质疑/收敛/思考子步)。
 *
 * 设计约束(见 docs/sliderule_v5.3_flow_visibility.md):
 * - 纯数据 + 纯函数,无副作用、无 LLM 调用(事件从已有的一次 LLM 响应里拆阶段 + 确定性补充)。
 * - 文案必须脱敏:emit 前过 sanitizeReasoningText(),不泄漏内部 token(G_READY、T_GATE、DLEDGER、baseline、F1_/F2_ 等)。
 * - 向后兼容:reasoningEvents 在 STATE 上是可选字段;所有消费方必须处理 undefined。
 *
 * P1 任务对应:P1.1(类型)/P1.2(sanitize)/P1.3(fold)/P1.4(byRun)/P1.5(makeEvent)。
 */

// ---------------------------------------------------------------------------
// P1.1 · 类型
// ---------------------------------------------------------------------------

export type ReasoningEventKind =
  | "capability_start" // 一次能力执行开始
  | "think" // agent 内部思考(一句话,用户语言)
  | "observe" // 观察/检索到的外部或上游信息
  | "tool_call" // 外部调用(evidence.search / repo.inspect / mcp.call 等)
  | "role_position" // 某角色给出的立场
  | "role_critique" // 某角色对另一角色的反驳/质疑
  | "role_rebuttal" // 被质疑方的回应
  | "panel_converge" // 面板收敛裁决(含 score / consensus / dissent)
  | "subtask" // 自主执行的子任务拆解项
  | "capability_complete"; // 产出 artifact

export interface ReasoningEventMeta {
  convergenceScore?: number; // 0..1
  consensusReached?: boolean;
  dissent?: Array<{ roleId: string; opinion: string }>;
  toolName?: string;
  sourceTag?: string; // 脱敏前的来源标签(展示前会被 sanitize 成"外部检索")
  [k: string]: unknown;
}

export interface ReasoningEvent {
  id: string; // `${capabilityRunId}-ev-${order}`
  turnId: string;
  capabilityRunId: string; // 绑定到 capabilityRun(= 一个 capability 投影节点)
  capabilityId: string;
  kind: ReasoningEventKind;
  roleId?: string; // 角色相关事件
  targetRoleId?: string; // critique / rebuttal 的对象角色
  text: string; // 用户可读、已脱敏
  refs?: string[]; // 关联 artifact / evidence id(可点跳)
  meta?: ReasoningEventMeta;
  order: number; // 同一 run 内顺序(从 0 递增)
  ts: string; // ISO 时间
}

/** 最小输入形状(makeEvent 会补 id/order/ts 并 sanitize text)。 */
export interface ReasoningEventInput {
  turnId: string;
  capabilityRunId: string;
  capabilityId: string;
  kind: ReasoningEventKind;
  text: string;
  roleId?: string;
  targetRoleId?: string;
  refs?: string[];
  meta?: ReasoningEventMeta;
}

// ---------------------------------------------------------------------------
// P1.2 · 脱敏
// ---------------------------------------------------------------------------

/**
 * 内部机制 token —— 用户可见文案中禁止出现。
 * 注:与 sliderule-turn-route.ts 的 assertRouteCopySanitized 禁词同源,后续可统一为单一导出
 * (本期先在此自带一份,避免跨文件耦合阻塞 P1)。
 */
export const FORBIDDEN_INTERNAL_TOKENS: readonly string[] = [
  "G_READY",
  "G_SCHEMA",
  "G_INV",
  "G_COVERAGE",
  "G-GROUND",
  "GCOV",
  "T_GATE",
  "T_PROV",
  "T_MERGE",
  "T_CONTENT",
  "T_TEST",
  "T_LEDGER",
  "DLEDGER",
  "BUDGET",
  "ORCH",
  "C_PROMPT",
  "C_REDACT",
  "baseline",
  "pilot-template",
];

/** 把脱敏前的来源标签(F1_Github_Source / F2_Web_Search …)统一展示为"外部检索"。 */
const SOURCE_TAG_RE = /F\d+_[A-Za-z_]+/g;

/**
 * 脱敏:移除/替换内部机制 token 与来源标签,用于所有 emit 出去的 ReasoningEvent.text。
 * 幂等:多次调用结果稳定。
 */
export function sanitizeReasoningText(text: string): string {
  let out = String(text ?? "");
  out = out.replace(SOURCE_TAG_RE, "外部检索");
  for (const token of FORBIDDEN_INTERNAL_TOKENS) {
    // 整词替换(token 多为大写标识符,直接全局替换为空并清理多余空白)
    out = out.split(token).join("");
  }
  // 收尾:压缩因删词产生的多余空格/标点空洞
  return out.replace(/[ \t]{2,}/g, " ").replace(/\s+([，。；：、])/g, "$1").trim();
}

// ---------------------------------------------------------------------------
// P1.5 · 工厂
// ---------------------------------------------------------------------------

/** 构造一条 ReasoningEvent:补 id/order/ts 并对 text 脱敏。order 由调用方维护并递增。 */
export function makeEvent(input: ReasoningEventInput, order: number): ReasoningEvent {
  return {
    id: `${input.capabilityRunId}-ev-${order}`,
    turnId: input.turnId,
    capabilityRunId: input.capabilityRunId,
    capabilityId: input.capabilityId,
    kind: input.kind,
    roleId: input.roleId,
    targetRoleId: input.targetRoleId,
    text: sanitizeReasoningText(input.text),
    refs: input.refs && input.refs.length > 0 ? [...input.refs] : undefined,
    meta: input.meta,
    order,
    ts: new Date().toISOString(),
  };
}

/**
 * 顺序构造一组事件(共享同一 turn/run/cap),order 从 0 递增。
 * 典型用法:执行器一次产出 capability_start → think… → capability_complete。
 */
export function makeEventSequence(
  base: Pick<ReasoningEventInput, "turnId" | "capabilityRunId" | "capabilityId">,
  steps: Array<Omit<ReasoningEventInput, "turnId" | "capabilityRunId" | "capabilityId">>
): ReasoningEvent[] {
  return steps.map((step, i) => makeEvent({ ...base, ...step }, i));
}

// ---------------------------------------------------------------------------
// P1.3 · overview 折叠(角标用)
// ---------------------------------------------------------------------------

export interface OverviewFold {
  think: number;
  observe: number;
  tool: number;
  role: number; // role_position + role_critique + role_rebuttal
}

export function foldEventsForOverview(events: ReasoningEvent[]): OverviewFold {
  const fold: OverviewFold = { think: 0, observe: 0, tool: 0, role: 0 };
  for (const e of events) {
    if (e.kind === "think") fold.think++;
    else if (e.kind === "observe") fold.observe++;
    else if (e.kind === "tool_call") fold.tool++;
    else if (e.kind === "role_position" || e.kind === "role_critique" || e.kind === "role_rebuttal")
      fold.role++;
  }
  return fold;
}

// ---------------------------------------------------------------------------
// P1.4 · 按 run 分组(投影用)
// ---------------------------------------------------------------------------

/** 最小 state 形状,避免本文件提前耦合 V5SessionState(P1.6 加字段后两者结构一致)。 */
export interface HasReasoningEvents {
  reasoningEvents?: ReasoningEvent[];
}

/** 按 capabilityRunId 分组并按 order 升序;空/undefined 安全返回空 Map(向后兼容)。 */
export function eventsByRun(state: HasReasoningEvents): Map<string, ReasoningEvent[]> {
  const map = new Map<string, ReasoningEvent[]>();
  for (const e of state.reasoningEvents || []) {
    const list = map.get(e.capabilityRunId) ?? [];
    list.push(e);
    map.set(e.capabilityRunId, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

// ---------------------------------------------------------------------------
// 示例(供执行 Agent 参考 —— 非运行代码,docstring 形式)
// ---------------------------------------------------------------------------
/*
// 示例 1 · dialogue gap.ask 一次执行的事件序列:
const evs = makeEventSequence(
  { turnId: "t3", capabilityRunId: "t3-run-1", capabilityId: "gap.ask" },
  [
    { kind: "capability_start", text: "开始定位阻塞缺口" },
    { kind: "think", text: "目标缺少用户群与范围边界,需先澄清" },
    { kind: "observe", text: "已确认:面向小区 C 端用户" },
    { kind: "capability_complete", text: "产出 4 个澄清问题", refs: ["t3-art-1"] },
  ]
);

// 示例 2 · 多角色面板(deliberation)收敛:
const panelEvs = makeEventSequence(
  { turnId: "t4", capabilityRunId: "t4-run-0", capabilityId: "critique.generate" },
  [
    { kind: "role_position", roleId: "安全", text: "优先 RBAC + 数据范围过滤" },
    { kind: "role_critique", roleId: "挑刺", targetRoleId: "安全", text: "ABAC 成本过高,MVP 不引入" },
    { kind: "panel_converge", roleId: "综合", text: "收敛:RBAC 优先,保留策略扩展点",
      meta: { convergenceScore: 0.82, consensusReached: true, dissent: [] } },
  ]
);
*/
