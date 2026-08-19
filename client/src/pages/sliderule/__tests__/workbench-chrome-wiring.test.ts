/**
 * 顶栏布局开关必须接在通电的那条链上。
 * 只测 helper 会假绿：把 Provider 从 SlideRuleUnified 摘掉，
 * studio-layout.test 照样过，真机右上角还是没有页面显隐。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("workbench chrome live-path wiring", () => {
  it("SlideRuleUnified 包了 StudioLayoutProvider，空会话 available=false", () => {
    const src = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("StudioLayoutProvider");
    expect(src).toContain("available={!isHomeEmpty}");
  });

  it("DashboardApp 外壳带 ShellSidebarProvider 和 data-sidebar-collapsed", () => {
    const src = stripComments(
      readFileSync(
        new URL(
          "../../agent-loop/dashboard/DashboardApp.tsx",
          import.meta.url
        ),
        "utf8"
      )
    );
    expect(src).toContain("ShellSidebarProvider");
    expect(src).toContain("data-sidebar-collapsed");
  });

  it("顶栏右边图标走 toggleStagePage，左边会话栏/对话键不存在", () => {
    const src = stripComments(
      readFileSync(new URL("../SlideRuleTopHud.tsx", import.meta.url), "utf8")
    );
    expect(src).toContain("useStudioLayout");
    expect(src).toContain("studio?.toggleStagePage");
    expect(src).toContain("隐藏页面");
    expect(src).toContain("sliderule-layout-maximize");
    expect(src).not.toContain("useShellSidebar");
    expect(src).not.toContain("sliderule-layout-sidebar");
    expect(src).not.toContain("sliderule-layout-chat");
    expect(src).not.toContain("studio?.toggleStage}");
    expect(src).not.toContain("studio?.toggleChat");
  });

  it("隐藏页面卸掉舞台，toggleStagePage 不许碰 panel.collapse", () => {
    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    expect(studio).toContain("isStagePageShown");
    expect(studio).toContain("stagePageHidden");

    const ctx = stripComments(
      readFileSync(
        new URL("../StudioLayoutContext.tsx", import.meta.url),
        "utf8"
      )
    );
    const pageToggle = ctx.match(
      /const toggleStagePage[\s\S]*?},\s*\[\]\s*\)/
    )?.[0];
    expect(pageToggle).toBeTruthy();
    expect(pageToggle).toContain("nextStagePageHidden");
    expect(pageToggle).not.toContain("collapse");
    expect(pageToggle).not.toContain("expand");
    expect(pageToggle).not.toContain("stageRef");
  });
});
