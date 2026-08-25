/**
 * 画布档**真的接在通电的那条链路上**吗。
 *
 * ## 这个文件为什么存在
 *
 * 本仓第一条纪律（"动手之前先确认哪条链真的在跑"）与第三条（"正向判据齐全、
 * 反向判据缺失"）在这次改动上同时适用：
 *
 *   · SpecPageCanvasStage 自己渲染得再对，没被 SlideRuleStudio 挂上去就是零；
 *   · 顶栏多一片「画布」按钮，不代表点了之后舞台真的换成画布；
 *   · 画布拿到页面了，不代表拿的是**跟页面档同一份**页面。
 *
 * 前两条组件层测不到（SlideRuleStudio 在 jsdom 里要拖起整条推演外壳、
 * SpecPageCanvasStage 要 React Flow 的真实布局与 iframe），所以判据落在
 * **剥掉注释之后的源码**上——这份文件里到处写着 "canvas"、"画布"，
 * 不剥注释的话把实现整段删了判据照样绿（本仓踩过：判据 grep 的标识符
 * 同时出现在文档字符串里）。
 *
 * 第三条落在 livePagesFromSpec 的真实行为上，是个正经单测。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { livePagesFromSpec } from "../spec-live-pages";

/** 剥注释再查：本文件与被查文件里都有大段中文注释提到这些词。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const STUDIO = stripComments(
  readFileSync(resolve(__dirname, "../SlideRuleStudio.tsx"), "utf8")
);

describe("画布档接在 SlideRuleStudio 上（而不是只写了个组件）", () => {
  it("统一页主布局真的挂了 SpecPageCanvasStage", () => {
    // ⚠ 这条**必须**查 JSX 挂载点，不是查 import。只 import 不渲染是
    //   本仓最经典的"装在不通电的插座上"。
    expect(STUDIO).toContain("<SpecPageCanvasStage");
  });

  it("顶栏档位组里有「画布」这一片，且排在「页面」左边", () => {
    const group = STUDIO.slice(
      STUDIO.indexOf('["canvas"'),
      STUDIO.indexOf('["code", "代码"]') + 20
    );
    expect(group).toContain('["canvas", "画布"]');
    expect(group.indexOf('["canvas"')).toBeLessThan(group.indexOf('["page"'));
  });

  it("按钮的档位值与舞台的渲染分支用的是同一个字面量", () => {
    // 只加按钮不加分支 → 点了没反应；只加分支不加按钮 → 永远进不去。
    // 两边都要在，且都得是 "canvas"。
    expect(STUDIO).toContain('["canvas", "画布"]');
    expect(STUDIO).toContain('stageView === "canvas"');
  });

  it("stageView 的联合类型里有 canvas（否则 TS 之外的分支是死代码）", () => {
    expect(STUDIO).toMatch(/useState<[^>]*"canvas"[^>]*>/);
  });

  it("画布喂的是 displayPages —— 跟页面档同一份，不是 livePages", () => {
    /**
     * ⚠ 这条是本仓第四条纪律的具象化。点选编辑存过的页在 pageOverrides
     *   里，displayPages 叠了覆盖层、livePages 没有。喂错的话画布显示改之前、
     *   页面档显示改之后：**同一个产物两个档位两种内容，而且不报错**。
     */
    const canvasJsx = STUDIO.slice(
      STUDIO.indexOf("<SpecPageCanvasStage"),
      STUDIO.indexOf("<SpecPageCanvasStage") + 900
    );
    expect(canvasJsx).toContain("pages={displayPages}");
    expect(canvasJsx).not.toContain("pages={livePages}");
  });

  it("画布外面套了防崩溃气囊（增强类必须 fail-open）", () => {
    const around = STUDIO.slice(
      Math.max(0, STUDIO.indexOf("<SpecPageCanvasStage") - 400),
      STUDIO.indexOf("<SpecPageCanvasStage")
    );
    expect(around).toContain("<AppStageErrorBoundary");
  });

  it("画布的选中页回喂给 activeSpecPageId —— 透视面板才跟得住", () => {
    const canvasJsx = STUDIO.slice(
      STUDIO.indexOf("<SpecPageCanvasStage"),
      STUDIO.indexOf("<SpecPageCanvasStage") + 900
    );
    expect(canvasJsx).toContain("onActivePageChange={setActiveSpecPageId}");
    expect(canvasJsx).toContain("activePageId={activeSpecPageId}");
  });
});

describe("画板标题的数据真的送到了（不是只在类型里加了个字段）", () => {
  const spec = {
    pages: {
      p1: "<html><body>甲</body></html>",
      p2: "<html><body>乙</body></html>",
    },
    navItems: [
      { id: "p1", name: "团长工作台" },
      { id: "p2", name: "订单核销页" },
    ],
    device: "desktop" as const,
  };

  it("落库那条把导航里的人话名带进 SpecPageLive.name", () => {
    // ⚠ 反向判据：name 以前**算出来了但只喂给 missingPageHtml 就丢掉**。
    //   把 spec-live-pages.ts 里那行 `name,` 删掉，这条必须红。
    const pages = livePagesFromSpec(spec);
    expect(pages.map(p => p.name)).toEqual(["团长工作台", "订单核销页"]);
  });

  it("导航没提到的页不会凭空编一个名字", () => {
    const pages = livePagesFromSpec({
      pages: { pX: "<html><body>x</body></html>" },
      navItems: [],
      device: "desktop",
    });
    expect(pages[0]!.name).toBe("pX");
  });

  it("缺页也带名字——画布上要如实标出「未通过校验」的是哪一页", () => {
    const pages = livePagesFromSpec({
      pages: { p1: "<html><body>甲</body></html>", p2: "" },
      navItems: [
        { id: "p1", name: "团长工作台" },
        { id: "p2", name: "订单核销页" },
      ],
      device: "desktop",
    });
    const missing = pages.find(p => p.missing);
    expect(missing?.name).toBe("订单核销页");
  });
});
