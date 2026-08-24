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
  it("清单在右侧栏里，不再挂在作曲家的 DOM 上", () => {
    /**
     * ⚠ 2026-08-25 第二轮用户原话「显示在右侧」。上一版清单是作曲家里的下拉，
     * 跟着作曲家浮在**对话栏上方**，跟最右的面板隔半个屏幕。判据两面都钉：
     * 清单在 Rail 里（正向）、作曲家里不再有清单（反向）。搬回去必红。
     */
    expect(rail()).toContain("sliderule-design-system-menu");
    expect(rail()).toContain("sliderule-design-system-new");
    expect(rail()).toContain("panel.openNew()");
    const src = dock();
    expect(src).not.toContain("sliderule-design-system-menu");
    expect(src).not.toContain("designList.map");
  });

  it("面板是浮层不是抽屉：fixed 定位、没有全屏遮罩", () => {
    const panel = stripComments(
      readFileSync(new URL("../DesignSystemPanel.tsx", import.meta.url), "utf8")
    );
    expect(panel).toContain("sliderule-design-panel");
    expect(panel).toContain("fixed right-[300px]");
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

  it("右侧栏挂在页面根，不是舞台里（首页没有舞台）", () => {
    const page = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    expect(page).toContain("<DesignSystemPanelProvider>");
    expect(page).toContain("<DesignSystemRail />");
    // 反向：不许被塞进 chromeSlot（那条槽只在有舞台时渲染）
    const at = page.indexOf("<DesignSystemRail />");
    expect(page.slice(at - 400, at)).not.toContain("chromeSlot");
  });

  it("面板在清单左边，两块不重叠", () => {
    const panel = stripComments(
      readFileSync(new URL("../DesignSystemPanel.tsx", import.meta.url), "utf8")
    );
    // 清单 right-4 宽 272 → 面板右边界必须让开它
    expect(rail()).toContain("right-4");
    expect(rail()).toContain("w-[272px]");
    expect(panel).toContain("right-[300px]");
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
