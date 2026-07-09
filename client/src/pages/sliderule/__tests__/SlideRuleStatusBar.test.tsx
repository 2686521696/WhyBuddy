import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { SlideRuleStatusBar } from "../SlideRuleStatusBar";

function state(): V5SessionState {
  return {
    sessionId: "status-bar-closure-test",
    goal: { text: "publish closure badge", status: "clear" },
    artifacts: [],
    capabilityRuns: [],
    coverageGaps: [],
  } as unknown as V5SessionState;
}

function render(closure?: PublishClosureSummary | null): string {
  return renderToStaticMarkup(
    <SlideRuleStatusBar
      state={state()}
      turnCount={1}
      isRunning={false}
      executorMode="server-llm"
      publishClosure={closure}
    />
  );
}

describe("SlideRuleStatusBar publish closure badge", () => {
  it("renders publish closed with evidence details", () => {
    const html = render({
      blocked: false,
      blockerCount: 0,
      evidencePresentCount: 6,
      skillCount: 6,
      versionPinsChecked: true,
      tierCounts: { hard_blocker: 0, warning: 1, info: 2 },
      topBlockers: [],
    });

    expect(html).toContain('data-testid="sliderule-publish-closure-badge"');
    expect(html).toContain("publish closed");
    expect(html).toContain('data-fail-closed="false"');
    expect(html).toContain(
      'title="6/6 evidence - pins checked - hard 0 - warn 1 - info 2"'
    );
  });

  it("renders publish blocked with blocker evidence as non-fail-closed", () => {
    const html = render({
      blocked: true,
      blockerCount: 1,
      evidencePresentCount: 4,
      skillCount: 6,
      versionPinsChecked: false,
      tierCounts: { hard_blocker: 2, warning: 1, info: 0 },
      topBlockers: [
        { code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED", path: "page" },
      ],
    });

    expect(html).toContain("publish blocked");
    expect(html).toContain('data-fail-closed="false"');
    expect(html).toContain("hard 2");
  });

  it("marks blocked closure without blocker details as fail-closed", () => {
    const html = render({
      blocked: true,
      blockerCount: 1,
      evidencePresentCount: 0,
      skillCount: 6,
      versionPinsChecked: false,
      tierCounts: { hard_blocker: 1, warning: 0, info: 0 },
      topBlockers: [],
    });

    expect(html).toContain("publish blocked");
    expect(html).toContain('data-fail-closed="true"');
  });

  it("omits publish closure badge when closure summary is absent", () => {
    expect(render(null)).not.toContain(
      'data-testid="sliderule-publish-closure-badge"'
    );
    expect(render(undefined)).not.toContain(
      'data-testid="sliderule-publish-closure-badge"'
    );
  });
});
