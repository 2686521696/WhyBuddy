/**
 * 产出体检的判据测试（2026-08-12）。
 *
 * 这条链路一直只有"对模型的门禁"，**对设计产出零检查**——真跑三个话题，律所
 * 那张首页把 5 个子列挤到 120px、中文标题竖着一字一行，测试全绿门禁全过。
 *
 * 三条判据的夹具都取自**真实产出量到的数**，不是编的：
 *   char-wrap    「案件名称 1」6 字 / 行高 22px / 高 66px → 3 行，每行 2 字
 *   text-clip    scrollWidth 226 vs clientWidth 120（impeccable 的 16px 阈值）
 *   low-contrast #bfbfbf 对白底 1.84:1（今天修掉的那处 11px 提示文字）
 *
 * 每条都配反向断言：健康形态必须**一处都不报**。判据太松等于没开，太紧会让
 * 报告变成噪音、没人看——两头都要钉。
 */
import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  detectCharWrap,
  detectDesignDefects,
  detectLowContrast,
  detectTextClip,
  requiredContrast,
  summarizeDefects,
  type MeasuredNode,
  type MeasuredSnapshot,
} from "../design-defect-detector";

const BASE: MeasuredNode = {
  selector: "div.card",
  tag: "div",
  ownText: "",
  rect: { x: 0, y: 0, width: 300, height: 24 },
  display: "block",
  flexDirection: "row",
  overflowX: "visible",
  overflow: "visible",
  fontSizePx: 14,
  fontWeight: 400,
  lineHeightPx: 22,
  color: { r: 38, g: 38, b: 38 }, // #262626
  effectiveBackground: { r: 255, g: 255, b: 255 },
  scrollWidth: 300,
  clientWidth: 300,
  insideScrollRegion: false,
  visuallyHidden: false,
};

const node = (over: Partial<MeasuredNode> = {}): MeasuredNode => ({ ...BASE, ...over });
const snap = (nodes: MeasuredNode[]): MeasuredSnapshot => ({
  viewport: { width: 1440, height: 1000 },
  nodes,
});

// ── ① 逐字换行 ───────────────────────────────────────────────────────
describe("char-wrap：列被挤到放不下一个词", () => {
  it("逮住真实产出那个形态：6 字挤成 3 行", () => {
    // 律所首页「案件名称 1」量到的：容器 120px、行高 22、总高 66
    const d = detectCharWrap(snap([
      node({ selector: "strong.title", tag: "strong", ownText: "案件名称 1",
             rect: { x: 0, y: 0, width: 120, height: 66 } }),
    ]));
    expect(d).toHaveLength(1);
    expect(d[0].id).toBe("char-wrap");
    expect(d[0].severity).toBe("critical");
    expect(d[0].message).toContain("3 行");
    expect(d[0].message).toContain("120px");
  });

  it("正常换行不报 —— 判据不许扩大化", () => {
    // 同一句话在 400px 里换 2 行：每行 3 字，仍在阈值之上
    expect(detectCharWrap(snap([
      node({ ownText: "案件名称 1", rect: { x: 0, y: 0, width: 400, height: 44 } }),
    ]))).toEqual([]);
    // 单行的一律不判
    expect(detectCharWrap(snap([
      node({ ownText: "案件名称 1", rect: { x: 0, y: 0, width: 400, height: 22 } }),
    ]))).toEqual([]);
  });

  it("太短的串不判：两三个字本来就可能一行一个", () => {
    expect(detectCharWrap(snap([
      node({ ownText: "已选", rect: { x: 0, y: 0, width: 20, height: 44 } }),
    ]))).toEqual([]);
  });

  it("行高取不到就跳过 —— 推不出行数时宁可漏报", () => {
    expect(detectCharWrap(snap([
      node({ ownText: "案件名称 1", lineHeightPx: 0,
             rect: { x: 0, y: 0, width: 120, height: 66 } }),
    ]))).toEqual([]);
  });
});

// ── ② 文字被裁 ───────────────────────────────────────────────────────
describe("text-clip：文字超出盒子且无处可滚", () => {
  it("超出 ≥16px 且没有可滚祖先 → 报", () => {
    const d = detectTextClip(snap([
      node({ ownText: "很长的一行说明文字", scrollWidth: 226, clientWidth: 120,
             rect: { x: 0, y: 0, width: 120, height: 22 } }),
    ]));
    expect(d).toHaveLength(1);
    expect(d[0].message).toContain("106px");
  });

  it("有可滚祖先就不报 —— 那种溢出是故意的", () => {
    expect(detectTextClip(snap([
      node({ ownText: "很长的一行说明文字", scrollWidth: 226, clientWidth: 120,
             insideScrollRegion: true }),
    ]))).toEqual([]);
  });

  it("不持有文字的祖先不报 —— 否则整条祖先链一起红", () => {
    // scrollWidth 是从溢出的子孙继承来的；impeccable 那边记着同一个坑
    expect(detectTextClip(snap([
      node({ selector: "div.wrap", ownText: "", scrollWidth: 226, clientWidth: 120 }),
    ]))).toEqual([]);
  });

  it("差 15px 不报，16px 才报 —— 阈值边界钉住", () => {
    const at = (delta: number) => detectTextClip(snap([
      node({ ownText: "文字文字", clientWidth: 120, scrollWidth: 120 + delta }),
    ])).length;
    expect(at(15)).toBe(0);
    expect(at(16)).toBe(1);
  });

  it("可滚代码块之类的标签整体跳过", () => {
    expect(detectTextClip(snap([
      node({ tag: "pre", ownText: "long code line", scrollWidth: 500, clientWidth: 120 }),
    ]))).toEqual([]);
  });
});

// ── ③ 对比度 ─────────────────────────────────────────────────────────
describe("low-contrast：WCAG AA", () => {
  it("对比度算得对 —— 拿今天修掉的那两个色值验", () => {
    const white = { r: 255, g: 255, b: 255 };
    // #bfbfbf 对白底：**1.84:1**。
    //
    // ⚠ 这个数是这条判据上线当天纠正过来的：我此前在注释、文档和对话里反复
    // 写"约 2.3:1"，是估的、且估高了——真值更糟。检测器按 WCAG 公式算出来
    // 1.84，独立用 Python 复算一致。所以这里钉真值，顺手把那几处错数也改了。
    expect(contrastRatio({ r: 191, g: 191, b: 191 }, white)).toBeCloseTo(1.84, 1);
    // #8c8c8c 对白底：3.36:1（收口后的 faint；此前也被我写成 3.54）
    expect(contrastRatio({ r: 140, g: 140, b: 140 }, white)).toBeCloseTo(3.36, 1);
    // #0f172a 对白底很高，但对**深色底**极低——那才是当时看不见字的原因
    expect(contrastRatio({ r: 15, g: 23, b: 42 }, { r: 20, g: 20, b: 20 })).toBeLessThan(1.5);
  });

  it("大字号阈值按 WCAG 的磅数换算", () => {
    expect(requiredContrast(14, 400)).toBe(4.5);
    expect(requiredContrast(24, 400)).toBe(3); // 18pt
    expect(requiredContrast(19, 700)).toBe(3); // 14pt 粗体
    expect(requiredContrast(19, 400)).toBe(4.5); // 不粗就不算大字号
  });

  it("11px 的 #bfbfbf 提示文字 → 报；换成 #8c8c8c 仍不达标但降级为警告", () => {
    const hint = (c: { r: number; g: number; b: number }) => detectLowContrast(snap([
      node({ ownText: "暂无数据", fontSizePx: 11, color: c }),
    ]));
    const bad = hint({ r: 191, g: 191, b: 191 });
    expect(bad).toHaveLength(1);
    expect(bad[0].severity).toBe("critical"); // 1.84 < 4.5*0.6
    const better = hint({ r: 140, g: 140, b: 140 });
    expect(better).toHaveLength(1);
    expect(better[0].severity).toBe("warning"); // 3.36 够不上 4.5 但不算离谱
  });

  it("达标的正文一处都不报", () => {
    expect(detectLowContrast(snap([node({ ownText: "正文文字" })]))).toEqual([]);
  });

  it("取不到前景或背景就跳过 —— 渐变/图片底上不猜", () => {
    expect(detectLowContrast(snap([
      node({ ownText: "文字", effectiveBackground: null }),
    ]))).toEqual([]);
    expect(detectLowContrast(snap([node({ ownText: "文字", color: null })]))).toEqual([]);
  });

  it("视觉隐藏的文字（sr-only）不报", () => {
    expect(detectLowContrast(snap([
      node({ ownText: "给读屏用的说明", color: { r: 250, g: 250, b: 250 }, visuallyHidden: true }),
    ]))).toEqual([]);
  });
});

// ── 汇总 ─────────────────────────────────────────────────────────────
describe("整体", () => {
  it("三条一起跑并按 id 归组", () => {
    const defects = detectDesignDefects(snap([
      node({ selector: "a", ownText: "案件名称 1", rect: { x: 0, y: 0, width: 120, height: 66 } }),
      node({ selector: "b", ownText: "很长的说明", scrollWidth: 226, clientWidth: 120 }),
      node({ selector: "c", ownText: "暂无数据", fontSizePx: 11, color: { r: 191, g: 191, b: 191 } }),
    ]));
    expect(summarizeDefects(defects)).toEqual({
      "char-wrap": 1, "text-clip": 1, "low-contrast": 1,
    });
  });

  it("健康的一页一处都不报 —— 反向兜底", () => {
    // 三个正常节点：正文、标题、达标的次要文字
    expect(detectDesignDefects(snap([
      node({ ownText: "退费申请总览" }),
      node({ ownText: "待处理退费单", fontSizePx: 24, fontWeight: 700 }),
      node({ ownText: "较前一日持平", fontSizePx: 12, color: { r: 89, g: 89, b: 89 } }),
    ]))).toEqual([]);
  });
});
