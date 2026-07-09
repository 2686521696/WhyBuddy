import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReplanTimelineView } from "../ReplanTimelineView";
import { event } from "./version-history-fixtures";

describe("<ReplanTimelineView>", () => {
  it("renders an empty state when no replan events exist", () => {
    const markup = renderToStaticMarkup(<ReplanTimelineView events={[]} />);

    expect(markup).toContain('data-state="empty"');
    expect(markup).toContain("No replan events.");
  });

  it("sorts newest first and uses jobId as a stable tie-breaker", () => {
    const markup = renderToStaticMarkup(
      <ReplanTimelineView
        events={[
          event(
            "same-b",
            "replan.triggered",
            "2026-05-23T03:00:00.000Z",
            "same b",
            {},
            "job-b"
          ),
          event(
            "new",
            "replan.triggered",
            "2026-05-23T04:00:00.000Z",
            "new",
            {},
            "job-c"
          ),
          event(
            "ignore",
            "job.stage",
            "2026-05-23T05:00:00.000Z",
            "ignore",
            {},
            "job-d"
          ),
          event(
            "same-a",
            "replan.triggered",
            "2026-05-23T03:00:00.000Z",
            "same a",
            {},
            "job-a"
          ),
        ]}
      />
    );

    expect(markup).toContain("new");
    expect(markup).not.toContain("ignore");
    expect(markup.indexOf("new")).toBeLessThan(markup.indexOf("same a"));
    expect(markup.indexOf("same a")).toBeLessThan(markup.indexOf("same b"));
  });

  it("truncates reason text and escapes HTML instead of rendering it", () => {
    const reason = `<script>alert(1)</script>${"x".repeat(210)}`;
    const markup = renderToStaticMarkup(
      <ReplanTimelineView
        events={[
          event(
            "branch",
            "replan.triggered",
            "2026-05-23T03:00:00.000Z",
            "branch",
            {
              mode: "branch",
              parentJobId: "root",
              fromStage: "spec_docs",
              inheritedUpstreamArtifactCount: 2,
              reason,
            }
          ),
        ]}
      />
    );

    expect(markup).toContain("branch");
    expect(markup).toContain("root");
    expect(markup).toContain("spec_docs");
    expect(markup).toContain("2");
    expect(markup).toContain("...");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).not.toContain("<script>");
  });
});
