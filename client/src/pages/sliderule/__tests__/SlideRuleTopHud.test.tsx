import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SlideRuleTopHud } from "../SlideRuleTopHud";

vi.mock("@/lib/deploy-target", () => ({
  IS_GITHUB_PAGES: false,
}));

describe("SlideRuleTopHud", () => {
  it("hides the wordmark when rendered inside AgentLoop", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud isRunning={false} embedded />
    );

    expect(html).toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain("sliderule_logo_wordmark_transparent.png");
  });

  it("keeps the wordmark for the standalone immersion surface", () => {
    const html = renderToStaticMarkup(<SlideRuleTopHud isRunning={false} />);

    expect(html).toContain("sliderule_logo_wordmark_transparent.png");
  });

  it("Work/Code 模式胶囊替代 STATUS 状态盒（用户裁决，TRAE 对标）", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud isRunning={false} surfaceMode="code" />
    );

    expect(html).toContain('data-testid="sliderule-surface-mode"');
    expect(html).toContain('data-testid="sliderule-mode-work"');
    expect(html).toContain('data-testid="sliderule-mode-code"');
    // Code 档处于按压态（aria-pressed 语义可测）
    expect(html).toMatch(
      /data-testid="sliderule-mode-code"[^>]*aria-pressed="true"/
    );
    // 旧 STATUS 状态盒退役
    expect(html).not.toContain("STATUS");
    expect(html).not.toContain("sliderule-goal-display");
  });
});
