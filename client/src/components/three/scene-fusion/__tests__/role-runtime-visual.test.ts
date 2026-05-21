import { describe, expect, it } from "vitest";

import type { RoleRuntimeState } from "@/lib/blueprint-realtime-store";

import { getRoleRuntimeVisual } from "../role-runtime-visual";

function makeRuntimeState(
  overrides: Partial<RoleRuntimeState> = {}
): RoleRuntimeState {
  return {
    roleId: "planner",
    status: "ready",
    runtimeKind: "real",
    lastUpdated: 1,
    ...overrides,
  };
}

describe("getRoleRuntimeVisual", () => {
  it("returns no badge when runtime evidence is missing", () => {
    expect(getRoleRuntimeVisual(undefined)).toBeNull();
  });

  it("maps real runtime evidence to a working badge", () => {
    expect(getRoleRuntimeVisual(makeRuntimeState())).toMatchObject({
      label: "real",
      statusCategory: "working",
    });
  });

  it("maps fallback runtime evidence to a reviewing badge", () => {
    expect(
      getRoleRuntimeVisual(
        makeRuntimeState({
          runtimeKind: "fallback",
          executionMode: "simulated_fallback",
          containerMode: "lite",
          fallbackReason: "executor unreachable",
        })
      )
    ).toMatchObject({
      label: "fallback",
      statusCategory: "reviewing",
    });
  });

  it("maps failed runtime evidence to a stub/error badge", () => {
    expect(
      getRoleRuntimeVisual(
        makeRuntimeState({
          status: "failed",
          runtimeKind: "stub",
          error: "provision failed",
        })
      )
    ).toMatchObject({
      label: "stub",
      statusCategory: "error",
    });
  });
});
