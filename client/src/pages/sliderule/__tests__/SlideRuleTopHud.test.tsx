import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SlideRuleResetSessionButton, SlideRuleTopHud } from "../SlideRuleTopHud";
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

  it("交付物是无字图标；重置会话已搬走，传了 onResetSession 也不许在簇里冒出来", () => {
    const html = renderToStaticMarkup(
      <SlideRuleTopHud
        isRunning={false}
        onOpenDeliverables={() => {}}
        onResetSession={() => {}}
      />
    );
    expect(html).toContain('data-testid="sliderule-deliverables-open"');
    expect(html).not.toContain(">交付物<");
    expect(html).not.toContain("rounded-full");
    // ⚠ 2026-08-24 反向判据：onResetSession 仍在 props 里（老调用点不炸），
    // 但**不渲染**。把 SlideRuleTopHud 里的按钮加回去，这条必红——否则
    // "搬走了"只是搬了个副本，右侧还留着一个，用户看到的还是两个重置。
    expect(html).not.toContain('data-testid="sliderule-reset-session"');
    expect(html).not.toContain(">重置会话<");
  });

  it("重置会话是标题左侧那颗蓝钮：更大、蓝底蓝字，且真的接在 onResetSession 上", () => {
    const html = renderToStaticMarkup(
      <SlideRuleResetSessionButton isRunning={false} onResetSession={() => {}} />
    );
    expect(html).toContain('data-testid="sliderule-reset-session"');
    expect(html).toContain('aria-label="重置会话"');
    // 放大：h-8 w-8（原簇里是 h-7 w-7），图标 h-4（原 h-3.5）
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("h-4 w-4");
    expect(html).not.toContain("h-7 w-7");
    // 蓝：品牌蓝前景 + 浅蓝底，不再是 #5c5c5c 灰
    expect(html).toContain("#1677ff");
    expect(html).toContain("#eef5ff");
    expect(html).not.toContain("#5c5c5c");
  });

  it("没给 onResetSession 就不画钮；推演中禁用", () => {
    expect(
      renderToStaticMarkup(<SlideRuleResetSessionButton isRunning={false} />)
    ).toBe("");
    const running = renderToStaticMarkup(
      <SlideRuleResetSessionButton isRunning onResetSession={() => {}} />
    );
    expect(running).toContain("disabled");
    expect(running).toContain("推演进行中，稍后再重置");
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
    expect(html).not.toContain('data-testid="sliderule-layout-reset"');
  });

  it("只有右侧页面显隐 + 最大化；重置布局已撤，没有会话栏/对话键", () => {
    const html = renderToStaticMarkup(
      <StudioLayoutProvider available>
        <SlideRuleTopHud isRunning={false} />
      </StudioLayoutProvider>
    );
    expect(html).toContain('data-testid="sliderule-layout-stage"');
    expect(html).toContain('aria-label="隐藏页面"');
    expect(html).toContain('data-testid="sliderule-layout-maximize"');
    // ⚠ 2026-08-24 用户反馈"按钮一多看不懂啥意思"：重置布局整片撤掉。
    // 功能没丢——StudioSplit 那道缝上的双击仍走同一条 resetLayout
    // （由 workbench-chrome-wiring 钉住）。把按钮加回来这两条必红。
    expect(html).not.toContain('data-testid="sliderule-layout-reset"');
    expect(html).not.toContain('aria-label="重置布局"');
    expect(html).not.toContain('data-testid="sliderule-layout-sidebar"');
    expect(html).not.toContain('data-testid="sliderule-layout-chat"');
    expect(html).not.toContain("折叠舞台");
    expect(html).not.toContain("折叠会话栏");
    expect(html).not.toContain("折叠对话");
  });
});
