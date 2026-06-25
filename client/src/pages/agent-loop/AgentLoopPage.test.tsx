import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AgentLoopPage from "./AgentLoopPage";

describe("AgentLoopPage", () => {
  it("renders the main-project AgentLoop shell and API-backed runs area", () => {
    const html = renderToStaticMarkup(<AgentLoopPage />);

    expect(html).toContain("AgentLoop");
    expect(html).toContain("运行队列");
    expect(html).toContain("Python Runtime");
    expect(html).toContain("/api/agent-loop/runs/overview");
    expect(html).toContain('data-testid="agent-loop-page"');
    expect(html).toContain('data-testid="agent-loop-runs"');
  });
});
