/**
 * 对话气泡：精修轮不许套首轮「含 2 角色、3 页面」。
 *
 * 2026-08-18 篮球馆：四轮 iterate 都是空 steps + 空 assistant，
 * assistantTextForTurn 却把 publishClosure.chatSummary 复读一遍。
 * 判据看页，不看产物个数。删掉 follow-up 那道闸，下面必红。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assistantTextForTurn,
  REFINE_TURN_NO_PAGE_NOTE,
} from "../assistant-text-for-turn";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import type { UiTurn } from "../types";

const GOAL = "社区篮球馆半场预约与会员积分";
const FIRST_SUMMARY = "预留半场、记录到场。含 2 角色、3 页面。";

const closure = (
  over: Partial<PublishClosureSummary> = {}
): PublishClosureSummary => ({
  blocked: false,
  blockerCount: 0,
  evidencePresentCount: 6,
  skillCount: 6,
  versionPinsChecked: true,
  chatSummary: FIRST_SUMMARY,
  tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
  topBlockers: [],
  ...over,
});

const turn = (over: Partial<UiTurn> = {}): UiTurn => ({
  id: "t2",
  user: "预约台超时未到的场次给红标",
  status: "complete",
  steps: [],
  routeFacts: { turnId: "t2" },
  routeExpanded: false,
  routeLitCount: 0,
  assistant: "",
  assistantSource: "fallback",
  main: null,
  actions: [],
  ...over,
});

describe("assistantTextForTurn", () => {
  it("首轮可以用 chatSummary（含 2 角色、3 页面）", () => {
    const text = assistantTextForTurn(
      turn({ user: GOAL }),
      closure(),
      GOAL
    );
    expect(text).toBe(FIRST_SUMMARY);
  });

  it("精修空轮不许套首轮 chatSummary", () => {
    const text = assistantTextForTurn(turn(), closure(), GOAL);
    expect(text).not.toContain("含 2 角色");
    expect(text).not.toContain("3 页面");
    expect(text).not.toBe(FIRST_SUMMARY);
    expect(text).toBe(REFINE_TURN_NO_PAGE_NOTE);
  });

  it("精修失败优先用 refinePaintNote", () => {
    const text = assistantTextForTurn(
      turn(),
      closure({ refinePaintNote: "这一处没画上：结构闸说臆造字段" }),
      GOAL
    );
    expect(text).toBe("这一处没画上：结构闸说臆造字段");
    expect(text).not.toContain("含 2 角色");
  });

  it("反向：skillCount 缺省不许冒充 6", () => {
    const src = readFileSync(
      new URL("../assistant-text-for-turn.ts", import.meta.url),
      "utf8"
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toContain("skillCount ?? 0");
    expect(src).not.toContain("skillCount ?? 6");
  });

  it("本轮有叙述就用叙述，不套总结", () => {
    const text = assistantTextForTurn(
      turn({
        steps: [
          {
            id: "n1",
            kind: "narration",
            text: "预约台已经加上超时红标。",
            source: "llm",
            isFinal: true,
          },
        ],
      }),
      closure(),
      GOAL
    );
    expect(text).toBe("预约台已经加上超时红标。");
  });

  it("本轮有 assistant 就用 assistant", () => {
    const text = assistantTextForTurn(
      turn({ assistant: "红标已经画上。" }),
      closure(),
      GOAL
    );
    expect(text).toBe("红标已经画上。");
  });

  it("SlideRule 用抽出来的那份，页内不再写一份", () => {
    const src = readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8");
    expect(src).toContain('from "./sliderule/assistant-text-for-turn"');
    expect(src).not.toMatch(/function assistantTextForTurn/);
  });
});
