/**
 * 缩略图接在真跑的那条链路上（CLAUDE.md §1 / §3）。
 *
 * §3「闸全绿但东西没了」在这一块的具体形态：
 *   `useProjectThumbnail` 单测全绿、`resultCardModel` 单测全绿，
 *   而 `projectId` 在 SlideRule → ClaudeChatSurface → TurnResultCard
 *   这一路上**断在任何一节**，缩略图都永远是 null——不报错、不告警。
 *
 * 所以这里钉的不是函数对不对，是**传参真的一路传到了底**。
 * 判据扫的是剥掉注释的源码：注释里写「projectId」不算数（§2 踩过）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const read = (relative: string) =>
  stripComments(readFileSync(resolve(__dirname, relative), "utf8"));

const PAGE = read("../../SlideRule.tsx");
const CARD = read("../TurnResultCard.tsx");

/**
 * 取某个 JSX 元素**自己那段开标签**。
 *
 * ⚠ 2026-09-14 第一版判据是「整页里 match 得到 projectId={sessionState.projectId}」，
 *   变异测试当场打脸：把 ClaudeChatSurface 那一节的 projectId 删掉，判据**照样绿**——
 *   因为同一页的 <SlideRuleStudio 上也有一个同样的字面量。这正是 §2 那条
 *   「判据没被变异咬住就是没用」。所以必须按调用点切。
 */
function openingTag(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`);
  expect(start, `${tag} 的调用点必须在`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${tag} 的开标签没闭合`);
}

describe("projectId 一路传到结果卡", () => {
  it("SlideRule 把会话里的 projectId 交给聊天面（钉在 ClaudeChatSurface 那一节）", () => {
    expect(openingTag(PAGE, "ClaudeChatSurface")).toMatch(
      /projectId=\{sessionState\.projectId\}/
    );
  });

  it("聊天面把它交给结果卡（钉在 TurnResultCard 那一节）", () => {
    expect(openingTag(PAGE, "TurnResultCard")).toMatch(/projectId=\{/);
  });

  it("结果卡真的调了 hook，并且把结果喂进了 resultCardModel", () => {
    expect(CARD).toMatch(/useProjectThumbnail\(/);
    // 反向：调了但不用，等于没调。thumbnailUrl 必须落到 model 里。
    const start = CARD.indexOf("resultCardModel(");
    expect(start).toBeGreaterThanOrEqual(0);
    const call = CARD.slice(start, start + 400);
    expect(call).toMatch(/thumbnailUrl:\s*thumbnailUrl\s*\|\|\s*verified/);
  });

  it("只在工程档取缩略图：HTML 推演档没有验收产物，不该白发一次请求", () => {
    const start = CARD.indexOf("useProjectThumbnail(");
    const call = CARD.slice(start, CARD.indexOf(")", start) + 1);
    expect(call).toMatch(/runtimeKind\s*===\s*"project"/);
  });

  it("反向：拿不到缩略图整块不画，不许挂占位图", () => {
    const start = CARD.indexOf("data-testid=\"turn-result-thumb\"");
    expect(start).toBeGreaterThanOrEqual(0);
    const block = CARD.slice(Math.max(0, start - 400), start);
    expect(block).toMatch(/model\.thumbnailUrl\s*\?/);
    // 占位图的两种常见凑法，一种都不许有。
    expect(CARD).not.toMatch(/placeholder\.(png|svg|jpg)/i);
    expect(CARD).not.toMatch(/src=\{model\.thumbnailUrl\s*\|\|/);
  });
});
