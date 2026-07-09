import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { SlideRuleTopHud } from "../SlideRuleTopHud";

vi.mock("@/lib/deploy-target", () => ({
  IS_GITHUB_PAGES: false,
}));

function minimalState(): V5SessionState {
  return {
    sessionId: "top-hud-test",
    goal: { text: "" },
    artifacts: [],
    capabilityRuns: [],
    coverageGaps: [],
  } as unknown as V5SessionState;
}

describe("SlideRuleTopHud", () => {
  it("hides the wordmark when rendered inside AgentLoop", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud
        state={minimalState()}
        goal=""
        turnCount={0}
        isRunning={false}
        embedded
      />
    );

    expect(html).toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain("sliderule_logo_wordmark_transparent.png");
  });

  it("keeps the wordmark for the standalone immersion surface", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud
        state={minimalState()}
        goal=""
        turnCount={0}
        isRunning={false}
      />
    );

    expect(html).toContain("sliderule_logo_wordmark_transparent.png");
  });
});
