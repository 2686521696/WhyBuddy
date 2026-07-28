/**
 * demo-seed — 演示种子数据的边界锁。
 *
 * 这个模块唯一的危险是"把假数据混进真数据里"，所以测试重点全押在三条边界上：
 * 只填空实体、每行有标记、写第一条真实数据时整批清掉。逼真度（enum 走真取值、
 * money 落在四位数）也一起锁——不锁的话哪天改成 Math.random 也没人发现。
 */

import { describe, it, expect } from "vitest";
import {
  SEED_ROW_COUNT,
  buildSeedRows,
  dropSeedRowsFor,
  entityShowsSeed,
  isSeedRow,
  seedRowCount,
  seedRuntimeState,
} from "../live-runtime/demo-seed";
import { addRow, initRuntimeState, updateRow } from "../live-runtime/live-runtime";
import type { FiveSystemModel } from "../system-screens/five-system-model";

/** 固定时间基准：日期字段确定性依赖它，不钉死的话跨天跑测试会飘。 */
const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "plot",
        name: "地块",
        fields: [
          { id: "name", name: "地块名", type: "string" },
          { id: "area", name: "面积", type: "number" },
          { id: "rent", name: "年费", type: "number", format: "money" },
          { id: "health", name: "健康度", type: "number", format: "percent" },
          { id: "rating", name: "评分", type: "number", format: "rating" },
          { id: "leased_at", name: "认领日", type: "date" },
          {
            id: "status",
            name: "状态",
            type: "enum",
            options: [
              { id: "idle", label: "空闲", tone: "default" },
              { id: "leased", label: "已认领", tone: "success" },
            ],
          },
          { id: "note", name: "备注", type: "text" },
          { id: "member_ref", name: "认领人", type: "ref" },
        ],
      },
      { id: "member", name: "成员", fields: [{ id: "name", name: "姓名", type: "string" }] },
    ],
  },
  rbac: { roles: ["admin"], permissions: [], menus: [] },
};

describe("demo-seed · 造行", () => {
  const rows = buildSeedRows(MODEL.datamodel!.entities![0], MODEL.datamodel!.entities!, NOW);

  it("每个实体铺 SEED_ROW_COUNT 行，行行带 seed 标记", () => {
    expect(rows).toHaveLength(SEED_ROW_COUNT);
    expect(rows.every(isSeedRow)).toBe(true);
    expect(rows.every(r => r.seed === true)).toBe(true);
    expect(new Set(rows.map(r => r.id)).size).toBe(SEED_ROW_COUNT); // id 不重
  });

  it("确定性：同样入参两次结果完全一致（没有随机数）", () => {
    const again = buildSeedRows(MODEL.datamodel!.entities![0], MODEL.datamodel!.entities!, NOW);
    expect(again).toEqual(rows);
  });

  it("enum 只取声明里的取值 id —— 否则徽标颜色/看板列全对不上", () => {
    const legal = new Set(["idle", "leased"]);
    expect(rows.every(r => legal.has(String(r.values.status)))).toBe(true);
    // 12 行不能全挤在同一个取值上，否则看板只有一列有货
    expect(new Set(rows.map(r => r.values.status)).size).toBe(2);
  });

  it("数字按 format 分档：money 四位数 / percent 0-100 / rating 1-5", () => {
    for (const r of rows) {
      expect(Number(r.values.rent)).toBeGreaterThanOrEqual(1200);
      expect(Number(r.values.rent)).toBeLessThanOrEqual(15000);
      expect(Number(r.values.health)).toBeGreaterThanOrEqual(0);
      expect(Number(r.values.health)).toBeLessThanOrEqual(100);
      expect(Number(r.values.rating)).toBeGreaterThanOrEqual(1);
      expect(Number(r.values.rating)).toBeLessThanOrEqual(5);
    }
  });

  it("日期落在最近两周内，且散得开（趋势图要有形状）", () => {
    const keys = rows.map(r => String(r.values.leased_at));
    expect(keys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k))).toBe(true);
    const oldest = [...keys].sort()[0];
    expect(Date.parse(oldest)).toBeGreaterThan(NOW - 15 * 864e5);
    // 12 行必须落在 12 个不同的日子上。第一版步长与跨度不互质（7 % 14），
    // 12 行只落到 2 天，真跑出来的折线图整条只有两个点——这条断言就是为
    // 那个 bug 立的：>1 太松，必须钉死"全都不同"。
    expect(new Set(keys).size).toBe(SEED_ROW_COUNT);
  });

  it("ref 字段存目标行的显示名，不是行 id —— 动态流/看板会把它原样打印", () => {
    // member 实体的第一个 string 字段是「姓名」，所以显示名长这样
    expect(rows.every(r => /^姓名 \d+$/.test(String(r.values.member_ref)))).toBe(true);
    // 与 member 自己那批种子的第一列逐字一致（指的是真存在的那条）
    const memberRows = buildSeedRows(MODEL.datamodel!.entities![1], MODEL.datamodel!.entities!, NOW);
    const names = new Set(memberRows.map(r => String(r.values.name)));
    expect(rows.every(r => names.has(String(r.values.member_ref)))).toBe(true);
  });

  it("enum 没有声明取值时留空，不瞎编枚举", () => {
    const bare = buildSeedRows(
      { id: "x", fields: [{ id: "s", name: "S", type: "enum" }] },
      [],
      NOW
    );
    expect(bare.every(r => r.values.s === "")).toBe(true);
  });
});

describe("demo-seed · 铺进状态", () => {
  it("空实体铺满，非空实体一行不碰", () => {
    const s0 = initRuntimeState(MODEL);
    const { state: withReal } = addRow(s0, "plot", { name: "我自己写的" }, "2026-07-28T00:00:00Z");
    const seeded = seedRuntimeState(withReal, MODEL, NOW);

    expect(seeded.entities.plot).toHaveLength(1); // 有真实数据 → 不铺
    expect(seeded.entities.plot[0].values.name).toBe("我自己写的");
    expect(seeded.entities.member).toHaveLength(SEED_ROW_COUNT); // 空的 → 铺满
  });

  it("幂等：铺过之后再调不重复铺，且返回同一个引用（不白触发 re-render）", () => {
    const once = seedRuntimeState(initRuntimeState(MODEL), MODEL, NOW);
    const twice = seedRuntimeState(once, MODEL, NOW);
    expect(twice).toBe(once);
  });

  it("模型没有实体时原样返回", () => {
    const s0 = initRuntimeState(null);
    expect(seedRuntimeState(s0, { rbac: { roles: [] } } as FiveSystemModel, NOW)).toBe(s0);
  });
});

describe("demo-seed · 与真实数据的交界", () => {
  const seeded = seedRuntimeState(initRuntimeState(MODEL), MODEL, NOW);

  it("entityShowsSeed：还剩种子就为 true，零行为 false（零行是空态不是示例）", () => {
    expect(entityShowsSeed(seeded, "plot")).toBe(true);
    expect(seedRowCount(seeded, "plot")).toBe(SEED_ROW_COUNT);
    expect(entityShowsSeed(initRuntimeState(MODEL), "plot")).toBe(false);
    expect(entityShowsSeed(seeded, "不存在的实体")).toBe(false);
  });

  it("混表（1 真 + N 种子）仍然算「还在展示示例」—— 用 some 不用 every", () => {
    const { state: mixed } = addRow(seeded, "plot", { name: "真数据" }, "2026-07-28T00:00:00Z");
    expect(entityShowsSeed(mixed, "plot")).toBe(true);
    expect(seedRowCount(mixed, "plot")).toBe(SEED_ROW_COUNT);
  });

  it("写第一条真实数据前清种子 —— 表里只剩用户自己那条", () => {
    const cleared = dropSeedRowsFor(seeded, "plot");
    expect(cleared.entities.plot).toHaveLength(0);
    const { state: after } = addRow(cleared, "plot", { name: "真数据" }, "2026-07-28T00:00:00Z");
    expect(after.entities.plot).toHaveLength(1);
    expect(entityShowsSeed(after, "plot")).toBe(false);
    // 只清这一张表，别的实体的示例照旧
    expect(after.entities.member).toHaveLength(SEED_ROW_COUNT);
  });

  it("没有种子可清时返回原引用", () => {
    const clean = initRuntimeState(MODEL);
    expect(dropSeedRowsFor(clean, "plot")).toBe(clean);
    expect(dropSeedRowsFor(clean, null)).toBe(clean);
  });

  it("编辑过的种子行不再算种子 —— 里面已经有用户真写的值了", () => {
    const rowId = seeded.entities.plot[0].id;
    const edited = updateRow(seeded, "plot", rowId, { name: "我改的" });
    expect(isSeedRow(edited.entities.plot[0])).toBe(false);
    expect(edited.entities.plot[0].values.name).toBe("我改的");
    expect(edited.entities.plot[0].values.area).toBe(seeded.entities.plot[0].values.area); // 其余字段不丢
    // 这一行转真了，但同表还剩 11 行种子 —— 徽标继续挂着才诚实
    expect(seedRowCount(edited, "plot")).toBe(SEED_ROW_COUNT - 1);
    expect(entityShowsSeed(edited, "plot")).toBe(true);
  });
});
