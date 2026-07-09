/**
 * Autopilot 驾驶舱右栏子阶段面板 — Shim identity 测试（Spec 2 P2）
 *
 * 对应 spec：`.kiro/specs/autopilot-right-rail-stage-panels/`
 * - 对应 design.md 的「正确性性质（PBT 候选）」P2 段（Shim identity）
 * - 对应 tasks.md 任务 10（shim identity 部分）
 *
 * 本文件断言 `@/pages/specs/panels/<Name>Panel.tsx` re-export 的组件**引用相等**
 * (`===`) 于 `@/pages/autopilot/right-rail/panels/<Name>Panel.tsx` 原始导出。
 *
 * 目的：阻止未来有人在 shim 里「顺手包一层」（例如 wrapper / memo）导致
 * identity 漂移。
 *
 * 覆盖 8 个面板 + `EngineeringLandingPanel` 历史别名 + barrel 一致性：
 *
 * | # | Shim 文件                                   | Canonical 文件                                               |
 * | - | ------------------------------------------- | ------------------------------------------------------------ |
 * | 1 | specs/panels/AgentCrewFabricPanel           | autopilot/right-rail/panels/AgentCrewFabricPanel             |
 * | 2 | specs/panels/SpecTreePanel                  | autopilot/right-rail/panels/SpecTreePanel                    |
 * | 3 | specs/panels/SpecDocumentsPanel             | autopilot/right-rail/panels/SpecDocumentsPanel               |
 * | 4 | specs/panels/EffectPreviewPanel             | autopilot/right-rail/panels/EffectPreviewPanel               |
 * | 5 | specs/panels/PromptPackagePanel             | autopilot/right-rail/panels/PromptPackagePanel               |
 * | 6 | specs/panels/RuntimeCapabilityPanel         | autopilot/right-rail/panels/RuntimeCapabilityPanel           |
 * | 7 | specs/panels/EngineeringLandingPanel        | autopilot/right-rail/panels/EngineeringHandoffPanel          |
 * | 8 | specs/panels/ArtifactMemoryPanel            | autopilot/right-rail/panels/ArtifactMemoryPanel              |
 */

import { describe, expect, it } from "vitest";

import * as agentCrewShim from "@/pages/specs/panels/AgentCrewFabricPanel";
import * as agentCrewCanonical from "@/pages/autopilot/right-rail/panels/AgentCrewFabricPanel";

import * as specTreeShim from "@/pages/specs/panels/SpecTreePanel";
import * as specTreeCanonical from "@/pages/autopilot/right-rail/panels/SpecTreePanel";

import * as specDocumentsShim from "@/pages/specs/panels/SpecDocumentsPanel";
import * as specDocumentsCanonical from "@/pages/autopilot/right-rail/panels/SpecDocumentsPanel";

import * as effectPreviewShim from "@/pages/specs/panels/EffectPreviewPanel";
import * as effectPreviewCanonical from "@/pages/autopilot/right-rail/panels/EffectPreviewPanel";

import * as promptPackageShim from "@/pages/specs/panels/PromptPackagePanel";
import * as promptPackageCanonical from "@/pages/autopilot/right-rail/panels/PromptPackagePanel";

import * as runtimeCapabilityShim from "@/pages/specs/panels/RuntimeCapabilityPanel";
import * as runtimeCapabilityCanonical from "@/pages/autopilot/right-rail/panels/RuntimeCapabilityPanel";

import * as engineeringLandingShim from "@/pages/specs/panels/EngineeringLandingPanel";
import * as engineeringHandoffCanonical from "@/pages/autopilot/right-rail/panels/EngineeringHandoffPanel";

import * as artifactMemoryShim from "@/pages/specs/panels/ArtifactMemoryPanel";
import * as artifactMemoryCanonical from "@/pages/autopilot/right-rail/panels/ArtifactMemoryPanel";

import * as specsPanelsBarrel from "@/pages/specs/panels";
import * as autopilotPanelsBarrel from "@/pages/autopilot/right-rail/panels";

describe("canonical panel shim identity (Spec 2)", () => {
  it("AgentCrewFabricPanel shim === canonical", () => {
    expect(agentCrewShim.AgentCrewFabricPanel).toBe(
      agentCrewCanonical.AgentCrewFabricPanel,
    );
  });

  it("SpecTreePanel shim === canonical", () => {
    expect(specTreeShim.SpecTreePanel).toBe(specTreeCanonical.SpecTreePanel);
  });

  it("SpecDocumentsPanel shim === canonical", () => {
    expect(specDocumentsShim.SpecDocumentsPanel).toBe(
      specDocumentsCanonical.SpecDocumentsPanel,
    );
  });

  it("EffectPreviewPanel shim === canonical", () => {
    expect(effectPreviewShim.EffectPreviewPanel).toBe(
      effectPreviewCanonical.EffectPreviewPanel,
    );
  });

  it("PromptPackagePanel shim === canonical", () => {
    expect(promptPackageShim.PromptPackagePanel).toBe(
      promptPackageCanonical.PromptPackagePanel,
    );
  });

  it("RuntimeCapabilityPanel shim === canonical", () => {
    expect(runtimeCapabilityShim.RuntimeCapabilityPanel).toBe(
      runtimeCapabilityCanonical.RuntimeCapabilityPanel,
    );
  });

  it("EngineeringHandoffPanel shim === canonical", () => {
    expect(engineeringLandingShim.EngineeringHandoffPanel).toBe(
      engineeringHandoffCanonical.EngineeringHandoffPanel,
    );
  });

  it("EngineeringLandingPanel alias === EngineeringHandoffPanel canonical", () => {
    // EngineeringLandingPanel 是历史别名，必须指向 canonical EngineeringHandoffPanel
    // （design.md 决策记录 §3；tasks.md 任务 7 shim 要求同名/别名双导出）
    expect(engineeringLandingShim.EngineeringLandingPanel).toBe(
      engineeringHandoffCanonical.EngineeringHandoffPanel,
    );
  });

  it("ArtifactMemoryPanel shim === canonical", () => {
    expect(artifactMemoryShim.ArtifactMemoryPanel).toBe(
      artifactMemoryCanonical.ArtifactMemoryPanel,
    );
  });
});

describe("canonical panels barrel identity (Spec 2)", () => {
  it("specs barrel exports the same components as the canonical barrel", () => {
    expect(specsPanelsBarrel.AgentCrewFabricPanel).toBe(
      autopilotPanelsBarrel.AgentCrewFabricPanel,
    );
    expect(specsPanelsBarrel.SpecTreePanel).toBe(
      autopilotPanelsBarrel.SpecTreePanel,
    );
    expect(specsPanelsBarrel.SpecDocumentsPanel).toBe(
      autopilotPanelsBarrel.SpecDocumentsPanel,
    );
    expect(specsPanelsBarrel.EffectPreviewPanel).toBe(
      autopilotPanelsBarrel.EffectPreviewPanel,
    );
    expect(specsPanelsBarrel.PromptPackagePanel).toBe(
      autopilotPanelsBarrel.PromptPackagePanel,
    );
    expect(specsPanelsBarrel.RuntimeCapabilityPanel).toBe(
      autopilotPanelsBarrel.RuntimeCapabilityPanel,
    );
    expect(specsPanelsBarrel.EngineeringHandoffPanel).toBe(
      autopilotPanelsBarrel.EngineeringHandoffPanel,
    );
    expect(specsPanelsBarrel.ArtifactMemoryPanel).toBe(
      autopilotPanelsBarrel.ArtifactMemoryPanel,
    );
  });
});
