/**
 * ComponentsLibraryPage — 组件库（左侧菜单「组件库」，/agent-loop/components）。
 *
 * ## 为什么不进数据库
 *
 * 这份清单是**从代码派生的**，不是内容数据。experience_block_catalog.json 已经是
 * 唯一真相源：Python 侧拿它拼提示词白名单（services/schema_legal.py），TS 侧拿它
 * 做渲染器注册表（vite 的 @experience-blocks 别名指向同一个文件）。
 *
 * 把它抄进数据库就多了第二份真相，一定会漂移——而这里的漂移是危险的：库里说有
 * 某个区块、渲染器却没有（或反过来），而这份目录正是 LLM 生成时对着的契约。
 *
 * 所以这一页**运行时读那份目录**，再逐个用真实渲染器（ExperienceBlockBoundary）
 * 挂起来。往目录里加一个区块，这一页自动就有；渲染器忘了注册，这一页会直接显示
 * 「暂不支持此区块」——漂移不但不会发生，还会被当场看见。
 *
 * 数据库将来可以存的是别的东西：哪个区块被生成得最多、用户的收藏与备注。
 * 那是加法，不影响这一页。
 *
 * 形制照抄技能库（SkillsLibraryPage）——那一页也是 `import ... from json`，
 * 没有后端表。
 */

import React from "react";
import { ConfigProvider, Empty, Input, Segmented, Tag, Tooltip, Typography } from "antd";
import {
  AppstoreOutlined,
  MobileOutlined,
  DesktopOutlined,
} from "@ant-design/icons";
import catalogJson from "@experience-blocks";
import { ExperienceBlockBoundary } from "./live-runtime/block-registry";
import type { ExperienceBlockInstance } from "./live-runtime/block-registry";
import { isPhoneExperienceBlock } from "./live-runtime/phone-mobile/PhoneExperienceBlock";
import type { RuntimeRow } from "./live-runtime/live-runtime";

const PRIMARY = "#1677ff";
const CHARTS = ["#1677ff", "#52c41a", "#faad14", "#722ed1", "#13c2c2"];

interface CatalogBlock {
  type: string;
  description?: string;
  rendererKey?: string;
  rendererStatus?: string;
  generationEnabled?: boolean;
  dataKinds?: string[];
  allowedSlots?: string[];
  freeformGenerated?: boolean;
}

const CATALOG = catalogJson as unknown as {
  blocks: CatalogBlock[];
  allowedSlots: string[];
  dataKinds: string[];
};

/**
 * 「背后是哪个真组件」这一条**目录里没有**——它是渲染器的实现细节，得手维护。
 *
 * 手维护的东西会烂，所以下面有一道自检：目录里有、这张表里没有的类型会显示成
 * 「未登记」，而不是静静地空着。看见「未登记」就是在提醒来补一行。
 */
const IMPL_BY_TYPE: Record<string, string> = {
  MetricGrid: "ProComponents StatisticCard",
  TrendChart: "ECharts",
  RankedList: "antd List + Progress + Tag",
  ActivityFeed: "antd Timeline",
  DataTable: "antd Table",
  QuickActionPanel: "ProCard + antd Button",
  FilterBar: "ProComponents QueryFilter",
  WorkflowTimeline: "ProCard + antd Steps",
  FreeformInsight: "受限 JSON 树（非固定组件）",
};

const SLOT_LABEL: Record<string, string> = {
  summary: "摘要区",
  primary: "主区",
  secondary: "副区",
  activity: "动态区",
  content: "内容区",
};

const DATAKIND_LABEL: Record<string, string> = {
  aggregate: "聚合值",
  series: "时间序列",
  rankedRows: "排序行",
  timelineRows: "时间轴行",
  entityRows: "实体行",
};

// ── 夹具：所有区块共用一份，看的是长相不是数据 ─────────────────────

const FIELD_LABEL: Record<string, string> = {
  name: "门店",
  amount: "金额",
  status: "状态",
  channel: "渠道",
  at: "日期",
};

const ENTITY_ROWS: Record<string, RuntimeRow[]> = {
  order: [
    { name: "人民路店", amount: 428, status: "done", channel: "线上", at: "2026-08-06" },
    { name: "高新店", amount: 366, status: "doing", channel: "门店", at: "2026-08-05" },
    { name: "南湖店", amount: 291, status: "done", channel: "线上", at: "2026-08-05" },
    { name: "城东店", amount: 244, status: "todo", channel: "电话", at: "2026-08-04" },
    { name: "西溪店", amount: 187, status: "doing", channel: "门店", at: "2026-08-03" },
    { name: "湖畔店", amount: 132, status: "done", channel: "线上", at: "2026-08-02" },
  ].map((values, i) => ({
    id: `order-${i + 1}`,
    values,
    createdAt: `2026-08-0${(i % 7) + 1}T09:00:00.000Z`,
  })),
};

const WORKFLOW = {
  nodes: [
    { id: "n1", name: "受理", assigneeRole: "前台" },
    { id: "n2", name: "审核", assigneeRole: "主管" },
    { id: "n3", name: "配货", assigneeRole: "仓管" },
    { id: "n4", name: "交付", assigneeRole: "配送" },
  ],
  transitions: [
    { from: "n1", to: "n2", condition: "资料齐全" },
    { from: "n2", to: "n3", condition: "审核通过" },
    { from: "n3", to: "n4", condition: "已备齐" },
  ],
  chains: [],
};

const FREEFORM_DEMO = {
  root: {
    tag: "div",
    style: { display: "flex", flexDirection: "column", gap: "12px" },
    children: [
      {
        tag: "div",
        style: { display: "flex", gap: "12px" },
        children: [
          {
            tag: "div",
            style: {
              flex: "1", padding: "12px", borderRadius: "6px",
              backgroundColor: "#f0f5ff", display: "flex", flexDirection: "column", gap: "4px",
            },
            children: [
              { tag: "span", style: { fontSize: "12px", color: "#8c8c8c" }, text: "订单总数" },
              {
                tag: "span",
                style: { fontSize: "22px", fontWeight: "700", color: PRIMARY },
                dataRef: { entityRef: "order", aggregate: "count" },
              },
            ],
          },
          {
            tag: "div",
            style: {
              flex: "1", padding: "12px", borderRadius: "6px",
              backgroundColor: "#f6ffed", display: "flex", flexDirection: "column", gap: "4px",
            },
            children: [
              { tag: "span", style: { fontSize: "12px", color: "#8c8c8c" }, text: "金额合计" },
              {
                tag: "span",
                style: { fontSize: "22px", fontWeight: "700", color: "#52c41a" },
                dataRef: { entityRef: "order", aggregate: "sum:amount" },
              },
            ],
          },
        ],
      },
      {
        // ⚠️ chart 的聚合键叫 metric，dataRef 的叫 aggregate——两个不一样，
        // 写混了图表会静默不渲染（不报错）。
        tag: "div",
        style: { height: "170px" },
        chart: {
          type: "donut",
          entityRef: "order",
          dimensionFieldId: "status",
          metric: "sum",
          metricFieldId: "amount",
          metricLabel: "金额",
        },
      },
    ],
  },
};

/** 每个区块要挂起来需要的 block 实例 + 额外 props。 */
function demoFor(type: string): {
  block: ExperienceBlockInstance;
  extra: Record<string, unknown>;
} {
  const base = { id: `demo-${type}`, type };
  switch (type) {
    case "MetricGrid":
      return {
        block: { ...base, props: { title: "今日经营指标" }, binding: { entityRef: "order", aggregate: "sum:amount" } },
        extra: {},
      };
    case "TrendChart":
      return {
        block: {
          ...base, props: { title: "金额走势" },
          binding: { entityRef: "order", aggregate: "sum:amount", timeDimensionRef: "at", timeGrain: "day" },
        },
        extra: {},
      };
    case "RankedList":
      return {
        block: {
          ...base, props: { title: "门店销售 Top 5" },
          binding: { entityRef: "order", sortByRef: "amount", sortOrder: "desc", limit: 5 },
        },
        extra: {},
      };
    case "ActivityFeed":
      return {
        block: {
          ...base, props: { title: "最近动态", variant: "timeline" },
          binding: {
            entityRef: "order", timeFieldRef: "at",
            levelFieldRef: "status", detailFieldRefs: ["name", "amount"],
          },
        },
        extra: {},
      };
    case "DataTable":
      return {
        block: { ...base, props: { title: "订单明细" }, binding: { entityRef: "order" } },
        extra: {},
      };
    case "QuickActionPanel":
      return {
        block: { ...base, props: { title: "常用操作", columns: 3 } },
        extra: {
          pageActions: [
            { id: "a1", label: "新建订单", permitted: true },
            { id: "a2", label: "批量导入", permitted: true },
            { id: "a3", label: "导出报表", permitted: false },
          ],
        },
      };
    case "FilterBar":
      return {
        block: { ...base, props: { title: "筛选条件", showDateRange: true } },
        extra: {
          filterFieldOptions: [
            {
              id: "status", label: "状态",
              options: [
                { label: "待办", value: "todo" },
                { label: "进行中", value: "doing" },
                { label: "已完成", value: "done" },
              ],
            },
            {
              id: "channel", label: "渠道",
              options: [
                { label: "线上", value: "线上" },
                { label: "门店", value: "门店" },
                { label: "电话", value: "电话" },
              ],
            },
          ],
          dateRangeField: { id: "at", label: "下单日期" },
          filterState: { enumFilters: {}, dateRange: null },
        },
      };
    case "WorkflowTimeline":
      return {
        block: { ...base, props: { title: "订单流转" } },
        extra: { workflow: WORKFLOW },
      };
    case "FreeformInsight":
      return {
        block: {
          ...base, props: { title: "自由洞察" },
          freeformContent: FREEFORM_DEMO as unknown as { root: Record<string, unknown> },
        },
        extra: {},
      };
    default:
      // 目录里新加了区块但这里没补夹具：不假装能演示，如实说。
      return { block: base, extra: {} };
  }
}

const HAS_DEMO = new Set([
  "MetricGrid", "TrendChart", "RankedList", "ActivityFeed", "DataTable",
  "QuickActionPanel", "FilterBar", "WorkflowTimeline", "FreeformInsight",
]);

/** 页面形态（pageKind）——与 Python 侧 schema_legal.PAGE_KINDS 同源，此处是说明文案。 */
const PAGE_KINDS = [
  { key: "workbench", label: "工作台", desc: "左列表 + 右详情，最通用的一档", need: "—" },
  { key: "kanban", label: "看板", desc: "按状态分列拖动", need: "必须有 enum 状态字段" },
  { key: "calendar", label: "日历", desc: "月历视图，按日期落点", need: "必须有 date 字段" },
  { key: "wizard", label: "向导", desc: "Steps 分步引导", need: "—" },
  { key: "dashboard", label: "仪表盘", desc: "指标密排；可拿 AI 自由版式", need: "—" },
  { key: "monitor", label: "总览", desc: "首页形态；可拿 AI 自由版式", need: "—" },
];

function BlockCard({ block }: { block: CatalogBlock }) {
  const { block: instance, extra } = demoFor(block.type);
  const impl = IMPL_BY_TYPE[block.type];
  const phone = isPhoneExperienceBlock(block.type);
  const demoable = HAS_DEMO.has(block.type);

  return (
    <div
      data-testid={`component-card-${block.type}`}
      style={{
        background: "#fff",
        border: "1px solid #e8e8e8",
        borderRadius: 8,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafafa" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{block.type}</span>
          <span style={{ fontSize: 12, color: "#8c8c8c" }}>
            {impl ?? <Tag color="warning">实现未登记</Tag>}
          </span>
          <span style={{ flex: 1 }} />
          <Tooltip title="桌面档">
            <DesktopOutlined style={{ color: "#52c41a" }} />
          </Tooltip>
          <Tooltip title={phone ? "手机档有专属渲染器" : "手机档走桌面档降级（未适配）"}>
            <MobileOutlined style={{ color: phone ? "#52c41a" : "#d9d9d9" }} />
          </Tooltip>
        </div>
        {block.description && (
          <div style={{ marginTop: 6, fontSize: 12.5, color: "#595959", lineHeight: 1.6 }}>
            {block.description}
          </div>
        )}
        <div style={{ marginTop: 8, display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(block.allowedSlots ?? []).map(s => (
            <Tag key={s} style={{ marginInlineEnd: 0 }}>{SLOT_LABEL[s] ?? s}</Tag>
          ))}
          {(block.dataKinds ?? []).map(k => (
            <Tag key={k} color="blue" style={{ marginInlineEnd: 0 }}>
              {DATAKIND_LABEL[k] ?? k}
            </Tag>
          ))}
          {block.generationEnabled === false && (
            <Tag color="default" style={{ marginInlineEnd: 0 }}>不由主模型直出</Tag>
          )}
          {block.freeformGenerated && (
            <Tag color="purple" style={{ marginInlineEnd: 0 }}>AI 现场设计</Tag>
          )}
        </div>
      </div>
      <div style={{ padding: 16, flex: 1, minHeight: 120 }}>
        {demoable ? (
          <ExperienceBlockBoundary
            block={instance}
            entityRows={ENTITY_ROWS}
            chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
            fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
            {...extra}
          />
        ) : (
          // 目录里有、这一页还没配夹具：如实说"没有示例"，不画一个假的充数。
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="这一页还没为它准备示例数据"
            style={{ margin: "12px 0" }}
          />
        )}
      </div>
    </div>
  );
}

export default function ComponentsLibraryPage() {
  const [keyword, setKeyword] = React.useState("");
  const [slot, setSlot] = React.useState<string>("all");

  const blocks = CATALOG.blocks ?? [];
  const filtered = blocks.filter(b => {
    const kw = keyword.trim().toLowerCase();
    const hitKw =
      !kw ||
      b.type.toLowerCase().includes(kw) ||
      (b.description ?? "").toLowerCase().includes(kw) ||
      (IMPL_BY_TYPE[b.type] ?? "").toLowerCase().includes(kw);
    const hitSlot = slot === "all" || (b.allowedSlots ?? []).includes(slot);
    return hitKw && hitSlot;
  });
  const phoneReady = blocks.filter(b => isPhoneExperienceBlock(b.type)).length;

  return (
    <ConfigProvider theme={{ token: { colorPrimary: PRIMARY } }}>
      <div
        data-testid="components-library"
        style={{ padding: "24px 28px", background: "#f5f6fa", minHeight: "100%", boxSizing: "border-box" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <AppstoreOutlined style={{ fontSize: 22, color: PRIMARY }} />
          <Typography.Title level={3} style={{ margin: 0 }}>组件库</Typography.Title>
        </div>
        <Typography.Paragraph type="secondary" style={{ marginTop: 6, marginBottom: 18, fontSize: 13 }}>
          系统生成应用时可用的全部体验区块，共 {blocks.length} 个；下面每一格都是
          <strong>真实渲染器</strong>按夹具数据现渲的，跟线上应用同一套代码。
          清单读自 <code>experience_block_catalog.json</code>——它同时也是 AI 生成时对着的契约，
          所以这一页不会跟实际能力脱节。
        </Typography.Paragraph>

        {/* 页面形态 */}
        <Typography.Title level={5} style={{ marginTop: 0, marginBottom: 10 }}>
          页面形态 · {PAGE_KINDS.length} 种
        </Typography.Title>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
            gap: 12,
            marginBottom: 26,
          }}
        >
          {PAGE_KINDS.map(k => (
            <div
              key={k.key}
              data-testid={`page-kind-${k.key}`}
              style={{ background: "#fff", border: "1px solid #e8e8e8", borderRadius: 8, padding: "12px 14px" }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {k.label}
                <code style={{ marginLeft: 6, fontSize: 11.5, color: "#8c8c8c", fontWeight: 400 }}>{k.key}</code>
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5, color: "#595959" }}>{k.desc}</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "#8c8c8c" }}>成立条件：{k.need}</div>
            </div>
          ))}
        </div>

        {/* 体验区块 */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            体验区块 · {blocks.length} 个
          </Typography.Title>
          <Tag color={phoneReady === blocks.length ? "success" : "warning"}>
            手机档已适配 {phoneReady} / {blocks.length}
          </Tag>
          <span style={{ flex: 1 }} />
          <Segmented
            size="small"
            value={slot}
            onChange={v => setSlot(String(v))}
            options={[
              { label: "全部槽位", value: "all" },
              ...(CATALOG.allowedSlots ?? []).map(s => ({ label: SLOT_LABEL[s] ?? s, value: s })),
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜区块名 / 说明 / 实现"
            style={{ width: 220 }}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </div>

        {filtered.length === 0 ? (
          <Empty description="没有匹配的区块" style={{ padding: "48px 0" }} />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(430px, 1fr))",
              gap: 16,
              alignItems: "start",
            }}
          >
            {filtered.map(b => (
              <BlockCard key={b.type} block={b} />
            ))}
          </div>
        )}
      </div>
    </ConfigProvider>
  );
}
