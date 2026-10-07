/**
 * 结果卡封面 / 右栏默认打开的「主交付」：有图或办公文件时不拿核验说明当封面。
 *
 * ⚠ 2026-10-07 真机 r88 sr-20261007165549-YHYGJNAB8A：GET /artifacts 原样是下面三份（两张图表 + 一份核验说明，
 *   说明最后收回）。原来两处都取最后一份——封面和右栏默认都是那段文字（deliverable-files.pickMainDeliverable 头注）。
 */
import { describe, expect, it } from "vitest";

import { pickMainDeliverable } from "../project-runtime/deliverable-files";
import { hostPreviewChoice } from "../project-computer-view";

const R88 = ["output/store-sales-h1-obscured.png", "output/store-sales-h1.png", "output/store-sales-h1-check.txt"];

describe("主交付", () => {
  it("真机那三份：封面是最后收回的那张图，不是核验说明", () => {
    expect(pickMainDeliverable(R88, p => p)).toBe("output/store-sales-h1.png");
  });

  it("右栏默认打开的跟封面是同一份", () => {
    const choice = hostPreviewChoice({ rows: [], collectedOffice: R88, office: true });
    expect(choice.officePath).toBe(pickMainDeliverable(R88, p => p));
  });

  it("反向：只有文本交付时，封面照旧是最后那份文本", () => {
    expect(pickMainDeliverable(["output/a.md", "output/b.md"], p => p)).toBe("output/b.md");
  });

  it("办公文件和图片之间仍按收回顺序取最后一份", () => {
    expect(pickMainDeliverable(["output/chart.png", "output/report.pptx", "output/notes.md"], p => p)).toBe("output/report.pptx");
  });
});
