/**
 * field-value-type — 控件档位判定表的锁。
 *
 * 这张表是读侧（FieldValue）与写侧（FieldEditor）的共同真相源，判错一档
 * 两边一起错，所以每一档都单独钉住。枚举的分档阈值也钉——那是产品判断
 * （少选项平铺、多选项收起），改阈值必须是明确决定，不能顺手改掉。
 */

import { describe, it, expect } from "vitest";
import {
  RADIO_MAX_OPTIONS,
  SEGMENTED_MAX_OPTIONS,
  isBlockControl,
  isBounded100,
  resolveValueType,
} from "../live-runtime/field-value-type";

const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `选项${i}`, tone: "default" }));

describe("resolveValueType · 数值按 format 分档", () => {
  it.each([
    ["money", "money"],
    ["percent", "percent"],
    ["progress", "progress"],
    ["score", "score"],
    ["rating", "rate"],
  ])("number + %s → %s", (format, expected) => {
    expect(resolveValueType({ type: "number", format } as never)).toBe(expected);
  });

  it("number 无 format → digit（裸数字输入框）", () => {
    expect(resolveValueType({ type: "number" } as never)).toBe("digit");
  });

  it("非法 format 不生效，退回裸数字 —— 归一化交给 field-display 那份判定", () => {
    // masked 是 string 的 format，挂在 number 上属于坏声明
    expect(resolveValueType({ type: "number", format: "masked" } as never)).toBe("digit");
  });
});

describe("resolveValueType · 枚举按取值个数分档", () => {
  it("≤3 个取值 → Segmented（平铺，零点击可见全部）", () => {
    expect(resolveValueType({ type: "enum", options: opts(2) } as never)).toBe("segmented");
    expect(resolveValueType({ type: "enum", options: opts(SEGMENTED_MAX_OPTIONS) } as never)).toBe(
      "segmented"
    );
  });

  it("4-6 个取值 → Radio.Group", () => {
    expect(resolveValueType({ type: "enum", options: opts(SEGMENTED_MAX_OPTIONS + 1) } as never)).toBe(
      "radio"
    );
    expect(resolveValueType({ type: "enum", options: opts(RADIO_MAX_OPTIONS) } as never)).toBe("radio");
  });

  it("超过 6 个取值 → Select（再平铺就占满整屏了）", () => {
    expect(resolveValueType({ type: "enum", options: opts(RADIO_MAX_OPTIONS + 1) } as never)).toBe(
      "select"
    );
    expect(resolveValueType({ type: "enum", options: opts(20) } as never)).toBe("select");
  });

  it("enum 没有取值声明 → tags（可选可输），不能给个空下拉让人填不进去", () => {
    expect(resolveValueType({ type: "enum" } as never)).toBe("tags");
    expect(resolveValueType({ type: "enum", options: [] } as never)).toBe("tags");
  });

  it("有 options 但 type 写成 string 时按枚举走 —— 模型偶尔会这么写", () => {
    expect(resolveValueType({ type: "string", options: opts(2) } as never)).toBe("segmented");
    expect(resolveValueType({ type: "string", options: opts(9) } as never)).toBe("select");
  });
});

describe("resolveValueType · 其余类型", () => {
  it.each([
    ["date", "date"],
    ["datetime", "dateTime"],
    ["text", "textarea"],
    ["ref", "ref"],
    ["boolean", "switch"],
    ["string", "text"],
  ])("%s → %s", (type, expected) => {
    expect(resolveValueType({ type } as never)).toBe(expected);
  });

  it("string + masked → password（此前是明文 Input，脱敏只做在读侧）", () => {
    expect(resolveValueType({ type: "string", format: "masked" } as never)).toBe("password");
  });

  it("未知类型退回 text，不抛", () => {
    expect(resolveValueType({ type: "geo_polygon" } as never)).toBe("text");
    expect(resolveValueType({} as never)).toBe("text");
  });
});

describe("辅助判定", () => {
  it("isBounded100 只认 percent/progress/score", () => {
    expect(isBounded100("percent")).toBe(true);
    expect(isBounded100("progress")).toBe(true);
    expect(isBounded100("score")).toBe(true);
    expect(isBounded100("digit")).toBe(false);
    expect(isBounded100("money")).toBe(false);
  });

  it("isBlockControl：星级与开关不占满整行，其余占满", () => {
    expect(isBlockControl("rate")).toBe(false);
    expect(isBlockControl("switch")).toBe(false);
    expect(isBlockControl("date")).toBe(true);
    expect(isBlockControl("textarea")).toBe(true);
  });
});
