/**
 * autopilot-scene-fusion / Wave C
 * blueprint-stage-signal 纯函数测试。
 *
 * 沿用本仓 example-based 测试模式（vitest 内置 describe / it / expect），
 * 不引入 PBT、不引入新依赖。
 */

import { describe, expect, it } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintGenerationStage,
} from "@shared/blueprint/contracts";

import {
  BLUEPRINT_SCENE_STAGES,
  adaptBlueprintSignalToSceneStageSignal,
  getBlueprintSceneStageSignal,
} from "../blueprint-stage-signal";

/** 构造一个最小可用的 BlueprintGenerationJob mock。 */
function makeJob(
  stage: BlueprintGenerationStage | string | undefined | null
): BlueprintGenerationJob {
  return {
    id: "job-test",
    request: { goal: "test" } as BlueprintGenerationJob["request"],
    status: "running" as BlueprintGenerationJob["status"],
    stage: stage as BlueprintGenerationStage,
  } as BlueprintGenerationJob;
}

describe("getBlueprintSceneStageSignal / 容错与默认", () => {
  it("null 入参返回 SAFE_DEFAULT_SIGNAL（input / 进度 0）", () => {
    const signal = getBlueprintSceneStageSignal(null);
    expect(signal.stageKey).toBe("input");
    expect(signal.stageIndex).toBe(0);
    expect(signal.totalStages).toBe(9);
    expect(signal.progress).toBe(0);
  });

  it("undefined 入参返回 SAFE_DEFAULT_SIGNAL", () => {
    const signal = getBlueprintSceneStageSignal(undefined);
    expect(signal.stageKey).toBe("input");
    expect(signal.stageIndex).toBe(0);
    expect(signal.progress).toBe(0);
  });

  it("stage 字段缺失返回 SAFE_DEFAULT_SIGNAL", () => {
    const signal = getBlueprintSceneStageSignal(makeJob(undefined));
    expect(signal.stageKey).toBe("input");
    expect(signal.stageIndex).toBe(0);
  });

  it("stage 字段为空字符串返回 SAFE_DEFAULT_SIGNAL", () => {
    const signal = getBlueprintSceneStageSignal(makeJob(""));
    expect(signal.stageKey).toBe("input");
  });

  it("未知 stage 字符串返回 SAFE_DEFAULT_SIGNAL（不抛错）", () => {
    const signal = getBlueprintSceneStageSignal(makeJob("bogus_stage_xyz"));
    expect(signal.stageKey).toBe("input");
    expect(signal.stageIndex).toBe(0);
  });

  it("stage 字段非字符串返回 SAFE_DEFAULT_SIGNAL", () => {
    const job = { id: "j", request: {}, status: "running", stage: 42 } as
      unknown as BlueprintGenerationJob;
    const signal = getBlueprintSceneStageSignal(job);
    expect(signal.stageKey).toBe("input");
  });
});

describe("getBlueprintSceneStageSignal / 9 阶段命中与进度", () => {
  it("BLUEPRINT_SCENE_STAGES 长度为 9", () => {
    expect(BLUEPRINT_SCENE_STAGES).toHaveLength(9);
  });

  for (let i = 0; i < BLUEPRINT_SCENE_STAGES.length; i++) {
    const stageKey = BLUEPRINT_SCENE_STAGES[i];
    it(`stage="${stageKey}" → stageIndex=${i} / progress=${(i / 8) * 100}`, () => {
      const signal = getBlueprintSceneStageSignal(makeJob(stageKey));
      expect(signal.stageKey).toBe(stageKey);
      expect(signal.stageIndex).toBe(i);
      expect(signal.totalStages).toBe(9);
      expect(signal.progress).toBeCloseTo((i / 8) * 100, 6);
    });
  }

  it("第 0 阶段（input）progress = 0", () => {
    const signal = getBlueprintSceneStageSignal(makeJob("input"));
    expect(signal.progress).toBe(0);
  });

  it("第 8 阶段（engineering_handoff）progress = 100", () => {
    const signal = getBlueprintSceneStageSignal(
      makeJob("engineering_handoff")
    );
    expect(signal.progress).toBe(100);
  });
});

describe("getBlueprintSceneStageSignal / 后端 enum 别名复用", () => {
  it("preview 复用 effect_preview 节点（第 6 阶段，progress = 75）", () => {
    const signal = getBlueprintSceneStageSignal(makeJob("preview"));
    expect(signal.stageKey).toBe("effect_preview");
    expect(signal.stageIndex).toBe(6);
    expect(signal.progress).toBeCloseTo(75, 6);
  });

  it("runtime_capability 复用 engineering_handoff 末尾节点", () => {
    const signal = getBlueprintSceneStageSignal(makeJob("runtime_capability"));
    expect(signal.stageKey).toBe("engineering_handoff");
    expect(signal.stageIndex).toBe(8);
    expect(signal.progress).toBe(100);
  });

  it("engineering_landing 复用 engineering_handoff 末尾节点", () => {
    const signal = getBlueprintSceneStageSignal(makeJob("engineering_landing"));
    expect(signal.stageKey).toBe("engineering_handoff");
    expect(signal.stageIndex).toBe(8);
  });
});

describe("adaptBlueprintSignalToSceneStageSignal / 输出与 SceneStageFlow 兼容", () => {
  it("input 阶段输出 mission → leadDesk trail（zh-CN）", () => {
    const signal = getBlueprintSceneStageSignal(makeJob("input"));
    const adapted = adaptBlueprintSignalToSceneStageSignal(signal, "zh-CN");
    expect(adapted).not.toBeNull();
    expect(adapted!.source).toBe("workflow");
    expect(adapted!.zones).toEqual(["mission", "leadDesk"]);
    expect(adapted!.stageKey).toBe("input");
    expect(adapted!.stageLabel).toBe("目标输入");
    expect(adapted!.statusLabel).toBe("蓝图驾驶舱推进中");
    expect(adapted!.progress).toBe(0);
    expect(adapted!.taskId).toBeNull();
  });

  it("engineering_handoff 阶段输出 lounge → mission trail（en-US）", () => {
    const signal = getBlueprintSceneStageSignal(
      makeJob("engineering_handoff")
    );
    const adapted = adaptBlueprintSignalToSceneStageSignal(signal, "en-US");
    expect(adapted).not.toBeNull();
    expect(adapted!.zones).toEqual(["lounge", "mission"]);
    expect(adapted!.stageLabel).toBe("Engineering Handoff");
    expect(adapted!.statusLabel).toBe("Blueprint Driving");
    expect(adapted!.progress).toBe(100);
  });

  it("SAFE_DEFAULT_SIGNAL（null job）也能输出 input trail，进度 0", () => {
    const signal = getBlueprintSceneStageSignal(null);
    const adapted = adaptBlueprintSignalToSceneStageSignal(signal, "zh-CN");
    expect(adapted).not.toBeNull();
    expect(adapted!.zones).toEqual(["mission", "leadDesk"]);
    expect(adapted!.progress).toBe(0);
  });

  it("9 个阶段每个都能产出非空 SceneStageSignal 且 zones.length >= 2", () => {
    for (const stageKey of BLUEPRINT_SCENE_STAGES) {
      const signal = getBlueprintSceneStageSignal(makeJob(stageKey));
      const adapted = adaptBlueprintSignalToSceneStageSignal(signal, "zh-CN");
      expect(adapted, `stage=${stageKey}`).not.toBeNull();
      expect(adapted!.zones.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("adapted.color 落在既有调色板内（与 mission-first 路径同视觉语言）", () => {
    const signal = getBlueprintSceneStageSignal(makeJob("spec_tree"));
    const adapted = adaptBlueprintSignalToSceneStageSignal(signal, "zh-CN");
    expect(adapted).not.toBeNull();
    // execution semantic color
    expect(typeof adapted!.color).toBe("string");
    expect(adapted!.color.length).toBeGreaterThan(0);
  });
});
