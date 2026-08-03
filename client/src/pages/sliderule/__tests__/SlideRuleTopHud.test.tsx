import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlideRuleTopHud } from "../SlideRuleTopHud";

describe("SlideRuleTopHud", () => {
  it("hides the wordmark when rendered inside AgentLoop", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud isRunning={false} embedded />
    );

    expect(html).toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain("面团AI");
  });

  it("keeps the wordmark for the standalone immersion surface", () => {
    const html = renderToStaticMarkup(<SlideRuleTopHud isRunning={false} />);

    expect(html).toContain("面团AI");
    expect(html).toContain("miantuan.ai");
  });

  it("STATUS 状态盒与 Work/Code 胶囊均退役（Work 模式迁私有主仓）", () => {
    const html = renderToStaticMarkup(<SlideRuleTopHud isRunning={false} />);

    expect(html).not.toContain('data-testid="sliderule-surface-mode"');
    expect(html).not.toContain('data-testid="sliderule-mode-work"');
    // 旧 STATUS 状态盒退役
    expect(html).not.toContain("STATUS");
    expect(html).not.toContain("sliderule-goal-display");
  });
});
