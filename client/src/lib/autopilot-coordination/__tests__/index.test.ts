import { describe, expect, it } from "vitest";

import * as barrel from "../index.js";

describe("autopilot coordination barrel", () => {
  it("re-exports the coordination layer surface", () => {
    expect(typeof barrel.getAutopilotPageForStage).toBe("function");
    expect(typeof barrel.areStagesOnSamePage).toBe("function");
    expect(typeof barrel.checkThreeLayerConsistency).toBe("function");
    expect(typeof barrel.createToastQueue).toBe("function");
    expect(typeof barrel.runAtomicRefresh).toBe("function");
    expect(typeof barrel.createAutopilotCoordinator).toBe("function");
    expect(typeof barrel.prefersReducedMotion).toBe("function");
    expect(typeof barrel.createStageTransitionAnimator).toBe("function");
    expect(typeof barrel.createPageTransitionChoreographer).toBe("function");
    expect(typeof barrel.getStagePage).toBe("function");
    expect(typeof barrel.isSameAutopilotPage).toBe("function");
  });
});
