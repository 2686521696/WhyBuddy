import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../Home", () => ({
  __esModule: true,
  default: () => (
    <div
      data-testid="home-mock"
      data-region="home-mock-primary-content"
    />
  ),
}));

async function renderCockpitMarkup(): Promise<string> {
  const { default: ProjectCockpitHome } = await import("../ProjectCockpitHome");
  return renderToStaticMarkup(<ProjectCockpitHome />);
}

describe("ProjectCockpitHome production snapshot", () => {
  it("renders the Home body and omits the removed top timeline region", async () => {
    const markup = await renderCockpitMarkup();

    expect(markup).toContain('data-testid="home-mock"');
    expect(markup).toContain('data-region="project-cockpit-layout-band"');
    expect(markup).not.toContain("project-main-chain-timeline");
    expect(markup).not.toContain("project-cockpit-timeline-band");
  });
});
