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
    expect(src).toContain("available={showStudioChrome}");
    expect(src).toContain("isStudioChromeShown");
    expect(src).toContain("showStudioChrome");
    expect(src).not.toContain("available={!isHomeEmpty}");
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
    expect(studio).toContain('from "./studio-layout"');
    expect(studio).toContain("stagePageHidden");
    // ⚠ 2026-08-20 真机：只 grep 函数名会假绿——调用写了、import 漏了，
    // 页面 ReferenceError。变异：删掉这条 import，下面必红。

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

  it("分栏缝走 Primer muted 发丝线，不是投影或 6px 槽", () => {
    const src = stripComments(
      readFileSync(new URL("../StudioSplit.tsx", import.meta.url), "utf8")
    );
    const handle = src.slice(
      src.indexOf("sliderule-studio-split-handle"),
      src.indexOf("sliderule-studio-split-toggle-chat")
    );
    expect(handle).toContain("w-px");
    expect(handle).toContain("#d1d9e0b3");
    expect(handle).not.toContain("linear-gradient");
    expect(handle).not.toContain("bg-[#e5e7eb]");
    expect(handle).not.toContain("w-1.5");
    expect(src).toContain("onDragging={layout.setResizing}");
    expect(src).toContain('data-studio-resizing={layout.resizing ? "true" : undefined}');

    const css = stripComments(
      readFileSync(
        new URL(
          "../../agent-loop/dashboard/dashboard.css",
          import.meta.url
        ),
        "utf8"
      )
    );
    const sidebar = css.slice(
      css.indexOf(".native-agent-sidebar {"),
      css.indexOf(".native-agent-shell[data-sidebar-collapsed")
    );
    expect(sidebar).toContain("border-right: 1px solid var(--sr-border-muted");
    expect(sidebar).toContain("#d1d9e0b3");
    expect(sidebar).not.toContain("linear-gradient");
    expect(css).not.toContain(".native-agent-main::before");
    expect(css).toContain("--sr-border-muted: #d1d9e0b3");
    const dragCss = css.slice(css.indexOf('[data-studio-resizing="true"]'));
    expect(dragCss).toContain("pointer-events: none");
    expect(dragCss).toContain("contain: strict");
  });

  it("拖分栏时冻结舞台缩放，不每帧 setScale", () => {
    const split = stripComments(
      readFileSync(new URL("../StudioSplit.tsx", import.meta.url), "utf8")
    );
    expect(split).toContain("onDragging={layout.setResizing}");

    const stage = stripComments(
      readFileSync(
        new URL("../live-runtime/SpecPageLiveStage.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(stage).toContain("studioLayout?.resizing ?? false");

    const scale = stripComments(
      readFileSync(
        new URL("../live-runtime/canvas-scale.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(scale).toContain("if (pausedRef.current) return");
    expect(scale).toContain("requestAnimationFrame");
  });

  it("角色切换箭头有右边距，不用系统原生贴边三角", () => {
    const src = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    const role = src.slice(
      src.indexOf("sliderule-stage-role"),
      src.indexOf("sliderule-stage-view-page")
    );
    expect(role).toContain("appearance-none");
    expect(role).toContain("pr-8");
    expect(role).toContain("right-2.5");
    expect(role).toContain("ChevronDown");
    expect(role).not.toContain("bg-white px-3 text-[12px]");
  });

  it("图标簇挂在舞台头条右侧，不占整页顶栏", () => {
    const page = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const hudIdx = page.indexOf("<SlideRuleTopHud");
    expect(hudIdx).toBeGreaterThan(-1);
    const beforeHud = page.slice(Math.max(0, hudIdx - 240), hudIdx);
    expect(beforeHud).toContain("chromeSlot");
    expect(beforeHud).not.toContain("border-b");
    expect(beforeHud).not.toContain("<header");
    expect(page).not.toContain("immersionOverlayHeader");

    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    const gearsAt = studio.indexOf("sliderule-stage-gears");
    const stageBodyAt = studio.indexOf("flex min-h-0 flex-1 gap-3", gearsAt);
    const gears = studio.slice(gearsAt, stageBodyAt);
    expect(gears).toContain("透视");
    expect(gears.indexOf("透视")).toBeLessThan(gears.indexOf("{chromeSlot}"));

    const boardAt = studio.lastIndexOf('stageView === "board"');
    const boardTab = studio.slice(boardAt, boardAt + 360);
    expect(boardTab).toContain("<ArchitectureStage");
    expect(boardTab).not.toContain("trailing=");
  });

  it("成品页顶栏有沙盘档，透视栏打开沙盘不走 Checks 抽屉", () => {
    const studio = stripComments(
      readFileSync(new URL("../SlideRuleStudio.tsx", import.meta.url), "utf8")
    );
    expect(studio).toContain('["board", "沙盘"]');
    expect(studio).toContain('stageView === "board"');
    expect(studio).toContain("onOpenSandbox");
    expect(studio).toContain("透视");
    expect(studio).not.toContain(">游标<");

    const panel = stripComments(
      readFileSync(new URL("../XrayPanel.tsx", import.meta.url), "utf8")
    );
    expect(panel).toContain("打开沙盘");
    expect(panel).toContain("onOpenSandbox");
    // 反向：清单底「五系统联动总图」点进去是 Checks 抽屉，沙盘仍然失踪
    expect(panel).not.toContain("五系统联动总图");
  });
});
