/**
 * 舞台预览框的外观：三处画同一个框，且余量必须真的传下去。
 *
 * ⚠ 2026-08-24：这条测试防的是两种都不会报错的失效。
 *
 *   一、只改一处。SpecPageLiveStage / AppRuntimeScreen / ClickEditStage 之前
 *       各自硬编了一份一模一样的 `0 8px 32px rgba(60,50,30,0.18)`，改一处
 *       另两处静默不变。
 *   二、引了常量但没传 pad。这个更阴——阴影常量用上了、代码看着全对，但画布
 *       是 overflow:hidden，不扣余量的话 ring 和分层阴影会被整段切掉，
 *       屏幕上跟没改一样。真机量过：改之前 gapTop / gapBottom 都是 0。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const FRAMES = [
  [
    "SpecPageLiveStage.tsx",
    new URL("../SpecPageLiveStage.tsx", import.meta.url),
  ],
  ["AppRuntimeScreen.tsx", new URL("../AppRuntimeScreen.tsx", import.meta.url)],
  [
    "ClickEditStage.tsx",
    new URL(
      "../../../agent-loop/dashboard/ClickEditStage.tsx",
      import.meta.url
    ),
  ],
] as const;

describe("舞台预览框外观（stage-frame-style）", () => {
  it.each(FRAMES)("%s 用共用常量画框，不再硬编阴影", (_name, url) => {
    const src = stripComments(readFileSync(url, "utf8"));
    expect(src).toContain("STAGE_FRAME_SHADOW");
    expect(src).toContain("stage-frame-style");
    // 反向：旧的暖棕单层阴影一处都不许留下。任一处改回去必红。
    expect(src).not.toContain("rgba(60,50,30");
    expect(src).not.toContain("0 8px 32px");
  });

  it.each(FRAMES)(
    "%s 把余量真的传给了 useScaleToFit（否则 ring 会被切掉）",
    (_name, url) => {
      const src = stripComments(readFileSync(url, "utf8"));
      expect(src).toContain("STAGE_FRAME_PAD");
      // 光 import 不算数：必须出现在 useScaleToFit 的实参里。
      const at = src.indexOf("useScaleToFit(");
      expect(at).toBeGreaterThan(-1);
      const call = src.slice(at, at + 400);
      expect(call).toContain("STAGE_FRAME_PAD");
    }
  );

  it("桌面档是 ring + 分层，不是单层大模糊", async () => {
    const { STAGE_FRAME_SHADOW, STAGE_FRAME_PAD, PHONE_FRAME_SHADOW } =
      await import("../stage-frame-style");
    // ring：0 0 0 1px 那一层，负责把四条边（尤其顶边）定住
    expect(STAGE_FRAME_SHADOW).toContain("0 0 0 1px");
    // 分层：至少三个 rgba 停靠点，单层写法必红
    expect(
      STAGE_FRAME_SHADOW.match(/rgba\(/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(3);
    // 色相跟着壳底色走冷中性，不许回到暖棕
    expect(STAGE_FRAME_SHADOW).toContain("rgba(15,23,42");
    expect(STAGE_FRAME_SHADOW).not.toContain("rgba(60,50,30");
    // 手机档机身自带边界，不该再加 ring
    expect(PHONE_FRAME_SHADOW).not.toContain("0 0 0 1px");
    // 余量要够放下最远那层的外扩（48px 模糊 -16px 收缩 ≈ 16px）+ 24px 下偏
    expect(STAGE_FRAME_PAD.x).toBeGreaterThanOrEqual(24);
    expect(STAGE_FRAME_PAD.y).toBeGreaterThanOrEqual(STAGE_FRAME_PAD.x);
  });
});
