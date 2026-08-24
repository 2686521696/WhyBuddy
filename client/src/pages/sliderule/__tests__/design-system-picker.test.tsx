/**
 * 设计系统选择器的四条形态（2026-08-25 用户裁决）。
 *
 * 每条都配反向判据——这批改动全是"看得见但不报错"的类型：写错了页面照样跑，
 * 只是长得不对。
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DesignSystemSwatch,
  designSystemSwatchColors,
} from "../DesignSystemSwatch";
import { DESIGN_SYSTEMS } from "../design-system";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const dock = () =>
  stripComments(
    readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
  );

describe("① 未选是图标，② 选了是多色色块", () => {
  it("按钮两态分岔：null 走 Palette 图标，有值走色块", () => {
    const src = dock();
    // 三态里的 null 分支必须存在（改动前是两态，永远有值）
    expect(src).toContain(
      "designSystemId ? findDesignSystem(designSystemId) : null"
    );
    expect(src).toMatch(/designSystem \?[\s\S]{0,120}DesignSystemSwatch/);
    expect(src).toMatch(/DesignSystemSwatch[\s\S]{0,160}<Palette/);
    // 反向：不许再有"单色圆点"那种写法（背景直接吃 seed）
    expect(src).not.toContain("style={{ background: designSystem.seed }}");
  });

  it("色块是四段真实派生色，且几套之间分得开", () => {
    const html = renderToStaticMarkup(<DesignSystemSwatch seed="#DD6B20" />);
    expect(html).toContain("conic-gradient");
    // 四段
    expect(designSystemSwatchColors("#DD6B20")).toHaveLength(4);

    /**
     * ⚠ 2026-08-25 真机踩到：第一版取了 sidebarBg，而浅色模式下它**三套都是
     * #ffffff**，白色那格毫无区分度，色块看起来像半圆。所以这条判据不是"有四个
     * 颜色"，而是"这四个颜色在几套系统之间真的不一样"。
     * 换回任何一个常量字段（各套同值），这条必红。
     */
    const perSystem = DESIGN_SYSTEMS.map(s => designSystemSwatchColors(s.seed));
    for (let slot = 0; slot < 4; slot++) {
      const vals = new Set(perSystem.map(c => c[slot].toLowerCase()));
      expect(
        vals.size,
        `第 ${slot} 段在各套系统里同值，等于白占一格`
      ).toBeGreaterThan(1);
    }
  });
});

describe("③ 新建开右侧面板，不是抽屉", () => {
  it("菜单里有新建，且它开的是面板不是别的", () => {
    const src = dock();
    expect(src).toContain("sliderule-design-system-new");
    expect(src).toContain("designPanel?.openNew()");
  });

  it("面板是浮层不是抽屉：fixed 定位、没有全屏遮罩", () => {
    const panel = stripComments(
      readFileSync(new URL("../DesignSystemPanel.tsx", import.meta.url), "utf8")
    );
    expect(panel).toContain("sliderule-design-panel");
    expect(panel).toContain("fixed right-4");
    /**
     * ⚠ 用户原话「不是抽屉那种」。抽屉的特征是**整屏遮罩 + 贴边全高**——
     * 那会把正在跑的应用整个盖住，而用户改配色时正要看着它。
     * 加回 inset-0 遮罩或 h-full 贴边，这两条必红。
     */
    expect(panel).not.toContain("inset-0");
    expect(panel).not.toMatch(/right-0[^"]*h-full/);
    // 可新建保存
    expect(panel).toContain("saveCustomDesignSystem");
    expect(panel).toContain("sliderule-design-panel-apply");
  });

  it("面板挂在页面根，不是舞台里（首页没有舞台）", () => {
    const page = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    expect(page).toContain("<DesignSystemPanelProvider>");
    expect(page).toContain("<DesignSystemPanel />");
    // 反向：面板不许被塞进 chromeSlot（那条槽只在有舞台时渲染）
    const at = page.indexOf("<DesignSystemPanel />");
    expect(page.slice(at - 400, at)).not.toContain("chromeSlot");
  });
});

describe("④ 选了预设，右侧出面板", () => {
  it("选中即 openView，不是只关菜单", () => {
    const src = dock();
    expect(src).toContain("designPanel?.openView(sys.id)");
    const at = src.indexOf("designPanel?.openView(sys.id)");
    // 同一个 onClick 里既要落选中态、又要开面板
    const around = src.slice(Math.max(0, at - 400), at);
    expect(around).toContain("saveDesignSystemId(sys.id)");
  });

  it("选中态放在 context，面板保存后作曲家会跟着变", () => {
    const src = dock();
    /**
     * ⚠ 触发在作曲家、保存在面板，两处不是父子。各存各的 useState 的话，
     * 「保存并应用」之后作曲家上的色块不会变——不报错，只是看着像没保存上。
     */
    // ⚠ 别盯整行字面：prettier 会按行宽折行，判据会因为格式化而假红。
    //   盯的是"有 Provider 时以它的 appliedId 为准"这个语义。
    expect(src).toMatch(
      /designPanel[\s\S]{0,40}designPanel\.appliedId[\s\S]{0,40}localDesignSystemId/
    );
    const ctx = stripComments(
      readFileSync(
        new URL("../DesignSystemContext.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(ctx).toContain("appliedId");
    expect(ctx).toContain("saveDesignSystemId(id)");
  });
});
