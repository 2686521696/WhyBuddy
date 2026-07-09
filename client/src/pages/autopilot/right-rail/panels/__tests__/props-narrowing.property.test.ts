/**
 * Autopilot 驾驶舱右栏子阶段面板 — Props slice narrowing 属性测试（Spec 2 PBT）
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 对应 design.md 的「正确性性质（PBT 候选）」P1 段与「面板抽离总表」8 行
 * - 对应 tasks.md 任务 9
 *
 * 本文件定义了一个**测试内部**的纯函数 `narrowPropsFor(panelKey, fullProps)`，该函数**不导出
 * 到 `panels/index.ts` barrel**（design.md P1 明确约束）。它的语义是：把完整的
 * `AutopilotRightRailProps` 按 design.md「面板抽离总表」中对应行列出的字段子集窄化。
 *
 * 8 条面板窄化字段集：
 *
 * | # | Panel                    | 窄化字段                                                                                       |
 * | - | ------------------------ | ---------------------------------------------------------------------------------------------- |
 * | 1 | AgentCrewFabricPanel     | jobId, job, agentCrew, capabilities, capabilityInvocations, capabilityEvidence, locale         |
 * | 2 | SpecTreePanel            | jobId, specTree, selection, locale                                                             |
 * | 3 | SpecDocumentsPanel       | jobId, specTree, locale                                                                        |
 * | 4 | EffectPreviewPanel       | jobId, job, specTree, effectPreviews, agentCrew, capabilityEvidence, locale                    |
 * | 5 | PromptPackagePanel       | jobId, specTree, effectPreviews, locale                                                        |
 * | 6 | RuntimeCapabilityPanel   | jobId, specTree, capabilities, capabilityInvocations, capabilityEvidence, agentCrew, locale    |
 * | 7 | EngineeringHandoffPanel  | jobId, locale                                                                                  |
 * | 8 | ArtifactMemoryPanel      | jobId, locale                                                                                  |
 *
 * 每个 panel 配对 4 条 property（共 8 × 4 = 32 条测试）：
 * - P1 keys 严格等于声明的 slice 字段集
 * - P2 每个字段值与 fullProps 对应字段引用相等（`===`）
 * - P3 原值为 `null` 的字段在 narrow 结果中仍为 `null`（不降级为 `undefined`）
 * - P4 不含额外字段（`onSubStageChange / currentStage / currentSubStage / routeSet` 等均不在 slice）
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { AutopilotRightRailProps } from "@/pages/autopilot/right-rail/types";

// ---------------------------------------------------------------------------
// 测试内部 narrow 函数与字段表（不出 barrel）
// ---------------------------------------------------------------------------

type PanelKey =
  | "AgentCrewFabricPanel"
  | "SpecTreePanel"
  | "SpecDocumentsPanel"
  | "EffectPreviewPanel"
  | "PromptPackagePanel"
  | "RuntimeCapabilityPanel"
  | "EngineeringHandoffPanel"
  | "ArtifactMemoryPanel";

/**
 * design.md「面板抽离总表」8 行的权威来源。PBT 以此常量为 expected 集合断言 narrow 结果。
 */
const PANEL_FIELDS: Record<PanelKey, ReadonlyArray<keyof AutopilotRightRailProps>> = {
  AgentCrewFabricPanel: [
    "jobId",
    "job",
    "agentCrew",
    "capabilities",
    "capabilityInvocations",
    "capabilityEvidence",
    "locale",
  ],
  SpecTreePanel: ["jobId", "specTree", "selection", "locale"],
  SpecDocumentsPanel: ["jobId", "specTree", "locale"],
  EffectPreviewPanel: [
    "jobId",
    "job",
    "specTree",
    "effectPreviews",
    "agentCrew",
    "capabilityEvidence",
    "locale",
  ],
  PromptPackagePanel: ["jobId", "specTree", "effectPreviews", "locale"],
  RuntimeCapabilityPanel: [
    "jobId",
    "specTree",
    "capabilities",
    "capabilityInvocations",
    "capabilityEvidence",
    "agentCrew",
    "locale",
  ],
  EngineeringHandoffPanel: ["jobId", "locale"],
  ArtifactMemoryPanel: ["jobId", "locale"],
};

const PANEL_KEYS: PanelKey[] = [
  "AgentCrewFabricPanel",
  "SpecTreePanel",
  "SpecDocumentsPanel",
  "EffectPreviewPanel",
  "PromptPackagePanel",
  "RuntimeCapabilityPanel",
  "EngineeringHandoffPanel",
  "ArtifactMemoryPanel",
];

/**
 * 纯函数 narrow：仅从 `fullProps` 中摘出 `PANEL_FIELDS[panelKey]` 列出的字段，保持原值引用。
 *
 * 约束（与 design.md P1 对齐）：
 * - 结果 keys 严格等于 `PANEL_FIELDS[panelKey]`
 * - 每个字段值引用相等于源对象（不做 spread / clone）
 * - 不做 `null -> undefined` 降级
 */
function narrowPropsFor<K extends PanelKey>(
  panelKey: K,
  fullProps: AutopilotRightRailProps,
): Record<string, unknown> {
  const fields = PANEL_FIELDS[panelKey];
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field] = fullProps[field];
  }
  return result;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * 生成最小可用的 `AutopilotRightRailProps`。
 *
 * `Blueprint*` 业务对象（job / routeSet / selection / specTree / agentCrew / capabilities 等）
 * 是结构化类型，完整构造需要深层 mock；但本 PBT 只关心「字段选择」行为，不触达业务语义，
 * 因此使用 `{ id: string }` 级别的最小对象 + 单次 `as unknown as AutopilotRightRailProps`
 * 宽化 cast（与 `resolve-rail-sub-stage.property.test.ts` 中的 `BlueprintGenerationJob`
 * double cast 模式一致）。
 */
const arbProps: fc.Arbitrary<AutopilotRightRailProps> = fc
  .record({
    jobId: fc.string(),
    currentStage: fc.constantFrom(
      "input",
      "clarification",
      "routeset",
      "selection",
      "fabric",
    ),
    currentSubStage: fc.option(
      fc.constantFrom(
        "agent_crew_fabric",
        "spec_tree",
        "effect_preview",
        "prompt_package",
        "runtime_capability",
        "engineering_handoff",
        "artifact_memory",
      ),
      { nil: undefined },
    ),
    job: fc.oneof(fc.constant(null), fc.record({ id: fc.string() })),
    routeSet: fc.oneof(fc.constant(null), fc.record({ id: fc.string() })),
    selection: fc.oneof(fc.constant(null), fc.record({ id: fc.string() })),
    specTree: fc.oneof(fc.constant(null), fc.record({ id: fc.string() })),
    agentCrew: fc.oneof(fc.constant(null), fc.record({ id: fc.string() })),
    capabilities: fc.array(fc.record({ id: fc.string() }), { maxLength: 3 }),
    capabilityInvocations: fc.array(fc.record({ id: fc.string() }), { maxLength: 3 }),
    capabilityEvidence: fc.array(fc.record({ id: fc.string() }), { maxLength: 3 }),
    effectPreviews: fc.array(fc.record({ id: fc.string() }), { maxLength: 3 }),
    locale: fc.constantFrom("zh-CN", "en-US"),
    onSubStageChange: fc.constant(() => {}),
  })
  .map((value) => value as unknown as AutopilotRightRailProps);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("panels props narrowing (Spec 2 PBT)", () => {
  for (const panelKey of PANEL_KEYS) {
    describe(panelKey, () => {
      // -------------------------------------------------------------------
      // P1 — keys strictly equal to the declared slice
      // **Validates: Requirements 2.1–2.8、Requirement 8**
      // -------------------------------------------------------------------
      it("P1 - keys strictly equal to the declared slice", () => {
        fc.assert(
          fc.property(arbProps, (fullProps) => {
            const narrowed = narrowPropsFor(panelKey, fullProps);
            const keys = Object.keys(narrowed).sort();
            const expected = [...PANEL_FIELDS[panelKey]].sort();
            expect(keys).toEqual(expected);
          }),
          { numRuns: 200 },
        );
      });

      // -------------------------------------------------------------------
      // P2 — each field value is referentially equal to source
      // **Validates: Requirements 2.1–2.8、Requirement 8**
      // -------------------------------------------------------------------
      it("P2 - each field value is referentially equal to source (===)", () => {
        fc.assert(
          fc.property(arbProps, (fullProps) => {
            const narrowed = narrowPropsFor(panelKey, fullProps);
            for (const field of PANEL_FIELDS[panelKey]) {
              expect(narrowed[field]).toBe(fullProps[field]);
            }
          }),
          { numRuns: 100 },
        );
      });

      // -------------------------------------------------------------------
      // P3 — null source fields remain null (not undefined)
      // **Validates: Requirements 2.1–2.8、Requirement 8**
      // -------------------------------------------------------------------
      it("P3 - null source fields remain null (not undefined)", () => {
        fc.assert(
          fc.property(arbProps, (fullProps) => {
            const narrowed = narrowPropsFor(panelKey, fullProps);
            for (const field of PANEL_FIELDS[panelKey]) {
              if (fullProps[field] === null) {
                expect(narrowed[field]).toBeNull();
                expect(narrowed[field]).not.toBeUndefined();
              }
            }
          }),
          { numRuns: 200 },
        );
      });

      // -------------------------------------------------------------------
      // P4 — no extra non-slice fields leak in
      // **Validates: Requirements 2.1–2.8、Requirement 8**
      // -------------------------------------------------------------------
      it("P4 - no extra fields like onSubStageChange or currentStage leak in", () => {
        fc.assert(
          fc.property(arbProps, (fullProps) => {
            const narrowed = narrowPropsFor(panelKey, fullProps);
            // 这 4 个字段在 8 个面板的 slice 中从未出现
            expect("onSubStageChange" in narrowed).toBe(false);
            expect("currentStage" in narrowed).toBe(false);
            expect("currentSubStage" in narrowed).toBe(false);
            expect("routeSet" in narrowed).toBe(false);
          }),
          { numRuns: 100 },
        );
      });
    });
  }
});
