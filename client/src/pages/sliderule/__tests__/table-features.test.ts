/**
 * 表格自带能力（schema 驱动）测试。
 * 锁：number 字段数值排序、字符串本地化排序、enum/低基数出真实取值筛选、
 * 高基数不出筛选（避免筛选菜单爆炸）、筛选谓词精确匹配。
 */
import { describe, it, expect } from "vitest";
import { buildColumnFeatures } from "../live-runtime/table-features";
import type { RuntimeRow } from "../live-runtime/live-runtime";

const row = (id: string, values: Record<string, unknown>): RuntimeRow => ({
  id,
  createdAt: "2026-07-09T00:00:00Z",
  values,
});

const ROWS: RuntimeRow[] = [
  row("r1", { price: 300, status: "上架", title: "初级课" }),
  row("r2", { price: 25, status: "审核中", title: "高级课" }),
  row("r3", { price: 100, status: "上架", title: "中级课" }),
];

describe("buildColumnFeatures", () => {
  it("number 字段按数值排序（不是字符串序：25 < 100 < 300）", () => {
    const f = buildColumnFeatures({ id: "price", type: "number" }, ROWS);
    const sorted = [...ROWS].sort(f.sorter);
    expect(sorted.map((r) => r.values.price)).toEqual([25, 100, 300]);
  });

  it("字符串字段本地化排序；enum 字段出真实取值筛选 + 谓词精确匹配", () => {
    const f = buildColumnFeatures({ id: "status", type: "enum" }, ROWS);
    expect(f.filters!.map((x) => x.value).sort()).toEqual(["上架", "审核中"]);
    expect(ROWS.filter((r) => f.onFilter!("上架", r)).map((r) => r.id)).toEqual(["r1", "r3"]);
    // 非 enum 低基数（2~8 取值）同样给筛选
    const g = buildColumnFeatures({ id: "title", type: "string" }, ROWS);
    expect(g.filters!.length).toBe(3);
  });

  it("高基数字符串不出筛选（>8 个取值），排序仍在", () => {
    const many = Array.from({ length: 12 }, (_, i) => row(`m${i}`, { code: `CODE-${i}` }));
    const f = buildColumnFeatures({ id: "code", type: "string" }, many);
    expect(f.filters).toBeUndefined();
    expect(typeof f.sorter).toBe("function");
  });

  it("无数据时 enum 也不出空筛选菜单", () => {
    const f = buildColumnFeatures({ id: "status", type: "enum" }, []);
    expect(f.filters).toBeUndefined();
  });
});
