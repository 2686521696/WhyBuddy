/**
 * 体验区块取数纯函数测试（2026-07-28）。
 *
 * 这层是五个区块里真正容易错的地方——渲染层没有 jsdom 只能测静态 HTML，
 * 分桶/补零/排序这些必须在这里锁死。几条断言对应的都是"naive 实现会写错、
 * 而且错了看不出来"的点：
 *
 *   - 缺失的时间桶补零（不补的话折线跨空档直连，等于撒谎）
 *   - 周从周一起（JS getDay() 周日是 0，直接减会把周日算进下一周）
 *   - 本地时区（new Date("YYYY-MM-DD") 按 UTC 解析，东八区整体偏一天）
 *   - avg 的分母是有值的行数，不是总行数
 *   - 算不出来给 null，不是 0
 */
import { describe, it, expect } from "vitest";

import {
  MAX_TREND_BUCKETS,
  bucketKeyOf,
  buildFeedRows,
  buildRankedRows,
  buildTrendSeries,
  computeAggregate,
  enumerateBuckets,
  parseAggregate,
} from "../block-data";
import type { RuntimeRow } from "../live-runtime";

const row = (id: string, values: Record<string, unknown>): RuntimeRow =>
  ({ id, values }) as RuntimeRow;

describe("parseAggregate", () => {
  it("识别 count / sum:<field> / avg:<field>", () => {
    expect(parseAggregate("count")).toEqual({ kind: "count" });
    expect(parseAggregate("sum:amount")).toEqual({ kind: "sum", fieldId: "amount" });
    expect(parseAggregate("avg:score")).toEqual({ kind: "avg", fieldId: "score" });
  });

  it("非法/空一律退回 count，不抛", () => {
    // 门禁会拦住非法表达式，但运行时不单方面信任上游——拿到脏值要能自己站住
    for (const bad of ["", null, undefined, "max:x", "sum:", "sum", 42, {}])
      expect(parseAggregate(bad)).toEqual({ kind: "count" });
  });
});

describe("computeAggregate", () => {
  const rows = [
    row("a", { amount: 10 }),
    row("b", { amount: 30 }),
    row("c", {}), // 该字段没填
    row("d", { amount: "不是数字" }),
  ];

  it("count 数的是行数", () => {
    expect(computeAggregate(rows, { kind: "count" })).toBe(4);
  });

  it("sum 只累加有效数值", () => {
    expect(computeAggregate(rows, { kind: "sum", fieldId: "amount" })).toBe(40);
  });

  it("avg 的分母是有值的行数，不是总行数", () => {
    // 40/2=20，不是 40/4=10——没填的行不该把平均值拉低
    expect(computeAggregate(rows, { kind: "avg", fieldId: "amount" })).toBe(20);
  });

  it("一条有效行都没有 → null（不是 0）", () => {
    // 0 是"算出来是零"，null 是"算不出来"，界面上必须显示成不同的东西
    expect(computeAggregate([row("x", {})], { kind: "sum", fieldId: "amount" })).toBeNull();
    expect(computeAggregate([], { kind: "avg", fieldId: "amount" })).toBeNull();
    // count 例外：空列表就是 0 条，这是算得出来的
    expect(computeAggregate([], { kind: "count" })).toBe(0);
  });
});

describe("bucketKeyOf", () => {
  it("day 原样", () => {
    expect(bucketKeyOf("2026-07-28", "day")).toBe("2026-07-28");
  });

  it("month 截到月", () => {
    expect(bucketKeyOf("2026-07-28", "month")).toBe("2026-07");
    expect(bucketKeyOf("2026-01-01", "month")).toBe("2026-01");
  });

  it("week 归到周一（不是周日）", () => {
    // 2026-07-28 是周二 → 本周一是 07-27
    expect(bucketKeyOf("2026-07-28", "week")).toBe("2026-07-27");
    expect(bucketKeyOf("2026-07-27", "week")).toBe("2026-07-27");
  });

  it("周日归本周（不是下一周）—— getDay() 周日是 0 的经典坑", () => {
    // 2026-08-02 是周日，它属于 07-27 那一周，不是 08-03
    expect(bucketKeyOf("2026-08-02", "week")).toBe("2026-07-27");
    expect(bucketKeyOf("2026-08-03", "week")).toBe("2026-08-03"); // 下周一
  });

  it("跨月/跨年的周不出错", () => {
    expect(bucketKeyOf("2026-01-01", "week")).toBe("2025-12-29");
  });

  it("不按 UTC 解析 —— 东八区不会整体偏一天", () => {
    // new Date("2026-07-01") 在 UTC+8 下是 06-30 08:00 本地，
    // 若用它取 getMonth 会算成 6 月。这里必须仍是 7 月。
    expect(bucketKeyOf("2026-07-01", "month")).toBe("2026-07");
    expect(bucketKeyOf("2026-07-01", "day")).toBe("2026-07-01");
  });
});

describe("enumerateBuckets", () => {
  it("按天逐日推进，含两端", () => {
    expect(enumerateBuckets("2026-07-28", "2026-07-31", "day")).toEqual([
      "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
    ]);
  });

  it("按周步进 7 天", () => {
    expect(enumerateBuckets("2026-07-06", "2026-07-20", "week")).toEqual([
      "2026-07-06", "2026-07-13", "2026-07-20",
    ]);
  });

  it("按月跨年进位", () => {
    expect(enumerateBuckets("2025-11", "2026-02", "month")).toEqual([
      "2025-11", "2025-12", "2026-01", "2026-02",
    ]);
  });
});

describe("buildTrendSeries", () => {
  it("中间没数据的桶补零 —— 折线不许跨空档直连", () => {
    const rows = [
      row("a", { at: "2026-07-01" }),
      row("b", { at: "2026-07-01" }),
      row("c", { at: "2026-07-04" }),
    ];
    const s = buildTrendSeries(rows, "at", "day");
    expect(s).not.toBeNull();
    expect(s!.categories).toEqual([
      "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04",
    ]);
    // 02/03 没有记录 → 0，而不是整段消失
    expect(s!.values).toEqual([2, 0, 0, 1]);
  });

  it("按 sum 聚合而不只是计数", () => {
    const rows = [
      row("a", { at: "2026-07-01", amt: 5 }),
      row("b", { at: "2026-07-01", amt: 7 }),
    ];
    const s = buildTrendSeries(rows, "at", "day", { kind: "sum", fieldId: "amt" });
    expect(s!.values).toEqual([12]);
  });

  it("桶太多时退到**刚好放得下**的那一档，不是一步跳到最粗", () => {
    // 一年零一天按天是 367 个桶（超上限），按周是 53 个（没超）——
    // 应该停在 week。一步跳到 month 会白丢一档细节。
    const s = buildTrendSeries(
      [row("a", { at: "2025-07-01" }), row("b", { at: "2026-07-02" })],
      "at",
      "day"
    );
    expect(s!.coarsened).toBe(true);
    expect(s!.grain).toBe("week");
    expect(s!.categories.length).toBeLessThanOrEqual(MAX_TREND_BUCKETS);
  });

  it("粒度用尽后宁可超上限，也不截断历史", () => {
    // 五年跨度：按天 1800+、按周 260+ 都超上限 → 落到 month，但仍有 61 个桶。
    // month 已经是 binding 枚举里最粗的一档（day/week/month，没有季/年），
    // 此时**允许超过 MAX_TREND_BUCKETS**——上限是偏好不是硬约束。
    // 另一条路是截断成最近 60 个月，但那会悄悄丢掉最早那段历史，用户看不出来。
    const s = buildTrendSeries(
      [row("a", { at: "2021-07-01" }), row("b", { at: "2026-07-02" })],
      "at",
      "day"
    );
    expect(s!.grain).toBe("month");
    expect(s!.coarsened).toBe(true);
    expect(s!.categories.length).toBeGreaterThan(MAX_TREND_BUCKETS);
    // 关键：两端都还在
    expect(s!.categories[0]).toBe("2021-07");
    expect(s!.categories[s!.categories.length - 1]).toBe("2026-07");
  });

  it("一条能解析日期的行都没有 → null", () => {
    expect(buildTrendSeries([row("a", { at: "" })], "at", "day")).toBeNull();
    expect(buildTrendSeries([], "at", "day")).toBeNull();
  });
});

describe("buildRankedRows", () => {
  const rows = [
    row("a", { name: "甲", score: 10 }),
    row("b", { name: "乙", score: 30 }),
    row("c", { name: "丙", score: 20 }),
    row("d", { name: "丁" }), // score 没填
  ];

  it("按数值倒序取 top-N", () => {
    const r = buildRankedRows(rows, "score", "name", "desc", 3);
    expect(r.map(i => i.label)).toEqual(["乙", "丙", "甲"]);
  });

  it("支持升序", () => {
    expect(buildRankedRows(rows, "score", "name", "asc", 3).map(i => i.label))
      .toEqual(["甲", "丙", "乙"]);
  });

  it("该字段没有有效值的行整条排除", () => {
    // 排行榜里出现空值条目，用户分不清是 0 还是没填——这两件事业务含义不同
    expect(buildRankedRows(rows, "score", "name", "desc", 10).map(i => i.label))
      .not.toContain("丁");
  });

  it("limit 夹在 [3,20]（与门禁的 ranges 一致）", () => {
    expect(buildRankedRows(rows, "score", "name", "desc", 1)).toHaveLength(3);
    expect(buildRankedRows(rows, "score", "name", "desc", 999).length)
      .toBeLessThanOrEqual(20);
  });
});

describe("buildFeedRows", () => {
  const rows = [
    row("a", { title: "旧", at: "2026-07-01" }),
    row("b", { title: "新", at: "2026-07-20" }),
    row("c", { title: "无时间" }),
  ];

  it("按时间倒序", () => {
    expect(buildFeedRows(rows, "at", undefined).map(i => i.title))
      .toEqual(["新", "旧"]);
  });

  it("解析不出时间的行不入流", () => {
    // 动态流的语义就是按时间排，没时间的记录放哪都是错的
    expect(buildFeedRows(rows, "at", undefined).map(i => i.title))
      .not.toContain("无时间");
  });

  it("带出等级字段（空串按未填处理）", () => {
    const r = buildFeedRows(
      [row("x", { t: "x", at: "2026-07-01", lvl: "高" }),
       row("y", { t: "y", at: "2026-07-02", lvl: "  " })],
      "at",
      "lvl"
    );
    expect(r.find(i => i.row.id === "x")?.level).toBe("高");
    expect(r.find(i => i.row.id === "y")?.level).toBeUndefined();
  });
});
