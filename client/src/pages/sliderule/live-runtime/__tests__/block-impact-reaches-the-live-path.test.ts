/**
 * 刀 4 **真的接在通电的那条链路上**吗（2026-08-27）。
 *
 * `block-impact.test.ts` 20 条全绿，但把舞台里造边那段删掉照样全绿——纯函数
 * 算得再对，边没进 React Flow 就是零。
 *
 * ⚠ 判据先剥注释（本仓踩过：grep 的标识符同时出现在文档字符串里）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const STAGE = stripComments(
  readFileSync(resolve(__dirname, "../SpecPageCanvasStage.tsx"), "utf8")
);
const IMPACT = stripComments(
  readFileSync(resolve(__dirname, "../block-impact.ts"), "utf8")
);

describe("影响线真的挂上了画布", () => {
  it("扫了源 HTML 并造了边", () => {
    expect(STAGE).toContain("scanBlockBindings(");
    expect(STAGE).toContain("buildImpactEdges(");
  });

  it("造出来的边真的并进了 edges（不是算完就扔）", () => {
    expect(STAGE).toMatch(/return\s*\[\s*\.\.\.ownership,\s*\.\.\.linkEdges,\s*\.\.\.impact/);
  });

  it("影响面只依赖 pages —— **不跟几何世代号走**", () => {
    // 刀 1 分两条世代号的全部理由：绑定关系跟视口/缩放/画板位置无关。
    // 跟着几何走的话每次平移都要重扫五页 HTML。
    const m = STAGE.match(
      /const impactEdges = React\.useMemo\([\s\S]{0,400}?\}, \[([^\]]*)\]\)/
    );
    expect(m).not.toBeNull();
    expect(m![1].trim()).toBe("pages");
  });
});

describe("⚠ 两类线必须分色分虚实", () => {
  it("四种关系各有各的样式，且同源字段是**虚线**", () => {
    // 风险台账 #03：画成一样的线，用户会以为改一处自动同步了。
    expect(STAGE).toContain("IMPACT_STYLE");
    for (const k of ["nav", "action", "asset", "field"]) {
      expect(STAGE).toMatch(new RegExp(`${k}:\\s*\\{\\s*stroke:`));
    }
    expect(STAGE).toMatch(/field:\s*\{[^}]*strokeDasharray/);
  });

  it("真联动的三类**不是**虚线（跟同源字段区分得开）", () => {
    for (const k of ["nav", "action", "asset"]) {
      const m = STAGE.match(new RegExp(`${k}:\\s*\\{([^}]*)\\}`));
      expect(m).not.toBeNull();
      expect(m![1]).not.toContain("strokeDasharray");
    }
  });

  it("真联动的口径只有一份（isRealLinkage），舞台不自己再判一遍", () => {
    // CLAUDE.md 第四条：同一件事两处实现必然分叉。
    expect(STAGE).toContain("isRealLinkage(");
    expect(STAGE).not.toMatch(/kind\s*!==\s*"field"/);
  });
});

describe("反向判据", () => {
  it("两端都没有节点的边不画（否则白算一场，React Flow 静默丢掉）", () => {
    expect(STAGE).toContain("blockNodeIds.has(");
  });

  it("nav 类的终点是**画板**，其余是块节点", () => {
    // nav 是页面级跳转，落在那一页的画板上；写成块节点会永远匹配不上。
    expect(STAGE).toMatch(/e\.kind === "nav"\s*\?\s*e\.to\s*:\s*`block:\$\{e\.to\}`/);
  });

  it("块条带关着时不画影响线", () => {
    expect(STAGE).toMatch(/const impact: Edge\[\] = blocksShown/);
  });

  it("孤岛块回空集不是 null（「无影响」不是「未计算」）", () => {
    // 风险台账 #05。真机基线 15 块里有 7 块挂不上绑定。
    expect(IMPACT).toContain("const real = new Set<string>();");
    expect(IMPACT).not.toMatch(/return\s*\{\s*real:\s*null/);
  });

  it("跳到自己这一页的不画（否则几十条自环）", () => {
    expect(IMPACT).toContain("if (target === b.pageId) continue;");
  });
});
