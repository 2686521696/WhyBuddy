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
import { LayoutGrid, Monitor, Rows3, Search, Smartphone } from "lucide-react";
import { useContainerPosition } from "masonic";
import catalogJson from "@experience-blocks";
import { SpanMasonry } from "@/pages/agent-loop/dashboard/SpanMasonry";
import { useScrollerIn } from "@/pages/agent-loop/dashboard/useScrollerIn";
import { spanForColumnCount } from "@/pages/agent-loop/dashboard/app-wall-span";
import { ExperienceBlockBoundary } from "./live-runtime/block-registry";
import BusinessPageGrid from "./live-runtime/BusinessPageGrid";
import {
  resolveBusinessGrid,
  upgradeLegacySlotsToGrid,
} from "./live-runtime/business-page-layout";
import type { ExperienceBlockInstance } from "./live-runtime/block-registry";
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
  // 2026-08-07 表单/详情族：全部来自已装的 @ant-design/pro-components 2.8
  RecordForm: "ProComponents ProForm",
  RecordFormDialog: "ProComponents DrawerForm / ModalForm",
  RecordDetail: "ProComponents ProDescriptions",
  StepsForm: "ProComponents StepsForm",
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
function demoFor(type: string): {
  block: ExperienceBlockInstance;
  extra: Record<string, unknown>;
} {
  const base = { id: `demo-${type}`, type };
  switch (type) {
    // ── 表单/详情族（2026-08-07）：全部来自已装的 pro-components ──────────
    // fieldRefs 显式声明要哪几个字段——**不写就走"从行数据推前 6 个"那条
    // 兜底路径**，那条路径在真实应用里是有的，但对照台要看的是"声明了会
    // 怎样"，两种都留在这里反而看不出契约在起作用。
    case "RecordForm":
      return {
        block: {
          ...base,
          props: { title: "新建订单", submitText: "创建", layout: "vertical" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel", "at"] },
        },
        extra: {},
      };
    case "RecordFormDialog":
      return {
        block: {
          ...base,
          props: { title: "新建订单", mode: "drawer", triggerText: "新建订单" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status"] },
        },
        extra: {},
      };
    case "RecordDetail":
      return {
        block: {
          ...base,
          props: { title: "订单详情", columns: 2 },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "channel", "at"] },
        },
        extra: {},
      };
    case "StepsForm":
      return {
        block: {
          ...base,
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
      };
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
  // 2026-08-07 表单/详情族
  "RecordForm", "RecordFormDialog", "RecordDetail", "StepsForm",
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
 * 底部元信息的文字阴影：四向 1px 浅色描边 + 一层柔和灰投影。
 *
 * 去掉深色渐变遮罩之后，这行字直接压在组件上，而组件的底色是不确定的
 * （多数是白/浅灰，也可能压到蓝色进度条、深色按钮上）。单一方向的
 * drop-shadow 只在一种底上有效，四向描边才是两种底都能读。
 */
const META_TEXT_SHADOW =
  "0 1px 0 rgba(255,255,255,0.9), 0 -1px 0 rgba(255,255,255,0.9), " +
  "1px 0 0 rgba(255,255,255,0.9), -1px 0 0 rgba(255,255,255,0.9), " +
  "0 2px 6px rgba(15,23,42,0.28)";

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

  const statusLabel = device === "phone" ? "手机档" : "桌面档";
  // 卡片角标跟顶部档位 chip 用同一套 lucide 图标——原来这里是 antd 的
  // Mobile/DesktopOutlined，跟顶部两个图标线宽和字重都对不上。
  const DeviceIcon = device === "phone" ? Smartphone : Monitor;

  return (
    <Card
      data-testid={`component-card-${block.type}`}
      size="small"
      variant="borderless"
      styles={{ body: { padding: 0, overflow: "hidden", position: "relative" } }}
      className="w-full shadow-[0_3px_14px_rgba(15,23,42,0.10)]"
    >
      {/* 渲染区四边不留白，组件铺满整张卡（2026-08-07 用户裁决）。 */}
      <div className="w-full">{rendered}</div>
      {/* 档位角标：无边框，半透明底 + 外阴影撑起层次（2026-08-07 用户裁决）。
          ring-1 那圈灰边去掉之后，与内容的分离全靠 shadow + backdrop-blur——
          阴影比原来的 shadow-sm 重一档，否则贴在浅色内容上会糊成一片。 */}
      <span className="absolute right-2.5 top-2.5 z-10 inline-flex items-center gap-1 rounded-md bg-white/75 px-2 py-1 text-[11px] font-medium text-slate-700 shadow-[0_2px_8px_rgba(15,23,42,0.16)] backdrop-blur-sm">
        <DeviceIcon size={12} />
        {statusLabel}
      </span>
      {/* 底部元信息条：**不铺任何背景**，且**不再浮在内容上**。

          2026-08-07 用户裁决三条：去掉上下 padding、角标去边框、"底部的阴影
          背景可以去掉，文字加灰色阴影的方式也会很清晰"。

          前两条直接照做。第三条**先按字面做了一版，实测不能用**：把 64px 留白
          和深色渐变一起撤掉之后，元信息真的压在内容上——MetricGrid 盖住
          「1,648」、QuickActionPanel 盖住三个按钮、RankedList 盖住第 4/5 名、
          DataTable 盖住末行、FilterBar 盖住「重置/查询」。文字阴影救不回来，
          因为糊住它的不是背景色，是**另一层字**。

          所以这里取的是能同时满足三条诉求的形状：**元信息回到正常流**，排在
          渲染区下面而不是压在上面。于是
            · 没有任何背景遮罩 ✅（第三条的诉求）
            · 渲染区四边零留白 ✅（第一条的诉求，padding 是 0，不是 64）
            · 元信息一个像素都不挡内容 ✅（这一页存在的意义）
          代价是卡片比"纯浮层"高出一行元信息的量。

          文字随之从白色改成深色——白字的可读性完全来自那层深色渐变，遮罩撤了
          白字就隐形。仍然保留 textShadow：卡片底色虽是白的，但组件自己可能把
          背景铺到底（FilterBar 的按钮条），描边让两种底都读得清。 */}
      <div className="relative z-10 px-3 pb-2 pt-2">
        <div className="flex items-center">
          <Tooltip title={block.description}>
            <span
              className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-slate-900"
              style={{ textShadow: META_TEXT_SHADOW }}
            >
              {block.type}
            </span>
          </Tooltip>
        </div>
        <div
          className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-600"
          style={{ textShadow: META_TEXT_SHADOW }}
        >
          <span>{impl ?? "实现未登记"}</span>
          {(block.allowedSlots ?? []).map(s => (
            <span key={s}>{SLOT_LABEL[s] ?? s}</span>
          ))}
          {(block.dataKinds ?? []).map(k => (
            <span key={k}>{DATAKIND_LABEL[k] ?? k}</span>
          ))}
          {block.freeformGenerated && <span>AI 现场设计</span>}
        </div>
      </div>
    </Card>
  );
}

/**
 * 预设卡：把一套"排好的组合"按**真实页面的摆法**摆出来。
 *
 * ## 为什么不自己近似一套栅格
 *
 * 槽位到网格的映射是有真实实现的（business-page-layout.upgradeLegacySlotsToGrid
 * → resolveBusinessGrid → BusinessPageGrid），而且每种 pageKind 的映射还不一样
 * （dashboard 的 summary 是整行、workbench 的 primary 占 2/3…）。这里照抄一份
 * 近似的，就等于让这一页展示的排布**跟真实应用不是同一件事**——而这一页存在
 * 的全部意义就是"看见真实的样子"。所以直接复用那条管线。
 *
 * 与区块卡同一条纪律：渲染器是真的，数据是同一份夹具，摆法也是真的。
 */
function PresetCard({ kind, preset }: { kind: string; preset: PagePreset }) {
  // 预设只声明 (type, slot)，这里补上实例 id —— 网格是按 blockRef 索引的。
  const instances = preset.blocks.map((b, i) => ({
    ...b,
    id: `${preset.id}-${i}-${b.type}`,
  }));
  const slots = {
    summary: instances.filter(b => b.slot === "summary").map(b => b.id),
    primary: instances.filter(b => b.slot === "primary").map(b => b.id),
    secondary: instances.filter(b => b.slot === "secondary").map(b => b.id),
    activity: instances.filter(b => b.slot === "activity").map(b => b.id),
    content: instances.filter(b => b.slot === "content").map(b => b.id),
  };
  const layouts = upgradeLegacySlotsToGrid(kind, slots);
  const items = resolveBusinessGrid(layouts, "desktop");
  const byId = new Map(instances.map(b => [b.id, b]));
  return (
    <Card
      data-testid={`preset-card-${kind}-${preset.id}`}
      size="small"
      variant="borderless"
      styles={{ body: { padding: 0, overflow: "hidden", position: "relative" } }}
      className="w-full shadow-[0_3px_14px_rgba(15,23,42,0.10)]"
    >
      <div className="border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-semibold text-slate-900">{preset.name}</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
            {PAGE_KINDS.find(k => k.key === kind)?.label ?? kind}
          </span>
        </div>
        {/* "什么时候用"必须摆出来——它是模型挑预设的唯一依据，
            看不见它就没法判断这套预设写得对不对。 */}
        <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{preset.when}</div>
      </div>
      <div className="bg-[#f0f2f5] p-3">
        <BusinessPageGrid
          breakpoint="desktop"
          items={items}
          renderItem={ref => {
            const b = byId.get(ref);
            if (!b) return null;
            const { block, extra } = demoFor(b.type);
            if (!HAS_DEMO.has(b.type)) {
              return (
                <Card size="small" variant="borderless">
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={`${b.type} 还没有示例数据`}
                  />
                </Card>
              );
            }
            return (
              <Card
                size="small"
                variant="borderless"
                styles={{ body: { padding: 0, overflow: "hidden" } }}
                className="shadow-[0_1px_6px_rgba(15,23,42,0.08)]"
              >
                <ExperienceBlockBoundary
                  block={{ ...block, id: b.id }}
                  entityRows={ENTITY_ROWS}
                  chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
                  fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
                  fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
                  enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
                  {...extra}
                />
                <div className="border-t border-slate-100 px-2 py-1 text-[10.5px] text-slate-400">
                  {b.type} · {SLOT_LABEL[b.slot] ?? b.slot}
                </div>
              </Card>
            );
          }}
        />
      </div>
    </Card>
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
  const [mode, setMode] = React.useState<"blocks" | "presets">("blocks");
  const [device, setDevice] = React.useState<DeviceTier>("all");
  const [query, setQuery] = React.useState("");
  const [slot, setSlot] = React.useState<string>("all");
  const [pageKind, setPageKind] = React.useState("workbench");

  const blocks = CATALOG.blocks ?? [];
  const allPresets = CATALOG.pageKindPresets ?? {};
  const presetCount = Object.values(allPresets).reduce((n, ps) => n + ps.length, 0);
  // 预设按**页面形态**过滤，跟第一行那排 chip 走同一个选择——不另开一套筛选。
  const kindPresets = allPresets[pageKind] ?? [];
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

      {mode === "presets" ? (
        kindPresets.length === 0 ? (
          <Empty description="这种页面形态还没有预设" className="py-16" />
        ) : (
          // 预设走单列：一套预设本身就是一整页的排布，塞进瀑布流的窄列
          // 会把"2/3 主区 + 1/3 副区"压成两条竖条，那正好把要看的东西看没了。
          <div className="mt-5 flex flex-col gap-4">
            {kindPresets.map(ps => (
              <PresetCard key={ps.id} kind={pageKind} preset={ps} />
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <Empty description="没有匹配的区块" className="py-16" />
      ) : (
        <BlockWall blocks={ordered} device={device} />
      )}
    </div>
  );
}
