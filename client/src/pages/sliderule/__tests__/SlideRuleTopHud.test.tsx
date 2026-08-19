import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SlideRuleTopHud } from "../SlideRuleTopHud";
import { StudioLayoutProvider } from "../StudioLayoutContext";

vi.mock("@/lib/deploy-target", () => ({
  IS_GITHUB_PAGES: false,
}));

describe("SlideRuleTopHud", () => {
  it("不再画整页顶栏字标（字标在侧栏）", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud isRunning={false} embedded />
    );
    expect(html).toContain('data-testid="sliderule-status-bar"');
    expect(html).not.toContain("sliderule_logo_wordmark_transparent.png");
    expect(html).not.toContain("<header");
  });

  it("STATUS 状态盒与 Work/Code 胶囊均退役（Work 模式迁私有主仓）", () => {
    const html = renderToStaticMarkup(<SlideRuleTopHud isRunning={false} />);

    expect(html).not.toContain('data-testid="sliderule-surface-mode"');
    expect(html).not.toContain('data-testid="sliderule-mode-work"');
    expect(html).not.toContain("STATUS");
    expect(html).not.toContain("sliderule-goal-display");
  });

  it("交付物/重置是无字图标，不再画描边胶囊", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud
        isRunning={false}
        onOpenDeliverables={() => {}}
        onResetSession={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-deliverables-open"');
    expect(html).toContain('data-testid="sliderule-reset-session"');
    expect(html).not.toContain(">交付物<");
    expect(html).not.toContain(">重置会话<");
    expect(html).not.toContain("rounded-full");
  });

  it("空会话不挂对话/舞台折钮（舞台还没登场）", () => {
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available={false}>
        <SlideRuleTopHud isRunning={false} />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-testid="sliderule-layout-controls"');
    expect(html).not.toContain('data-testid="sliderule-layout-chat"');
    expect(html).not.toContain('data-testid="sliderule-layout-stage"');
    expect(html).not.toContain('data-testid="sliderule-layout-maximize"');
  });

  it("只有右侧页面显隐 + 最大化，没有会话栏/对话键", () => {
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleTopHud isRunning={false} />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-testid="sliderule-layout-stage"');
    expect(html).toContain('aria-label="隐藏页面"');
    expect(html).toContain('data-testid="sliderule-layout-maximize"');
    expect(html).not.toContain('data-testid="sliderule-layout-sidebar"');
    expect(html).not.toContain('data-testid="sliderule-layout-chat"');
    expect(html).not.toContain("折叠舞台");
    expect(html).not.toContain("折叠会话栏");
    expect(html).not.toContain("折叠对话");
  });
});
