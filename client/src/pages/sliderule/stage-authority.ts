/**
 * 左栏阶段权属。对照 BettaFish 的「阶段事件 ≠ 正文」，不拉它的仓。
 *
 * 2026-08-18：V6.0 控制面是 Agent 选下一步，画页是写死配方。
 * 左栏若混成一张无规则清单，两种活就看不出来。
 * 这里只分权属，不装论坛互辩——仓里没有主持人，FLOWB 还要剥 debate。
 *
 * 真机坑：marathon 曾把 reasoning_step 的 **label**（人话）传给
 * onReasoningStep；现在优先传 **stage**（机器 id），左栏再翻人话。
 * 配方步仍会顶着 round 前缀进来。必须按文案/能力 id 认，不能只看「第 N 轮」。
 */

import type { PlanSourceValue } from "@shared/blueprint/sliderule-turn-route";
import type { TurnStep } from "./types";
import {
  type ActivityGroup,
  type ActivityRowModel,
  type ActivityStatus,
  type StageAuthority,
  parseActivityLine,
} from "./activity-rows";

export type { StageAuthority };

export type StageLine = {
  text: string;
  capabilityId?: string;
};

/** 配方步只认事件上的 specfirst.* id。查表翻译已删（对齐 xai-grok-session-events）。 */
const SPECFIRST_ID = /\bspecfirst\.[a-z]+\b/;

const INTAKE_NEEDLES = ["指令已接收", "上一话题已闭环"];

const CLOSURE_NEEDLES = ["本话题已闭环", "发布闭环"];

/** 画页/证据，但不是具名配方阶段（BettaFish 里当 chunk，不进阶段轨）。 */
const PAINT_CHUNK_NEEDLES = [
  "系统画面生成",
  "证据落地",
  "证据缺失",
  "最新定义：",
  "界面已出",
  "生成五系统模型",
  "重做模型",
  "首页参照图",
  "读取配色",
  "设计页面版式",
];

export function shortStageId(id: string): string {
  return id.split(".").pop() || id;
}

export function pickBadge(planSource?: PlanSourceValue): string {
  return planSource === "llm" ? "Agent 选" : "规则选";
}

function haystack(line: StageLine): string {
  return `${line.capabilityId || ""} ${line.text}`;
}

function isClosureLine(line: StageLine): boolean {
  return (
    /^\s*(closed|blocked)\b/i.test(line.text) ||
    CLOSURE_NEEDLES.some(n => haystack(line).includes(n))
  );
}

function isIntakeLine(line: StageLine): boolean {
  return INTAKE_NEEDLES.some(n => haystack(line).includes(n));
}

export function classifyStageLine(line: StageLine): StageAuthority {
  if (isIntakeLine(line) || isClosureLine(line)) return "gate";
  const hay = haystack(line);
  if (
    SPECFIRST_ID.test(hay) ||
    PAINT_CHUNK_NEEDLES.some(n => hay.includes(n))
  ) {
    return "recipe";
  }
  return "agent";
}

export function matchRecipeStage(line: StageLine): string | undefined {
  const hay = haystack(line);
  const hit = hay.match(SPECFIRST_ID);
  return hit ? hit[0] : undefined;
}

export function linesFromTurnSteps(steps: TurnStep[]): StageLine[] {
  const out: StageLine[] = [];
  for (const step of steps) {
    if (step.kind === "narration" || step.kind === "step_narration") {
      if (step.text) {
        out.push({
          text: step.text,
          capabilityId: (step as { capabilityId?: string }).capabilityId,
        });
      }
    } else if (step.kind === "chip") {
      if (step.label) out.push({ text: step.label, capabilityId: step.capabilityId });
    } else if (step.kind === "capability_fail") {
      if (step.message) {
        out.push({ text: step.message, capabilityId: step.capabilityId });
      }
    }
  }
  return out;
}

function rowFromLine(
  line: StageLine,
  index: number,
  bandStatus: "running" | "done",
  last: boolean
): ActivityRowModel {
  const parsed = parseActivityLine(line.text);
  let status: ActivityStatus = parsed.status;
  if (status !== "failed") {
    if (bandStatus === "done") status = "done";
    else if (last) status = "running";
    else status = "done";
  }
  const stageId = matchRecipeStage(line);
  return {
    id: `${classifyStageLine(line)}-${index}`,
    ...parsed,
    status,
    target: parsed.target || (stageId ? shortStageId(stageId) : undefined),
    authority: classifyStageLine(line),
    stageId,
  };
}

function recipeTrackRows(
  lines: StageLine[],
  streaming: boolean
): ActivityRowModel[] {
  // 只渲染已经到过的阶段。不发明一份 7 格 pending 骨架（那就是 RECIPE_CORE 翻译表）。
  const rows: ActivityRowModel[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const id = matchRecipeStage(line);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const parsed = parseActivityLine(line.text);
    rows.push({
      id,
      status: "done",
      verb: parsed.verb || line.text,
      target: shortStageId(id),
      authority: "recipe",
      stageId: id,
    });
  }
  if (streaming && rows.length > 0) {
    rows[rows.length - 1] = { ...rows[rows.length - 1], status: "running" };
  }
  return rows;
}

export function deriveStageBands(args: {
  steps: TurnStep[];
  streaming: boolean;
  planSource?: PlanSourceValue;
  extraTexts?: string[];
}): ActivityGroup[] {
  const lines = [
    ...linesFromTurnSteps(args.steps),
    ...(args.extraTexts || []).map(text => ({ text })),
  ];
  if (lines.length === 0) return [];

  const buckets = {
    intake: [] as StageLine[],
    agent: [] as StageLine[],
    recipe: [] as StageLine[],
    closure: [] as StageLine[],
  };
  for (const line of lines) {
    const authority = classifyStageLine(line);
    if (authority === "gate") {
      (isClosureLine(line) ? buckets.closure : buckets.intake).push(line);
    } else {
      buckets[authority].push(line);
    }
  }

  const groups: ActivityGroup[] = [];
  const pushBand = (
    id: string,
    authority: StageAuthority,
    title: string,
    badge: string,
    rows: ActivityRowModel[]
  ) => {
    if (rows.length === 0) return;
    const running = args.streaming && rows.some(r => r.status === "running");
    groups.push({
      id,
      title,
      badge,
      authority,
      status: running ? "running" : "done",
      rows,
    });
  };

  const stream = args.streaming ? "running" : "done";
  pushBand(
    "gate-in",
    "gate",
    "入站",
    "闸",
    buckets.intake.map((line, i) =>
      rowFromLine(line, i, stream, false)
    )
  );
  pushBand(
    "agent",
    "agent",
    "选材",
    pickBadge(args.planSource),
    buckets.agent.map((line, i) =>
      rowFromLine(
        line,
        i,
        stream,
        args.streaming && i === buckets.agent.length - 1 && buckets.recipe.length === 0
      )
    )
  );
  if (buckets.recipe.length > 0) {
    const named = buckets.recipe.some(line => matchRecipeStage(line));
    const rows = named
      ? recipeTrackRows(buckets.recipe, args.streaming)
      : buckets.recipe.map((line, i) =>
          rowFromLine(
            line,
            i,
            stream,
            args.streaming && i === buckets.recipe.length - 1
          )
        );
    pushBand("recipe", "recipe", "画应用", "配方", rows);
  }
  pushBand(
    "gate-out",
    "gate",
    "闭环",
    "闸",
    buckets.closure.map((line, i) =>
      rowFromLine(line, i, stream, false)
    )
  );
  return groups;
}
