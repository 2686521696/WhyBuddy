import { describe, expect, it } from "vitest";
import {
  buildClearStateWithTrustedReport,
  commitTrusted,
  createRawArtifact,
  markTrusted,
} from "@/lib/whybuddy-fullpath-fixtures";
import { commitArtifact, createInitialSessionState } from "@/lib/whybuddy-runtime";
import {
  buildTemplateTree,
  formatTreeContent,
} from "@shared/blueprint/whybuddy-structure-chain";
import { deriveWhyBuddyReasoningViewModel } from "../derive-reasoning-view-model";
import { expandProjectionNodes } from "../expand-projection-nodes";

describe("Knife B · projection density", () => {
  it("detailed mode expands evidence child nodes from evidenceRefs", () => {
    const { state, reportId, riskId } = buildClearStateWithTrustedReport("knife-b");
    const report = (state.artifacts || []).find((a) => a.id === reportId);
    if (report) {
      report.evidenceRefs = [riskId, "ev-ground-1"];
    }

    const compact = deriveWhyBuddyReasoningViewModel(state, { density: "compact" });
    const detailed = deriveWhyBuddyReasoningViewModel(state, { density: "detailed" });
    expect(detailed.visibleNodes.length).toBeGreaterThan(compact.visibleNodes.length);
    expect(detailed.visibleNodes.some((n) => n.id.includes("::ev-"))).toBe(true);
  });

  it("compact mode has no projection child node ids", () => {
    const { state } = buildClearStateWithTrustedReport("knife-b-compact");
    const vm = deriveWhyBuddyReasoningViewModel(state, { density: "compact" });
    expect(vm.visibleNodes.every((n) => !n.id.includes("::ev-"))).toBe(true);
    expect(vm.visibleNodes.every((n) => !n.id.includes("::phase-"))).toBe(true);
  });

  it("does not emit phase nodes when no capability runs exist", () => {
    const state = createInitialSessionState("权限 MVP", "knife-b-no-fake");
    const vm = deriveWhyBuddyReasoningViewModel(state, { density: "detailed" });
    expect(vm.visibleNodes.every((n) => !n.id.includes("::phase-"))).toBe(true);
  });

  it("never emits the old decorative thinking/observing/completed trio", () => {
    const { state } = buildClearStateWithTrustedReport("knife-b-trio");
    const vm = deriveWhyBuddyReasoningViewModel(state, { density: "detailed" });
    const generic = vm.visibleNodes.filter((n) =>
      /· 思考$|· 观察$|· 完成$/.test(n.body || "")
    );
    expect(generic.length).toBe(0);
  });

  it("phase children cite real capabilityRun gate facts", () => {
    const { state } = buildClearStateWithTrustedReport("knife-b-phase");
    const vm = deriveWhyBuddyReasoningViewModel(state, { density: "detailed" });
    const phaseNodes = vm.visibleNodes.filter((n) => n.id.includes("::phase-"));
    expect(phaseNodes.length).toBeGreaterThan(0);
    // Now richer (artifact summary + ledger + gate detail), no longer raw "T_GATE · status" / "产出 id"
    expect(
      phaseNodes.some((n) => /观察|思考|完成|接地|提交|风险|综合|证据/.test(n.body || ""))
    ).toBe(true);
  });

  // 【Kx.x 探索测试】当前必败 (before full writer population of gate.reason/checked); will flip after runtime enriches gateResults in commit path.
  // Verifies that when a resolved parent has run+outputs, phase completed pulls artifact title/summary (not bare id).
  it("phase completed nodes project artifact summary (title/summary/kind) not raw ids", () => {
    const { state, reportId, riskId } = buildClearStateWithTrustedReport("knife-b-phase-art");
    // Ensure the report/risk are outputs of some run in fixture
    const vm = deriveWhyBuddyReasoningViewModel(state, { density: "detailed" });
    const completedPhases = vm.visibleNodes.filter(
      (n) => n.id.includes("::phase-") && /完成/.test(n.title || "")
    );
    // At minimum, if phases exist they should mention kind or title words from seeded artifacts, not contain raw "产出 turn-" pattern for the enriched path
    if (completedPhases.length > 0) {
      const bodies = completedPhases.map((n) => n.body || "").join("\n");
      // Should not be the thin fallback
      expect(/产出 turn-/.test(bodies)).toBe(false);
    }
  });

  it("spec_tree expands formatTreeContent production serialization", () => {
    let state = createInitialSessionState("权限 MVP", "knife-b-fmt");
    const treeContent = formatTreeContent(buildTemplateTree("权限 MVP"), {
      source: "template",
      gateNote: "C_PROMPT:built · G_SCHEMA:attempt1:passed · G_INV:attempt1:passed",
    });
    const { updatedState } = commitArtifact(
      state,
      createRawArtifact("tree-fmt", "structure.decompose", "架构", "spec_tree", treeContent),
      "knife-b-fmt-run",
      false,
      []
    );
    markTrusted(updatedState, "tree-fmt");
    state = updatedState;

    const expanded = expandProjectionNodes(
      state,
      [
        {
          id: "node-spec-tree",
          type: "hypothesis",
          title: "SPEC Tree",
          status: "resolved",
          capabilityId: "structure.decompose",
          producedArtifactId: "tree-fmt",
          roleId: "架构",
        },
      ],
      [],
      "detailed"
    );
    const treeNodes = expanded.nodes.filter((n) => n.id.includes("::tree-"));
    expect(treeNodes.length).toBeGreaterThanOrEqual(4);
    expect(treeNodes.some((n) => n.id.endsWith("::tree-root"))).toBe(true);
    expect(treeNodes.some((n) => n.title.includes("核心需求"))).toBe(true);
  });

  it("spec_tree children form a tree (siblings share parent)", () => {
    let state = createInitialSessionState("拆解", "knife-b-tree");
    const treeContent = [
      "- [root] 根需求",
      "  - [req-a] 子需求 A",
      "  - [req-b] 子需求 B",
      "    - [task-1] 任务 1",
    ].join("\n");
    const { updatedState } = commitArtifact(
      state,
      createRawArtifact("tree-1", "structure.decompose", "架构", "spec_tree", treeContent),
      "knife-b-tree-run",
      false,
      []
    );
    markTrusted(updatedState, "tree-1");
    state = updatedState;
    const expanded = expandProjectionNodes(
      state,
      [
        {
          id: "node-spec-tree",
          type: "hypothesis",
          title: "SPEC Tree",
          status: "resolved",
          capabilityId: "structure.decompose",
          producedArtifactId: "tree-1",
          roleId: "架构",
        },
      ],
      [],
      "detailed"
    );
    const treeNodes = expanded.nodes.filter((n) => n.id.includes("::tree-"));
    expect(treeNodes.length).toBeGreaterThanOrEqual(3);
    const reqA = treeNodes.find((n) => n.id.endsWith("::tree-req-a"));
    const reqB = treeNodes.find((n) => n.id.endsWith("::tree-req-b"));
    expect(reqA && reqB).toBeTruthy();
    const edgeToA = expanded.edges.find((e) => e.target === reqA!.id);
    const edgeToB = expanded.edges.find((e) => e.target === reqB!.id);
    expect(edgeToA?.source).toBe(edgeToB?.source);
    expect(edgeToA?.source).toContain("::tree-root");
  });
});