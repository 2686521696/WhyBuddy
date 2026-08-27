/**
 * M2: MarathonDriver — thin orchestration layer on top of driveReasoningSession.
 * Inner spine (gates, ledger, single-writer, GCOV) zero change.
 * "自主决定 WHAT，机械裁决 WHETHER" — replay at drive layer.
 *
 * Per spec: reuses driveReasoningSession in loop; handles stopReasons for auto-seed (stub frontier for now).
 * stopSignal (M1) propagated.
 * Mode: "single" (current default, bypass) vs "marathon" (autopilot).
 */

import type { V5SessionState, CapabilityCostRecord } from "@shared/blueprint/v5-reasoning-state";
import type { ReentryStopReason } from "./sliderule-runtime";
import * as SlideRuleRuntime from "./sliderule-runtime";
import { buildStructuredReport } from "@shared/blueprint/sliderule-report-builder";
import { buildCapabilityPrompt } from "@shared/blueprint/sliderule-capability-prompts";
// 技能库六期"推演注入"：已安装技能随 drive-full 请求进生成契约（纯本地读取，无环）
import { installedSkillsDrivePayload } from "@/pages/sliderule/installed-skills";
import { lenientStringList } from "@/pages/sliderule/spec-assumptions";
import {
  loadTurnCapabilities,
  pickedConnectorIds,
} from "@/pages/sliderule/turn-capabilities";

export type MarathonStopReason =
  | "user_interrupted" // M1
  | "session_budget_exhausted" // M5
  | "frontier_exhausted" // M3
  | "await_human"; // M4 true gap, resumable

export interface MarathonOptions {
  stopSignal: AbortSignal;
  budget: { maxTokens?: number; declaredAt: string };
  policy: { autoConfirmRoute?: string; autoWaiveNonBlockingGaps?: boolean };
  onRoundComplete?: (digest: any, round: any) => void;
  /** Passthrough to each inner driveReasoningSession round (BYOK pool executor etc.). */
  executor?: SlideRuleRuntime.DriveReasoningOptions["executor"];
  router?: SlideRuleRuntime.DriveReasoningOptions["router"];
  maxLoopsPerMessage?: SlideRuleRuntime.DriveReasoningOptions["maxLoopsPerMessage"];
  onCapabilityRound?: SlideRuleRuntime.DriveReasoningOptions["onCapabilityRound"];
  onLoopComplete?: SlideRuleRuntime.DriveReasoningOptions["onLoopComplete"];
}

export interface MarathonResult {
  finalState: V5SessionState;
  rounds: Array<{
    loopTurnId: string;
    stopReason: ReentryStopReason | MarathonStopReason;
    seed?: string; // auto-seeded for next
  }>;
  stopReason: MarathonStopReason;
  publishClosure?: any;
}

export type DriveFullStatus =
  | "python_success"
  | "timeout"
  | "python_unavailable"
  | "fallback";

/**
 * 推演需要登录（后端 401）。
 *
 * ## 为什么必须是一个**独立的异常**，不能跟其它失败一样 return null
 *
 * 这几个驱动函数的约定是"失败返回 null"，调用方拿到 null 就回落本地引擎重跑。
 * 那个约定对**服务不可用**是对的，对 401 是错的：
 *
 *   · 本地重跑绕不过登录——后端每个写接口都会再拦一次；
 *   · 回落路径会去打 legacy 的 /execute-capability，那条路在
 *     SLIDERULE_V5_BACKEND=python 下直接 500（thin_proxy_violation）；
 *   · 用户看到的是转圈转到底 + 一个跟登录毫无关系的 500，而真正的原因
 *     （"请先登录后再推演"）被吞掉了。
 *
 * 线上实测过这个形状：miantuan.ai 上匿名点发送 → drive-full-stream 401 →
 * 前端当故障降级 → execute-capability 500。**后端守卫是对的，错的是前端
 * 把"没权限"当成了"服务坏了"。**
 *
 * 权限失败不是瞬时故障，不该重试、不该降级——如实抛出，让调用方去引导登录。
 */
export class DriveAuthRequiredError extends Error {
  readonly needsLogin = true;
  constructor(message: string) {
    super(message || "请先登录后再推演");
    this.name = "DriveAuthRequiredError";
  }
}

/** 401 → 抛 DriveAuthRequiredError（带上后端那句人话）；其余交给调用方按原约定处理。 */
async function throwIfAuthRequired(res: Response): Promise<void> {
  if (res.status !== 401) return;
  let message = "";
  try {
    const body = await res.clone().json();
    message = String(body?.message || body?.detail || "");
  } catch {
    // 非 JSON 响应（网关自己的 401 页面等）——用默认文案
  }
  throw new DriveAuthRequiredError(message);
}

async function driveMarathonViaPython(
  state: V5SessionState,
  seedText: string,
  opts: MarathonOptions
): Promise<MarathonResult | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/api/sliderule/drive-marathon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: opts.stopSignal,
      body: JSON.stringify({
        state,
        seedText,
        budget: opts.budget,
        policy: opts.policy,
        maxRounds: 8,
      }),
    });
    await throwIfAuthRequired(res);
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.backend !== "python" || body?.budgetAuthority !== "python" || !body?.state) return null;
    const rounds = Array.isArray(body.rounds) ? body.rounds : [];
    for (const round of rounds) {
      opts.onRoundComplete?.({}, round);
    }
    const finalState = body.publishClosure
      ? { ...(body.state as V5SessionState), publishClosure: body.publishClosure }
      : (body.state as V5SessionState);
    return {
      finalState,
      rounds,
      stopReason: (body.stopReason || "await_human") as MarathonStopReason,
      publishClosure: body.publishClosure,
    };
  } catch (err) {
    if (err instanceof DriveAuthRequiredError) throw err;
    return null;
  }
}

export function classifyDriveFullStatus(
  result:
    | { finalState?: V5SessionState | null; error?: string | null; status?: number | null }
    | null
    | undefined
): DriveFullStatus {
  if (result?.finalState) return "python_success";
  const error = String(result?.error || "").toLowerCase();
  if (error.includes("timeout") || result?.status === 504) return "timeout";
  if (error.includes("python_unavailable") || error.includes("unavailable")) {
    return "python_unavailable";
  }
  return "fallback";
}

export async function driveFullViaPython(
  state: V5SessionState,
  userText: string,
  opts: {
    stopSignal?: AbortSignal;
    maxLoops?: number;
    turnId?: string;
    preferredDevice?: "desktop" | "phone";
    /** 设计系统 id。后端据此取种子色拼提示词 / 选 DESIGN.md。 */
    designSystemId?: string;
  } = {}
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/api/sliderule/drive-full", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: opts.stopSignal,
      body: JSON.stringify({
        state,
        userText,
        max_loops: opts.maxLoops ?? 10,
        turnId: opts.turnId,
        installedSkills: installedSkillsDrivePayload(),
        /* 这一轮挂着的连接器（输入框 `/` 或伙伴挂上的）。
           ⚠ 同步和流式两处都要带——流式才是前端主路径，只改一处等于没改。 */
        activeConnectors: pickedConnectorIds(loadTurnCapabilities()),
        preferredDevice: opts.preferredDevice ?? "desktop",
        designSystemId: opts.designSystemId,
      }),
    });
    await throwIfAuthRequired(res);
    if (!res.ok) return null;
    const body = await res.json();
    if (body?.backend !== "python" || !body?.state) return null;
    const finalState: any = { ...(body.state as V5SessionState) };
    if (body.publishClosure !== undefined) {
      finalState.publishClosure = body.publishClosure;
    }
    if (body.skillRuntimeGraph !== undefined) {
      finalState.skillRuntimeGraph = body.skillRuntimeGraph;
    }
    return {
      finalState,
      stopReason: body.stopReason || "completed",
      publishClosure: body.publishClosure,
      loops: opts.turnId
        ? [
            {
              loopTurnId: opts.turnId,
              plan: { selected: [], reason: "python_drive_full", expectedArtifacts: [] },
              committedArtifactIds: [],
              stopSignal: "drive_full",
            },
          ]
        : [],
    };
  } catch (err) {
    if (err instanceof DriveAuthRequiredError) throw err;
    return null;
  }
}

/** Skill IDs emitted by the Python SSE stream. */
export type SkillId = "dataModel" | "workflow" | "rbac" | "page" | "aigc" | "appBundle";

export interface DriveFullStreamOpts {
  stopSignal?: AbortSignal;
  maxLoops?: number;
  turnId?: string;
  /** E26 缺口修复轮：只重跑覆盖门标红的能力，已 PASS 产物原样复用。 */
  mode?: "repair";
  /** Called each time one of the 5 skill systems starts (post-closure sequence). */
  onSkillActivated?: (skillId: SkillId, label: string) => void;
  /** Called when a skill finishes, with its real closure evidence + graph. */
  onSkillCompleted?: (
    skillId: SkillId,
    hasError: boolean,
    detail?: {
      mermaid?: string | null;
      evidencePresent?: boolean;
      evidenceRef?: string | null;
      artifactId?: string | null;
      digest?: string | null;
      edges?: Array<Record<string, any>> | null;
      /** Gate-PASSED five-system model section for this skill (LLM path; null on deterministic domains). */
      modelSection?: Record<string, any> | null;
    }
  ) => void;
  /** Called for each reasoning-engine step (evidence.search, risk.analyze ...). */
  onReasoningStep?: (label: string, loop?: number) => void;
  /**
   * 已有 SSE `progress_heartbeat` 的投影点。不另开进度 API。
   * 只推进产品六步钟，不要往左栏再塞一条 chip（心跳会连发）。
   */
  onProgressHeartbeat?: (stage?: string, label?: string) => void;
  /** LLM 实时内容增量。label 标注来源：能力 id（risk.analyze / report.write…）
   *  或 "five-system-model"（五系统起草）。旧后端不带 label 时为 undefined。 */
  onLlmDelta?: (text: string, label?: string) => void;
  /** spec-first 第 3 步的页面：每落地一页来一次（2026-08-14）。
   *
   *  新链路产出的是**一整份能直接打开的 HTML**，而第一页在整轮的第二分钟
   *  就有了——比最终模型早四五分钟。这条回调存在的全部理由就是把那四五
   *  分钟从"转圈"变成"能看"。
   *
   *  `bound=false` 是第 3 步的素颜页（还没打 data-* 孔，孔要等第 6.5 步，
   *  那时实体字段才定死）。渲染方据此知道现在看的是"长什么样"，
   *  数据是后面才接上的。 */
  onSpecPage?: (page: {
    pageId: string;
    html: string;
    current: number;
    total: number;
    bound: boolean;
    /** desktop 横屏 1920×1080 / phone 竖屏 390×844 CSS 像素——画布视口据此选。 */
    device: "desktop" | "phone";
  }) => void;
  /** 伴随式澄清：spec-first 第 2 步**替用户定下的事**（2026-08-27）。
   *
   *  它不是提问，不阻塞，也不需要回答。推演照常往下跑，这些只是把模型
   *  已经做的决定摊开——「员工登录我定成了手机号，也可以是工号」。
   *  用户改哪条，就把那条改动接进中途排队（本轮结束自动发出），
   *  走的是已经验证过的「用户 → AI」那条路，不新开通道。
   *
   *  ⚠ 第 2 步在整轮的第 1~2 分钟，而整轮 8~10 分钟。这个回调存在的全部
   *  理由就是别等到最后——那时候用户唯一能做的只剩整轮重来。 */
  onSpecAssumptions?: (items: Array<{
    id: string;
    topic: string;
    decision: string;
    alternatives: string[];
    why: string;
  }>) => void;
  /** E25：后端 run id（事件里首见即回调一次）——客户端记书签供刷新后续播。 */
  onRunId?: (runId: string) => void;
  /** E25：仅当服务端亲口宣布 run 终局（complete / run_cancelled / error
   *  事件到达）时回调一次。纯连接断开（刷新/跳页/网络抖动）不触发——
   *  run 仍在后台跑，续播书签必须保留。 */
  onRunSettled?: (reason: "complete" | "cancelled" | "error") => void;
  /** 流读到 done 却没见终局（协议违规）。见 STREAM_NO_TERMINAL 头注。 */
  onStreamNoTerminal?: (code: string) => void;
  /** 空态作曲家「应用 / Web」。desktop 横屏 / phone 竖屏，跟 device_policy 同词表。 */
  preferredDevice?: "desktop" | "phone";
  /** 设计系统 id。后端据此取种子色拼提示词 / 选 DESIGN.md。 */
  designSystemId?: string;
  /** M1 控制面昂贵按钮：rehearse/refine/repair/challenge。/推演 不得带 rehearse。 */
  forcedTool?: string;
  /**
   * `/回退` 的目标版本。空 versionId 在服务端 restore_version 是静默 no-op，
   * 必须把上一版 id 带上；服务端缺省也会再默认上一版。
   */
  versionId?: string;
  /**
   * 质疑指向的产物 id。
   *
   * ⚠ **不带这条，质疑就等于没质疑。** 服务端拿它构造 UserIntervention，
   *   三个 target 全空时失效级联整段跳过（staleArtifactIds 一个不加），
   *   而流里照样说「已按质疑失效」。2026-08-27 评审逮到的断链：客户端
   *   `challenge-composer` 解析好了、`runTurn` 收到了，就是没进 POST body。
   */
  targetArtifactId?: string;
  /**
   * 澄清卡这次答掉了哪几个缺口。
   *
   * ⚠ 同上一条是一对。旧 TS `intakeMessage` 里的 `resolveReadinessGapsByIds`
   *   随控制面改造一起删了，而拼 answeredGapIds 的代码还在——答完卡片
   *   一个缺口都不会关。
   */
  answeredGapIds?: string[];
  /**
   * 澄清卡答完的**问答对**。
   *
   * ⚠ 只发 id 不发答案的话，服务端只能把缺口置 resolved——闸绿了，而生成侧
   *   一个字都没多知道（`clarification_prompt_block` 靠 gap.answer 取料）。
   *   澄清这条链 2026-08-27 之前就断在这儿：问了等于没问。
   */
  answeredGaps?: Array<{ gapId: string; answer: string }>;
  /** 产品宪章 opt-in。只在确认推演时带，缺省不送，免得问候把账户旗清掉。 */
  reuseCharter?: boolean;
  productCharter?: {
    industry?: string;
    terms?: string;
    defaultRoles?: string;
    hardCompliance?: string;
    brandConstraints?: string;
  };
  onControlText?: (text: string) => void;
  onControlAskUser?: (event: {
    question: string;
    options?: string[];
  }) => void;
  onControlScopeCard?: (event: {
    restatement: string;
    device?: string;
    variant?: string;
    userText?: string;
    charterReuseNext?: boolean;
  }) => void;
  onControlToolStart?: (tool: string) => void;
  onControlToolResult?: (event: Record<string, unknown>) => void;
}

/**
 * SSE version of driveFullViaPython.
 *
 * Connects to /api/sliderule/drive-full-stream and consumes the event stream.
 * Calls opts.onSkillActivated / onSkillCompleted as events arrive so the UI
 * can highlight the active thumbnail in real time.
 * Returns the same shape as driveFullViaPython on completion, or null on error.
 */
export async function driveFullViaPythonStream(
  state: V5SessionState,
  userText: string,
  opts: DriveFullStreamOpts = {}
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/api/sliderule/drive-full-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: opts.stopSignal,
      body: JSON.stringify({
        state,
        userText,
        max_loops: opts.maxLoops ?? 10,
        turnId: opts.turnId,
        installedSkills: installedSkillsDrivePayload(),
        /* 这一轮挂着的连接器（输入框 `/` 或伙伴挂上的）。
           ⚠ 同步和流式两处都要带——流式才是前端主路径，只改一处等于没改。 */
        activeConnectors: pickedConnectorIds(loadTurnCapabilities()),
        ...(opts.mode ? { mode: opts.mode } : {}),
        preferredDevice: opts.preferredDevice ?? "desktop",
        designSystemId: opts.designSystemId,
      }),
    });
    await throwIfAuthRequired(res);
    if (!res.ok || !res.body) return null;
    return await consumeDriveStreamResponse(res, opts);
  } catch (err) {
    // 权限失败必须穿透这层 catch——它正是被这个 catch 吞成 null 的
    if (err instanceof DriveAuthRequiredError) throw err;
    return null;
  }
}

/**
 * E25 续播：附着到既有后台 run 的事件流（刷新/断线后接回）。
 * 恒从 since=0 全量补播——正在进行的这一轮 UI 据同一事件流原样重建，
 * 已产出的文字瞬间填充（drainStep 随积压自适应），之后接实时尾流。
 */
export async function resumeDriveFullStream(
  runId: string,
  opts: DriveFullStreamOpts = {}
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch(
      `/api/sliderule/runs/${encodeURIComponent(runId)}/stream?since=0`,
      { signal: opts.stopSignal, credentials: "include" }
    );
    await throwIfAuthRequired(res);
    if (!res.ok || !res.body) return null;
    return await consumeDriveStreamResponse(res, opts);
  } catch (err) {
    // 权限失败必须穿透这层 catch——它正是被这个 catch 吞成 null 的
    if (err instanceof DriveAuthRequiredError) throw err;
    return null;
  }
}

type FactoryStreamAcc = {
  finalState: V5SessionState | null;
  publishClosure: any;
  stopReason: string;
};

/**
 * 工厂 SSE 词表。POST 发起、GET 续播、控制面 handoff 之后共用——
 * 禁止复制一份 switch（复制必然漏 case）。
 */
function applyFactoryStreamEvent(
  event: any,
  opts: DriveFullStreamOpts,
  acc: FactoryStreamAcc
): "continue" | "complete" | "abort" {
  switch (event.type) {
    case "reasoning_step":
      opts.onReasoningStep?.(
        (typeof event.stage === "string" && event.stage) ||
          (event.label as string),
        event.loop as number | undefined
      );
      return "continue";
    case "llm_delta":
      opts.onLlmDelta?.(event.text as string, event.label as string | undefined);
      return "continue";
    case "spec_page":
      if (typeof event.html === "string" && event.html) {
        opts.onSpecPage?.({
          pageId: String(event.pageId || ""),
          html: event.html as string,
          current: Number(event.current) || 0,
          total: Number(event.total) || 0,
          bound: event.bound === true,
          device: event.device === "phone" ? "phone" : "desktop",
        });
      }
      return "continue";
    case "spec_assumption": {
      // 服务端已经洗过一遍（spec_tree._sanitize_assumptions）。这里再洗一次
      // 不是不信任它，是这条流也接老后端 / 续播缓存——形状不对宁可少渲染
      // 一张卡，不许把 undefined 摊到面板上。
      const rows: unknown[] = Array.isArray(event.items) ? event.items : [];
      const items = (rows.filter(
        (r) => !!r && typeof r === "object",
      ) as Array<Record<string, unknown>>)
        .map((r: Record<string, unknown>, i: number) => ({
          id: String(r.id || `a${i + 1}`),
          topic: String(r.topic || "").trim(),
          decision: String(r.decision || "").trim(),
          // ⚠ 裸字符串要变成**单元素数组**，不是被丢掉——口径见
          //   spec-assumptions.lenientStringList（跟 Python 侧同一张表）。
          alternatives: (lenientStringList(r.alternatives) ?? [])
            .map((a: string) => a.trim())
            .filter(Boolean),
          why: String(r.why || "").trim(),
        }))
        .filter((r: { topic: string; decision: string }) => r.topic && r.decision);
      if (items.length > 0) opts.onSpecAssumptions?.(items);
      return "continue";
    }
    case "skill_start":
      opts.onSkillActivated?.(event.skill as SkillId, event.label as string);
      return "continue";
    case "progress_heartbeat":
      opts.onProgressHeartbeat?.(
        typeof event.stage === "string" ? event.stage : undefined,
        typeof event.label === "string" ? event.label : undefined
      );
      return "continue";
    case "skill_result":
      opts.onSkillCompleted?.(event.skill as SkillId, Boolean(event.error), {
        mermaid: (event.mermaid as string | null) ?? null,
        evidencePresent: event.evidencePresent as boolean | undefined,
        evidenceRef: (event.evidenceRef as string | null) ?? null,
        artifactId: (event.artifactId as string | null) ?? null,
        digest: (event.digest as string | null) ?? null,
        edges: (event.edges as Array<Record<string, any>> | null) ?? null,
        modelSection: (event.modelSection as Record<string, any> | null) ?? null,
      });
      return "continue";
    case "publish_closure":
      acc.publishClosure = event.data;
      return "continue";
    case "complete":
      if (event.state) {
        acc.finalState = event.state as V5SessionState;
        if (acc.publishClosure !== undefined) {
          (acc.finalState as any).publishClosure = acc.publishClosure;
        }
      }
      opts.onRunSettled?.("complete");
      return "complete";
    case "run_cancelled":
      opts.onRunSettled?.("cancelled");
      return "abort";
    case "error":
      opts.onRunSettled?.("error");
      return "abort";
    default:
      return "continue";
  }
}

/**
 * 流的收尾契约：任意多个中间事件，**必须**以恰好一个终局收尾。
 * 终局集合（见 applyFactoryStreamEvent）：
 *   · `complete`                → 成功收尾，返回结果
 *   · `run_cancelled` / `error` → abort，返回 null（本来就是诚实的）
 * 读到 `done` 却一个终局都没见过 = **实现方违约**，不是一种正常结束。
 *
 * 抄的标准答案：grok-build `xai-tool-runtime/src/dispatch.rs`
 *   /// A stream that ends without a `Terminal` is a protocol violation by
 *   /// the implementation; the default surfaces this as
 *   /// `ToolError::Custom { code: "stream_no_terminal", ... }`
 * 那边 `call_terminal` 遇到无终局的流返回 Err，而不是把攒到一半的东西
 * 当结果交出去。
 *
 * ⚠ 2026-08-27 审查逮到本仓的形状：两个消费者里 `if (done) break;` 和
 *   `if (verdict === "complete") break outer;` **走同一个出口**
 *   `finishDriveStream(acc, opts)`。断掉的流只要之前某个事件带过 state，
 *   就会被包成一个看着正常的结果；而 classifyStreamFallback 第一行是
 *   `if (input.gotResult) return "settled"` —— 断流于是在**已有的两道
 *   双开守卫上游**被判成"已收尾"，守卫根本没机会生效。
 *
 *   这跟 2026-08-10 那次（POST 流第 2 分钟被 reset、服务端一路跑到
 *   seq 1812 正常收尾、前端把整轮重跑）是同一条根：消费者分不清
 *   "收尾了"和"断了"。那次修的是下游症状，这次把区分放回消费者并命名。
 */
export const STREAM_NO_TERMINAL = "stream_no_terminal";

function finishDriveStream(
  acc: FactoryStreamAcc,
  opts: DriveFullStreamOpts,
  sawTerminal: boolean
): { finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null {
  // 没见终局：报出名字再返回 null。攒到一半的 finalState 不许当本轮终态——
  // 那正是把"断了"讲成"完成"的那一步。
  if (!sawTerminal) {
    opts.onStreamNoTerminal?.(STREAM_NO_TERMINAL);
    return null;
  }
  if (!acc.finalState) return null;
  return {
    finalState: acc.finalState,
    stopReason: acc.stopReason,
    publishClosure: acc.publishClosure,
    loops: opts.turnId
      ? [
          {
            loopTurnId: opts.turnId,
            plan: { selected: [], reason: "python_drive_full_stream", expectedArtifacts: [] },
            committedArtifactIds: [],
            stopSignal: "drive_full_stream",
          },
        ]
      : [],
  };
}

/** POST 发起与 GET 续播共用的 SSE 消费循环（同一事件词表 → 同一 UI）。 */
export async function consumeDriveStreamResponse(
  res: Response,
  opts: DriveFullStreamOpts
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  try {
    if (!res.body) return null;
    let runIdSeen = false;
    let sawTerminal = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const acc: FactoryStreamAcc = {
      finalState: null,
      publishClosure: undefined,
      stopReason: "completed",
    };

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;

        let event: any;
        try { event = JSON.parse(jsonStr); } catch { continue; }

        if (!runIdSeen && typeof event.runId === "string" && event.runId) {
          runIdSeen = true;
          opts.onRunId?.(event.runId);
        }

        const verdict = applyFactoryStreamEvent(event, opts, acc);
        if (verdict === "complete") {
          sawTerminal = true;
          break outer;
        }
        // abort（run_cancelled / error）本来就是终局，返回 null 是诚实的：
        // 不是"断了"，是服务端明确宣布过结局。
        if (verdict === "abort") return null;
      }
    }

    return finishDriveStream(acc, opts, sawTerminal);
  } catch (err) {
    if (err instanceof DriveAuthRequiredError) throw err;
    return null;
  }
}

/**
 * 产品新烧：POST /api/sliderule/control-turn-stream。
 * 六字段必须带上（installedSkillsDrivePayload / pickedConnectorIds）。
 * 续播不走这里——续播是 GET /runs/{id}/stream。
 */
export async function postControlTurnStream(
  state: V5SessionState,
  userText: string,
  opts: DriveFullStreamOpts = {}
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  if (typeof fetch !== "function") return null;
  try {
    const res = await fetch("/api/sliderule/control-turn-stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      signal: opts.stopSignal,
      body: JSON.stringify({
        sessionId: state.sessionId,
        userText,
        installedSkills: installedSkillsDrivePayload(),
        activeConnectors: pickedConnectorIds(loadTurnCapabilities()),
        preferredDevice: opts.preferredDevice ?? "desktop",
        designSystemId: opts.designSystemId ?? null,
        ...(opts.forcedTool ? { forcedTool: opts.forcedTool } : {}),
        ...(opts.versionId ? { versionId: opts.versionId } : {}),
        ...(opts.targetArtifactId
          ? { targetArtifactId: opts.targetArtifactId }
          : {}),
        ...(opts.answeredGapIds?.length
          ? { answeredGapIds: opts.answeredGapIds }
          : {}),
        ...(opts.answeredGaps?.length
          ? { answeredGaps: opts.answeredGaps }
          : {}),
        ...(opts.mode ? { mode: opts.mode } : {}),
        ...(opts.reuseCharter !== undefined
          ? { reuseCharter: opts.reuseCharter }
          : {}),
        ...(opts.productCharter ? { productCharter: opts.productCharter } : {}),
      }),
    });
    await throwIfAuthRequired(res);
    if (!res.ok || !res.body) return null;
    return await consumeControlStreamResponse(res, opts);
  } catch (err) {
    if (err instanceof DriveAuthRequiredError) throw err;
    return null;
  }
}

/** 控制面 SSE：先处理 control_*；handoff 之后把剩余事件交给同一份工厂 case。 */
export async function consumeControlStreamResponse(
  res: Response,
  opts: DriveFullStreamOpts
): Promise<{ finalState: V5SessionState; stopReason?: string; loops?: any[]; publishClosure?: any } | null> {
  try {
    if (!res.body) return null;
    let runIdSeen = false;
    let handedOff = false;
    let sawTerminal = false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const acc: FactoryStreamAcc = {
      finalState: null,
      publishClosure: undefined,
      stopReason: "completed",
    };

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr) continue;
        let event: any;
        try { event = JSON.parse(jsonStr); } catch { continue; }

        if (!runIdSeen && typeof event.runId === "string" && event.runId) {
          runIdSeen = true;
          opts.onRunId?.(event.runId);
        }

        if (!handedOff) {
          switch (event.type) {
            case "control_text":
              opts.onControlText?.(String(event.text || ""));
              continue;
            case "control_tool_start":
              opts.onControlToolStart?.(String(event.tool || ""));
              continue;
            case "control_tool_result":
              opts.onControlToolResult?.(event);
              {
                const human = String(
                  event.human || event.summary || ""
                ).trim();
                if (human) opts.onControlText?.(human);
              }
              continue;
            case "control_ask_user":
              opts.onControlAskUser?.({
                question: String(event.question || ""),
                options: Array.isArray(event.options)
                  ? event.options.map((x: unknown) => String(x))
                  : [],
              });
              continue;
            case "control_scope_card":
              opts.onControlScopeCard?.({
                restatement: String(event.restatement || ""),
                device: event.device,
                variant: event.variant,
                userText: event.userText,
                charterReuseNext:
                  typeof event.charterReuseNext === "boolean"
                    ? event.charterReuseNext
                    : undefined,
              });
              continue;
            case "control_handoff_factory":
              handedOff = true;
              if (typeof event.runId === "string" && event.runId) {
                runIdSeen = true;
                opts.onRunId?.(event.runId);
              }
              continue;
            case "complete":
              if (event.state) {
                acc.finalState = event.state as V5SessionState;
              }
              opts.onRunSettled?.("complete");
              sawTerminal = true;
              break outer;
            default:
              break;
          }
        }

        const verdict = applyFactoryStreamEvent(event, opts, acc);
        if (verdict === "complete") {
          sawTerminal = true;
          break outer;
        }
        if (verdict === "abort") return null;
      }
    }

    return finishDriveStream(acc, opts, sawTerminal);
  } catch (err) {
    if (err instanceof DriveAuthRequiredError) throw err;
    return null;
  }
}

export interface FrontierProposal {
  seed: string;
  rationale: string;
  prompt: string; // explicit prompt used (or would-be via buildCapabilityPrompt single truth)
  ledgerEntry: {
    type: "frontier_propose";
    proposedSeed: string;
    rationale: string;
    promptSnippet: string;
    at: string;
    deDupeChecked: boolean;
  };
}

export async function proposeFrontier(
  state: V5SessionState,
  digest: { title: string; summary: string; content: string },
  previousFrontiers: string[]
): Promise<FrontierProposal> {
  // M3 真实 frontier.propose: prompt (single-truth build) + rationale + ledger
  // Use buildCapabilityPrompt (B1 truth) + report context for a "frontier.propose" derivation.
  // We call with report.write (guaranteed supported) to get authoritative context block, then craft explicit frontier prompt.
  // The actual seed is deterministically derived from real digest "下一步工程化分支" + goal (no halluc freeform).
  const turnId = `frontier-${Date.now()}`;
  // Build a context-rich prompt via the single source of truth (even if capId is synthetic, contract falls back gracefully)
  const promptRes = buildCapabilityPrompt({
    capabilityId: "frontier.propose",
    state,
    inputArtifactIds: (state.artifacts || []).slice(-6).map((a: any) => a.id),
    roleId: "autopilot",
    turnId,
  });
  const basePrompt = `${promptRes.systemPrompt}\n\n${promptRes.userPrompt}`;

  // Derive concrete next frontier seed from the *real* digest (K1 supply priority: front-load the last report content)
  const branchMatch = (digest.content || "").match(/下一步工程化分支[:：]\s*([\s\S]{20,400}?)(?:\n\n|provenance|收敛|$)/i);
  const branchText = branchMatch ? branchMatch[1].trim().replace(/\n+/g, " ") : "";
  const goalText = (state.goal?.text || "当前目标").slice(0, 80);
  // Produce a focused, deduped question seed (userText style for next drive)
  let proposedSeed = `基于上轮收敛「${digest.title}」继续：${branchText ? branchText.slice(0, 180) : "探索下一可执行闭环与证据补强"}？（目标：${goalText}）`;
  proposedSeed = proposedSeed.replace(/\s+/g, " ").slice(0, 420);

  const rationale = `M3 frontier.propose: 从结构化 digest（buildStructuredReport 9段）中提取「下一步工程化分支」+ 目标片段，生成自治下一轮 seed。优先 K1 供给最近 digest 内容（~24k 截断由调用方控制）。rationale 避免重复 previousFrontiers（M3 de-dupe）。此 propose 显式记录 prompt（B1 契约）+ rationale + ledger，便于 audit 与 replay。`;

  // M3 de-dupe
  const deDupeChecked = previousFrontiers.includes(proposedSeed);
  if (deDupeChecked || previousFrontiers.length >= 3) {
    // still return a proposal; caller decides exhausted
    proposedSeed = proposedSeed + " [variant-" + (previousFrontiers.length + 1) + "]";
  }

  const ledgerEntry = {
    type: "frontier_propose" as const,
    proposedSeed,
    rationale,
    promptSnippet: basePrompt.slice(0, 600) + (basePrompt.length > 600 ? "..." : ""),
    at: new Date().toISOString(),
    deDupeChecked,
  };

  return {
    seed: proposedSeed,
    rationale,
    prompt: basePrompt,
    ledgerEntry,
  };
}

export function createRoundDigest(state: V5SessionState, recentArtifactIds: string[]): { title: string; summary: string; content: string; supersededIds: string[] } {
  // M6 真实 digest: 直接使用 buildStructuredReport（生产 baseline 9段 schema）
  const inputIds = recentArtifactIds.length > 0
    ? recentArtifactIds
    : (state.artifacts || []).slice(-5).map((a: any) => a.id);
  const built = buildStructuredReport({ state, inputArtifactIds: inputIds, roleId: "digest-autopilot", turnLabel: "marathon-round" });

  // M6 superseded (独立于 stale): 标记本轮参与 digest 的 artifacts（供画布分组/K1 压缩）
  const supersededIds = [...new Set(inputIds)];

  return { ...built, supersededIds };
}

export async function driveMarathon(
  state: V5SessionState,
  seedText: string,
  opts: MarathonOptions
): Promise<MarathonResult> {
  const pythonResult = await driveMarathonViaPython(state, seedText, opts);
  if (pythonResult) return pythonResult;

  const rounds: MarathonResult["rounds"] = [];
  let working = state;
  let currentSeed = seedText;
  let stopReason: MarathonStopReason = "await_human";
  const previousFrontiers: string[] = [];
  // TS THIN COMPAT CONSUMER ONLY (review finding 3):
  // - Named budget policy + marathon stop (session_budget_exhausted) owned by PYTHON_AUTHORITY in slide-rule-python/services/slide_rule_budget.py + drive_marathon (defaults to real drive_reasoning_turn).
  // - This TS driveMarathon first tries Python /api (driveMarathonViaPython); local loop retained ONLY as compat/offline fallback when fetch fails or Python unavailable.
  // - Residual risk: when Python API unreachable, TS fallback executes digest/frontier/re-entry (no Python inner gates in that case). Documented in migration status. Production prefers Python.

  // M4: AutopilotPolicy (explicit, audit-able; attached for TopHud/raw export)
  const policy = {
    autoConfirmRoute: "primary",
    autoWaiveNonBlockingGaps: true,
    declaredAt: new Date().toISOString(),
  };
  (working as any).autopilotPolicy = policy;

  while (true) {
    if (opts.stopSignal.aborted) {
      stopReason = "user_interrupted";
      break;
    }

    const driveRes = await SlideRuleRuntime.driveReasoningSession(working, {
      turnSeedId: `marathon-${Date.now()}`,
      userText: currentSeed,
      abortSignal: opts.stopSignal,
      executor: opts.executor,
      router: opts.router,
      maxLoopsPerMessage: opts.maxLoopsPerMessage,
      onCapabilityRound: opts.onCapabilityRound,
      onLoopComplete: opts.onLoopComplete,
    });

    const lastStop = driveRes.stopReason;
    const loopTurnId = driveRes.loops[driveRes.loops.length - 1]?.loopTurnId || `m-${Date.now()}`;
    rounds.push({ loopTurnId, stopReason: lastStop });

    working = driveRes.finalState;

    // thin compat: costLedger not accumulated for budget decisions here (PYTHON_AUTHORITY in Python budget/marathon); only inner drive + Python policy own max* stops. (HUD uses may read ledger directly.)

    // M6: 真实 digest (buildStructuredReport 9段) + 质量门概念（digest 本身由 report 契约保证，内层 drive 已过 gates）
    let digestForRound: any = { title: "轮次小结", summary: "", content: "" };
    if (lastStop === "convergence_signal" || lastStop === "coverage_sufficient") {
      const recentIds = (working.artifacts || []).slice(-6).map((a: any) => a.id);
      const digest = createRoundDigest(working, recentIds);
      digestForRound = digest;

      // M6: 应用 superseded（画布分组/优先供给依据）
      if (!working.supersededArtifactIds) working.supersededArtifactIds = [];
      working.supersededArtifactIds = [...new Set([...(working.supersededArtifactIds || []), ...digest.supersededIds])];

      // K1 供给优先：把 digest 内容前置到下一 seed（截断 24000 char 保护上下文预算）
      const k1DigestSupply = (digest.content || "").slice(0, 24000);

      // M3: 真实 frontier.propose（prompt + rationale + ledger）
      const proposal = await proposeFrontier(working, digest, previousFrontiers);
      const frontierLedger = proposal.ledgerEntry;

      // 记录到 decisionLedger（append-only，M3/M4/M6 可审计）
      if (!working.decisionLedger) working.decisionLedger = [];
      (working.decisionLedger as any[]).push({
        id: `frontier-${Date.now()}`,
        turnId: loopTurnId,
        source: "autopilot_frontier",
        reason: proposal.rationale,
        frontierProposal: frontierLedger,
        at: frontierLedger.at,
      });

      // 也追加到 conversation 便于 UI 可见 auto-seed 痕迹
      if (!working.conversation) working.conversation = [];
      (working.conversation as any[]).push({
        id: `frontier-note-${Date.now()}`,
        role: "system",
        text: `[M3 frontier.propose] ${proposal.seed}\nrationale: ${proposal.rationale.slice(0, 200)}`,
        timestamp: new Date().toISOString(),
      });

      previousFrontiers.push(proposal.seed);

      const exhausted = previousFrontiers.length > 4 || previousFrontiers.filter((f, i, a) => a.indexOf(f) !== i).length > 0;
      if (exhausted) {
        stopReason = "frontier_exhausted";
        if (opts.onRoundComplete) opts.onRoundComplete({ ...digest, frontier: proposal, k1Supply: k1DigestSupply.slice(0, 1200) }, rounds[rounds.length - 1]);
        break;
      }

      // 下一轮 seed = K1 优先 digest supply + frontier 问题
      currentSeed = `${k1DigestSupply.slice(0, 1800)}\n\n${proposal.seed}`;
      if (opts.onRoundComplete) {
        opts.onRoundComplete({ ...digest, frontier: proposal, k1Supply: k1DigestSupply.slice(0, 1200) }, rounds[rounds.length - 1]);
      }
      // continue to next marathon round
    } else if (lastStop === "await_ready") {
      stopReason = "await_human"; // M4 human-only
      if (opts.onRoundComplete) opts.onRoundComplete(digestForRound, rounds[rounds.length - 1]);
      break;
    } else if (lastStop === "await_confirm") {
      // M4: policy 代答（显式 ledger trace）
      currentSeed = `auto-confirmed per policy (${policy.autoConfirmRoute}); digest continued`;
      if (!working.decisionLedger) working.decisionLedger = [];
      (working.decisionLedger as any[]).push({
        id: `policy-confirm-${Date.now()}`,
        turnId: loopTurnId,
        source: "autopilot_policy",
        reason: `M4 policy代答: ${policy.autoConfirmRoute}`,
        autopilotPolicy: policy,
        at: new Date().toISOString(),
      });
      if (opts.onRoundComplete) opts.onRoundComplete(digestForRound, rounds[rounds.length - 1]);
    } else if (lastStop === "user_interrupted") {
      stopReason = "user_interrupted";
      break;
    } else if (lastStop === "budget_exhausted") {
      currentSeed = "继续基于前轮（内层 budget 后回 marathon session 预算）";
    } else {
      if (opts.onRoundComplete) opts.onRoundComplete(digestForRound, rounds[rounds.length - 1]);
      break;
    }

    // no TS session budget decision here (maxTokens etc removed). session_budget_exhausted + reentry now PYTHON_AUTHORITY default via /api (drive_marathon + real inner driver). Fallback below only for API-unavailable case (see review minor finding 3 + status residual risk note). TS only thin compat.
  }

  return { finalState: working, rounds, stopReason };
}

// Mode type re-exported from runtime for consistency
import type { SlideRuleDriveMode } from "./sliderule-runtime";
export type { SlideRuleDriveMode };

/** SSE 流没拿回结果时，接下来该走哪条路。 */
export type StreamFallbackVerdict =
  /** 后端 run 还在跑：如实报中断，绝不本地重跑（书签还在，刷新可接回）。 */
  | "report_interrupted"
  /** 连 run 都没建起来：本地引擎兜底是正当降级。 */
  | "local_fallback"
  /** 用户自己停的 / 服务端已宣布终局：按正常收尾走，不算中断。 */
  | "settled";

/**
 * 流断了之后该不该落本地引擎兜底。
 *
 * ## 为什么单独抽成纯函数
 *
 * 这是个**三岔判断**，而它原来长在 useSlideRuleSession 一个几百行的回调里，
 * 测不动。照 `block-wall-order.ts` 的先例抽出来——判据是纯函数就有单测，
 * 不必去搭 React hook + 动态 import + fetch 的架子。
 *
 * ## 判据：见没见过 runId
 *
 * 原来的条件是 `resumeRun && !result && !settled && !aborted`，只护住了
 * **续播**分支。首发流中途断线时 `resumeRun` 是假、`settledReason` 也是 null
 * （服务端好好的，压根没宣布终局），两道守卫全跳过，直接落进本地引擎——
 * 正是那段注释明令禁止的"与后台 run 双开"。
 *
 * 实测（2026-08-10）：一趟推演的 POST 流在第 2 分钟被对端 reset
 * （`curl: (56) Recv failure: Connection reset by peer`），而服务端一路跑到
 * seq 1812 正常收尾、闭环 6/6。那一刻前端会把整轮在浏览器里重跑一遍，
 * 与后台那个还活着的 run 各算各的。
 *
 * 正确的判据是**后端 run 到底建起来没有**，也就是 `onRunId` 触发过没有：
 *
 *   · 见过 runId（或本来就是续播）→ 后端有 run 在跑 → 报中断，别本地重跑；
 *   · 没见过                      → run 压根没建起来（Python 后端没起 / 直接
 *                                   500）→ 本地兜底是正当降级，那条路要留着。
 *
 * `aborted` 与 `settledReason` 优先于以上两条：用户自己按了停止、或服务端
 * 已经宣布终局，都不该报"连接中断"。
 */
export function classifyStreamFallback(input: {
  /** 这次走的是续播（GET /runs/{id}/stream）而不是首发 POST。 */
  resuming: boolean;
  /** 本次连接期间 onRunId 触发过（后端 run 已存在）。 */
  sawRunId: boolean;
  /** 流是否拿回了结果（拿回来就没这个问题）。 */
  gotResult: boolean;
  /** 服务端宣布的终局原因；null = 没宣布过。 */
  settledReason: "complete" | "cancelled" | "error" | null;
  /** 本地主动中止（用户点了停止）。 */
  locallyAborted: boolean;
  /**
   * 这条流见过终局事件吗。
   *
   * ⚠ 2026-08-27：原来第一行是 `if (input.gotResult) return "settled"`。
   *   而消费者只要 acc.finalState 被填过就返回非空——断掉的流攒着半截
   *   state 也算 gotResult，于是在**下面那两道双开守卫的上游**就被判成
   *   "已收尾"，守卫（sawRunId / settledReason）根本没机会看一眼。
   *   现在把"有没有终局"补进来：拿到结果**且**见过终局才算收尾。
   *
   * 省略时按 true 处理：老调用点（以及只关心其它分支的测试）语义不变，
   * 不悄悄变严——变严要显式传 false。
   */
  sawTerminal?: boolean;
}): StreamFallbackVerdict {
  const sawTerminal = input.sawTerminal ?? true;
  if (input.gotResult && sawTerminal) return "settled";
  if (input.locallyAborted || input.settledReason !== null) return "settled";
  return input.resuming || input.sawRunId ? "report_interrupted" : "local_fallback";
}
