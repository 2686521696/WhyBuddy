/**
 * 输入条 Cursor 三行形态（装在真链路上）。
 *
 * 对照：Cursor Composer 芯片行 / 胶囊+圆发送 / 状态行；
 * Void SidebarChat SelectedFiles → textarea → 底栏。
 * hintChips 必须真渲染——只写在 props 类型里会假绿。
 * 不许出现 git / Commit / main 这种本仓没有的东西。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("ComposerDock Cursor 三行形态", () => {
  it("停靠条是 24px 白胶囊，+ 是灰圆，发送在胶囊外的实心圆", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    const shell = dock.slice(
      dock.indexOf("sliderule-composer-dock") - 420,
      dock.indexOf("sliderule-composer-dock") + 80
    );
    expect(shell).toContain("rounded-[24px]");
    expect(shell).toContain("rounded-[12px]");
    expect(shell).toContain("bg-white");
    expect(shell).toContain("border-[#e5e7eb]");
    expect(shell).not.toContain("bg-[#f3f4f6]");
    expect(dock).not.toContain("sliderule-hero-glow");

    const plus = dock.slice(
      dock.indexOf("sliderule-composer-plus") - 420,
      dock.indexOf("sliderule-composer-plus")
    );
    expect(plus).toContain("rounded-full");
    expect(plus).toContain("bg-[#f4f4f5]");
    expect(plus).not.toContain("rounded-md");

    const send = dock.slice(
      dock.indexOf("sliderule-composer-send"),
      dock.indexOf("sliderule-composer-send") + 520
    );
    expect(send).toContain("pointer-events-auto");
    expect(send).toContain("rounded-full");
    expect(send).not.toContain("mb-0.5");
    // 发送圆和胶囊同一中线。变异 items-end / mb-0.5 会把圆顶上去或沉下去。
    expect(dock).toContain("flex w-full items-center gap-2");
    expect(dock).not.toContain("flex w-full items-end gap-2");
    expect(dock).toContain(">优化<");
    expect(dock).not.toContain("sliderule-hero-upload");
    expect(dock).not.toContain("order-first basis-full");
  });

  it("空态是 Cursor 卡片：字在上、发送在卡片里，没有粉紫光晕", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    expect(dock).toContain("grid-cols-[auto_auto_1fr_auto]");
    expect(dock).toContain("min-h-[72px]");
    expect(dock).toContain("shadow-[0_2px_8px_rgba(31,35,40,0.06)]");
    expect(dock).toContain("col-start-4 row-start-2");
    expect(dock).toContain("{refineButton}");
    expect(dock).toContain("{sendButton}");
    // 空态：优化和发送同一簇靠右，优化在前。变异把优化塞回 + 右侧 col-start-3 必红。
    const heroSend = dock.slice(
      dock.indexOf("col-start-4 row-start-2"),
      dock.indexOf("{hero ? null : sendButton}")
    );
    expect(heroSend.indexOf("{refineButton}")).toBeLessThan(
      heroSend.indexOf("{sendButton}")
    );
    expect(dock).not.toContain("col-start-3 row-start-2");
    expect(dock).not.toContain("col-start-5 row-start-2");
    expect(dock).toContain("sliderule-composer-device");
    expect(dock).toContain("COMPOSER_DEVICE_OPTIONS");
    expect(dock).toContain("{hero ? null : sendButton}");
    expect(dock).not.toContain("sliderule-hero-glow");
    expect(dock).not.toContain("rgba(167,139,250");
    expect(dock).not.toContain("filter: \"blur(10px)\"");
    expect(dock).not.toContain("This PC");
    expect(dock).not.toContain("Microphone");
  });

  it("顶行真的渲染 hintChips，不是只在 props 里占位", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    expect(dock).toContain("sliderule-composer-actions");
    expect(dock).toContain("hintChips.slice");
    expect(dock).toContain("sliderule-composer-hint-chip");
    expect(dock).toContain("sliderule-composer-status-pill");
    // 反向：编 git 顶行必红
    expect(dock).not.toContain("Commit & Push");
    expect(dock).not.toContain("Changes +");
  });

  it("底行是话题 + 成品/推演，不是 git 分支", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    expect(dock).toContain("topicLabel");
    expect(dock).toContain("surfaceLabel");
    expect(dock).toContain('hasApp ? "成品" : "推演"');
    expect(dock).toContain("AppWindow");
    expect(dock).not.toContain(">main<");
    expect(dock).not.toContain("This PC");
  });
});

describe("对话列接到输入条，不要横切分隔线", () => {
  it("footer 与会话同宽 720，没有 border-t", () => {
    const src = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const footer = src.slice(
      src.indexOf("sliderule-composer-footer"),
      src.indexOf("sliderule-composer-footer") + 520
    );
    expect(footer).toContain("max-w-[720px]");
    expect(footer).not.toContain("border-t");
  });

  it("闭环胶囊从 publishClosure 接入 ComposerDock", () => {
    const src = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const call = src.slice(
      src.indexOf("<ComposerDock"),
      src.indexOf("<ComposerDock") + 900
    );
    expect(call).toContain("hintChips={composerHints}");
    expect(call).toContain("formatComposerClosurePill");
    expect(call).not.toContain("statusPill={null}");
    expect(call).not.toContain("闭环 ${");
  });

  it("应用/Web 开关接到 drive-full-stream 请求体，不是只画在输入条上", () => {
    const session = stripComments(
      readFileSync(new URL("../useSlideRuleSession.ts", import.meta.url), "utf8")
    );
    expect(session).toContain("preferredDevice: loadPreferredDevice()");
    const driver = stripComments(
      readFileSync(
        new URL("../../../lib/sliderule-marathon-driver.ts", import.meta.url),
        "utf8"
      )
    );
    expect(driver).toContain("preferredDevice: opts.preferredDevice");
    expect(driver).toContain("/drive-full-stream");
  });
});
