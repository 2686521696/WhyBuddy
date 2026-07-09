/**
 * derive-turn-phases — 把本轮平铺的步骤流水分组成 V5.2 闭环的阶段叙事
 * （Claude 式：每个阶段有标题与状态，当前阶段展开流式输出，完成的折叠）。
 *
 * 阶段与步骤文本的对应（步骤 label 由 useSlideRuleSession 生成，前缀即协议）：
 *   理解意图        —— 「指令已接收…」「上一话题已闭环…」「本话题已闭环…」
 *   第 N 轮推演     —— 「第 N 轮 · …」（reasoning_step，每轮一组）
 *   五系统模型起草  —— 「🖋 LLM 正在起草…」（llm_delta 窗口）
 *   六系统证据落地  —— 「⚙ …生成中」「✓ …证据落地」「✗ …证据缺失」
 *   发布闭环        —— 合成阶段：turn 完成后由 publishClosure 补上
 *
 * 纯函数模块：无副作用，便于单测。
 */

export interface TurnPhase {
  id: string;
  title: string;
  /** running（本阶段正在流式推进）| done */
  status: "running" | "done";
  lines: string[];
}

const INTAKE_PREFIXES = ["指令已接收", "上一话题已闭环", "本话题已闭环"];

function phaseKeyForStep(text: string): { key: string; title: string } {
  if (INTAKE_PREFIXES.some(p => text.startsWith(p))) {
    return { key: "intake", title: "理解意图" };
  }
  const round = text.match(/^第 (\d+) 轮/);
  if (round) {
    return { key: `round-${round[1]}`, title: `第 ${round[1]} 轮推演` };
  }
  if (text.startsWith("🖋")) {
    return { key: "draft", title: "五系统模型起草" };
  }
  if (/^[⚙✓✗]/.test(text)) {
    return { key: "evidence", title: "六系统证据落地" };
  }
  return { key: "", title: "" }; // 归入当前阶段
}

/** 从 LLM 草稿里提取最近一个 "name" 定义，给起草阶段一条语义副标题。 */
export function latestDraftDefinition(draft: string): string | null {
  if (!draft) return null;
  const matches = draft.match(/"name"\s*:\s*"([^"]{1,40})"/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1].match(/"name"\s*:\s*"([^"]+)"/);
  return last ? last[1] : null;
}

export function deriveTurnPhases(args: {
  stepTexts: string[];
  streaming: boolean;
  /** 起草中的实时草稿（非空时 draft 阶段视为进行中并附语义行） */
  llmDraft?: string;
  /** turn 完成后合成「发布闭环」阶段 */
  closure?: {
    blocked: boolean;
    evidencePresentCount: number;
    skillCount: number;
  } | null;
}): TurnPhase[] {
  const { stepTexts, streaming, llmDraft = "", closure } = args;
  const phases: TurnPhase[] = [];
  const byKey = new Map<string, TurnPhase>();

  const ensure = (key: string, title: string): TurnPhase => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const phase: TurnPhase = { id: key, title, status: "done", lines: [] };
    byKey.set(key, phase);
    phases.push(phase);
    return phase;
  };

  for (const text of stepTexts) {
    const { key, title } = phaseKeyForStep(text);
    if (key) {
      ensure(key, title).lines.push(text);
    } else if (phases.length > 0) {
      phases[phases.length - 1].lines.push(text);
    } else {
      ensure("intake", "理解意图").lines.push(text);
    }
  }

  // 起草阶段的语义副标题（「最新定义：档案状态」）——原始 JSON 之上的人话层。
  const draftPhase = byKey.get("draft");
  if (draftPhase && llmDraft) {
    const latest = latestDraftDefinition(llmDraft);
    if (latest)
      draftPhase.lines.push(
        `最新定义：${latest} · 已产出 ${llmDraft.length} 字符`
      );
  }

  // 完成后合成「发布闭环」终局阶段（V5.2 闭环的收口一目了然）。
  if (!streaming && closure) {
    const phase = ensure("closure", "发布闭环");
    phase.lines.push(
      closure.blocked
        ? `blocked ${closure.evidencePresentCount}/${closure.skillCount} — 证据缺口如实拦截（fail-closed）`
        : `closed ${closure.evidencePresentCount}/${closure.skillCount} — 六系统证据齐备，版本钉扎已检查`
    );
  }

  // 状态：流式时最后一个阶段 running，其余 done；完成后全部 done。
  if (streaming && phases.length > 0) {
    phases[phases.length - 1].status = "running";
  }
  return phases;
}
