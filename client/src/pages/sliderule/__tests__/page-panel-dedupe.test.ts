/**
 * page-panel-dedupe — 「同一份数据只画一次」的锁。
 *
 * 夹具直接抄真跑那次的声明（会话 sr-ms502mm2-vqxn5「练动云」首页）：
 * ActivityFeed 积木和 feeds 声明绑的是同一个实体、同一个时间字段、同一个
 * 等级字段，只有 id 和名字不同——靠 id 判重永远判不出来，这正是这份指纹
 * 判定要解决的问题。
 */

import { describe, it, expect } from "vitest";
import {
  blockPanelKey,
  collectFreeformBlockRefKeys,
  dedupeBlocksByPanelKey,
  dropLegacyPanelsCoveredByBlocks,
} from "../live-runtime/page-panel-dedupe";
import type { ExperienceBlockInstance } from "../live-runtime/block-registry";

const feedBlock = {
  id: "recent_attendance",
  type: "ActivityFeed",
  binding: {
    entityRef: "attendance_record",
    timeFieldRef: "check_in_time",
    levelFieldRef: "status",
  },
} as unknown as ExperienceBlockInstance;

const rankBlock = {
  id: "expiry_members",
  type: "RankedList",
  binding: { entityRef: "membership", sortByRef: "paid_amount" },
} as unknown as ExperienceBlockInstance;

/** legacy 那份：字段引用带实体前缀，id/名字都不一样 */
const legacyFeed = {
  id: "attendance_alert_feed",
  label: "近期出勤动态",
  entityId: "attendance_record",
  timeFieldId: "attendance_record.check_in_time",
  levelFieldId: "attendance_record.status",
};
const legacyRanking = {
  id: "top_paid",
  label: "缴费排行",
  entityId: "membership",
  sortFieldId: "membership.paid_amount",
  sortLabel: "实付金额",
  limit: 10, // 条数不同也算同一张榜
};

describe("blockPanelKey · 指纹只认决定画面的那几维", () => {
  it("同实体同字段 → 同指纹（id / 名字 / 条数都不参与）", () => {
    const other = {
      ...rankBlock,
      id: "另一个 id",
      props: { limit: 3, sortOrder: "asc" },
    } as unknown as ExperienceBlockInstance;
    expect(blockPanelKey(other)).toBe(blockPanelKey(rankBlock));
  });

  it("换实体或换字段 → 不同指纹", () => {
    const k = blockPanelKey(feedBlock);
    expect(
      blockPanelKey({
        ...feedBlock,
        binding: { ...feedBlock.binding, entityRef: "booking" },
      } as ExperienceBlockInstance)
    ).not.toBe(k);
    expect(
      blockPanelKey({
        ...feedBlock,
        binding: { ...feedBlock.binding, timeFieldRef: "created_at" },
      } as ExperienceBlockInstance)
    ).not.toBe(k);
  });

  it("其余区块类型不参与去重（返回 null）", () => {
    for (const type of ["FilterBar", "MetricGrid", "DataTable", "FreeformInsight"]) {
      expect(
        blockPanelKey({ id: "x", type, binding: { entityRef: "e" } } as ExperienceBlockInstance)
      ).toBeNull();
    }
  });

  it("绑定不全的不参与去重 —— 宁可漏判也不能误删", () => {
    expect(blockPanelKey({ id: "x", type: "RankedList", binding: {} } as ExperienceBlockInstance)).toBeNull();
    expect(
      blockPanelKey({
        id: "x",
        type: "ActivityFeed",
        binding: { entityRef: "e" },
      } as ExperienceBlockInstance)
    ).toBeNull();
  });
});

describe("dropLegacyPanelsCoveredByBlocks · 撞车时保留积木那一份", () => {
  it("真跑那个案例：动态流被摘掉，积木留下", () => {
    const out = dropLegacyPanelsCoveredByBlocks(
      { rankings: [], feeds: [legacyFeed] },
      [feedBlock]
    );
    expect(out.feeds).toHaveLength(0);
  });

  it("字段引用带不带实体前缀都能对上（legacy 带、积木不带）", () => {
    const out = dropLegacyPanelsCoveredByBlocks(
      { rankings: [legacyRanking], feeds: [] },
      [rankBlock]
    );
    expect(out.rankings).toHaveLength(0);
  });

  it("没撞车的 legacy 声明照旧保留", () => {
    const other = { ...legacyFeed, entityId: "booking" };
    const out = dropLegacyPanelsCoveredByBlocks(
      { rankings: [], feeds: [legacyFeed, other] },
      [feedBlock]
    );
    expect(out.feeds).toEqual([other]);
  });

  it("一个积木都没有时原样返回（引用相等，调用方可跳过重渲染）", () => {
    const lists = { rankings: [legacyRanking], feeds: [legacyFeed] };
    expect(dropLegacyPanelsCoveredByBlocks(lists, [])).toBe(lists);
    expect(
      dropLegacyPanelsCoveredByBlocks(lists, [
        { id: "f", type: "FilterBar", binding: { entityRef: "x" } } as ExperienceBlockInstance,
      ])
    ).toBe(lists);
  });

  it("没有任何一条撞车时也返回原引用", () => {
    const lists = { rankings: [], feeds: [{ ...legacyFeed, entityId: "booking" }] };
    expect(dropLegacyPanelsCoveredByBlocks(lists, [feedBlock])).toBe(lists);
  });
});

describe("dedupeBlocksByPanelKey · 积木内部也可能重复", () => {
  it("同指纹只留第一个", () => {
    const dup = { ...feedBlock, id: "recent_attendance_2" } as ExperienceBlockInstance;
    const out = dedupeBlocksByPanelKey([feedBlock, dup, rankBlock]);
    expect(out.map(b => b.id)).toEqual(["recent_attendance", "expiry_members"]);
  });

  it("指纹为 null 的一律保留 —— 两个 FilterBar 是布局问题，不是重复数据", () => {
    const bar = { id: "b1", type: "FilterBar", binding: { entityRef: "e" } } as ExperienceBlockInstance;
    const bar2 = { ...bar, id: "b2" } as ExperienceBlockInstance;
    expect(dedupeBlocksByPanelKey([bar, bar2])).toHaveLength(2);
  });
});

describe("collectFreeformBlockRefKeys · 嵌了就外面不画", () => {
  /** 设计树：根 → 两列 → 其中一列里摆了个动态流积木 */
  const design = {
    root: {
      tag: "div",
      children: [
        { tag: "div", children: [{ tag: "div", chart: { type: "bar" } }] },
        {
          tag: "div",
          children: [
            {
              tag: "div",
              blockRef: {
                type: "ActivityFeed",
                binding: {
                  entityRef: "attendance_record",
                  timeFieldRef: "check_in_time",
                  levelFieldRef: "status",
                },
              },
            },
          ],
        },
      ],
    },
  };

  it("能从嵌套的设计树里把 blockRef 指纹挖出来", () => {
    const keys = collectFreeformBlockRefKeys(design);
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe(blockPanelKey(feedBlock));
  });

  it("摆进设计里之后，外层积木脚手架不再画同一份", () => {
    const keys = collectFreeformBlockRefKeys(design);
    const out = dedupeBlocksByPanelKey([feedBlock, rankBlock], keys);
    expect(out.map(b => b.id)).toEqual(["expiry_members"]); // 动态流已在设计里，只剩排行榜
  });

  it("摆进设计里之后，固定骨架也不再画同一份", () => {
    const keys = collectFreeformBlockRefKeys(design);
    const out = dropLegacyPanelsCoveredByBlocks(
      { rankings: [], feeds: [legacyFeed] },
      [],
      keys
    );
    expect(out.feeds).toHaveLength(0);
  });

  it("没有 freeformOverview / 树里没有 blockRef 时返回空集，什么都不影响", () => {
    expect(collectFreeformBlockRefKeys(null).size).toBe(0);
    expect(collectFreeformBlockRefKeys(undefined).size).toBe(0);
    expect(collectFreeformBlockRefKeys({ root: { tag: "div", children: [] } }).size).toBe(0);
  });

  it("坏形状不抛：children 不是数组、blockRef 缺 type、深度超限都安静跳过", () => {
    expect(() =>
      collectFreeformBlockRefKeys({ root: { tag: "div", children: "不是数组" } } as never)
    ).not.toThrow();
    expect(
      collectFreeformBlockRefKeys({
        root: { tag: "div", children: [{ tag: "div", blockRef: { binding: {} } }] },
      } as never).size
    ).toBe(0);
    // 深度 12 层的合法 blockRef 应被上限挡住（防坏数据把遍历转晕）
    let deep: Record<string, unknown> = {
      tag: "div",
      blockRef: { type: "ActivityFeed", binding: feedBlock.binding },
    };
    for (let i = 0; i < 12; i++) deep = { tag: "div", children: [deep] };
    expect(collectFreeformBlockRefKeys({ root: deep }).size).toBe(0);
  });
});

/**
 * 2026-08-01：不吃 binding 的两类可嵌积木（blockRef 白名单在 6fe1c13 从 2 种
 * 扩到 4 种时新增的那两个）。它们的指纹此前恒为 null，去重放行，同一个积木
 * 在首页设计里嵌一次、下面骨架里再画一次。
 *
 * 下面用的是真机跑出来的形状（诊所话题 today_overview 页，2026-08-01 基线轮）：
 * 设计树里的 blockRef 只带 {type, binding:{}, props:{}}，**不带 id**——所以
 * 任何"按 id 匹配"的方案在这里都对不上，指纹必须从内容源取。
 */
describe("不吃 binding 的可嵌积木去重", () => {
  const embeddedActionPanel = { type: "QuickActionPanel", binding: {}, props: {} };
  const embeddedTimeline = { type: "WorkflowTimeline", binding: {}, props: {} };

  it("QuickActionPanel：设计里嵌了，骨架里同类就不再画", () => {
    const keys = collectFreeformBlockRefKeys({
      root: { tag: "div", children: [{ tag: "div", blockRef: embeddedActionPanel }] },
    } as never);
    expect(keys.size).toBe(1);
    const out = dedupeBlocksByPanelKey(
      [{ id: "today_actions", type: "QuickActionPanel", binding: {}, props: {} } as never],
      keys
    );
    expect(out).toHaveLength(0);
  });

  it("WorkflowTimeline：按 props.chainRef 认身份，主链路能对上", () => {
    const keys = collectFreeformBlockRefKeys({
      root: { tag: "div", children: [{ tag: "div", blockRef: embeddedTimeline }] },
    } as never);
    const out = dedupeBlocksByPanelKey(
      [{ id: "appointment_stages", type: "WorkflowTimeline", binding: {}, props: {} } as never],
      keys
    );
    expect(out).toHaveLength(0);
  });

  it("指向不同链路的两个流程条不互相去重（chainRef 就是身份）", () => {
    const keys = collectFreeformBlockRefKeys({
      root: {
        tag: "div",
        children: [
          { tag: "div", blockRef: { type: "WorkflowTimeline", props: { chainRef: "chain_a" } } },
        ],
      },
    } as never);
    // 骨架里那个指向 chain_b，跟设计里嵌的不是同一个东西，必须保留
    const out = dedupeBlocksByPanelKey(
      [{ id: "flow_b", type: "WorkflowTimeline", binding: {}, props: { chainRef: "chain_b" } } as never],
      keys
    );
    expect(out).toHaveLength(1);
  });

  it("回归：ActivityFeed 仍按 binding 取指纹，行为不变", () => {
    const keys = collectFreeformBlockRefKeys({
      root: {
        tag: "div",
        children: [
          {
            tag: "div",
            blockRef: { type: "ActivityFeed", binding: feedBlock.binding, props: { variant: "row" } },
          },
        ],
      },
    } as never);
    const out = dedupeBlocksByPanelKey([feedBlock], keys);
    expect(out).toHaveLength(0);
  });
});
