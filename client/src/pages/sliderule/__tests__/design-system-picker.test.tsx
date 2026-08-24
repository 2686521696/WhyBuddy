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
const rail = () =>
  stripComments(
    readFileSync(new URL("../DesignSystemRail.tsx", import.meta.url), "utf8")
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
  it("清单渲染在 Rail 里，作曲家只留触发按钮", () => {
    expect(rail()).toContain("sliderule-design-system-menu");
    expect(rail()).toContain("sliderule-design-system-new");
    expect(rail()).toContain("panel.openNew()");
    const src = dock();
    expect(src).not.toContain("sliderule-design-system-menu");
  });

  it("走 portal + fixed，不能用 absolute 锚在按钮上", () => {
    /**
     * ⚠ 2026-08-25 第三轮真机量到：作曲家坐在 `max-w-[720px] overflow-y-auto`
     * 的对话滚动容器里（右边界 1321），清单 272 + 面板 300 要到 1378 ——
     * 面板被那一列**裁掉 57px**，种子色输入框/角半径/应用按钮全部截断。
     * absolute 锚在按钮上就逃不出这个列宽，所以必须 portal 出去。
     * 改回 absolute 必红。
     */
    const src = rail();
    expect(src).toContain("createPortal");
    expect(src).toContain("document.body");
    expect(src).toContain("getBoundingClientRect");
    expect(src).not.toMatch(/absolute bottom-full/);
  });

  it("放不下时整体左移、高度按可用空间钳住，不许出屏", () => {
    const src = rail();
    // 右边放不下 → 左移贴边
    expect(src).toContain("window.innerWidth - width - 8");
    // 上方空间不够 → 钳高度（真机 900 高时量到 top=-28，标题和 × 跑出屏幕）
    expect(src).toContain("maxH");
    expect(src).toContain("r.top - GAP - 12");
  });

  it("面板是浮层不是抽屉：fixed 定位、没有全屏遮罩", () => {
    const panel = stripComments(
      readFileSync(new URL("../DesignSystemPanel.tsx", import.meta.url), "utf8")
    );
    expect(panel).toContain("sliderule-design-panel");
    /**
     * ⚠ 用户原话「不是抽屉那种」。抽屉的特征是**整屏遮罩 + 贴边全高**——
     * 那会把正在跑的应用整个盖住，而用户改配色时正要看着它。
     * 加回 inset-0 遮罩或贴边全高，下面必红。
     *
     * ⚠ 位置断言删了：它写死过 `fixed right-4` → `fixed right-[300px]`，
     *   两轮各红一次。面板的位置现在由 Rail 那一行决定（见上一条用例），
     *   在这里再钉一遍具体坐标，只会在每次挪位置时假红。
     */
    expect(panel).not.toContain("inset-0");
    expect(panel).not.toMatch(/right-0[^"]*h-full/);
    // 可新建保存
    expect(panel).toContain("saveCustomDesignSystem");
    expect(panel).toContain("sliderule-design-panel-apply");
  });

  it("Provider 在页面根，Rail 由作曲家挂（要拿按钮的 rect 定位）", () => {
    const page = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    expect(page).toContain("<DesignSystemPanelProvider>");
    const src = dock();
    expect(src).toContain("<DesignSystemRail anchorRef={designAnchorRef} />");
    expect(src).toContain("ref={designAnchorRef}");
  });

  it("面板是 Rail 那一行的第二列，自己不再定位", () => {
    const panel = stripComments(
      readFileSync(new URL("../DesignSystemPanel.tsx", import.meta.url), "utf8")
    );
    expect(rail()).toContain("w-[272px]");
    expect(panel).toContain("w-[300px]");
    /**
     * ⚠ 面板自己再挂 fixed / absolute 就会脱离那一行，又回到"面板离清单半个
     * 屏幕"的老样子（2026-08-25 第二轮就是这么错的）。位置只能由 Rail 决定。
     */
    expect(panel).not.toMatch(/\bfixed\b/);
    expect(panel).not.toMatch(/\babsolute\b/);
  });
});

describe("④ 点预设不消失，点应用一起消失", () => {
  it("点预设只开面板：不关清单、也不落选中态", () => {
    const src = rail();
    expect(src).toContain("panel.openView(sys.id)");
    /**
     * ⚠ 用户第 2 条「点击预设不消失」。而且**不能顺手落库**：点着看几套的
     * 过程中每点一下都改掉下一轮真正会用的那套，等于没有"预览"这回事。
     * 落库归「应用」。清单里出现 apply/saveDesignSystemId 必红。
     */
    expect(src).not.toContain("panel.apply(");
    expect(src).not.toContain("saveDesignSystemId");
    expect(src).not.toContain("closeAll");
  });

  it("点预设不关清单：openView 反而把 menuOpen 顶成 true", () => {
    const ctx = stripComments(
      readFileSync(
        new URL("../DesignSystemContext.tsx", import.meta.url),
        "utf8"
      )
    );
    const at = ctx.indexOf("const openView");
    expect(ctx.slice(at, at + 320)).toContain("setMenuOpen(true)");
  });

  it("「应用」清单和面板一起收，不是只收面板", () => {
    const panel = stripComments(
      readFileSync(new URL("../DesignSystemPanel.tsx", import.meta.url), "utf8")
    );
    const at = panel.indexOf("const apply =");
    const body = panel.slice(at, at + 420);
    expect(body).toContain("panel.apply(sys.id)");
    expect(body).toContain("panel.closeAll()");
    // 反向：只 close() 会留下开着的清单，看着像没生效
    expect(body).not.toMatch(/panel\.close\(\)/);
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
