import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AUTOPILOT_LAUNCH_EXAMPLE_CONSISTENCY_MARKER,
  AUTOPILOT_ONBOARDING_LAYER_MARKERS,
  AutopilotLaunchEmptyState,
} from "../AutopilotLaunchEmptyState";

describe("AutopilotLaunchEmptyState", () => {
  it("explains the destination to route to fleet to evidence flow", () => {
    const markup = renderToStaticMarkup(
      <AutopilotLaunchEmptyState locale="en-US" onSelectExample={vi.fn()} />
    );

    expect(markup).toContain('data-testid="autopilot-launch-empty-state"');
    expect(markup).toContain('data-onboarding-state="expanded"');
    expect(markup).toContain("Destination");
    expect(markup).toContain("Route planning");
    expect(markup).toContain("Fleet execution");
    expect(markup).toContain("Takeover / Evidence");
  });

  it("renders a lightweight first-entry cockpit guide with explanation markers", () => {
    const markup = renderToStaticMarkup(
      <AutopilotLaunchEmptyState locale="en-US" onSelectExample={vi.fn()} />
    );

    expect(markup).toContain(
      'data-testid="autopilot-first-entry-cockpit-guide"'
    );
    expect(markup).toContain("First cockpit entry");
    expect(markup).toContain("Start left");
    expect(markup).toContain("Then scan center");
    expect(markup).toContain("Finish right");
    for (const marker of AUTOPILOT_ONBOARDING_LAYER_MARKERS) {
      expect(markup).toContain(`data-explanation-layer="${marker}"`);
    }
  });

  it("keeps launch examples tied to a code-side consistency marker", () => {
    const markup = renderToStaticMarkup(
      <AutopilotLaunchEmptyState locale="en-US" onSelectExample={vi.fn()} />
    );

    expect(markup).toContain(
      `data-example-consistency-marker="${AUTOPILOT_LAUNCH_EXAMPLE_CONSISTENCY_MARKER}"`
    );
  });

  it("declares reduced-motion safe onboarding animation classes", () => {
    const markup = renderToStaticMarkup(
      <AutopilotLaunchEmptyState locale="en-US" onSelectExample={vi.fn()} />
    );

    expect(markup).toContain("motion-safe:animate-in");
    expect(markup).toContain("motion-reduce:animate-none");
    expect(markup).toContain("motion-reduce:transition-none");
  });

  it("renders the six safe launch example chips", () => {
    const markup = renderToStaticMarkup(
      <AutopilotLaunchEmptyState locale="en-US" onSelectExample={vi.fn()} />
    );

    expect(markup).toContain('data-testid="autopilot-launch-example-analysis"');
    expect(markup).toContain(
      'data-testid="autopilot-launch-example-generation"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-launch-example-implementation"'
    );
    expect(markup).toContain('data-testid="autopilot-launch-example-research"');
    expect(markup).toContain(
      'data-testid="autopilot-launch-example-attachment"'
    );
    expect(markup).toContain(
      'data-testid="autopilot-launch-example-advanced-execution"'
    );
  });
});
