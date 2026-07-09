import { describe, it, expect } from "vitest";
import { deriveTurnPhases, latestDraftDefinition } from "../derive-turn-phases";

const STEPS = [
  "指令已接收 · 启动推理",
  "第 1 轮 · ⚡ 正在全网检索外部证据",
  "第 1 轮 · 正在澄清需求",
  "第 2 轮 · 正在综合各方结论",
  "🖋 LLM 正在起草五系统模型（实时输出见下方）...",
  "⚙ 数据模型 系统画面生成中...",
  "✓ 数据模型 证据落地 · LLM 生成",
  "✗ 页面 证据缺失（fail-closed）",
];

describe("deriveTurnPhases (V5.2 闭环阶段叙事)", () => {
  it("按前缀协议把步骤分进 意图/轮次/起草/证据 阶段，顺序保持", () => {
    const phases = deriveTurnPhases({ stepTexts: STEPS, streaming: true });
    expect(phases.map(p => p.id)).toEqual([
      "intake",
      "round-1",
      "round-2",
      "draft",
      "evidence",
    ]);
    expect(phases[1].title).toBe("第 1 轮推演");
    expect(phases[1].lines).toHaveLength(2);
    expect(phases[4].lines).toContain("✗ 页面 证据缺失（fail-closed）");
  });

  it("流式时最后一个阶段 running，其余 done；完成后全部 done", () => {
    const running = deriveTurnPhases({ stepTexts: STEPS, streaming: true });
    expect(running.at(-1)!.status).toBe("running");
    expect(running.slice(0, -1).every(p => p.status === "done")).toBe(true);
    const done = deriveTurnPhases({ stepTexts: STEPS, streaming: false });
    expect(done.every(p => p.status === "done")).toBe(true);
  });

  it("起草阶段附语义副标题（最新 name 定义 + 字符数）", () => {
    const draft =
      '{"entities":[{"id":"a","name":"档案状态"},{"id":"b","name":"传承人"}';
    const phases = deriveTurnPhases({
      stepTexts: STEPS,
      streaming: true,
      llmDraft: draft,
    });
    const draftPhase = phases.find(p => p.id === "draft")!;
    expect(draftPhase.lines.at(-1)).toContain("最新定义：传承人");
    expect(draftPhase.lines.at(-1)).toContain(`${draft.length} 字符`);
  });

  it("完成后合成「发布闭环」终局阶段（closed 与 blocked 都如实）", () => {
    const closed = deriveTurnPhases({
      stepTexts: STEPS,
      streaming: false,
      closure: { blocked: false, evidencePresentCount: 6, skillCount: 6 },
    });
    expect(closed.at(-1)!.id).toBe("closure");
    expect(closed.at(-1)!.lines[0]).toContain("closed 6/6");
    const blocked = deriveTurnPhases({
      stepTexts: STEPS,
      streaming: false,
      closure: { blocked: true, evidencePresentCount: 0, skillCount: 6 },
    });
    expect(blocked.at(-1)!.lines[0]).toContain("blocked 0/6");
    expect(blocked.at(-1)!.lines[0]).toContain("fail-closed");
  });

  it("流式中不合成发布闭环阶段（不预告未发生的收口）", () => {
    const phases = deriveTurnPhases({
      stepTexts: STEPS,
      streaming: true,
      closure: { blocked: false, evidencePresentCount: 6, skillCount: 6 },
    });
    expect(phases.find(p => p.id === "closure")).toBeUndefined();
  });

  it("无法归类的行归入当前阶段；空输入返回空", () => {
    const phases = deriveTurnPhases({
      stepTexts: ["第 1 轮 · 正在分析风险", "驱动执行失败（已降级显示）：boom"],
      streaming: false,
    });
    expect(phases).toHaveLength(1);
    expect(phases[0].lines).toHaveLength(2);
    expect(deriveTurnPhases({ stepTexts: [], streaming: false })).toEqual([]);
  });
});

describe("latestDraftDefinition", () => {
  it("取最后一个 name 定义；无匹配返回 null", () => {
    expect(latestDraftDefinition('{"name": "甲"} {"name": "乙"}')).toBe("乙");
    expect(latestDraftDefinition("{}")).toBeNull();
    expect(latestDraftDefinition("")).toBeNull();
  });
});
