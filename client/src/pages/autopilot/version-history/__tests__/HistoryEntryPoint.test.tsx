import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  HistoryEntryPoint,
  withHistorySearchParam,
} from "../HistoryEntryPoint";

describe("<HistoryEntryPoint>", () => {
  it("renders a semantic right-rail top entry with a stable test id", () => {
    const markup = renderToStaticMarkup(
      <HistoryEntryPoint jobId="job-1" familyCount={3} staleCount={1} />
    );

    expect(markup).toContain('data-testid="autopilot-history-entry"');
    expect(markup).toContain('aria-label="Open version history"');
    expect(markup).toContain('data-history-entry="true"');
    expect(markup).not.toContain("replan");
    expect(markup).not.toContain("edit");
  });

  it("localizes the manual history entry in Chinese mode", () => {
    const markup = renderToStaticMarkup(
      <HistoryEntryPoint
        jobId="job-1"
        familyCount={3}
        staleCount={2}
        locale="zh-CN"
      />
    );

    expect(markup).toContain('aria-label="打开版本历史"');
    expect(markup).toContain(">历史<");
    expect(markup).toContain(">2 个过期<");
    expect(markup).not.toContain(">History<");
    expect(markup).not.toContain(" stale");
  });

  it("navigates to history=1 on click while preserving other query params", () => {
    const navigate = vi.fn();
    const element = HistoryEntryPoint({
      jobId: "job-1",
      search: "?activeJob=job-1",
      navigate,
    }) as React.ReactElement<{ onClick: () => void }>;

    element.props.onClick();

    expect(navigate).toHaveBeenCalledWith("?activeJob=job-1&history=1");
  });

  it("disables static preview with tooltip and no click response", () => {
    const navigate = vi.fn();
    const element = HistoryEntryPoint({
      jobId: "job-1",
      staticPreview: true,
      navigate,
    }) as React.ReactElement<{ onClick: () => void }>;
    const markup = renderToStaticMarkup(element);

    expect(markup).toContain("disabled");
    expect(markup).toContain(
      "Static preview does not support version history."
    );
    element.props.onClick();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not auto-open for socket or replan success events", () => {
    const navigate = vi.fn();

    renderToStaticMarkup(
      <HistoryEntryPoint
        jobId="job-1"
        navigate={navigate}
        lastSocketEvent={{ type: "job.updated" }}
        lastReplanSuccess={{ jobId: "job-1" }}
      />
    );

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("withHistorySearchParam", () => {
  it("sets history without dropping existing params", () => {
    expect(withHistorySearchParam("?activeJob=job-1", true)).toBe(
      "?activeJob=job-1&history=1"
    );
    expect(withHistorySearchParam("?activeJob=job-1&history=0", true)).toBe(
      "?activeJob=job-1&history=1"
    );
  });
});
