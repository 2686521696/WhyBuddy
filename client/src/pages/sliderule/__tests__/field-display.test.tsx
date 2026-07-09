/**
 * 字段语义纯函数 + FieldValue 渲染测试（加厚 schema 一期）。
 * 锁：归一化合法域与 python 门禁对齐；渲染层对声明外的值如实显示原文。
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  clampNumber,
  formatMoney,
  formatPercent,
  maskValue,
  normalizeFieldFormat,
  normalizeFieldOptions,
  scoreColor,
  toneToTagColor,
} from "../live-runtime/field-display";
import { FieldValue } from "../live-runtime/FieldValue";

describe("field-display 纯函数", () => {
  it("normalizeFieldOptions：只认 enum；空 id 剔除、重复保首、坏 tone 降级 default", () => {
    expect(normalizeFieldOptions("string", [{ id: "x" }])).toEqual([]);
    expect(normalizeFieldOptions("enum", undefined)).toEqual([]);
    expect(
      normalizeFieldOptions("enum", [
        { id: "a", tone: "success" },
        { id: "a", tone: "danger" },
        { id: " ", tone: "warning" },
        { id: "b", label: "乙", tone: "rainbow" },
      ])
    ).toEqual([
      { id: "a", label: "a", tone: "success" },
      { id: "b", label: "乙", tone: "default" },
    ]);
  });

  it("normalizeFieldFormat：格式必须匹配字段类型，未知丢弃", () => {
    expect(normalizeFieldFormat("number", "money")).toBe("money");
    expect(normalizeFieldFormat("number", "rating")).toBe("rating");
    expect(normalizeFieldFormat("string", "masked")).toBe("masked");
    expect(normalizeFieldFormat("text", "masked")).toBe("masked");
    expect(normalizeFieldFormat("string", "money")).toBeUndefined();
    expect(normalizeFieldFormat("number", "masked")).toBeUndefined();
    expect(normalizeFieldFormat("enum", "money")).toBeUndefined();
    expect(normalizeFieldFormat("number", "hexdump")).toBeUndefined();
  });

  it("格式化：金额千分位 / 百分比 / 钳制 / 脱敏 / 评分色档", () => {
    expect(formatMoney(1234567.5)).toBe("¥1,234,567.5");
    expect(formatMoney("abc")).toBeNull();
    expect(formatPercent(66.666)).toBe("66.7%");
    expect(formatPercent("")).toBeNull();
    expect(clampNumber(120, 0, 100)).toBe(100);
    expect(clampNumber("x", 0, 100)).toBeNull();
    expect(maskValue("13812345678")).toBe("138****78");
    expect(maskValue("abc")).toBe("a**");
    expect(scoreColor(85)).toBe("#52c41a");
    expect(scoreColor(65)).toBe("#faad14");
    expect(scoreColor(30)).toBe("#ff4d4f");
    expect(toneToTagColor("danger")).toBe("error");
    expect(toneToTagColor("success")).toBe("success");
  });
});

describe("FieldValue 渲染", () => {
  const OPTIONS = [
    { id: "待跟进", label: "待跟进", tone: "warning" as const },
    { id: "已成交", label: "已成交", tone: "success" as const },
  ];

  it("enum 声明取值 → tone 徽标；声明外的值如实纯文本", () => {
    const hit = renderToStaticMarkup(
      <FieldValue field={{ type: "enum", options: OPTIONS }} value="已成交" />
    );
    expect(hit).toContain("ant-tag-success");
    expect(hit).toContain("已成交");
    const miss = renderToStaticMarkup(
      <FieldValue field={{ type: "enum", options: OPTIONS }} value="野值" />
    );
    expect(miss).toContain("野值");
    expect(miss).not.toContain("ant-tag");
  });

  it("format 渲染：money/percent/progress/rating/masked/score；非数值回退原文", () => {
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "number", format: "money" }} value={9800} />
      )
    ).toContain("¥9,800");
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "number", format: "percent" }} value={42} />
      )
    ).toContain("42%");
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "number", format: "progress" }} value={70} />
      )
    ).toContain("ant-progress");
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "number", format: "rating" }} value={4} />
      )
    ).toContain("ant-rate");
    expect(
      renderToStaticMarkup(
        <FieldValue
          field={{ type: "string", format: "masked" }}
          value="13812345678"
        />
      )
    ).toContain("138****78");
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "number", format: "score" }} value={82} />
      )
    ).toContain("82 分");
    // 非数值挂数字格式 → 如实原文，不冒充 0
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "number", format: "money" }} value="待定" />
      )
    ).toContain("待定");
  });

  it("空值恒为 —；无声明字段纯文本", () => {
    expect(
      renderToStaticMarkup(<FieldValue field={{ type: "string" }} value="" />)
    ).toContain("—");
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "string" }} value={undefined} />
      )
    ).toContain("—");
    expect(
      renderToStaticMarkup(
        <FieldValue field={{ type: "string" }} value="普通值" />
      )
    ).toBe("普通值");
  });
});
