/**
 * 入站判定闸门的前端消费侧（2026-07-27）。
 *
 * 后端 services/intake_judge.py 判这一轮输入是真需求 / 真迭代，还是闲聊、
 * 产品咨询、太模糊。卡片出来之后**只提示不阻断**：action=hint 就在输入框
 * 上方给一句引导 + 可点的改写建议，用户仍可自己改完再发。
 *
 * ⚠ 2026-08-20：生成这张卡的过程中必须锁发送。真机上判定还在飞，发送键
 * 是亮的，用户把半成品意图发出去，卡片回来已经晚了。锁的是 isJudging 这一
 * 段请求，不是卡片本身——debounce 期间不锁，打字不会一下一下灰掉发送。
 *
 * 三条纪律与后端一致：
 *  1. fail-open —— 网络错、超时、返回体不合约，一律当没判过（返回 null），
 *     闸门坏了不能变成产品坏了。
 *  2. 不抢跑 —— 输入停下来 500ms 才判；判定回来时输入若已改，结果作废
 *     （用 requestId 单调递增比对，避免慢响应盖掉新输入的判定）。
 *  3. 不打扰 —— 太短的输入直接不判（后端 precheck 也会拦，但没必要为
 *     "帮" 这种半个字发一次请求）。
 */
import React from "react";

import { parseJudgeDevice } from "./product-archetypes";

export type IntakeVerdict =
  | "real"
  | "iteration"
  | "vague"
  | "off_topic"
  | "meta"
  // 2026-07-29：说清楚了、但这个形态推演不出来（游戏/硬件/端侧原生/内容
  // 创作/实时信号）。跟 vague 分开是照 TriageSQL 的分法——"说不清"和"说清
  // 了但表达不了"是两回事，给用户的话也完全不同：前者是"再多说两句"，后者
  // 是"这件事做不了，但旁边这件做得了"。
  | "out_of_scope";

/**
 * 设备档（2026-07-30）。搭在同一次判定调用上，零额外往返。
 *
 * `unspecified` 是**一等取值不是 null 的别名**：判不出来跟判出来是桌面，
 * 下游处理完全不同——前者两档版式都生成，后者只生成桌面档并省掉约 67s。
 * 所以这里也不允许缺省成 "desktop"。
 */
export type IntakeDevice = string;

export interface IntakeJudgement {
  verdict: IntakeVerdict;
  action: "proceed" | "hint";
  reason: string;
  guidance: string;
  rewrite: string[];
  confidence: number;
  source: string;
  degradedReason: string;
  device: IntakeDevice;
  deviceReason: string;
}

// 这个集合是**闭集**：后端加了判词而这里没加，parseJudgement 会返回 null，
// 于是新判词的提示条一个字都不会显示——fail-open 在这里会把功能悄悄吞掉，
// 不会报错。所以两侧必须同步，intake-verdict-parity 测试钉住了这一点。
const VALID_VERDICTS: ReadonlySet<string> = new Set([
  "real",
  "iteration",
  "vague",
  "off_topic",
  "meta",
  "out_of_scope",
]);

/** 低于这个长度不发请求：后端 precheck 也会判 vague，但没必要为半个字往返。 */
export const MIN_JUDGE_CHARS = 6;
export const JUDGE_DEBOUNCE_MS = 500;

/**
 * 同一 send 禁止 hint 条和范围卡同时占位。范围卡是点火闸，hint 让路。
 * 变异：ComposerDock 同时渲染两者，intake-hint 与 scope-card 同屏必红。
 */
export function intakeHintYieldsToScopeCard(scopeCardOpen: boolean): boolean {
  return !scopeCardOpen;
}

/** 严格解析：字段缺失或 verdict 不在闭集内 → null（当作没判过，fail-open）。 */
export function parseJudgement(body: unknown): IntakeJudgement | null {
  if (!body || typeof body !== "object") return null;
  const j = (body as { judgement?: unknown }).judgement;
  if (!j || typeof j !== "object") return null;
  const raw = j as Record<string, unknown>;
  const verdict = String(raw.verdict ?? "");
  const action = String(raw.action ?? "");
  if (!VALID_VERDICTS.has(verdict)) return null;
  if (action !== "proceed" && action !== "hint") return null;
  return {
    verdict: verdict as IntakeVerdict,
    action,
    reason: String(raw.reason ?? ""),
    guidance: String(raw.guidance ?? ""),
    rewrite: Array.isArray(raw.rewrite)
      ? raw.rewrite.filter((r): r is string => typeof r === "string" && !!r.trim())
      : [],
    confidence: typeof raw.confidence === "number" ? raw.confidence : 1,
    source: String(raw.source ?? ""),
    degradedReason: String(raw.degradedReason ?? ""),
    // 不认的值一律落 unspecified，**不猜**。后端已经收敛过一遍，这里是第二道
    // ——前端独立判一次，是因为这个字段将来会被别的调用方消费，不能假定
    // 只有后端那条路径写它。
    device: parseJudgeDevice(raw.device),
    deviceReason: String(raw.deviceReason ?? ""),
  };
}

/**
 * 判一次。任何异常都吞掉返回 null——调用方据此当没判过。
 * 抽成独立函数是为了能脱开 React 直接测。
 */
export async function judgeIntake(
  text: string,
  hasApp: boolean,
  signal?: AbortSignal,
  appSummary = ""
): Promise<IntakeJudgement | null> {
  try {
    const res = await fetch("/api/sliderule/intake-judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, hasApp, appSummary }),
      signal,
    });
    if (!res.ok) return null;
    return parseJudgement(await res.json());
  } catch {
    return null;
  }
}

/**
 * 输入框旁的判定订阅。
 *
 * `hasApp` 变化会重判：同一句话在"还没有应用"和"已有应用"两种语境下
 * 判决不同（后端按 scope 分规则域），语境变了旧判决就不再成立。
 *
 * `appSummary`（可选）把当前应用是什么告诉后端，引导话术会具体到这个应用
 * 而不是泛泛而谈——真机对比：不传时说"指出当前应用要怎么改"，传了会说
 * "指出当前采购审批应用要怎么改…例如补充预算校验、调整审批流程"。改的是
 * 话术质量不是判定结果，所以缺了也只是话术泛一点，不影响放行/拦截。
 */
export function useIntakeJudge(
  text: string,
  hasApp: boolean,
  enabled = true,
  appSummary = ""
): { judgement: IntakeJudgement | null; isJudging: boolean } {
  // 连同"这条判定是判的哪句话"一起存。判定在途时输入已经变了的话，旧判定
  // 对新输入就是一句错话——真机验证时点了改写建议（回填的是一句完全合格的
  // 需求），界面还在说"你这句太模糊"，持续到新判定回来为止。宁可这几秒什么
  // 都不显示，也不显示一句已经不成立的话。
  const [state, setState] = React.useState<{
    judgedFor: string;
    judgement: IntakeJudgement | null;
  }>({ judgedFor: "", judgement: null });
  const [isJudging, setIsJudging] = React.useState(false);
  // 单调递增的请求号：只有最新一次请求的结果能落盘，防止慢响应盖掉新判定。
  const latestRef = React.useRef(0);

  React.useEffect(() => {
    const trimmed = text.trim();
    if (!enabled || trimmed.length < MIN_JUDGE_CHARS) {
      setState({ judgedFor: "", judgement: null });
      setIsJudging(false);
      return;
    }
    const seq = ++latestRef.current;
    setIsJudging(false);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // 锁发送从这里开始：debounce 结束、请求真正发出。打字期间不锁。
      setIsJudging(true);
      void judgeIntake(trimmed, hasApp, controller.signal, appSummary).then(result => {
        if (seq !== latestRef.current) return;
        setIsJudging(false);
        setState({ judgedFor: trimmed, judgement: result });
      });
    }, JUDGE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (seq === latestRef.current) setIsJudging(false);
    };
    // appSummary 不进依赖：它随应用摘要刷新而变，但同一个应用换个措辞不该
    // 重判一次（每次重判都是一次 LLM 调用）。hasApp 翻转才是真语境切换。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, hasApp, enabled]);

  // 判的不是当前这句话就不给——输入一变，旧提示立刻消失。
  return {
    judgement: state.judgedFor === text.trim() ? state.judgement : null,
    isJudging: enabled && isJudging,
  };
}
