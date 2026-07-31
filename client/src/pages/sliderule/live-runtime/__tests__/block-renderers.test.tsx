/**
 * 五个数据区块的渲染层测试（2026-07-28）。
 *
 * 取数逻辑在 block-data.test.ts 里锁（那层才是容易算错的地方）；这里锁的是
 * 渲染层的三件事：
 *   1. 有数据时真的画出来了（不是还挂着占位灰框）；
 *   2. **空态说清楚缺什么**——"未绑定实体" / "写入某字段后自动出图" 各不相同，
 *      糊成一句"暂无数据"用户就不知道该去干嘛；
 *   3. 遗留的 children 透传没被这次改动弄丢。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { EXPERIENCE_BLOCK_RENDERERS } from "../block-registry";
import type { ExperienceBlockInstance } from "../block-registry";
import type { RuntimeRow } from "../live-runtime";

const row = (id: string, values: Record<string, unknown>): RuntimeRow =>
  ({ id, values }) as RuntimeRow;

function render(
  rendererKey: string,
  block: ExperienceBlockInstance,
  entityRows?: Record<string, RuntimeRow[]>,
  children?: React.ReactNode,
  /** 额外的渲染器入参（enumOptionsOf / fieldLabelOf 这类查询函数） */
  extra?: Record<string, unknown>
) {
  const R = EXPERIENCE_BLOCK_RENDERERS[rendererKey];
  return renderToStaticMarkup(
    <R block={block} entityRows={entityRows} {...extra}>
      {children}
    </R>
  );
}

const ORDERS = [
  row("o1", { name: "甲单", amount: 100, at: "2026-07-01", level: "高" }),
  row("o2", { name: "乙单", amount: 300, at: "2026-07-03", level: "低" }),
  row("o3", { name: "丙单", amount: 200, at: "2026-07-03" }),
];
const ROWS = { order: ORDERS };

describe("五个区块都已接真渲染器（不再是占位）", () => {
  it("注册表里没有一个还挂着 ExistingContentAdapter", async () => {
    const { ExistingContentAdapter } = await import("../block-registry");
    for (const key of [
      "metric-grid",
      "trend-chart",
      "ranked-list",
      "activity-feed",
      "data-table",
    ])
      expect(EXPERIENCE_BLOCK_RENDERERS[key]).not.toBe(ExistingContentAdapter);
  });
});

describe("MetricGrid", () => {
  it("count 聚合出真实条数", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      props: { title: "订单概览" },
      binding: { entityRef: "order", aggregate: "count" },
    }, ROWS);
    expect(html).toContain("订单概览");
    expect(html).toContain("3");
  });

  it("sum 聚合", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      binding: { entityRef: "order", aggregate: "sum:amount" },
    }, ROWS);
    expect(html).toContain("600");
  });

  it("字段一行有效值都没有 → 显示「—」并说明，不显示 0", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      binding: { entityRef: "order", aggregate: "sum:不存在的字段" },
    }, ROWS);
    expect(html).toContain("—");
    expect(html).toContain("该字段暂无有效数值");
  });

  it("实体绑不上 → 说清楚是绑定问题", () => {
    const html = render("metric-grid", {
      id: "b1",
      type: "MetricGrid",
      binding: { entityRef: "不存在的实体" },
    }, ROWS);
    expect(html).toContain("指标未绑定到有效实体");
  });
});

describe("TrendChart", () => {
  it("有数据时出图并标出粒度", () => {
    const html = render("trend-chart", {
      id: "b2",
      type: "TrendChart",
      props: { title: "下单趋势" },
      binding: { entityRef: "order", timeDimensionRef: "at", timeGrain: "day" },
    }, ROWS);
    expect(html).toContain('data-testid="trend-chart"');
    expect(html).toContain("下单趋势");
    expect(html).toContain("按天");
  });

  it("时间字段没绑 → 空态点名缺的是时间字段", () => {
    const html = render("trend-chart", {
      id: "b2",
      type: "TrendChart",
      binding: { entityRef: "order" },
    }, ROWS);
    expect(html).toContain("趋势未绑定到有效的时间字段");
  });

  it("绑了字段但一行都没日期 → 提示写入该字段，带上字段名", () => {
    const html = render("trend-chart", {
      id: "b2",
      type: "TrendChart",
      binding: { entityRef: "order", timeDimensionRef: "没填过的日期字段" },
    }, ROWS);
    expect(html).toContain("没填过的日期字段");
    expect(html).toContain("自动出图");
  });
});

describe("RankedList", () => {
  it("按数值倒序出名次，且真值和条形都在", () => {
    const html = render("ranked-list", {
      id: "b3",
      type: "RankedList",
      props: { title: "金额排行" },
      binding: { entityRef: "order", sortByRef: "amount", limit: 3 },
    }, ROWS);
    expect(html).toContain("金额排行");
    expect(html.match(/data-testid="ranked-list-item"/g)).toHaveLength(3);
    // 只给条形不给数看不出量级——真值必须在
    expect(html).toContain("300");
    // 第一名是金额最大的乙单
    expect(html.indexOf("乙单")).toBeLessThan(html.indexOf("丙单"));
  });

  it("排序字段没绑 → 空态点名缺的是数值字段", () => {
    const html = render("ranked-list", {
      id: "b3",
      type: "RankedList",
      binding: { entityRef: "order" },
    }, ROWS);
    expect(html).toContain("排行未绑定到有效的数值字段");
  });
});

describe("ActivityFeed", () => {
  it("按时间倒序，带出等级标签", () => {
    const html = render("activity-feed", {
      id: "b4",
      type: "ActivityFeed",
      props: { title: "近期动态" },
      binding: { entityRef: "order", timeFieldRef: "at", levelFieldRef: "level" },
    }, ROWS);
    expect(html).toContain("近期动态");
    expect(html.match(/data-testid="activity-feed-item"/g)).toHaveLength(3);
    expect(html).toContain("高");
    // 最新的 07-03 排在 07-01 前面
    expect(html.indexOf("2026-07-03")).toBeLessThan(html.indexOf("2026-07-01"));
  });

  it("时间字段没绑 → 空态点名", () => {
    const html = render("activity-feed", {
      id: "b4",
      type: "ActivityFeed",
      binding: { entityRef: "order" },
    }, ROWS);
    expect(html).toContain("动态未绑定到有效的时间字段");
  });
});

describe("DataTable", () => {
  it("画出表头与行，超出条数时如实说明", () => {
    const many = { order: Array.from({ length: 12 }, (_, i) => row(`r${i}`, { name: `第${i}单` })) };
    const html = render("data-table", {
      id: "b5",
      type: "DataTable",
      props: { title: "订单明细" },
      binding: { entityRef: "order" },
    }, many);
    expect(html).toContain("订单明细");
    expect(html.match(/data-testid="data-table-row"/g)).toHaveLength(8);
    // 截断必须说出来，否则用户以为只有 8 条
    expect(html).toContain("共 12 条");
  });

  it("实体存在但零行 → 引导去新建，而不是报绑定错误", () => {
    const html = render("data-table", {
      id: "b5",
      type: "DataTable",
      binding: { entityRef: "order" },
    }, { order: [] });
    expect(html).toContain("点「新建」写入第一条真实数据");
  });
});

describe("接 antd 之后的三条不许退回去（2026-07-28 重构）", () => {
  // 这三条都是对照台（/block-gallery.html）上肉眼逮到的，不是想出来的：
  // 手写样式时它们全都"看着能跑"，但颜色跟应用主题无关、枚举出的是取值 id。
  const src = () =>
    import("../block-registry.tsx?raw").then(
      m => (m as unknown as { default: string }).default
    );

  it("ActivityFeed 的等级出声明里的 label，不是取值 id", () => {
    const html = render(
      "activity-feed",
      {
        id: "b",
        type: "ActivityFeed",
        binding: { entityRef: "order", timeFieldRef: "at", levelFieldRef: "level" },
      },
      { order: [row("o1", { name: "甲", at: "2026-07-01", level: "frozen" })] },
      undefined,
      { enumOptionsOf: () => [{ id: "frozen", label: "已冻结", tone: "danger" }] }
    );
    expect(html).toContain("已冻结");
    expect(html).not.toContain("frozen");
  });

  it("DataTable 列头出中文显示名，枚举列出标签", () => {
    const html = render(
      "data-table",
      { id: "b", type: "DataTable", binding: { entityRef: "order" } },
      { order: [row("o1", { lot_code: "RR-1", status: "frozen" })] },
      undefined,
      {
        fieldLabelOf: (_e: string, f: string) =>
          ({ lot_code: "批次编码", status: "库存状态" })[f],
        enumOptionsOf: (_e: string, f: string) =>
          f === "status" ? [{ id: "frozen", label: "已冻结", tone: "danger" }] : [],
      }
    );
    expect(html).toContain("批次编码");
    expect(html).toContain("已冻结");
  });

  it("排行的条与名次标签取主题 token，不写死颜色", async () => {
    const s = await src();
    // Progress 在 percent>=100 时会自动变 success 绿，必须显式给 strokeColor，
    // 否则第一名永远是绿的、跟应用主题无关
    expect(s).toContain("strokeColor={token.colorPrimary}");
    // color="processing" 是 antd 固定语义蓝，不跟 colorPrimary
    expect(s).not.toContain('color={i < 3 ? "processing"');
    // 手写时代残留的靛蓝硬编色值不许回来。只查**用法**不查散文——注释里
    // 还留着这两个色值在讲当年为什么要换掉，一刀切会把那段历史也禁了
    expect(s).not.toMatch(/(bg|text|border)-\[#5b6cff\]/);
    expect(s).not.toMatch(/(bg|text|border)-\[#3b5bdb\]/);
  });

  it("等级颜色走声明的 tone，不靠关键词猜", async () => {
    const s = await src();
    expect(s).toContain("toneTimelineColor");
    // 第一版那个中英文关键词猜测器：枚举是 available/frozen 这种英文 id 时
    // 一条都命中不了，八个节点全同色
    expect(s).not.toContain("levelTimelineColor");
  });
});

describe("遗留 children 透传没丢", () => {
  it("传了 children 就照原样渲染（_fromLegacy 转换期用法）", () => {
    for (const key of [
      "metric-grid",
      "trend-chart",
      "ranked-list",
      "activity-feed",
      "data-table",
    ]) {
      const html = render(
        key,
        { id: "x", type: "X", binding: { entityRef: "order" } },
        ROWS,
        <span>现成内容</span>
      );
      expect(html).toContain("现成内容");
    }
  });
});
