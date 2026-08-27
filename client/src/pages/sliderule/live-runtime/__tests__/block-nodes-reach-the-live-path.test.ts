/**
 * 刀 2 **真的接在通电的那条链路上**吗（2026-08-27）。
 *
 * 纯函数那两组（block-node-fit 17 条、block-node-layout 18 条）全绿，但把
 * ArtboardNode/舞台里的挂载点删掉照样全绿——它们只直接调纯函数。这个文件
 * 补缺的那一半，形状同 `block-rects-reaches-the-live-path.test.ts`。
 *
 * ⚠ 判据先剥注释：这份实现里 `BlockNode`、`fitBlockNodes`、`crop` 在中文
 *   注释里出现得比在代码里还多。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
function read(rel: string): string {
  return stripComments(readFileSync(resolve(__dirname, rel), "utf8"));
}

const STAGE = read("../SpecPageCanvasStage.tsx");
const LAYOUT = read("../block-node-layout.ts");

describe("块节点真的挂上了画布", () => {
  it("注册了 block 这个节点类型（不注册的话 React Flow 静默不渲染）", () => {
    expect(STAGE).toMatch(/nodeTypes\s*=\s*\{[^}]*block:\s*BlockNode/s);
  });

  it("造了块节点，并且用的是 layoutBlockNodes 算出来的盒子", () => {
    expect(STAGE).toContain("layoutBlockNodes(");
    expect(STAGE).toMatch(/type:\s*"block"/);
  });

  it("降级阶梯真的接上了：live 来自 fitBlockNodes 的结果", () => {
    // 只调不接 = 阶梯白算，所有块都真渲染，块一多就卡死。
    expect(STAGE).toContain("fitBlockNodes(");
    expect(STAGE).toContain("blockFit.live.has(b.key)");
  });

  it("归属线（块 → 它所属的整页）挂了出去", () => {
    expect(STAGE).toMatch(/id:\s*`own:\$\{b\.key\}`/);
    expect(STAGE).toContain("source: `block:${b.key}`");
  });

  it("块节点带常挂的 Handle（没有把手 React Flow 画不出这条边）", () => {
    // 画板那边头注记过同一个坑（控制台 #008）。
    expect(STAGE).toMatch(/<Handle[\s\S]{0,200}position=\{Position\.Left\}/);
  });
});

describe("用户裁决落到代码上", () => {
  it("块**不可拖**（页组框可拖不受影响）", () => {
    // 用户原话：「建议页组框能拖、块不能」。块没有自己的位置，
    // 它的位置是画板位置推出来的。
    expect(STAGE).toMatch(/type:\s*"block"[\s\S]{0,400}draggable:\s*false/);
  });

  it("块节点是**真渲染**（裁整页 iframe），不是静态截图", () => {
    // 用户原话：「真渲染真渲染」。
    expect(STAGE).toMatch(/live\s*\?\s*\([\s\S]{0,900}<HtmlAppSurface/);
  });
});

describe("反向判据", () => {
  it("裁剪的内层盒子用**页面原尺寸**，不是缩放后的尺寸", () => {
    // ⚠ 2026-08-27 真机：写成 `board.w * scale` 等于改 iframe 尺寸，
    //   页面按新宽度重新响应式布局，裁出来的是别处的内容——而块框位置
    //   还是对的，所以两件事各自都"看着正常"。
    expect(STAGE).toMatch(/width:\s*board\.w,\s*\n\s*height:\s*board\.h,/);
    expect(STAGE).not.toContain("width: board.w * box.crop.scale");
  });

  it("缩放走 transform，且 scale 在 translate **之前**", () => {
    // CSS 右结合：先 translate（设计坐标）再 scale，最终位移正好 -left*s。
    // 写反了会少乘一次 scale，块整体偏出去。
    expect(STAGE).toMatch(
      /transform:\s*`scale\(\$\{box\.crop\.scale\}\)\s*translate\(/
    );
  });

  it("裁剪位移是设计坐标——布局侧不许先乘一遍 scale", () => {
    expect(LAYOUT).toMatch(/left:\s*b\.rect\.left,/);
    expect(LAYOUT).not.toContain("left: b.rect.left * scale");
  });

  it("视口判定复用 shouldMountBoard，不另写一套", () => {
    // 画板和块用两套可见性规则的话，某个缩放档会出现"画板挂着而它的块
    // 全静态"这种自相矛盾的画面，且不报错。
    expect(STAGE).toMatch(/inViewport:\s*shouldMountBoard\(/);
  });

  it("开条带时画板多留列间距（否则条带盖住右边那列）", () => {
    expect(STAGE).toContain("BLOCK_STRIP_EXTRA_GAP_X");
  });

  it("阶梯档位暴露成可读事实（rung 不是装饰）", () => {
    // 截图上"全量真渲染"和"降到全静态"长得差不多，只有档位读得出区别。
    expect(STAGE).toContain("data-block-fit-rung");
    expect(STAGE).toContain("data-block-fit-live");
  });

  it("「当前页」要在页清单里校验过（宿主可能传来不存在的页）", () => {
    // 真机量到过：宿主传 "home"，这套应用里没有这一页，
    // 第 2 档筛出 0 块 —— 24 个节点全静态，看着像阶梯坏了。
    expect(STAGE).toContain("known.has(id)");
  });

  it("静态卡里的字**不反缩放**（外面那行标签才反缩放）", () => {
    // 真机 17% 全景：`12 * inv` = 70 画布单位，比矮块本身还高，直接溢出。
    expect(STAGE).not.toMatch(
      /sliderule-canvas-block-node-static[\s\S]{0,400}fontSize:\s*\d+\s*\*\s*inv/
    );
  });
});
