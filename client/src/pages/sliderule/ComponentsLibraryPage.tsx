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
 * ## 形制
 *
 * 数据取法照技能库（SkillsLibraryPage 也是 import json、没有后端表）；
 * **外观照应用中心**（AppsWorkbench，2026-08-07 用户裁决"参考应用中心的这种样式、
 * 筛选、以及卡片的块大小算法"）：
 *
 *   · 吸顶头 —— 图标 + 标题 + 搜索框 + 带计数的筛选 chip，与 AppsWorkbench 同一套类名
 *   · 卡片壳 —— 画面铺满整卡、信息条以底部黑色渐变浮层压在画面上（CenterCard 同款）
 *   · 排布   —— 复用 SpanMasonry（AppsWorkbench 那面卡片墙的同一个组件）
 *
 * 卡片墙那边高度靠"列宽 / 设备宽高比"算，因为应用截图只有三种比例；这里不用算——
 * SpanMasonry 本来就用 ResizeObserver 量真实高度，而各区块**渲染出来的真实高度
 * 本来就差很多**（实测 148~451px），错落是真的，不需要造。
 *
 * 跨列的判据同样必须是真实信息（纪律见 app-wall-span.ts 顶部）：这里用
 * **allowedSlots 含 content** —— 内容区在真实页面里就是整行宽的，能放进去的区块
 * 天然需要横向空间（DataTable 要摆列、WorkflowTimeline 要横向展开阶段）。
 * 不是随机、也不是按好看程度挑。
 */

import React from "react";
import { Card, Empty, Tooltip } from "antd";
// 顶部一律用 lucide，与 AppsWorkbench 同源；antd 图标只留给卡片内部。
import { LayoutGrid, Monitor, Rows3, Search, Smartphone, Sparkles } from "lucide-react";
import { useContainerPosition } from "masonic";
import catalogJson from "@experience-blocks";
import { SpanMasonry } from "@/pages/agent-loop/dashboard/SpanMasonry";
import { useScrollerIn } from "@/pages/agent-loop/dashboard/useScrollerIn";
import { spanForColumnCount } from "@/pages/agent-loop/dashboard/app-wall-span";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary } from "./live-runtime/block-registry";
import { BASE_COMPONENTS, BASE_GROUPS } from "./base-components/base-catalog";
import BusinessPageGrid from "./live-runtime/BusinessPageGrid";
import {
  resolveBusinessGrid,
  upgradeLegacySlotsToGrid,
} from "./live-runtime/business-page-layout";
import type {
  ExperienceBlockInstance,
  FilterFieldOption,
  PageFilterState,
} from "./live-runtime/block-registry";
import { isPhoneExperienceBlock } from "./live-runtime/phone-mobile/PhoneExperienceBlock";
import type { RuntimeRow } from "./live-runtime/live-runtime";
import type { NormalizedFieldOption } from "./live-runtime/field-display";


const PRIMARY = "#1677ff";
const CHARTS = ["#1677ff", "#52c41a", "#faad14", "#722ed1", "#13c2c2"];
/**
 * 顶部筛选 chip —— 与 AppsWorkbench 的 TabButton / StatChip 逐字同款。
 *
 * 原来用的是 antd `Tag.CheckableTag`，配色虽然对上了，但得靠一串 `!important`
 * 去压 antd 自带的 margin/border/padding；`!m-0`、`!border-0`、`!px-3` 这些一旦
 * 有一条被 antd 版本改动顶掉，样式就会悄悄偏一点。应用中心那边本来就是普通
 * button，直接用同一个，`!important` 一个都不需要。
 *
 * icon 可选，是照那边的分工：库切换那排（我的应用 / 官方示例）不带图标，
 * 只有条件筛选那排才带——混着用会让"切内容"和"筛条件"在视觉上分不开。
 */
function FilterChip({
  icon,
  label,
  count,
  active,
  onClick,
  testid,
}: {
  icon?: React.ReactNode;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  testid?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testid}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[#e8eeff] text-[#3b5bdb]"
          : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
      }`}
      onClick={onClick}
    >
      {icon && <span className={active ? "opacity-100" : "opacity-70"}>{icon}</span>}
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={`tabular-nums text-[11px] ${
            active ? "text-[#3b5bdb]/80" : "text-slate-400"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
interface CatalogBlock {
  type: string;
  description?: string;
  rendererKey?: string;
  rendererStatus?: string;
  generationEnabled?: boolean;
  dataKinds?: string[];
  allowedSlots?: string[];
  pageKinds?: string[];
  freeformGenerated?: boolean;
}

/** 页面形态预设：一套"已经排好的积木组合"。与 Python 侧同源同一份 JSON。 */
interface PagePreset {
  id: string;
  name: string;
  when: string;
  blocks: { type: string; slot: string }[];
}

const CATALOG = catalogJson as unknown as {
  blocks: CatalogBlock[];
  allowedSlots: string[];
  dataKinds: string[];
  pageKindPresets?: Record<string, PagePreset[]>;
};

/**
 * 「背后是哪个真组件」这一条**目录里没有**——它是渲染器的实现细节，得手维护。
 *
 * 手维护的东西会烂，所以下面有一道自检：目录里有、这张表里没有的类型会显示成
 * 「未登记」，而不是静静地空着。看见「未登记」就是在提醒来补一行。
 */
/**
 * 「背后是哪个真组件」与中文名 —— **从区块定义表派生**（2026-08-08）。
 *
 * 此前这里是一张手维护的表，加组件忘了补就显示「实现未登记」。现在唯一
 * 真相是 block-registry 的 BLOCK_DEFINITIONS：那条记录里已经带着 impl 和
 * label，这里只是读出来。加组件不再需要来改这一处。
 */
const IMPL_BY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(BLOCK_DEFINITIONS).map(([type, d]) => [type, d.impl])
);
const LABEL_BY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(BLOCK_DEFINITIONS).map(([type, d]) => [type, d.label])
);


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

/** 字段类型：表单族按它决定出哪种控件（enum→下拉、number→数字、date→日期）。
 *  与 FIELD_LABEL 同源同形——这一页是对照台，两张表都得跟真实数据模型对得上。 */
const FIELD_TYPE: Record<string, string> = {
  name: "string",
  amount: "number",
  status: "enum",
  channel: "enum",
  at: "date",
};

/**
 * 枚举取值：表单族的 enum 字段靠它出下拉，表格/详情靠它把取值 id 翻成标签。
 *
 * **必须与 ENTITY_ROWS 里真实出现的取值对上**——对不上的话下拉里选不到行数据
 * 里已有的值，而这一页恰恰是用来看"契约真的接上了没有"的。
 */
const ENUM_OPTIONS: Record<string, NormalizedFieldOption[]> = {
  status: [
    { id: "todo", label: "待办", tone: "default" },
    { id: "doing", label: "进行中", tone: "processing" },
    { id: "done", label: "已完成", tone: "success" },
  ],
  channel: [
    { id: "线上", label: "线上", tone: "default" },
    { id: "门店", label: "门店", tone: "default" },
    { id: "电话", label: "电话", tone: "default" },
  ],
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
/**
 * 组件库的示例数据 —— **一个类型一条记录**（2026-08-08 由 14 分支的 switch 改成）。
 *
 * 形状照 measuredco/puck 的 ComponentConfig.defaultProps：示例数据是组件的
 * 一项属性，跟渲染器住在一起，不是散落在调用方的一个 switch 里。
 *
 * 此前 switch 与 HAS_DEMO 那张手写名单是两处：名单里有、switch 里没有就渲染
 * 出一张空卡；反过来示例数据永远用不到。加组件要同时记得改两处，漏改不报错。
 * 现在 HAS_DEMO 直接由这张表的键派生，两处对不上这件事从结构上消失。
 *
 * 到三五百个组件时这张表会挪进目录记录本身（lowcode-engine 的 snippets：
 * 一个渲染器带多个带标题和截图的行业变体），形状不用变。
 */
const DEMOS: Record<string, { block: ExperienceBlockInstance; extra: Record<string, unknown> }> = {
  RecordForm: {
        block: {
          id: "demo-RecordForm", type: "RecordForm",
          props: { title: "新建订单", submitText: "创建", layout: "vertical" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel", "at"] },
        },
        extra: {},
      },
  RecordFormDialog: {
        block: {
          id: "demo-RecordFormDialog", type: "RecordFormDialog",
          props: { title: "新建订单", mode: "drawer", triggerText: "新建订单" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status"] },
        },
        extra: {},
      },
  RecordDetail: {
        block: {
          id: "demo-RecordDetail", type: "RecordDetail",
          props: { title: "订单详情", columns: 2 },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel", "at"] },
        },
        extra: {},
      },
  StepsForm: {
        block: {
          id: "demo-StepsForm", type: "StepsForm",
          props: { title: "订单录入" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel"] },
        },
        // 步骤名跟着工作流链路走（见 StepsFormRenderer 里的说明），
        // 这里给一条真链路，才看得出"五系统关联"不是一句口号。
        extra: {
          workflow: {
            chains: [
              {
                id: "order-main",
                nodes: [
                  { id: "n1", name: "填写订单" },
                  { id: "n2", name: "确认金额" },
                  { id: "n3", name: "提交审核" },
                ],
              },
            ],
          },
        },
      },
  ContentCard: {
        block: { id: "demo-ContentCard", type: "ContentCard", props: { title: "订单概览", subtitle: "容器 · 装什么由组装决定" } },
        extra: {
          children: (
            <div className="text-[12px] leading-relaxed text-slate-500">
              这是个容器，本身不展示数据。
              <br />
              组装时把几个积木的 id 写进它的 children，它们就被收进同一张卡里。
            </div>
          ),
        },
      },
  MetricGrid: {
        block: { id: "demo-MetricGrid", type: "MetricGrid", props: { title: "今日经营指标" }, binding: { entityRef: "order", aggregate: "sum:amount" } },
        extra: {},
      },
  TrendChart: {
        block: {
          id: "demo-TrendChart", type: "TrendChart", props: { title: "金额走势" },
          binding: { entityRef: "order", aggregate: "sum:amount", timeDimensionRef: "at", timeGrain: "day" },
        },
        extra: {},
      },
  RankedList: {
        block: {
          id: "demo-RankedList", type: "RankedList", props: { title: "门店销售 Top 5" },
          binding: { entityRef: "order", sortByRef: "amount", sortOrder: "desc", limit: 5 },
        },
        extra: {},
      },
  ActivityFeed: {
        block: {
          id: "demo-ActivityFeed", type: "ActivityFeed", props: { title: "最近动态", variant: "timeline" },
          binding: {
            entityRef: "order", timeFieldRef: "at",
            levelFieldRef: "status", detailFieldRefs: ["name", "amount"],
          },
        },
        extra: {},
      },
  DataTable: {
        block: { id: "demo-DataTable", type: "DataTable", props: { title: "订单明细" }, binding: { entityRef: "order" } },
        extra: {},
      },
  QuickActionPanel: {
        block: { id: "demo-QuickActionPanel", type: "QuickActionPanel", props: { title: "常用操作", columns: 3 } },
        extra: {
          pageActions: [
            { id: "a1", label: "新建订单", permitted: true },
            { id: "a2", label: "批量导入", permitted: true },
            { id: "a3", label: "导出报表", permitted: false },
          ],
        },
      },
  FilterBar: {
        block: { id: "demo-FilterBar", type: "FilterBar", props: { title: "筛选条件", showDateRange: true } },
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
      },
  WorkflowTimeline: {
        block: { id: "demo-WorkflowTimeline", type: "WorkflowTimeline", props: { title: "订单流转" } },
        extra: { workflow: WORKFLOW },
      },
  FreeformInsight: {
        block: {
          id: "demo-FreeformInsight", type: "FreeformInsight", props: { title: "自由洞察" },
          freeformContent: FREEFORM_DEMO as unknown as { root: Record<string, unknown> },
        },
        extra: {},
      },
};

/**
 * 取示例数据。
 *
 * `surface` 一律置 plain（2026-08-08）：**陈列卡本身就是那张卡**，组件在它
 * 里面再画一层白底就是卡里套卡。实测这么套着的有 8 个（DataTable /
 * RecordForm / RecordDetail / TrendChart / RankedList / ActivityFeed /
 * RecordFormDialog / StepsForm），外面一圈阴影、里面又一圈圆角。
 *
 * 跟"装进 ContentCard 的积木自动 plain"是同一条规矩，只是这里的容器是陈列
 * 相框而不是 ContentCard：**谁提供表面，谁负责，一层就够**。
 */
function demoFor(type: string): { block: ExperienceBlockInstance; extra: Record<string, unknown> } {
  const d = DEMOS[type] ?? { block: { id: `demo-${type}`, type }, extra: {} };
  return {
    ...d,
    block: { ...d.block, props: { ...(d.block.props ?? {}), surface: "plain" } },
  };
}
const HAS_DEMO = new Set(Object.keys(DEMOS));

/** 页面形态（pageKind）——与 Python 侧 schema_legal.PAGE_KINDS 同源，此处是说明文案。 */
const PAGE_KINDS = [
  { key: "workbench", label: "工作台", desc: "左列表 + 右详情，最通用的一档", need: "—" },
  { key: "kanban", label: "看板", desc: "按状态分列拖动", need: "必须有 enum 状态字段" },
  { key: "calendar", label: "日历", desc: "月历视图，按日期落点", need: "必须有 date 字段" },
  { key: "wizard", label: "向导", desc: "Steps 分步引导", need: "—" },
  { key: "dashboard", label: "仪表盘", desc: "指标密排；可拿 AI 自由版式", need: "—" },
  { key: "monitor", label: "总览", desc: "首页形态；可拿 AI 自由版式", need: "—" },
];


/** 列宽下限与间距——照应用中心那面墙的写法，但值不同。
 *
 * 与应用中心保持 260：它决定的是列数下限，真实列宽仍由 SpanMasonry 把剩余空间
 * 均分。PC 与手机预览必须分别作为独立 item，ResizeObserver 才能按各自真实高度
 * 排列；把两档包进同一个 item 会让整组高度参与定位，墙面无法填补空列。
 */
const WALL_COLUMN_WIDTH = 260;
const WALL_GUTTER = 16;

type DeviceTier = "all" | "desktop" | "phone";
type PreviewDevice = Exclude<DeviceTier, "all">;

interface BlockPreviewEntry {
  block: CatalogBlock;
  device: PreviewDevice;
}

/**
 * 手机档渲染器。**懒加载**：它拉的是整个 antd-mobile，桌面档一个字节都用不上，
 * 静态引会把 antd-mobile 压进这一页的首包。挂法与 AppRuntimeScreen 一致。
 */
const LazyPhoneExperienceBlock = React.lazy(
  () => import("./live-runtime/phone-mobile/PhoneExperienceBlock")
);

/** 跨两列的判据：allowedSlots 含 content。
 *
 * 纪律照 app-wall-span.ts 顶部那段——**必须是真实信息，不能是随机也不能凭好看**。
 * 内容区在真实页面里就是整行宽的，能放进内容区的区块天然需要横向空间
 * （DataTable 要摆列、WorkflowTimeline 要横向展开阶段、ActivityFeed 行要放得下
 * 多个字段）。9 个里有 4 个符合，正好是"够错落又不散"的密度。
 */
function isWideBlock(b: CatalogBlock): boolean {
  return (b.allowedSlots ?? []).includes("content");
}

/**
 * 把宽卡按展示序均匀铺开。
 *
 * 这是 app-wall-span.ts「原因 A」记过的同一个坑，原文是"宽卡全部落在墙的头部……
 * 往下滚几行之后一张宽卡都没有"。这里的表现是反过来的同一件事：目录 JSON 里
 * DataTable / ActivityFeed / WorkflowTimeline / FreeformInsight 正好排在后半段，
 * 四张宽卡**连着来**，于是 4 列布局里它们全挤进中间那两列，第 1 列和第 4 列从第二
 * 行起就空到底——实测左右各空一大片。
 *
 * 那边的修法是把规则拆成两步：**谁有资格**由真实信息定，**在哪儿放**按展示序铺开。
 * 这里照搬：资格仍然只由 allowedSlots 含 content 决定（一个都没多、没少），
 * 只是把它们插在窄卡之间，每两张窄卡后面跟一张宽卡。
 *
 * 为什么可以动顺序：目录里的数组次序本来就没有语义（不是按重要性也不是按字母），
 * 组件库也没有"必须按这个顺序读"的要求。真有排序诉求的是筛选和搜索，那两条没动。
 */
function interleaveWide(blocks: CatalogBlock[]): CatalogBlock[] {
  const wide = blocks.filter(isWideBlock);
  const narrow = blocks.filter(b => !isWideBlock(b));
  if (wide.length === 0 || narrow.length === 0) return blocks;
  // 每放 stride 张窄卡插一张宽卡；stride 由两边数量算，保证宽卡摊到整列表上
  const stride = Math.max(1, Math.round(narrow.length / wide.length));
  const out: CatalogBlock[] = [];
  let wi = 0;
  narrow.forEach((b, i) => {
    out.push(b);
    if ((i + 1) % stride === 0 && wi < wide.length) out.push(wide[wi++]);
  });
  while (wi < wide.length) out.push(wide[wi++]);
  return out;
}

/**
 * 这个区块在手机档有没有**自己的**渲染器。
 *
 * 两个条件都要满足：手机渲染器认得它（PhoneExperienceBlock 的类型表），
 * 并且这一页给它备了示例数据（HAS_DEMO）。缺后者会画出一张空卡，
 * 那跟"降级"一样是没意义的中间态。
 *
 * 2026-08-07 用户裁决：手机端就是手机端，桌面端就是桌面端，不要"手机档但其实
 * 是桌面渲染器"这种东西。所以这个判据现在决定的是**这张卡出不出现在手机档**，
 * 而不再是"出现、但挂个降级角标"。
 *
 * ⚠️ 这只改了这一页的陈列方式。真实应用里的降级仍然存在
 * （AppRuntimeScreen.tsx:1538：手机档遇到没有手机实现的区块，照样拿桌面渲染器
 * 塞进窄壳）。要让线上也"手机端就是手机端"，得单独决定那种情况给用户看什么
 * ——直接不显示会让手机用户少掉整块内容，比挤一点更糟。
 */
function hasPhoneImplementation(block: CatalogBlock): boolean {
  return isPhoneExperienceBlock(block.type) && HAS_DEMO.has(block.type);
}

/** 真实渲染器预览；外壳使用 Ant Design Card，元信息不会覆盖可交互内容。 */
function BlockCard({ block, device }: { block: CatalogBlock; device: PreviewDevice }) {
  const { block: instance, extra } = demoFor(block.type);
  const impl = IMPL_BY_TYPE[block.type];
  const demoable = HAS_DEMO.has(block.type);

  // 手机档只渲染**真有手机实现**的区块（见 hasPhoneImplementation 与那里的说明）。
  // 没有实现的不会走到这里——它们压根不进手机档的列表。
  const rendered = demoable ? (
    device === "phone" ? (
      <React.Suspense fallback={<div style={{ height: 120 }} />}>
        <LazyPhoneExperienceBlock
          block={instance}
          entityRows={ENTITY_ROWS}
          chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
          fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
          fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
          enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
          {...extra}
        />
      </React.Suspense>
    ) : (
      <ExperienceBlockBoundary
        block={instance}
        entityRows={ENTITY_ROWS}
        chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
        fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
        fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
        enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
        {...extra}
      />
    )
  ) : (
    // 目录里有、这一页还没配夹具：如实说"没有示例"，不画一个假的充数。
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="这一页还没为它准备示例数据"
      style={{ margin: "16px 0" }}
    />
  );

  // 卡片角标跟顶部档位 chip 用同一套 lucide 图标——原来这里是 antd 的
  // Mobile/DesktopOutlined，跟顶部两个图标线宽和字重都对不上。
  const DeviceIcon = device === "phone" ? Smartphone : Monitor;

  return (
    <Card
      data-testid={`component-card-${block.type}`}
      size="small"
      variant="borderless"
      styles={{ body: { padding: 0, overflow: "hidden", position: "relative" } }}
      className="group w-full shadow-[0_3px_14px_rgba(15,23,42,0.10)]"
    >
      {/* 渲染区四边不留白，组件铺满整张卡；元信息浮层直接压在画面底部。 */}
      <div className="w-full">{rendered}</div>
      {/* 元信息作为底部浮层直接压在卡片画面上。
          
          2026-08-08：药丸本身的做法（每条自带底衬）是对的——压在任何底色上
          都读得清。问题在**视觉权重**：一眼扫过去，一片浅色组件里挂着十几个
          深色药丸，最抢眼的成了标签而不是组件本身，而这一页是用来看组件的。
          
          改成跟着鼠标走：默认 35% 不透明度（认得出有东西、不夺目），指针
          落到这张卡上才 100%。画廊类界面的通行做法——信息一个不少，只是
          不在你没问的时候喊。 */}
      <div className="absolute inset-x-0 bottom-0 z-10 px-3 pb-2 pt-2 opacity-35 transition-opacity duration-200 group-hover:opacity-100">
        <div className="flex items-center">
          <Tooltip title={block.description}>
            <span
              className="inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-sm bg-black/30 px-1 text-[13.5px] font-semibold leading-5 text-white"
              style={{ textShadow: "0 1px 2px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.25)" }}
            >
              <span className="min-w-0 truncate">{block.type}</span>
              <DeviceIcon size={12} className="shrink-0" />
            </span>
          </Tooltip>
        </div>
        <div
          className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-white/75"
          style={{ textShadow: "0 0.5px 1px rgba(0,0,0,0.28)" }}
        >
          <span className="rounded-sm bg-black/30 px-1">{impl ?? "实现未登记"}</span>
          {(block.allowedSlots ?? []).map(s => (
            <span className="rounded-sm bg-black/30 px-1" key={s}>{SLOT_LABEL[s] ?? s}</span>
          ))}
          {(block.dataKinds ?? []).map(k => (
            <span className="rounded-sm bg-black/30 px-1" key={k}>{DATAKIND_LABEL[k] ?? k}</span>
          ))}
          {block.freeformGenerated && <span className="rounded-sm bg-black/30 px-1">AI 现场设计</span>}
        </div>
      </div>
    </Card>
  );
}

/**
 * 一套存下来的模板 —— 用真渲染器 + 真实的槽位→网格管线摆出来。
 *
 * 与此前那个 PresetCard 的区别不在长相，在**来源**：那个读的是我手写在目录
 * JSON 里的十套（死的、每次一样，其中三套推荐的积木在真实应用里会被渲染层
 * 直接丢掉）；这个读的是 AI 组装攒进库里的。所以这里的积木已经带着 binding
 * ——绑到哪个实体、哪几个字段都是组装时定好的，不需要再 demoFor 一次。
 */
function SavedPresetCard({ preset }: { preset: SavedPreset }) {
  const topLevel = preset.blocks.filter(b => !b.nested);
  const slots = {
    summary: topLevel.filter(b => b.slot === "summary").map(b => b.id),
    primary: topLevel.filter(b => b.slot === "primary").map(b => b.id),
    secondary: topLevel.filter(b => b.slot === "secondary").map(b => b.id),
    activity: topLevel.filter(b => b.slot === "activity").map(b => b.id),
    content: topLevel.filter(b => b.slot === "content").map(b => b.id),
  };
  const items = resolveBusinessGrid(
    upgradeLegacySlotsToGrid(preset.pageKind, slots),
    "desktop"
  );
  const byId = new Map(preset.blocks.map(b => [b.id, b]));

  const renderOne = (b: AssembledBlock): React.ReactNode => (
    <ExperienceBlockBoundary
      key={b.id}
      block={{ id: b.id, type: b.type, props: b.props, binding: b.binding } as ExperienceBlockInstance}
      entityRows={ENTITY_ROWS}
      chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
      fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
      fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
      enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
      workflow={WORKFLOW}
    >
      {b.children && b.children.length > 0
        ? b.children.map(id => {
            const child = byId.get(id);
            return child ? renderOne(child) : null;
          })
        : undefined}
    </ExperienceBlockBoundary>
  );

  return (
    <Card
      data-testid={`saved-preset-${preset.id}`}
      size="small"
      variant="borderless"
      styles={{ body: { padding: 0, overflow: "hidden" } }}
      className="w-full shadow-[0_3px_14px_rgba(15,23,42,0.10)]"
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
        <span className="text-[13.5px] font-semibold text-slate-900">{preset.name}</span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
          {preset.industry}
        </span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
          {PAGE_KINDS.find(k => k.key === preset.pageKind)?.label ?? preset.pageKind}
        </span>
        <span className="ml-auto text-[11px] text-slate-400">{preset.blockCount} 个积木</span>
      </div>
      <div className="bg-[#f0f2f5] p-3">
        <BusinessPageGrid
          breakpoint="desktop"
          items={items}
          renderItem={ref => {
            const b = byId.get(ref);
            return b ? renderOne(b) : null;
          }}
        />
      </div>
    </Card>
  );
}

/** 组装结果里的一个积木——服务端已经逐个校验过槽位与绑定。 */
/** 存进库里的一套模板 —— AI 组装的产物 + 它判的行业。 */
interface SavedPreset {
  id: string;
  name: string;
  industry: string;
  pageKind: string;
  blockCount: number;
  blocks: AssembledBlock[];
}

interface AssembledBlock {
  id: string;
  type: string;
  slot: string;
  props?: Record<string, unknown>;
  binding?: Record<string, unknown>;
  /** ContentCard 这类容器装的积木 id（服务端已校验都指向真实存在的积木）。 */
  children?: string[];
  /** 已经被某个容器装走 —— 不再单独占槽位，否则同一个积木会出现两次。 */
  nested?: boolean;
}

/**
 * AI 组装出来的那一页 —— **真的能录数据**。
 *
 * 用户要的（2026-08-07 原话）：「点了那个按钮之后，它就真的可以进行录入数据了，
 * 就往你的页面录入数据了，就已经给你装配好了。」
 *
 * 所以这里持有一份自己的 RuntimeState（live-runtime 那套纯函数），表单提交走
 * addRow 真写进去，下面的表格/详情立刻多一行。不是截图，不是示意。
 *
 * ## 为什么它是个副本
 *
 * 用户还要求：「相当于这个还是一个副本，你把原组件删掉，也丝毫不会影响到
 * 这个组件」。做法是**开局就把行数据整份深拷贝一份进自己的状态**，之后
 * 它跟 ENTITY_ROWS（组件库那份共用夹具）再无关系：在这一页里录 10 条、删
 * 5 条，切回区块视图那些卡片一行都不变。
 *
 * 摆法仍然复用真实的槽位→网格管线，理由同 SavedPresetCard。
 */
function AssembledPageModal({
  page,
  pageKind,
  onClose,
  onSaved,
}: {
  page: {
    name: string;
    industry?: string;
    blocks: AssembledBlock[];
    dropped?: { block: string; why: string }[];
  };
  pageKind: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [saving, setSaving] = React.useState(false);
  const [savedAs, setSavedAs] = React.useState<string | null>(null);

  /**
   * 存成模板 —— 这是"拆盲盒"闭环的最后一步（2026-08-08 用户描述）：
   * 「AI 组装出来的预设，现在就是一个模板了。」
   *
   * 组件从十几个长到三五百个的过程中，同一个按钮抽出来的东西会越来越丰富，
   * 模板库跟着长。所以模板不该手写——我此前手写的十套，其中三套推荐的积木
   * 在真实应用里会被渲染层直接丢掉，手写的东西没法验证也不会自己变多。
   */
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/sliderule/components/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: page.name,
          industry: page.industry,
          pageKind,
          blocks: page.blocks,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; preset?: { industry: string } };
      if (res.ok && body.ok) {
        setSavedAs(body.preset?.industry ?? page.industry ?? "通用");
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };
  // 深拷贝一份属于这一页的行数据——副本语义就落在这一行上。
  const [rows, setRows] = React.useState<Record<string, RuntimeRow[]>>(() =>
    JSON.parse(JSON.stringify(ENTITY_ROWS))
  );
  const [seq, setSeq] = React.useState(0);
  const [toast, setToast] = React.useState<string | null>(null);
  // 筛选态：不接它 FilterBar 会直接渲染成"本页无可筛选字段"——一个按不动的
  // 控件掉在页面上，正是这一页最不该出现的东西（仓库里为此还专门在 prompt
  // 里禁过总览页用 FilterBar）。接上之后它筛的是**这一页自己的副本数据**。
  const [filterState, setFilterState] = React.useState<PageFilterState>({
    enumFilters: {},
    dateRange: null,
  });
  const filterFieldOptions: FilterFieldOption[] = React.useMemo(
    () =>
      Object.entries(ENUM_OPTIONS).map(([id, opts]) => ({
        id,
        label: FIELD_LABEL[id] ?? id,
        options: opts.map(o => ({ value: o.id, label: o.label })),
      })),
    []
  );
  const dateRangeField = React.useMemo(() => {
    const id = Object.keys(FIELD_TYPE).find(f => FIELD_TYPE[f] === "date");
    return id ? { id, label: FIELD_LABEL[id] ?? id } : null;
  }, []);

  /** 筛过的行——展示类积木吃这一份，所以"筛"是真的会变的。 */
  const visibleRows = React.useMemo(() => {
    const out: Record<string, RuntimeRow[]> = {};
    for (const [entityId, list] of Object.entries(rows)) {
      out[entityId] = list.filter(r => {
        for (const [field, want] of Object.entries(filterState.enumFilters)) {
          if (!want) continue;
          if (String(r.values?.[field] ?? "") !== want) return false;
        }
        const range = filterState.dateRange;
        if (range && dateRangeField) {
          const v = String(r.values?.[dateRangeField.id] ?? "");
          if (v && (v < range[0] || v > range[1])) return false;
        }
        return true;
      });
    }
    return out;
  }, [rows, filterState, dateRangeField]);

  // 被容器装走的不进网格 —— 它们由容器负责渲染。
  const topLevel = page.blocks.filter(b => !b.nested);
  const slots = {
    summary: topLevel.filter(b => b.slot === "summary").map(b => b.id),
    primary: topLevel.filter(b => b.slot === "primary").map(b => b.id),
    secondary: topLevel.filter(b => b.slot === "secondary").map(b => b.id),
    activity: topLevel.filter(b => b.slot === "activity").map(b => b.id),
    content: topLevel.filter(b => b.slot === "content").map(b => b.id),
  };
  const items = resolveBusinessGrid(upgradeLegacySlotsToGrid(pageKind, slots), "desktop");
  const byId = new Map(page.blocks.map(b => [b.id, b]));

  /**
   * 渲染一个积木 —— **不替它套任何外壳**（2026-08-08 用户裁决）。
   *
   * 「组装的时候就要纯粹一点，该是啥就是啥，该是啥组件就是啥组件。」
   * 要卡片外观时由模型自己选 ContentCard 去包，包不包是组装结果的一部分，
   * 不是渲染宿主替它决定的。
   *
   * 容器（ContentCard）把 children 递归渲进去。深度天然有限：服务端只允许
   * children 指向同一批里真实存在的积木，且不能指向自己，环也就无从形成。
   */
  const renderOne = (b: AssembledBlock): React.ReactNode => (
    <ExperienceBlockBoundary
      key={b.id}
      block={{ id: b.id, type: b.type, props: b.props, binding: b.binding } as ExperienceBlockInstance}
      entityRows={visibleRows}
      chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
      filterState={filterState}
      filterFieldOptions={filterFieldOptions}
      dateRangeField={dateRangeField}
      onFilterChange={patch => setFilterState(prev => ({ ...prev, ...patch }))}
      fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
      fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
      enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
      onAction={handleAction}
      workflow={WORKFLOW}
    >
      {b.children && b.children.length > 0
        ? b.children.map(id => {
            const child = byId.get(id);
            return child ? renderOne(child) : null;
          })
        : undefined}
    </ExperienceBlockBoundary>
  );

  /** 表单提交 → 真写一行。写完让 toast 说清楚写进了哪个实体、现在几条。 */
  const handleAction = (actionId: string, data?: Record<string, unknown>) => {
    if (actionId !== "submitRequest") return;
    const entityRef = String(data?.entityRef ?? "");
    const values = (data?.values ?? {}) as Record<string, unknown>;
    if (!entityRef || !rows[entityRef]) return;
    const next = seq + 1;
    setSeq(next);
    setRows(prev => ({
      ...prev,
      [entityRef]: [
        ...(prev[entityRef] ?? []),
        { id: `asm-row-${next}`, values, createdAt: new Date().toISOString() },
      ],
    }));
    setToast(`已写入 ${entityRef}，现在共 ${(rows[entityRef]?.length ?? 0) + 1} 条`);
    window.setTimeout(() => setToast(null), 2600);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
      data-testid="assembled-page-modal"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-2.5">
          <span className="truncate text-[14px] font-semibold text-slate-900">{page.name}</span>
          <span className="shrink-0 rounded bg-[#e8eeff] px-2 py-0.5 text-[11px] text-[#3b5bdb]">
            AI 现场组装 · {page.blocks.length} 个积木
          </span>
          {page.industry && (
            <span className="shrink-0 rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              {page.industry}
            </span>
          )}
          {/* 被剔除的必须说出来，不能静默吃掉——否则用户以为模型只拼了这么多 */}
          {page.dropped && page.dropped.length > 0 && (
            <Tooltip
              title={page.dropped.map(d => `${d.block}：${d.why}`).join("；")}
            >
              <span className="shrink-0 cursor-help rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
                剔除 {page.dropped.length} 个
              </span>
            </Tooltip>
          )}
          {toast && (
            <span
              data-testid="assembled-toast"
              className="shrink-0 rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700"
            >
              {toast}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {savedAs ? (
              <span
                data-testid="preset-saved"
                className="rounded bg-green-50 px-2 py-1 text-[11.5px] text-green-700"
              >
                已存入「{savedAs}」模板库
              </span>
            ) : (
              <button
                data-testid="assembled-save"
                disabled={saving}
                onClick={() => void save()}
                className="rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-50"
              >
                {saving ? "存入中…" : "存成模板"}
              </button>
            )}
            <button
              className="rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-500 transition hover:bg-slate-100"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#f0f2f5] p-4">
          <BusinessPageGrid
            breakpoint="desktop"
            items={items}
            renderItem={ref => {
              const b = byId.get(ref);
              if (!b) return null;
              return renderOne(b);
            }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 基础组件墙 —— 官方组件的通用示例。
 *
 * 与区块墙的区别在**这一层没有槽位、没有绑定、没有设备档**：一个 Input 就是
 * 一个 Input，不存在"它该放在主区还是副区"。所以这里的筛选只有一个维度：
 * 官方分组（通用/布局/导航/数据录入/数据展示/反馈）。
 *
 * 排布仍用 SpanMasonry（跟另外两面墙同一个组件），但一律单列宽：官方示例
 * 高度差得很多（一个 Divider 三十几像素，一个 Calendar 两百多），瀑布流正好
 * 吃这个，而跨列在这里没有意义——没有哪个基础组件"需要整行宽才说得清"。
 */
function BaseComponentWall({
  group,
  onGroup,
}: {
  group: string;
  onGroup: (g: string) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, isScrolling, height } = useScrollerIn(containerRef);
  const { width } = useContainerPosition(containerRef, [height]);
  const shown = React.useMemo(
    () => (group === "all" ? BASE_COMPONENTS : BASE_COMPONENTS.filter(c => c.group === group)),
    [group]
  );
  const counts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of BASE_COMPONENTS) m[c.group] = (m[c.group] ?? 0) + 1;
    return m;
  }, []);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <FilterChip
          testid="base-group-all"
          icon={<LayoutGrid size={13} />}
          label="全部"
          count={BASE_COMPONENTS.length}
          active={group === "all"}
          onClick={() => onGroup("all")}
        />
        {BASE_GROUPS.filter(g => counts[g]).map(g => (
          <FilterChip
            key={g}
            testid={`base-group-${g}`}
            label={g}
            count={counts[g]}
            active={group === g}
            onClick={() => onGroup(g)}
          />
        ))}
      </div>
      <div data-testid="base-wall" style={{ display: "contents" }}>
        <SpanMasonry
          containerRef={containerRef}
          items={shown}
          width={width}
          height={height}
          scrollTop={scrollTop}
          isScrolling={isScrolling}
          minColumnWidth={WALL_COLUMN_WIDTH}
          gutter={WALL_GUTTER}
          overscanBy={2}
          itemHeightEstimate={180}
          itemKey={c => c.name}
          getSpan={() => 1}
          className="mt-5"
          render={c => (
            <Card
              data-testid={`base-card-${c.name}`}
              size="small"
              variant="borderless"
              styles={{ body: { padding: 0, overflow: "hidden" } }}
              className="w-full shadow-[0_3px_14px_rgba(15,23,42,0.10)]"
            >
              <div className="border-b border-slate-100 px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13.5px] font-semibold text-slate-900">{c.name}</span>
                  <span className="text-[12px] text-slate-500">{c.label}</span>
                  <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500">
                    {c.group}
                  </span>
                </div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
                  {c.description}
                </div>
              </div>
              {/* 示例本体。给一点内边距——这一层不像业务积木那样要铺满，
                  官方文档里每个 demo 也都是有留白的。 */}
              <div className="px-3 py-3">{c.render()}</div>
            </Card>
          )}
        />
      </div>
    </>
  );
}

/** 区块墙。抽成组件的理由同 AppsWorkbench 的 AppWall：里面全是 hook，
 * 而墙在「有结果 / 搜索无结果」两岔里只有一岔渲染，写在外层就成了条件调用。 */
function BlockWall({ blocks, device }: { blocks: CatalogBlock[]; device: DeviceTier }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, isScrolling, height } = useScrollerIn(containerRef);
  const { width } = useContainerPosition(containerRef, [height]);
  // 手机档只列**真有手机实现**的区块。
  //
  // 2026-08-07 用户裁决：「手机端就是手机端，桌面端就是桌面端。弄一个手机端
  // 桌面降级，这没意思的。」——此前没有手机实现的区块也会出现在手机档里，
  // 拿桌面渲染器塞进 380px 机身、挂一个橙色「桌面降级」角标。那个中间态被
  // 整个删掉：现在手机档列出来的每一张都是真手机渲染器。
  //
  // 「全部」档同理，一个区块出现一次还是两次，取决于它有没有手机实现。
  const entries = React.useMemo<BlockPreviewEntry[]>(
    () => device === "all"
      ? blocks.flatMap(block =>
          hasPhoneImplementation(block)
            ? ([{ block, device: "desktop" }, { block, device: "phone" }] satisfies BlockPreviewEntry[])
            : ([{ block, device: "desktop" }] satisfies BlockPreviewEntry[])
        )
      : device === "phone"
        ? blocks.filter(hasPhoneImplementation).map(block => ({ block, device }))
        : blocks.map(block => ({ block, device })),
    [blocks, device]
  );

  return (
    <div data-testid="components-wall" style={{ display: "contents" }}>
      <SpanMasonry<BlockPreviewEntry>
        containerRef={containerRef}
        items={entries}
        width={width}
        height={height}
        scrollTop={scrollTop}
        isScrolling={isScrolling}
        minColumnWidth={WALL_COLUMN_WIDTH}
        gutter={WALL_GUTTER}
        overscanBy={2}
        // 实测各区块渲染高度 148~451px，取中位偏上；真实高度由 ResizeObserver 量，
        // 这个值只影响首屏还没量到时的总高估算。
        itemHeightEstimate={280}
        itemKey={entry => `${entry.device}-${entry.block.type}`}
        // 手机档不跨列：机身宽度是固定的 380px，跨两列只会让机身两侧多出空白，
        // 不会让内容变宽——跨列的前提是"内容能用上多出来的宽度"，这里用不上。
        getSpan={(entry, _i, columnCount) =>
          entry.device === "phone"
            ? 1
            : spanForColumnCount(isWideBlock(entry.block), columnCount)}
        className="mt-5"
        render={entry => <BlockCard block={entry.block} device={entry.device} />}
      />
    </div>
  );
}

export default function ComponentsLibraryPage() {
  // 区块 = 一个个积木；预设 = 已经排好的组合（2026-08-07）。
  // 预设是模型真正的起点，看不见它就没法判断生成质量的上限在哪，
  // 所以给它一个与"区块"并列的入口，而不是塞在某个角落。
  // 三档，对应三个层次（2026-08-08 用户澄清的分层）：
  //   base    基础组件 —— Ant Design 官方组件的通用示例，无业务数据
  //   blocks  体验区块 —— 绑数据模型的业务积木，有 binding/槽位/门禁
  //   presets 模板     —— AI 组装攒出来的，分行业
  const [mode, setMode] = React.useState<"base" | "blocks" | "presets">("base");
  const [baseGroup, setBaseGroup] = React.useState<string>("all");
  const [assembling, setAssembling] = React.useState(false);
  const [assembled, setAssembled] = React.useState<{
    name: string;
    industry?: string;
    blocks: AssembledBlock[];
    dropped?: { block: string; why: string }[];
  } | null>(null);
  const [assembleError, setAssembleError] = React.useState<string | null>(null);
  const [device, setDevice] = React.useState<DeviceTier>("all");
  const [query, setQuery] = React.useState("");
  const [slot, setSlot] = React.useState<string>("all");
  const [pageKind, setPageKind] = React.useState("workbench");

  const blocks = CATALOG.blocks ?? [];
  /**
   * 模板库 —— **攒出来的，不是手写的**（2026-08-08 改）。
   *
   * 此前这里读的是目录 JSON 里我手写的十套 pageKindPresets。那批是死的、
   * 每次一样，而且其中三套推荐的 DataTable 在真实应用里会被渲染层直接丢掉
   * ——手写的东西没法验证，也不会自己变多。
   *
   * 现在读的是 AI 组装攒进库里的：点一次「AI 组装」抽一次盲盒，觉得好就
   * 「存成模板」，AI 判的行业跟着一起存。组件从十几个长到三五百个的过程中，
   * 抽出来的东西越来越丰富，这个库跟着长。
   *
   * 筛选维度也随之从"页面形态"换成**行业**——页面形态是我们内部的结构分类，
   * 行业才是用户找模板时真正会用的那个词。
   */
  const [presets, setPresets] = React.useState<SavedPreset[]>([]);
  const [industries, setIndustries] = React.useState<{ industry: string; count: number }[]>([]);
  const [industry, setIndustry] = React.useState<string>("all");
  const presetCount = industries.reduce((n, x) => n + x.count, 0);

  const loadPresets = React.useCallback(async () => {
    try {
      const res = await fetch("/api/sliderule/components/presets");
      if (!res.ok) return;
      const body = (await res.json()) as {
        presets?: SavedPreset[];
        industries?: { industry: string; count: number }[];
      };
      setPresets(body.presets ?? []);
      setIndustries(body.industries ?? []);
    } catch {
      // 模板库拉不到不该让整页挂掉——区块视图本来就不依赖它
    }
  }, []);
  React.useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const shownPresets =
    industry === "all" ? presets : presets.filter(p => p.industry === industry);

  /**
   * AI 组装：把**当前这一页真正显示着的**积木类型交给模型，让它现场拼一页。
   *
   * 传 allowedTypes 而不是让服务端自己算，是因为用户说的是"从当前显示的
   * 各个组件"里拼——页面形态、槽位、搜索这些筛选此刻筛出什么，就从什么
   * 里面挑。服务端再按目录复验一遍（模型仍可能挑目录外的）。
   *
   * 数据模型用组件库自己那份订单夹具：这一页存在的意义是看积木怎么拼，
   * 不是再造一遍推演。字段类型/枚举取值都跟卡片里那份逐字节相同，所以
   * 组装出来的表单跟你在卡片上看到的是同一个东西。
   */
  const runAssemble = async () => {
    if (assembling) return;
    setAssembling(true);
    setAssembleError(null);
    try {
      const res = await fetch("/api/sliderule/components/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageKind,
          allowedTypes: filtered.map(b => b.type),
          datamodel: {
            entities: [
              {
                id: "order",
                name: "订单",
                fields: Object.keys(FIELD_TYPE).map(id => ({
                  id,
                  name: FIELD_LABEL[id] ?? id,
                  type: FIELD_TYPE[id],
                })),
              },
            ],
          },
        }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        name?: string;
        industry?: string;
        blocks?: AssembledBlock[];
        dropped?: { block: string; why: string }[];
        error?: string;
      };
      if (!res.ok || !body.ok || !body.blocks?.length) {
        setAssembleError(body.error || `组装失败（HTTP ${res.status}）`);
        return;
      }
      setAssembled({
        name: body.name || "组装页面",
        industry: body.industry,
        blocks: body.blocks,
        dropped: body.dropped,
      });
    } catch (e) {
      setAssembleError(String(e instanceof Error ? e.message : e));
    } finally {
      setAssembling(false);
    }
  };
  const pageKindBlocks = React.useMemo(
    () => blocks.filter(block => (block.pageKinds ?? []).includes(pageKind)),
    [blocks, pageKind]
  );
  const filtered = React.useMemo(() => {
    const kw = query.trim().toLowerCase();
    return pageKindBlocks.filter(b => {
      const hitKw =
        !kw ||
        b.type.toLowerCase().includes(kw) ||
        (b.description ?? "").toLowerCase().includes(kw) ||
        (IMPL_BY_TYPE[b.type] ?? "").toLowerCase().includes(kw);
      const hitSlot = slot === "all" || (b.allowedSlots ?? []).includes(slot);
      return hitKw && hitSlot;
    });
  }, [pageKindBlocks, query, slot]);

  // 先筛后铺：铺开只影响展示次序，不影响筛出来的集合。
  // 手机档不跨列，也就没有"宽卡挤成一坨"的问题，保持目录原序更好读。
  const ordered = React.useMemo(
    () => (device === "phone" ? filtered : interleaveWide(filtered)),
    [filtered, device]
  );
  return (
    <div data-testid="components-library" className="px-6 pb-10 pt-5 md:px-8 md:pt-6">
      {/* 吸顶头：与应用中心同一套（-mx/-mt 抵消外层内边距，保证背景铺满） */}
      <div className="sticky top-0 z-30 -mx-6 -mt-5 bg-[var(--sr-shell-bg,#fff)] px-6 pt-5 pb-3 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          {/* 标题块：8×8 圆角底座 + lucide LayoutGrid + #5b6cff，与 AppsWorkbench
              一模一样。原来是裸的 AppstoreOutlined，既没有底座、色号也是 #1677ff。 */}
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
              <LayoutGrid size={18} strokeWidth={2.2} />
            </span>
            <h1 className="text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
              体验区块库
            </h1>
          </div>

          {/* 搜索框：应用中心那个自绘的（无边框 + 半透明底 + ring），不是
              antd Input.Search——后者自带搜索按钮和另一套高度/边框，摆在一起
              一眼就看得出是两个东西。 */}
          <div className="relative w-full min-w-[200px] flex-1 sm:mx-4 sm:max-w-xl md:max-w-2xl">
            <Search
              size={15}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              data-testid="components-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="搜区块名、说明或实现…"
              className="w-full rounded-lg border-0 bg-white/70 py-2.5 pl-10 pr-4 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/60 placeholder:text-slate-400 transition focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
            />
          </div>
        </div>

        {/* 筛选区：chip 样式与间距照 AppsWorkbench，但**分两行**。
            
            那边一行装得下是因为它只有 6 个 chip（2 个库切换 + 4 个状态）；
            这里有 15 个（6 页面形态 + 7 槽位 + 3 档位），挤一行密度差一大截，
            窄屏 flex-wrap 还会从某个组的中间折断，看着像折错了而不是排版。
            
            所以按**层级**拆，不是按数量拆：
              第一行 = 看哪一类页面 · 看哪个档位   —— 两个"我在看什么"的维度
              第二行 = 在这批里再按槽位收窄       —— "再筛一下"
            档位放第一行右端（ml-auto），位置对应应用中心那行右端的排序控件。 */}
        <div
          className="mt-4 flex flex-wrap items-center gap-1.5"
          data-testid="components-filters"
        >
          <span className="contents" data-testid="components-page-kind-switch">
            {PAGE_KINDS.map(kind => (
              <FilterChip
                key={kind.key}
                testid={`components-page-kind-${kind.key}`}
                label={kind.label}
                count={blocks.filter(b => (b.pageKinds ?? []).includes(kind.key)).length}
                active={pageKind === kind.key}
                onClick={() => setPageKind(kind.key)}
              />
            ))}
          </span>

          <div
            className="ml-auto flex items-center gap-1.5"
            data-testid="components-mode-switch"
          >
            <FilterChip
              testid="components-mode-base"
              label="基础组件"
              count={BASE_COMPONENTS.length}
              active={mode === "base"}
              onClick={() => setMode("base")}
            />
            <FilterChip
              testid="components-mode-blocks"
              label="区块"
              count={blocks.length}
              active={mode === "blocks"}
              onClick={() => setMode("blocks")}
            />
            <FilterChip
              testid="components-mode-presets"
              label="预设"
              count={presetCount}
              active={mode === "presets"}
              onClick={() => setMode("presets")}
            />
            {/* AI 组装：现场从当前显示的积木里拼一页出来，能真录数据。
                与「预设」的区别是死活——预设是手写死的固定组合，这个是每点
                一次现拼一次。 */}
            <button
              type="button"
              data-testid="components-assemble"
              disabled={assembling || filtered.length === 0}
              onClick={() => void runAssemble()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-50"
            >
              <Sparkles size={13} />
              {assembling ? "组装中…" : "AI 组装"}
            </button>
          </div>

          <div
            className="ml-3 flex items-center gap-1.5"
            data-testid="components-device-switch"
          >
            <FilterChip label="全部" active={device === "all"} onClick={() => setDevice("all")} />
            <FilterChip
              icon={<Monitor size={13} className="text-slate-400" />}
              label="桌面档"
              active={device === "desktop"}
              onClick={() => setDevice("desktop")}
            />
            <FilterChip
              icon={<Smartphone size={13} className="text-slate-400" />}
              label="手机档"
              active={device === "phone"}
              onClick={() => setDevice("phone")}
            />
          </div>
        </div>

        {/* 第二行：槽位收窄。计数走 pageKindBlocks 而不是 blocks——它显示的是
            "在当前这类页面里，这个槽位有几个区块可用"，跟着上一行的选择走。 */}
        <div
          className="mt-4 flex flex-wrap items-center gap-1.5"
          data-testid="components-slot-filters"
        >
          <FilterChip
            testid="components-slot-all"
            icon={<LayoutGrid size={13} />}
            label="全部槽位"
            count={pageKindBlocks.length}
            active={slot === "all"}
            onClick={() => setSlot("all")}
          />
          {(CATALOG.allowedSlots ?? []).map(sl => (
            <FilterChip
              key={sl}
              testid={`components-slot-${sl}`}
              icon={<Rows3 size={13} className="text-slate-400" />}
              label={SLOT_LABEL[sl] ?? sl}
              count={pageKindBlocks.filter(b => (b.allowedSlots ?? []).includes(sl)).length}
              active={slot === sl}
              onClick={() => setSlot(sl)}
            />
          ))}
        </div>
      </div>

      {assembleError && (
        <div
          data-testid="assemble-error"
          className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[12.5px] text-red-600"
        >
          {assembleError}
        </div>
      )}
      {assembled && (
        <AssembledPageModal
          page={assembled}
          pageKind={pageKind}
          onClose={() => setAssembled(null)}
          onSaved={() => void loadPresets()}
        />
      )}

      {mode === "base" ? (
        <BaseComponentWall group={baseGroup} onGroup={setBaseGroup} />
      ) : mode === "presets" ? (
        <>
          {/* 行业筛选：取值来自库里真实存在的行业，不是我们预先定死的一张表。
              AI 判出什么行业，这里就有什么——库长什么样，筛选就长什么样。 */}
          {industries.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <FilterChip
                label="全部行业"
                count={presetCount}
                active={industry === "all"}
                onClick={() => setIndustry("all")}
              />
              {industries.map(x => (
                <FilterChip
                  key={x.industry}
                  label={x.industry}
                  count={x.count}
                  active={industry === x.industry}
                  onClick={() => setIndustry(x.industry)}
                />
              ))}
            </div>
          )}
          {shownPresets.length === 0 ? (
            <Empty
              description="模板库还是空的 —— 点右上角「AI 组装」抽一套，觉得好就存下来"
              className="py-16"
            />
          ) : (
            // 单列：一套模板本身就是一整页的排布，塞进瀑布流的窄列会把
            // "2/3 主区 + 1/3 副区"压成两条竖条，那正好把要看的东西看没了。
            <div className="mt-5 flex flex-col gap-4">
              {shownPresets.map(ps => (
                <SavedPresetCard key={ps.id} preset={ps} />
              ))}
            </div>
          )}
        </>
      ) : filtered.length === 0 ? (
        <Empty description="没有匹配的区块" className="py-16" />
      ) : (
        <BlockWall blocks={ordered} device={device} />
      )}
    </div>
  );
}
