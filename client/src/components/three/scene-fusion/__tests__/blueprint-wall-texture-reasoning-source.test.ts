import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const textureSource = () =>
  readFileSync(resolve(here, "../BlueprintWallTexture.tsx"), "utf8");
const sceneSource = () =>
  readFileSync(resolve(here, "../../../Scene3D.tsx"), "utf8");

describe("BlueprintWallTexture Stage 2 reasoning graph wiring", () => {
  it("uses the reasoning graph deriver for spec_tree/spec_docs wall rendering", () => {
    const source = textureSource();

    expect(source).toContain("deriveBlueprintWallReasoningGraph");
    expect(source).toContain("isStageTwoJob(job)");
    expect(source).toContain("reasoningGraphToGraphData(reasoningViewModel)");
    expect(source).toContain('job?.stage === "spec_tree" || job?.stage === "spec_docs"');
  });

  it("renders semantic edge labels, reasoning telemetry, and the thinking console", () => {
    const source = textureSource();

    expect(source).toContain("edge.label");
    expect(source).toContain("edgeColor(edge)");
    expect(source).toContain("telemetryText(layout.telemetry)");
    expect(source).toContain("Thinking Console");
    expect(source).toContain("node.roleLabel");
  });

  it("threads structured reasoning graphs from Scene3D props into the wall texture", () => {
    const source = sceneSource();

    expect(source).toContain("blueprintReasoningGraphs?: BrainstormReasoningGraph[]");
    expect(source).toContain("structuredReasoningGraphs={blueprintReasoningGraphs}");
  });

  it("keeps routeSet fallback nodes out of the brainstorm-only layout path", () => {
    const source = textureSource();

    expect(source).toContain("function buildRouteSetGraphData");
    expect(source).toContain("function shouldRenderRouteSetWall");
    expect(source).toContain('stage === "route_generation" || stage === "route_selection"');
    expect(source).toContain("if (routeSet && shouldRenderRouteSetWall(job))");
    expect(source).toContain("return buildRouteSetGraphData(routeSet, job, locale, specTree)");
    expect(source).not.toContain("if (routeSet) {\n      return buildRouteSetGraphData");
    expect(source).toContain("function computeRouteSetLayout");
    expect(source).toContain('node.data?.type === "route_root"');
    expect(source).toContain('type: "route_spec"');
    expect(source).toContain('type: "spec_node"');
    expect(source).toContain('type: "capability"');
    expect(source).not.toContain('const capabilityNodeId = `${routeNodeId}-cap-${capability.id}`;\r\n      nodes.push({\r\n        id: capabilityNodeId,\r\n        data: {\r\n          title: capability.label,\r\n          type: "brainstorm"');
  });
});
