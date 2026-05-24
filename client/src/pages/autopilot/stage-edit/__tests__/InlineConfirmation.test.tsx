import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { InlineConfirmation } from "../InlineConfirmation";

describe("<InlineConfirmation>", () => {
  it("shows the downstream impact count and field-level confirm/cancel controls", () => {
    const markup = renderToStaticMarkup(
      <InlineConfirmation
        downstreamCount={3}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain("3 downstream items will become stale");
    expect(markup).toContain("Confirm");
    expect(markup).toContain("Cancel");
    expect(markup).toContain('data-testid="autopilot-inline-confirmation"');
  });

  it("uses the direct-save copy when there are no downstream items", () => {
    const markup = renderToStaticMarkup(
      <InlineConfirmation
        downstreamCount={0}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain("No downstream items; this will save directly");
  });

  it("does not render spec2 replan modal test ids", () => {
    const markup = renderToStaticMarkup(
      <InlineConfirmation
        downstreamCount={1}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).not.toContain("autopilot-replan-from-stage-divider");
  });
});
