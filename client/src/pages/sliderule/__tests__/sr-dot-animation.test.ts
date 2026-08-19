/**
 * 思考点动画。正向：SpinKit 那两行（both + 负 delay）。
 * 反向：调用点再写正 delay 会盖掉 CSS——三颗又齐钉。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function css(): string {
  return stripComments(
    readFileSync(new URL("../../../index.css", import.meta.url), "utf8")
  );
}

describe("sr-dot thinking animation", () => {
  it("用 both + 负 delay，不靠正 delay 等第一拍", () => {
    const src = css();
    const block = src.slice(src.indexOf(".sr-dot"));
    expect(block, "sr-dot 规则不见了").toMatch(/\.sr-dot\s*\{/);
    expect(src).toMatch(/sr-dot-bounce[^;]*\bboth\b/);
    expect(src).toMatch(/animation-delay:\s*-0\.32s/);
    expect(src).toMatch(/animation-delay:\s*-0\.16s/);
    const base = src.match(/\.sr-dot\s*\{[^}]+\}/)?.[0] ?? "";
    expect(base).not.toMatch(/animation-delay/);
  });

  it("左栏和右舞台都走 sr-dot，且不内联正 delay", () => {
    const chat = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const studio = stripComments(
      readFileSync(
        new URL("../SlideRuleStudio.tsx", import.meta.url),
        "utf8"
      )
    );
    expect(chat).toContain("sr-dot");
    expect(studio).toContain("sr-dot");
    expect(chat).not.toMatch(/animationDelay/);
    expect(studio).not.toMatch(/animationDelay/);
    expect(chat).not.toMatch(/animation-delay:\s*\d/);
  });
});
