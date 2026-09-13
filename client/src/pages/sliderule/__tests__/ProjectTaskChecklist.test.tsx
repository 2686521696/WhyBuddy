import { describe, expect, it } from "vitest";
import { deriveProjectTaskChecklist } from "../ProjectTaskChecklist";
import type { UiTurn } from "../types";

function turn(
  steps: Array<{
    id: string;
    capabilityId: string;
    progressType?: "acting" | "completed" | "failed";
  }>,
  status: UiTurn["status"] = "complete"
): UiTurn {
  return {
    id: "turn-1",
    user: "build a project",
    status,
    steps: steps.map(step => ({
      ...step,
      capabilityId: step.capabilityId as any,
      kind: "chip" as const,
      roleId: "system",
      label: step.capabilityId,
      realLlm: false,
    })),
    routeFacts: {} as UiTurn["routeFacts"],
    routeExpanded: false,
    routeLitCount: 0,
    assistant: "",
    assistantSource: "fallback",
    main: null,
    actions: [],
  };
}

describe("ProjectTaskChecklist", () => {
  it("does not invent a checklist before a project tool event exists", () => {
    expect(deriveProjectTaskChecklist([turn([])])).toEqual([]);
  });

  it("projects observed project tools and leaves future work pending", () => {
    const items = deriveProjectTaskChecklist(
      [
        turn([
          {
            id: "a",
            capabilityId: "project_create",
            progressType: "completed",
          },
          { id: "b", capabilityId: "project_patch", progressType: "acting" },
        ]),
      ],
      true
    );
    expect(items.find(item => item.id === "project_create")?.status).toBe(
      "done"
    );
    expect(items.find(item => item.id === "project_patch")?.status).toBe(
      "running"
    );
    expect(items.find(item => item.id === "project_verify")?.status).toBe(
      "pending"
    );
    expect(items.find(item => item.id === "project_delivery")?.status).toBe(
      "pending"
    );
  });

  it("keeps a failed operation visible and never marks delivery done", () => {
    const items = deriveProjectTaskChecklist([
      turn([
        { id: "a", capabilityId: "project_verify", progressType: "failed" },
      ]),
    ]);
    expect(items.find(item => item.id === "project_verify")?.status).toBe(
      "failed"
    );
    expect(items.find(item => item.id === "project_delivery")?.status).toBe(
      "failed"
    );
  });
});
