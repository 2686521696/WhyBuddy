/**
 * 入站判定闸门的前端消费侧（2026-07-27）。
 *
 * 后端 services/intake_judge.py 判这一轮输入是真需求 / 真迭代，还是闲聊、
 * 产品咨询、太模糊。第一版**只提示不阻断**：这里拿到 action=hint 就在输入框
 * 上方给一句引导 + 可点的改写建议，用户永远能直接发。
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

export type IntakeVerdict =
  | "real"
  | "iteration"
  | "vague"
  | "off_topic"
  | "meta";

export interface IntakeJudgement {
  verdict: IntakeVerdict;
  action: "proceed" | "hint";
  reason: string;
  guidance: string;
  rewrite: string[];
  confidence: number;
  source: string;
  degradedReason: string;
}

const VALID_VERDICTS: ReadonlySet<string> = new Set([
  "real",
  "iteration",
  "vague",
  "off_topic",
  "meta",
]);

/** 低于这个长度不发请求：后端 precheck 也会判 vague，但没必要为半个字往返。 */
export const MIN_JUDGE_CHARS = 6;
export const JUDGE_DEBOUNCE_MS = 500;

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
  };
}

/**
 * 判一次。任何异常都吞掉返回 null——调用方据此当没判过。
 * 抽成独立函数是为了能脱开 React 直接测。
 */
export async function judgeIntake(
  text: string,
  hasApp: boolean,
  signal?: AbortSignal
): Promise<IntakeJudgement | null> {
  try {
    const res = await fetch("/api/sliderule/intake-judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, hasApp }),
      signal,
    });
    if (!res.ok) return null;
    return parseJudgement(await res.json());
  } catch {
    return null;
  }
}

/**
 * 输入框旁的判定订阅。返回当前该展示的判定（不该展示时为 null）。
 *
 * `hasApp` 变化会重判：同一句话在"还没有应用"和"已有应用"两种语境下
 * 判决不同（后端按 scope 分规则域），语境变了旧判决就不再成立。
 */
export function useIntakeJudge(
  text: string,
  hasApp: boolean,
  enabled = true
): IntakeJudgement | null {
  // 连同"这条判定是判的哪句话"一起存。判定在途时输入已经变了的话，旧判定
  // 对新输入就是一句错话——真机验证时点了改写建议（回填的是一句完全合格的
  // 需求），界面还在说"你这句太模糊"，持续到新判定回来为止。宁可这几秒什么
  // 都不显示，也不显示一句已经不成立的话。
  const [state, setState] = React.useState<{
    judgedFor: string;
    judgement: IntakeJudgement | null;
  }>({ judgedFor: "", judgement: null });
  // 单调递增的请求号：只有最新一次请求的结果能落盘，防止慢响应盖掉新判定。
  const latestRef = React.useRef(0);

  React.useEffect(() => {
    const trimmed = text.trim();
    if (!enabled || trimmed.length < MIN_JUDGE_CHARS) {
      setState({ judgedFor: "", judgement: null });
      return;
    }
    const seq = ++latestRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void judgeIntake(trimmed, hasApp, controller.signal).then(result => {
        if (seq === latestRef.current)
          setState({ judgedFor: trimmed, judgement: result });
      });
    }, JUDGE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, hasApp, enabled]);

  // 判的不是当前这句话就不给——输入一变，旧提示立刻消失。
  return state.judgedFor === text.trim() ? state.judgement : null;
}
