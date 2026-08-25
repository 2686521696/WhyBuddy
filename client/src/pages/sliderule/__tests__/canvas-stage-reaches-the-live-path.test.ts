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

/**
 * 第二轮（连线 / 属性面板 / 右键菜单 / 素材图）的链路判据。
 *
 * 同样是**剥注释后查源码**：这四件事的实现文件里到处写着自己的名字，
 * 不剥注释的话把 JSX 整段删了判据照样绿。
 */
const CANVAS = stripComments(
  readFileSync(
    resolve(__dirname, "../live-runtime/SpecPageCanvasStage.tsx"),
    "utf8"
  )
);

describe("四件新东西真的挂在画布上（不是各写了个组件）", () => {
  it("属性面板与右键菜单都被画布渲染", () => {
    expect(CANVAS).toContain("<CanvasInspector");
    expect(CANVAS).toContain("<CanvasBoardMenu");
  });

  it("边真的喂给了 ReactFlow —— 不是算出来放着不用", () => {
    // ⚠ 只算不喂是本仓最经典的形状。判据要落在 `edges={edges}` 这个挂载点上。
    expect(CANVAS).toContain("edges={edges}");
    expect(CANVAS).toContain("deriveDataflowLinks(");
    expect(CANVAS).toContain("onConnect=");
  });

  it("素材节点真的进了 nodes（同上）", () => {
    expect(CANVAS).toContain("extractPageAssets(");
    expect(CANVAS).toContain("layoutAssets(");
    expect(CANVAS).toMatch(/nodeTypes\s*=\s*\{\s*artboard:[^}]*asset:/);
  });

  it("连线把手常挂，不是「连线态才渲染」", () => {
    /**
     * ⚠ 反向判据。把手不在时 React Flow 算不出边的起终点，已有的边直接
     *   画不出来（控制台 #008）。写成 `{linkMode && <Handle …>}` 会让
     *   "关掉连线态之后连线全部消失"——而且不报错。
     */
    expect(CANVAS).toContain("isConnectable={ctx?.linkMode ?? false}");
    expect(CANVAS).not.toMatch(/linkMode\s*&&\s*<Handle/);
  });

  it("把手的 zIndex 在（不是样式，是功能）", () => {
    // 手势层 absolute inset-0 排在把手后面，不提 zIndex 的话把手看得见
    // 却按不下去——真机 L2「拖出一条连线」就是这么失败的。
    const handleBlock = CANVAS.slice(
      CANVAS.indexOf("isConnectable={ctx?.linkMode ?? false}"),
      CANVAS.indexOf("isConnectable={ctx?.linkMode ?? false}") + 400
    );
    expect(handleBlock).toContain("zIndex: 10");
  });

  it("四条边的把手都在，且边按几何挑边（不是写死右出左进）", () => {
    expect(CANVAS).toContain("pickLinkSides(");
    expect(CANVAS).toContain("sourceHandle: sides.source");
    expect(CANVAS).toContain("targetHandle: sides.target");
    expect(CANVAS).not.toContain('sourceHandle: "s"');
  });

  it("「重新生成」与「写进页面」走的是已有的 fill-prompt 事件，且**只填不发**", () => {
    /**
     * ⚠ 这条同时钉两件事：
     *   1. 复用既有链路（不新造 prop），
     *   2. **不许自动开跑**——一轮推演是几分钟 + 真金白银的 token。
     *      出现任何直接提交的调用（submit/send/run）都该让这条红。
     */
    expect(CANVAS).toContain('"sliderule:fill-prompt"');
    expect(CANVAS).toContain("linkToRefineInstruction(");
    const filler = CANVAS.slice(
      CANVAS.indexOf("function fillComposer"),
      CANVAS.indexOf("function fillComposer") + 300
    );
    expect(filler).not.toMatch(/submit|sendMessage|runTurn|drive/i);
  });

  it("手画连线按会话存档（宿主传了 sessionId）", () => {
    expect(CANVAS).toContain("manualLinksStorageKey(sessionId)");
    expect(STUDIO).toContain("sessionId={sessionId}");
  });

  it("导出两种都在，且 PNG 复用仓里那条采集链路", () => {
    expect(CANVAS).toContain("exportBoardPng(");
    expect(CANVAS).toContain("exportBoardHtml(");
    const exportSrc = stripComments(
      readFileSync(
        resolve(__dirname, "../live-runtime/canvas-board-export.ts"),
        "utf8"
      )
    );
    // ⚠ 别在这儿另写一份 snapdom 调用：dpr/embedFonts/backgroundColor/fast
    //   四个参数是 thumb-capture 踩出来的。
    expect(exportSrc).toContain("captureNodeToCanvas");
    expect(exportSrc).not.toContain("snapdom");
  });

  it("导出失败要说话——fail-open 不等于静静地什么都不发生", () => {
    const exportBlock = CANVAS.slice(
      CANVAS.indexOf("const doExportPng"),
      CANVAS.indexOf("const doExportPng") + 600
    );
    expect(exportBlock).toContain("setToast");
    expect(exportBlock).toMatch(/ok \?/);
  });

  it("右键菜单**没有**「删除」——画板不是用户放上去的图元", () => {
    /**
     * ⚠ 参考工具的菜单第四项是「删除」。这里有意不做：在画布上"删掉"一页，
     *   删的到底是画布上的显示（假的，刷新就回来）还是 pages_json 里那一页
     *   （破坏性动作，不该藏在右键菜单第四项）？宁可没有。
     *   哪天真要加，先想清楚删的是哪一个，再回来改这条判据。
     */
    const menu = stripComments(
      readFileSync(
        resolve(__dirname, "../live-runtime/CanvasBoardMenu.tsx"),
        "utf8"
      )
    );
    expect(menu).not.toContain('label="删除"');
    expect(menu).toContain('label="导出 PNG"');
    expect(menu).toContain('label="重新生成这一页…"');
  });
});

/* ================================================== 换图接在通电的链路上吗 */

const STAGE = stripComments(
  readFileSync(
    resolve(__dirname, "../live-runtime/SpecPageCanvasStage.tsx"),
    "utf8"
  )
);
const PANEL = stripComments(
  readFileSync(
    resolve(__dirname, "../live-runtime/AssetReplacePanel.tsx"),
    "utf8"
  )
);
const ROUTES = readFileSync(
  resolve(
    __dirname,
    "../../../../../slide-rule-python/routes/sliderule_full.py"
  ),
  "utf8"
).replace(/"""[\s\S]*?"""/g, "");

describe("换图：纯函数之外，链路真的接上了吗", () => {
  it("画布真的挂了换图面板（不是只写了个组件）", () => {
    expect(STAGE).toContain("<AssetReplacePanel");
  });

  it("换图**真的写回库**——调用点在，且走既有的 updateAppPage", () => {
    // ⚠ 这条钉的是本仓最贵的那条纪律。planAssetReplacement 算得再对，
    //   不落库就只是把画布上的图换了个样子，刷新即打回原形。
    expect(STAGE).toContain("planAssetReplacement(");
    expect(STAGE).toContain("updateAppPage(");
    // 反向：不许自己另起一条 PATCH（那就是同一件事两处实现）
    expect(STAGE).not.toMatch(/method:\s*["']PATCH["']/);
  });

  it("落库成功**真的**回调宿主刷新覆盖层", () => {
    // 少了这一步：库里换了，画布还显示旧图 —— "存了但看着没变"
    // 跟"根本没存上"在屏幕上长得一模一样。
    expect(STAGE).toContain("onPagesReplaced?.(saved)");
  });

  it("Studio 真的把 appId 和覆盖层回调传下去了", () => {
    const call = STUDIO.slice(
      STUDIO.indexOf("<SpecPageCanvasStage"),
      STUDIO.indexOf("<SpecPageCanvasStage") + 1600
    );
    expect(call).toContain("appId={boundAppId}");
    expect(call).toContain("onPagesReplaced=");
    // 反向：回调必须真的写进 pageOverrides，不是个空函数
    expect(call).toContain("setPageOverrides");
  });

  it("面板真的调搜图接口（不是摆个搜索框不发请求）", () => {
    expect(PANEL).toContain("searchStockImages(");
    expect(PANEL).toContain("assetUseGroups(");
  });

  it("换图**不走 LLM**——不许偷偷接成一轮精修", () => {
    // 换 src 是纯字符串替换。接成精修 = 几分钟 + 真金白银的 token，
    // 还可能顺手把整页重写了。
    expect(STAGE).not.toContain("fillComposer(`把这张图");
    expect(PANEL).not.toContain("fill-prompt");
    expect(PANEL).not.toContain("ai-edit-element");
  });

  it("搜图路由真的调了服务函数，且只读不落库", () => {
    expect(ROUTES).toContain("search_replacement_images");
    const route = ROUTES.slice(
      ROUTES.indexOf('@router.post("/stock-images/search")'),
      ROUTES.indexOf('@router.post("/stock-images/search")') + 2000
    );
    expect(route).toContain("_auth(x_internal_key)");
    // 反向：搜图这条**不许**碰 pages_json（写回是 PATCH 那条的事）
    expect(route).not.toContain("update_page_html");
  });

  it("没有 appId 时不摆那颗按钮（而不是摆一颗点了报错的）", () => {
    expect(STAGE).toContain(
      "appId ? (a: CanvasAsset) => setReplacingUrl(a.url) : null"
    );
    expect(STAGE).toContain("ctx?.onReplaceAsset ?");
  });
});

/* ============================================ 画布档锁死最大化：五个口子 */

const LAYOUT_CTX = stripComments(
  readFileSync(resolve(__dirname, "../StudioLayoutContext.tsx"), "utf8")
);
const SPLIT = stripComments(
  readFileSync(resolve(__dirname, "../StudioSplit.tsx"), "utf8")
);
const HUD = stripComments(
  readFileSync(resolve(__dirname, "../SlideRuleTopHud.tsx"), "utf8")
);

describe("画布档锁死最大化：掰开它的五个口子都堵上了吗", () => {
  it("Studio 真的在画布档上锁（不是只写了个 setter）", () => {
    expect(STUDIO).toContain('setMaximizeLocked(stageView === "canvas")');
  });

  it("口子1 顶栏最大化钮：置灰而不是按了没反应", () => {
    expect(HUD).toContain('maxIntent === "locked"');
    expect(HUD).toMatch(/disabled=\{[^}]*maxIntent === "locked"/);
    // 反向：锁的判定要从 context 来，不许顶栏自己按 stageView 猜一遍
    expect(HUD).toContain("studio?.maximizeLocked");
    expect(HUD).not.toContain('stageView === "canvas"');
  });

  it("口子2 分隔条上的折叠对话钮：锁住时置灰", () => {
    expect(SPLIT).toMatch(
      /disabled=\{collapsed\.stage \|\| layout\.maximizeLocked\}/
    );
  });

  it("口子3 拖分隔条：锁住时整条 handle 不许拖", () => {
    expect(SPLIT).toMatch(/disabled=\{phone \|\| layout\.maximizeLocked\}/);
  });

  it("口子4 双击还原：锁住时不展开对话栏", () => {
    const reset = LAYOUT_CTX.match(
      /const resetLayout[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(reset).toBeTruthy();
    expect(reset).toContain("if (!maximizeLocked) setChatCollapsed(false)");
  });

  it("口子5 隐藏页面再显示：锁住时不展开对话栏", () => {
    const toggle = LAYOUT_CTX.match(
      /const toggleStagePage[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(toggle).toBeTruthy();
    expect(toggle).toContain("if (!maximizeLocked) setChatCollapsed(false)");
  });

  it("两个 toggle 在锁住时直接 return，不靠 effect 事后扳回来", () => {
    // 靠 effect 兜底会先闪一下再弹回去，用户看到的是"抖了一下"。
    const chat = LAYOUT_CTX.match(
      /const toggleChat[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(chat).toContain("if (maximizeLocked) return");
    // toggleMaximize 要把锁**传进** maximizeIntent，而不是自己判一遍。
    // ⚠ 钉语义不钉换行：prettier 一跑格式就变，写死缩进的判据会假红。
    const max = LAYOUT_CTX.match(
      /const toggleMaximize[\s\S]*?},\s*\[[^\]]*\]\s*\)/
    )?.[0];
    expect(max).toBeTruthy();
    expect(max).toMatch(/maximizeIntent\([\s\S]*maximizeLocked[\s\S]*\)/);
  });

  it("兜底 effect 在**拥有 ref 的组件**里，且判定用纯函数", () => {
    /*
     * ⚠ 2026-08-25 真机：第一版把这个 effect 放在 StudioLayoutContext 上，
     *   首屏**一次都没执行**——Provider 的 effect 以 locked=true 跑时
     *   StudioSplit 还没挂载（画布要等页面数据），chatRef 是 null，
     *   之后依赖不再变就没有第二次。钮已置灰、对话栏还占半屏。
     *   所以这条判据钉的是"执行点在 StudioSplit"，不只是"有这么一段代码"。
     */
    expect(SPLIT).toContain(
      "needsMaximizeLockFix(collapsed, layout.maximizeLocked)"
    );
    expect(SPLIT).toContain("chatRef.current?.collapse()");
    // 反向：Provider 里不许再留一份（同一件事两处实现 = 半个锁）
    expect(LAYOUT_CTX).not.toContain("needsMaximizeLockFix");
  });

  it("解锁要还原成用户上锁前的选择，不是一律展开", () => {
    expect(LAYOUT_CTX).toContain("beforeLockRef");
    expect(LAYOUT_CTX).toContain(
      "if (before === false) chatRef.current?.expand()"
    );
  });
});

describe("画布台面：浅灰点阵 + 画板不带投影", () => {
  it("画板/素材卡用平框，不带模糊投影", () => {
    // ⚠ 页面档那份 STAGE_FRAME_SHADOW 是三层投影，跟 STAGE_FRAME_PAD 是一组
    //   联立不等式（见 stage-frame-style 头注），画布**不共用**它：一排画板
    //   平铺时每块都带三层投影，缩到 25% 会糊成一片灰边。
    expect(STAGE).toContain("STAGE_FRAME_FLAT");
    expect(STAGE).not.toContain("STAGE_FRAME_SHADOW");
  });

  it("点阵画在台面上，不跟缩放走", () => {
    // ⚠ React Flow 的 <Background> 跟 viewport 缩放走：画布常用 25%~57%，
    //   1.4px 的点缩到不足一个像素直接消失（真机量过，看着像"点阵没生效"）。
    expect(STAGE).toContain("backgroundSize:");
    expect(STAGE).not.toContain("<Background");
    expect(STAGE).not.toContain("BackgroundVariant");
  });
});
