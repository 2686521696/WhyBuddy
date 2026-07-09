import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../Home", () => ({
  __esModule: true,
  default: () => <div data-testid="home-mock" />,
}));

async function renderCockpitMarkup(): Promise<string> {
  const { default: ProjectCockpitHome } = await import("../ProjectCockpitHome");
  return renderToStaticMarkup(<ProjectCockpitHome />);
}

describe("ProjectCockpitHome layout", () => {
  it("renders Home without the top main-chain timeline band", async () => {
    const markup = await renderCockpitMarkup();

    const layoutBandMatch = markup.match(
      /<[^>]+data-region=["']project-cockpit-layout-band["'][^>]*>/i,
    );
    expect(layoutBandMatch).not.toBeNull();

    const homeMatch = markup.match(
      /<[^>]+data-testid=["']home-mock["'][^>]*>/i,
    );
    expect(homeMatch).not.toBeNull();
    expect(markup.indexOf(homeMatch![0])).toBeGreaterThan(
      markup.indexOf(layoutBandMatch![0]),
    );

    expect(markup).not.toContain("project-cockpit-timeline-band");
    expect(markup).not.toContain("project-main-chain-timeline");
    expect(markup).not.toContain(
      "project-cockpit-home-main-chain-timeline-slot",
    );
  });
});
