import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompareView } from "../CompareView";
import { artifact, job } from "./version-history-fixtures";

describe("<CompareView>", () => {
  it("rejects cross-family jobs before rendering comparison rows", () => {
    const markup = renderToStaticMarkup(
      <CompareView
        leftJob={job("left")}
        rightJob={job("external")}
        familyJobIds={["left"]}
      />
    );

    expect(markup).toContain('data-state="cross-family"');
    expect(markup).toContain("not in the current family");
    expect(markup).not.toContain("<table");
  });

  it("renders canonical stage order with missing and stale artifact states", () => {
    const left = job("left", {
      staleArtifactIds: ["tasks-stale"],
      artifacts: [
        artifact("intake", "intake", "2026-05-23T01:00:00.000Z"),
        artifact("tasks-stale", "tasks", "2026-05-23T02:00:00.000Z"),
      ],
    });
    const right = job("right", {
      artifacts: [artifact("design", "design", "2026-05-23T03:00:00.000Z")],
    });

    const markup = renderToStaticMarkup(
      <CompareView
        leftJob={left}
        rightJob={right}
        familyJobIds={["left", "right"]}
      />
    );

    expect(markup.indexOf('data-stage="input"')).toBeLessThan(
      markup.indexOf('data-stage="route_generation"')
    );
    expect(markup.indexOf('data-stage="route_generation"')).toBeLessThan(
      markup.indexOf('data-stage="spec_docs"')
    );
    expect(markup).toContain('data-status="missing"');
    expect(markup).toContain('data-status="stale"');
    expect(markup).toContain("—");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<textarea");
  });
});
