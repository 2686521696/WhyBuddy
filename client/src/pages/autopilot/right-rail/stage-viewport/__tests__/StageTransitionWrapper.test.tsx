import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import StageTransitionWrapper from "../StageTransitionWrapper";

describe("StageTransitionWrapper", () => {
  it("does not block the next stage behind a stuck exit animation", () => {
    const source = readFileSync(
      resolve(__dirname, "../StageTransitionWrapper.tsx"),
      "utf8",
    );

    expect(source).toContain('mode="sync"');
    expect(source).not.toContain('mode="wait"');
    expect(source).not.toContain('exit="exit"');
  });

  it("renders the current stage visibly on the server and first client frame", () => {
    const markup = renderToStaticMarkup(
      <StageTransitionWrapper stageKey="route" direction="backward">
        <div data-testid="stage-content">Route content</div>
      </StageTransitionWrapper>,
    );

    expect(markup).toContain('data-testid="stage-content"');
    expect(markup).toContain("Route content");
    expect(markup).toContain("grid h-full min-h-0");
    expect(markup).toContain("col-start-1 row-start-1 h-full min-h-0");
    expect(markup).not.toContain("opacity:0");
    expect(markup).not.toContain("translateX(-30%)");
  });
});
