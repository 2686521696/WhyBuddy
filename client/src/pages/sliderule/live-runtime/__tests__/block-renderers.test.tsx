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

import { EXPERIENCE_BLOCK_RENDERERS, ExperienceBlockBoundary } from "../block-registry";
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

/**
 * ── 字段语义渲染（2026-08-08，照 refinedev/refine 的 Inferencer）──────────
 *
 * 用户拿一张真实的「门店订单管理」页做示范，指出我们的表格差太远：状态该是
 * 彩色标签、金额该是 ¥428.00、时间该是完整时刻、末尾该有操作列、分页该带
 * 总数。此前我们**直接拿行数据的键当列**，没有语义也没有格式化。
 *
 * refine 的做法是三层：字段语义推断链 → 每种语义一个字段渲染器 → 自动追加
 * 操作列。我们比它占一个便宜：字段类型是数据模型里声明好的，不用从值猜。
 */
describe("字段语义渲染", () => {
  const rows = [
    {
      id: "r1",
      values: { code: "OD20250806", amount: 428, status: "done", at: "2025-08-06 14:28:32" },
      createdAt: "2025-08-06T14:28:32.000Z",
    },
  ];
  const types: Record<string, string> = {
    code: "string",
    amount: "number",
    status: "enum",
    at: "date",
  };
  const render = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <ExperienceBlockBoundary
        block={{ id: "t", type: "DataTable", binding: { entityRef: "order" } }}
        entityRows={{ order: rows }}
        fieldLabelOf={(_e, f) => ({ code: "订单号", amount: "金额", status: "状态", at: "下单时间" })[f]}
        fieldTypeOf={(_e, f) => types[f]}
        enumOptionsOf={(_e, f) =>
          f === "status" ? [{ id: "done", label: "已完成", tone: "success" }] : []
        }
        {...extra}
      />
    );

  it("金额列格式化成货币并右对齐 —— 左对齐的金额没法竖着比大小", () => {
    const html = render();
    expect(html).toContain("¥428.00");
    // antd 的 align 落成内联 style，不是类名（实测；写成 ant-table-cell-align-right
    // 会红，那是别的版本的类名）
    expect(html).toContain("text-align:right");
  });

  it("枚举列出彩色标签，颜色来自声明的 tone 而不是猜的", () => {
    const html = render();
    expect(html).toContain("已完成");
    expect(html).toContain("ant-tag-success");
    // 取值 id 不该露出来
    expect(html).not.toMatch(/>done</);
  });

  it("带时刻的日期出完整时刻，不是只有日期", () => {
    expect(render()).toContain("2025-08-06 14:28:32");
  });

  it("操作列**只在调用方接了 onAction 时**出现", () => {
    // 没人接的时候画一排点不动的链接，比不画更糟
    expect(render()).not.toContain("操作");
    expect(render({ onAction: () => {} })).toContain("操作");
  });

  it("分页带总数 —— 此前是 slice(0,8) 加一行「显示前 8 条」，用户翻不到第 9 条", () => {
    const html = render();
    expect(html).toContain("共 1 条");
    expect(html).toContain("ant-pagination");
  });
});

/**
 * 2026-08-08：照 pro-components 补的两个区块。
 *
 * 它们共用一个风险：**依赖宿主态，宿主不给就渲染成空气**。这个项目当天刚踩过
 * 一次——QuickActionPanel 第一行是「没有 pageActions 就返回 null」，而装配预览
 * 从来没传过，于是它一直是空气、没人发现（它总跟别的区块挤在一个区里，看不出
 * 少了谁）。所以这两个的用例先钉「宿主没接时说人话，不是消失」。
 */
describe("StatusTabs（状态切换栏）", () => {
  const ENUMS = {
    status: [
      { id: "todo", label: "待办" },
      { id: "doing", label: "进行中" },
      { id: "done", label: "已完成" },
    ],
  };
  const TASKS = {
    task: [
      row("t1", { name: "甲", status: "todo" }),
      row("t2", { name: "乙", status: "done" }),
      row("t3", { name: "丙", status: "done" }),
    ],
  };
  const block = {
    id: "st",
    type: "StatusTabs",
    props: {},
    binding: { entityRef: "task", statusField: "status" },
  } as unknown as ExperienceBlockInstance;

  it("条数是真数出来的，不是 props 里写死的", () => {
    // 写死的话，用户删掉一条记录、页签还写着原来的数——那种不一致比不显示
    // 条数更糟，因为它看起来是对的。
    const html = render("status-tabs", block, TASKS, undefined, {
      enumOptionsOf: (_e: string, f: string) => (ENUMS as never)[f] ?? [],
      filterState: { enumFilters: {} },
    });
    expect(html).toContain("全部 3");
    expect(html).toContain("已完成 2");
    expect(html).toContain("待办 1");
    expect(html).toContain("进行中 0");
  });

  it("绑的字段不是枚举时说清楚，而不是渲染一个空的页签条", () => {
    const html = render(
      "status-tabs",
      {
        ...block,
        binding: { entityRef: "task", statusField: "name" },
      } as unknown as ExperienceBlockInstance,
      TASKS,
      undefined,
      { enumOptionsOf: () => [], fieldLabelOf: () => "名称" }
    );
    expect(html).toContain("不是枚举字段");
  });
});

describe("BatchActionBar（批量操作栏）", () => {
  const block = {
    id: "bar",
    type: "BatchActionBar",
    props: { actions: ["批量审批", "批量导出"] },
    binding: { entityRef: "order" },
  } as unknown as ExperienceBlockInstance;

  it("没选中时给一句引导，不是整条消失", () => {
    // 官方 Alert 的做法是整条消失（selectedRowKeys 为空就 return null）。
    // 我们在组件库和装配预览里不能那样——**会消失的区块没法审阅**，而且
    // "消失"和"坏了"长得一模一样。
    const html = render("batch-action-bar", block, ROWS, undefined, {
      selection: { rowIds: {} },
    });
    expect(html).toContain("勾选左侧的行");
    expect(html).not.toContain("已选择");
  });

  it("选中之后显示条数与批量操作按钮", () => {
    const html = render("batch-action-bar", block, ROWS, undefined, {
      selection: { rowIds: { order: ["o1", "o3"] } },
    });
    expect(html).toContain("已选择");
    expect(html).toContain(">2<");
    expect(html).toContain("批量审批");
    expect(html).toContain("批量导出");
    expect(html).toContain("清空");
  });

  it("只认自己绑的那个实体的勾选 —— 一页可能有不止一张表", () => {
    const html = render("batch-action-bar", block, ROWS, undefined, {
      selection: { rowIds: { customer: ["c1", "c2", "c3"] } },
    });
    expect(html).toContain("勾选左侧的行");
  });
});

describe("DataTable 的勾选列", () => {
  const block = {
    id: "dt",
    type: "DataTable",
    props: {},
    binding: { entityRef: "order" },
  } as unknown as ExperienceBlockInstance;

  it("宿主没接选择态时不长出勾选列 —— 勾了也没地方用，纯噪音", () => {
    const html = render("data-table", block, ROWS);
    expect(html).not.toContain("selection-col");
  });

  it("宿主接了才出现勾选列", () => {
    const html = render("data-table", block, ROWS, undefined, {
      selection: { rowIds: { order: [] } },
      onSelectionChange: () => {},
    });
    expect(html).toContain("selection-col");
  });
});
