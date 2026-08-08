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
 * **allowedRegions 含整行区域** —— 整行区域在真实页面里就是通栏的，能放进去的区块
 * 天然需要横向空间（DataTable 要摆列、WorkflowTimeline 要横向展开阶段）。
 * 不是随机、也不是按好看程度挑。
 */

import React from "react";
import { Card, Dropdown, Empty, Tooltip } from "antd";
// 顶部一律用 lucide，与 AppsWorkbench 同源；antd 图标只留给卡片内部。
import { ChevronDown, LayoutGrid, Monitor, Rows3, Search, Smartphone, Sparkles, X } from "lucide-react";
import { useContainerPosition } from "masonic";
import catalogJson from "@experience-blocks";
import { SpanMasonry } from "@/pages/agent-loop/dashboard/SpanMasonry";
import { useScrollerIn } from "@/pages/agent-loop/dashboard/useScrollerIn";
import { spanForColumnCount } from "@/pages/agent-loop/dashboard/app-wall-span";
import { BLOCK_DEFINITIONS, ExperienceBlockBoundary } from "./live-runtime/block-registry";
import { interleaveWide, isWideBlock } from "./block-wall-order";
import { BASE_COMPONENTS, BASE_GROUPS } from "./base-components/base-catalog";
import BusinessPageGrid from "./live-runtime/BusinessPageGrid";
import {
  resolveBusinessGrid,
  regionsToGrid,
  type BusinessRegions,
} from "./live-runtime/business-page-layout";
import type {
  ExperienceBlockInstance,
  FilterFieldOption,
  BlockColumnState,
  PageColumnState,
  PageFilterState,
  PageSelectionState,
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
/**
 * ── 筛选条 —— 照 Shopify Polaris 的 Filters 模型重做（2026-08-08）─────────
 *
 * ## 为什么重做
 *
 * 用户："目前顶部的筛选区域已经承载不了我们目前的页面，包括筛选的级联关系，
 * 包括现在的排列方式，已经承载不住了。"
 *
 * 症结有两条，第二条更要命：
 *
 *   ① **占地方**：三行 chip 常驻（范式 7 + 区域 6 + 能力 7 = 20 个），
 *      内容还没开始就吃掉三行高度。组件从 14 长到 137，只会更糟。
 *   ② **层次混了**：范式/区域是"区块"那一层的维度（页面形态、槽位），
 *      能力是"基础组件"那一层的（官方分组），行业是"模板"那一层的。
 *      现在不管在哪个档都全摆着——在基础组件档下摆着区块的槽位筛选，
 *      点了什么也不会发生。这就是用户说的"级联关系承载不住"。
 *
 * ## 抄的什么
 *
 * Shopify/polaris 的 Filters（polaris-react/src/components/Filters）：
 *
 *     filters: FilterInterface[]       每个维度一条：key + label + 控件
 *                                      pinned 才常驻，其余收进「+ 添加筛选」
 *     appliedFilters: AppliedFilter[]  **只有已选中的**才以 pill 形式占位，
 *                                      可单独 × 掉
 *     onClearAll                       一键清空
 *
 * 关窍是那句 "Applied filters which are rendered as filter pills"——
 * **筛选项平时不占地方，占地方的只有你已经选了的**。20 个 chip 于是塌成
 * 几个下拉按钮 + 零到三个 pill。
 *
 * 层次问题则靠"每个模式带自己那套维度"解决（对应 Polaris 的 tabs + 每个 tab
 * 自己的 filters 数组）：基础组件档只有能力和端，区块档才有范式和区域。
 * 不适用的维度**根本不出现**，而不是出现了点不动。
 */
interface FilterDim {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string; count?: number }[];
  onChange: (v: string) => void;
}

function FilterBarRow({
  dims,
  extra,
}: {
  dims: FilterDim[];
  extra?: React.ReactNode;
}) {
  const applied = dims.filter(d => d.value !== "all");
  const labelOf = (d: FilterDim) =>
    d.options.find(o => o.value === d.value)?.label ?? d.value;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="components-filters">
      {dims.map(d => (
        <Dropdown
          key={d.key}
          trigger={["click"]}
          menu={{
            selectable: true,
            selectedKeys: [d.value],
            items: d.options.map(o => ({
              key: o.value,
              label: (
                <span className="inline-flex min-w-[120px] items-center gap-3">
                  <span>{o.label}</span>
                  {o.count !== undefined && (
                    <span className="ml-auto tabular-nums text-[11px] text-slate-400">
                      {o.count}
                    </span>
                  )}
                </span>
              ),
            })),
            onClick: ({ key }) => d.onChange(key),
          }}
        >
          <button
            type="button"
            data-testid={`filter-dim-${d.key}`}
            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
              d.value !== "all"
                ? "bg-[#e8eeff] text-[#3b5bdb]"
                : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
            }`}
          >
            {d.label}
            <ChevronDown size={13} className="opacity-60" />
          </button>
        </Dropdown>
      ))}

      {/* 已选中的才占位。这是整个改动的关窍——平时这一段是空的。 */}
      {applied.length > 0 && (
        <>
          <span className="mx-1 h-4 w-px bg-slate-200" />
          {applied.map(d => (
            <span
              key={d.key}
              data-testid={`filter-pill-${d.key}`}
              className="inline-flex items-center gap-1 rounded-lg bg-[#5b6cff] px-2.5 py-1.5 text-[12px] font-medium text-white"
            >
              {d.label}：{labelOf(d)}
              <button
                type="button"
                aria-label={`清除${d.label}筛选`}
                className="ml-0.5 opacity-70 transition hover:opacity-100"
                onClick={() => d.onChange("all")}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <button
            type="button"
            data-testid="filter-clear-all"
            className="rounded-lg px-2.5 py-1.5 text-[12px] text-slate-500 transition hover:bg-slate-100"
            onClick={() => applied.forEach(d => d.onChange("all"))}
          >
            清空
          </button>
        </>
      )}

      {extra && <span className="ml-auto flex items-center gap-1.5">{extra}</span>}
    </div>
  );
}

interface CatalogBlock {
  type: string;
  description?: string;
  rendererKey?: string;
  rendererStatus?: string;
  generationEnabled?: boolean;
  dataKinds?: string[];
  allowedRegions?: string[];
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
  /** 区域目录 —— 键就是区域名，值带 label / band / 出处（见 pageRegions 的注释）。 */
  pageRegions: Record<string, { label: string; band: string; evidence: string }>;
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
  Object.entries(BLOCK_DEFINITIONS).map(([type, d]) => [
    type,
    d.uses.length > 0 ? d.uses.join(" + ") : "非组件实现",
  ])
);

/**
 * 反查：这个基础组件被哪些区块用到了。
 *
 * 2026-08-08 用户问了一句要害的话：「AI 组装它是真的从这 130 多个组件里面
 * 组装的吗」。答案是不是——装配器看得见的是 13 个区块，基础组件由区块内部
 * 调用。所以真正该回答的是"137 个里有多少真的被区块用上了"，而这个数字
 * 此前**说不出来**，因为那层关系只存在一个手写字符串里。
 *
 * 现在能算了，而且组件库直接把它标出来：没有任何区块用到的组件，如实显示
 * 「还没接进区块」。那是覆盖缺口，不是 bug——但看不见它就没法有意识地补。
 */
const BLOCKS_USING = (() => {
  const m: Record<string, string[]> = {};
  for (const [type, d] of Object.entries(BLOCK_DEFINITIONS)) {
    for (const u of d.uses) (m[u] ??= []).push(type);
  }
  return m;
})();
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
  // 2026-08-08 补的六种字段语义要在对照台上**看得见**才叫接上了。
  // 只有类型定义没有真实数据的话，邮箱有没有出 mailto、图片有没有出缩略图，
  // 谁都不知道。
  contact: "联系邮箱",
  detailUrl: "详情链接",
  cover: "门店照片",
  remark: "备注",
  urgent: "加急",
  owner_id: "负责人",
};

/** 字段类型：表单族按它决定出哪种控件（enum→下拉、number→数字、date→日期）。
 *  与 FIELD_LABEL 同源同形——这一页是对照台，两张表都得跟真实数据模型对得上。 */
const FIELD_TYPE: Record<string, string> = {
  name: "string",
  amount: "number",
  status: "enum",
  channel: "enum",
  at: "date",
  // cover 用的是**站内静态资源路径**，不是 picsum 这类外链图床。对照台要在
  // 离线/内网里也能看出"图片语义出的是缩略图"——外链一挡就是六个碎图标，
  // 那时候分不清是语义没接上还是网没通。
  //
  // 这几个**故意声明成 string**：真实数据模型里邮箱、链接、图片地址都是字符串，
  // 更细的语义得从值看出来。这正好压住"声明成字符串就不再往下看"那个坑
  // （上一版就是那样，六种新语义对声明过的字段全部失效）。
  contact: "string",
  detailUrl: "string",
  cover: "string",
  remark: "text",
  urgent: "boolean",
  owner_id: "ref",
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
    { name: "人民路店", amount: 428, status: "done", channel: "线上", at: "2026-08-06",
      contact: "renmin@example.com", detailUrl: "https://example.com/store/1",
      cover: "/brand/miantuan-mark.png", urgent: true, owner_id: "u-1",
      remark: "客户要求当日达，已与配送确认时间窗；如遇雨天顺延至次日上午，需提前电话告知。" },
    { name: "高新店", amount: 366, status: "doing", channel: "门店", at: "2026-08-05",
      contact: "gaoxin@example.com", detailUrl: "https://example.com/store/2",
      cover: "/assets/sliderule-mark.svg", urgent: false, owner_id: "u-2", remark: "常规" },
    { name: "南湖店", amount: 291, status: "done", channel: "线上", at: "2026-08-05",
      contact: "nanhu@example.com", detailUrl: "https://example.com/store/3",
      cover: "/brand/logo.png", urgent: false, owner_id: "u-1", remark: "常规" },
    { name: "城东店", amount: 244, status: "todo", channel: "电话", at: "2026-08-04",
      contact: "chengdong@example.com", detailUrl: "https://example.com/store/4",
      cover: "/assets/sliderule_icon_flat_transparent.png", urgent: true, owner_id: "u-3", remark: "待确认收货地址" },
    { name: "西溪店", amount: 187, status: "doing", channel: "门店", at: "2026-08-03",
      contact: "xixi@example.com", detailUrl: "https://example.com/store/5",
      cover: "/brand/transLogo.png", urgent: false, owner_id: "u-2", remark: "常规" },
    { name: "湖畔店", amount: 132, status: "done", channel: "线上", at: "2026-08-02",
      contact: "hupan@example.com", detailUrl: "https://example.com/store/6",
      cover: "/assets/sliderule_icon_card_transparent.png", urgent: false, owner_id: "u-3", remark: "常规" },
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
          // 详情是宽字段的去处：长文本备注、缩略图、外链在两列描述里比在表格
          // 单元格里更接近真实用法。
          binding: {
            entityRef: "order",
            fieldRefs: ["name", "amount", "status", "at", "cover", "contact", "detailUrl", "remark"],
          },
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
        // fieldRefs 是**显式写死**的，不能省。不写的话渲染器按行数据的键派生前
        // 八个，正好切在 cover 之后——布尔、关联、长文本三种语义在对照台上一个
        // 都看不见。看不见就等于没接上。
        block: {
          id: "demo-DataTable", type: "DataTable", props: { title: "订单明细" },
          binding: {
            entityRef: "order",
            fieldRefs: [
              "name", "cover", "amount", "status", "urgent",
              "owner_id", "contact", "detailUrl", "remark", "at",
            ],
          },
        },
        extra: {},
      },
  EditableSubTable: {
        block: {
          id: "demo-EditableSubTable", type: "EditableSubTable",
          props: { title: "订单明细", editMode: "row", maxRows: 8, addText: "新增一行" },
          binding: { entityRef: "order", fieldRefs: ["name", "amount", "status", "at"] },
        },
        extra: {},
      },
  ColumnSettingPanel: {
        block: {
          id: "demo-ColumnSettingPanel", type: "ColumnSettingPanel",
          props: { title: "列设置" },
          // targets 指向墙上那张 DataTable 的 id。这一格是**单块预览**，那张表
          // 不在同一棵树上，所以看不到联动——但连线本身是真的：装进同一页时
          // （对照台下半截的装配预览）勾掉一列，表上那列就消失。
          binding: { entityRef: "order", targets: ["demo-DataTable"] },
        },
        // 面板自己不绑行数据，列清单由宿主给（见渲染器里 targetColumns 的说明）
        extra: { targetColumns: ["name", "cover", "amount", "status", "urgent", "owner_id", "at"] },
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
  // 墙上的示例也得是**能动的**。ColumnSettingPanel 全靠改宿主态活着，宿主不
  // 给回调它就是一排点不动的复选框——这一页刚因为同一个原因让 QuickActionPanel
  // 渲染成空气过（见 previewActions 那段）。这份局部态只服务这张卡。
  const [demoColumnState, setDemoColumnState] = React.useState<PageColumnState>({});
  const demoStateProps = {
    columnState: demoColumnState,
    onColumnStateChange: (targetId: string, next: BlockColumnState) =>
      setDemoColumnState(prev => ({ ...prev, [targetId]: next })),
  };

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
        {...demoStateProps}
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
          {(block.allowedRegions ?? []).map(s => (
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
  const regions = Object.fromEntries(
    REGION_LAYOUT.map(r => [r.key, topLevel.filter(b => b.slot === r.key).map(b => b.id)])
  ) as unknown as BusinessRegions;
  const items = resolveBusinessGrid(regionsToGrid(preset.pageKind, regions), "desktop");
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
/**
 * 一个区块提案 —— 契约，不是代码。
 *
 * 这是链路第二层的入口：基础组件（纯 schema）+ 逻辑 + 关联 = 区块。提案把
 * 「加什么逻辑、关联到什么」说清楚（capability / binding / regions），渲染器
 * 仍然要人写。Ant Design 官方的 pro-blocks 也是这个分工——29 个区块全是手写
 * 源码，`umi block add` 拷源码而已。
 */
interface BlockProposal {
  type: string;
  label: string;
  capability: string;
  does: string;
  uses: string[];
  regions: string[];
  props?: string[];
  binding?: { required?: string[]; optional?: string[] };
  why: string;
}

interface BlockProposalResult {
  proposals: BlockProposal[];
  /** 这一批全建了能释放哪些"还没接进区块"的素材 —— 提案的价值得能量出来。 */
  releases: string[];
  unlinkedBefore: number;
  gatePassed?: boolean;
  attempts?: number;
}

/**
 * 提案面板。
 *
 * 刻意**不长得像一张组装好的页面**：它不是页面，是一份设计稿。所以摆的是
 * 契约本身——收哪些基础组件、声明什么能力、绑什么、落哪些区域、为什么值得建。
 * 做成"预览一张漂亮的页面"反而会让人以为点一下就有了。
 */
function BlockProposalModal({
  result,
  onClose,
}: {
  result: BlockProposalResult;
  onClose: () => void;
}) {
  const after = result.unlinkedBefore - result.releases.length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
      data-testid="block-proposal-modal"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-[1000px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">AI 提议的区块</span>
            <span className="rounded bg-[#e8eeff] px-2 py-0.5 text-[11px] text-[#3b5bdb]">
              契约草案 · 渲染器仍需实现
            </span>
            {/* 提案的价值必须是可量的，否则只是一段好听的话。 */}
            <span
              data-testid="proposal-coverage"
              className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"
            >
              建完可释放 {result.releases.length} 个素材：还没接进区块的从{" "}
              {result.unlinkedBefore} 降到 {after}
            </span>
            <button
              className="ml-auto rounded-lg px-2.5 py-1.5 text-[12.5px] text-slate-500 transition hover:bg-slate-100"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#f0f2f5] p-4">
          <div className="flex flex-col gap-3">
            {result.proposals.map(p => (
              <Card
                key={p.type}
                size="small"
                variant="borderless"
                styles={{ body: { padding: 0, overflow: "hidden" } }}
                data-testid={`proposal-${p.type}`}
                className="shadow-[0_1px_6px_rgba(15,23,42,0.08)]"
              >
                <div className="border-b border-slate-100 px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13.5px] font-semibold text-slate-900">{p.type}</span>
                    <span className="text-[12px] text-slate-500">{p.label}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-500">
                      {p.capability}
                    </span>
                    <span className="ml-auto text-[11px] text-slate-400">
                      落在 {p.regions.join(" / ")}
                    </span>
                  </div>
                  <div className="mt-1 text-[11.5px] leading-relaxed text-slate-500">{p.does}</div>
                </div>
                <div className="space-y-2 p-3 text-[11.5px]">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-slate-400">用基础组件</span>
                    {p.uses.map(u => {
                      const fresh = result.releases.includes(u);
                      return (
                        <span
                          key={u}
                          title={fresh ? "此前没有任何区块用它" : "已经被别的区块用了"}
                          className={`rounded px-1.5 py-0.5 ${
                            fresh
                              ? "bg-amber-50 text-amber-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {u}
                        </span>
                      );
                    })}
                  </div>
                  {p.binding?.required && p.binding.required.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-slate-400">必绑</span>
                      {p.binding.required.map(b => (
                        <span key={b} className="rounded bg-[#e8eeff] px-1.5 py-0.5 text-[#3b5bdb]">
                          {b}
                        </span>
                      ))}
                      {(p.binding.optional ?? []).map(b => (
                        <span key={b} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
                          {b}?
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="rounded bg-slate-50 px-2 py-1.5 leading-relaxed text-slate-600">
                    <span className="text-slate-400">为什么要建：</span>
                    {p.why}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

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



/** 五阶段装配的产物：范式 + 区域 + 每个区域里的区块实例。 */
interface AssembledPage {
  name: string;
  industry: string;
  archetype: string;
  tasks: string[];
  regions: Record<string, AssembledBlock[]>;
  gatePassed?: boolean;
  attempts?: number;
}

/**
 * 区域在页面上占多少空间 —— **权重决定的，不是区块决定的**。
 *
 * 这是"五个组件 = 五张等大卡片"的解药（2026-08-08 用户指出的第 5 条）。
 * 区域声明自己的权重，布局按它分空间：
 *
 *   primary     主角，占主区（2/3 宽）
 *   secondary   为主角服务的（筛选条），整行但矮
 *   supporting  辅助信息，右侧窄栏（1/3）
 *   overlay     **一点页面空间都不占** —— 渲染出来就是个按钮，点了才有东西
 *
 * 区域顺序也在这里定死。不定死的话，模型返回的对象键序会直接变成页面顺序，
 * 那是随机的——同一份装配换个键序就成了另一张页面。
 */
/**
 * 页面区域的排版表 —— **从共享目录派生，不再手抄**。
 *
 * 2026-08-08 第三轮改的就是这里。上一轮这张表是我照着 Python 的
 * page_archetypes.py 手打的第二份，然后加了条对账用例让"一边改了另一边没改"
 * 报错。那是创可贴：两份还是两份，只是漏抄时会被抓。
 *
 * 同一天真机爆的那个 bug（进「区块」档点「清空」，16 个区块一个都不剩）根子
 * 是同一类——范式那栏的选项由 PAGE_KINDS 直接铺出、没有「全部」，而「清空」
 * 把每维置成 "all"，两处对同一个概念的取值集合不一致。**同一个概念写两份，
 * 迟早对不上**，靠用例只能事后抓。
 *
 * 现在两边同读 experience_block_catalog.json：Python 走 schema_legal，这边走
 * vite 的 @experience-blocks 别名。
 *
 * key 的顺序就是区域在页面上从上到下的顺序，由目录里 pageRegions 的键序决定
 * ——不定死的话，模型返回的对象键序会直接变成页面顺序，那是随机的。
 */
type RegionBand = "top" | "main" | "aside" | "footer" | "overlay";
type RegionWeight = "primary" | "secondary" | "supporting" | "overlay";

const REGION_LAYOUT: { key: string; label: string; band: RegionBand }[] =
  Object.entries(
    (CATALOG as unknown as {
      pageRegions: Record<string, { label: string; band: RegionBand }>;
    }).pageRegions
  ).map(([key, meta]) => ({ key, label: meta.label, band: meta.band }));

/**
 * 区域在**某个范式下**的权重。
 *
 * 权重是按范式来的，不是全局的：`main` 在列表页是主角（primary），在结果页
 * 也是主角，但 `metrics` 只有仪表盘才是 primary，列表页压根没有这个区域。
 * 手抄那版把 weight 拍成了全局一份，是错的——只是它当时只用来显示一行灰字，
 * 错了看不出来。
 */
const REGION_WEIGHTS: Record<string, Record<string, RegionWeight>> =
  Object.fromEntries(
    Object.entries(
      (CATALOG as unknown as {
        pageArchetypes: Record<
          string,
          { regions: { key: string; weight: RegionWeight }[] }
        >;
      }).pageArchetypes
    ).map(([archetype, arch]) => [
      archetype,
      Object.fromEntries(arch.regions.map(r => [r.key, r.weight])),
    ])
  );

/**
 * 装配出来的那一页。
 *
 * 与上一版（从 137 个基础组件抽的那个）的区别不是长相，是**里面装的是什么**：
 * 那版装的是组件示例（Button 的「主按钮/次按钮/虚线」原样搬进来），这版装的
 * 是绑到真实实体和字段上的业务区块实例。所以这版能真录数据，那版只能看。
 *
 * 头部把 tasks 摆出来——那是"用户在这一页要干什么"的答案，也是整条链路的
 * 第一步。摆出来才看得出模型到底理解了没有；理解错了，下面排布再整齐也是错的。
 */
function AssembledPageModal({
  page,
  onClose,
  onSaved,
}: {
  page: AssembledPage;
  onClose: () => void;
  onSaved?: () => void;
}) {
  // 深拷贝一份属于这一页的行数据 —— 副本语义就落在这一行上：在这里录十条
  // 删五条，切回组件库那些卡片一行都不变。
  const [rows, setRows] = React.useState<Record<string, RuntimeRow[]>>(() =>
    JSON.parse(JSON.stringify(ENTITY_ROWS))
  );
  const [seq, setSeq] = React.useState(0);
  const [toast, setToast] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [savedAs, setSavedAs] = React.useState<string | null>(null);
  // 筛选态**按筛选区块的 id 分片**，不再是页面级一坨（见 rowsForBlock 的注释）。
  const [filterState, setFilterState] = React.useState<Record<string, PageFilterState>>({});
  const EMPTY_FILTER: PageFilterState = React.useMemo(
    () => ({ enumFilters: {}, dateRange: null }),
    []
  );
  /** 这一页所有区块的扁平表 —— 查"谁筛我"要用。 */
  const allBlocks = React.useMemo(
    () =>
      Object.values(page.regions ?? {}).flatMap((items, ri) =>
        (items ?? []).map((b, i) => ({ ...b, id: b.id ?? `r${ri}-${i}` }))
      ),
    [page.regions]
  );
  // 行选择态 —— DataTable 勾选、BatchActionBar 读。
  //
  // 2026-08-08 的教训直接写在这里：QuickActionPanel 的渲染器第一行是"没有
  // pageActions 就返回 null"，而这个预览从来没传过，于是它一直渲染成空气。
  // BatchActionBar 依赖同一类宿主态，所以**先把通路接上再建区块**——不接的话
  // 它在预览里永远显示"勾选左侧的行"，看着像做完了，其实是死的。
  const [selection, setSelection] = React.useState<PageSelectionState>({ rowIds: {} });
  // 列视图态 —— ColumnSettingPanel 改、DataTable 读。跟 filterState 同一套路：
  // **按目标区块 id 存**，一页两张表各改各的。
  const [columnState, setColumnState] = React.useState<PageColumnState>({});

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

  /**
   * 某个数据区块**自己**看到的行 —— 只被指向它的筛选收窄。
   *
   * 2026-08-08 修的真 bug：上一版是页面级一坨，
   *
   *     for (const [entityId, list] of Object.entries(rows))   // 所有实体
   *       ... filterState.enumFilters ...                      // 只按字段名匹配
   *
   * 一页放两张表（订单 + 客户），只要都有 status 字段，筛一个就把两个都筛了。
   * 而 StatusTabs 写 enumFilters[field] 时同样不知道自己该筛哪张表。
   *
   * 现在照 nocobase 的 x-filter-targets：筛选区块显式声明自己筛谁
   * （SchemaSettingsConnectDataBlocks.tsx），数据区块反过来问"谁在筛我"。
   * 位置（区域）和关系（targets）是两根独立的轴——筛选条在页头、表格在主区，
   * 但连线是明确的。
   */
  const rowsForBlock = React.useCallback(
    (blockId: string): Record<string, RuntimeRow[]> => {
      const applied = allBlocks
        .filter(b => (b.binding?.targets as string[] | undefined)?.includes(blockId))
        .map(b => filterState[b.id])
        .filter(Boolean) as PageFilterState[];
      if (applied.length === 0) return rows;
      const out: Record<string, RuntimeRow[]> = {};
      for (const [entityId, list] of Object.entries(rows)) {
        out[entityId] = list.filter(r =>
          applied.every(f =>
            Object.entries(f.enumFilters ?? {}).every(([field, want]) =>
              !want ? true : String(r.values?.[field] ?? "") === want
            )
          )
        );
      }
      return out;
    },
    [rows, filterState, allBlocks]
  );

  /**
   * 列设置面板要列出的字段 —— 从它 targets 指向的那张表**当前的列**来。
   *
   * 面板自己不绑行数据（它的 dataKinds 是空的），所以这份清单必须由宿主给。
   * 顺序也从目标表格来：目标声明了 fieldRefs 就用它，没声明就是行数据的键。
   * 这跟 DataTable 自己那套派生规则得是同一份，否则面板上列出来的和表上画
   * 出来的对不上——用户勾掉一个，表上没反应。
   */
  const targetColumnsOf = React.useCallback(
    (b: AssembledBlock): string[] | undefined => {
      const targets = (b.binding?.targets as string[] | undefined) ?? [];
      if (targets.length === 0) return undefined;
      const target = allBlocks.find(x => x.id === targets[0]);
      if (!target) return undefined;
      const declared = target.binding?.fieldRefs as string[] | undefined;
      if (Array.isArray(declared) && declared.length > 0) return declared.map(String);
      const entityRef = String(target.binding?.entityRef ?? "");
      const list = rows[entityRef] ?? [];
      return [...new Set(list.flatMap(r => Object.keys(r.values ?? {})))].slice(0, 8);
    },
    [allBlocks, rows]
  );

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

  /**
   * 预览用的页面操作 —— 拿这一页自己的 tasks 当按钮。
   *
   * 2026-08-08 实测抓到的坑：`QuickActionPanelRenderer` 第一行就是
   * `if ((pageActions ?? []).length === 0) return null`——按钮来源是宿主给的
   * pageActions，而这个预览**从来没传过**。于是任何被装进页面的
   * QuickActionPanel 都渲染成空气：不报错、不占位、什么都没有。
   *
   * 以前看不出来，是因为它总跟别的区块挤在同一个区里；这次 footerBar 把它
   * 单独放进底部那条带，一眼就露馅了（整条带是空的）。
   *
   * 预览里没有真实应用的操作清单，但这一页的 tasks 正是模型写下的"用户在这
   * 一页要干的事"（提交入库单 / 新增商品 / 补货），拿它当按钮既有内容又诚实
   * ——按钮文案和这一页的意图是同一份东西。
   */
  const previewActions = React.useMemo(
    () =>
      (page.tasks ?? []).slice(0, 6).map((t, i) => ({
        id: `preview-task-${i}`,
        label: t,
        permitted: true,
      })),
    [page.tasks]
  );

  const renderBlock = (b: AssembledBlock, i: number) => {
    // 区块 id 用装配结果里给的，没给才退回位置生成的 —— targets 连的是这个 id，
    // 每次渲染都换一个的话连线就断了。
    const blockId = b.id ?? `${b.type}-${i}`;
    return (
    <ExperienceBlockBoundary
      key={blockId}
      block={
        {
          id: blockId,
          type: b.type,
          // surface 一律 plain：区域面板已经提供了那张卡，区块再画一层白底
          // 就是卡里套卡（同"装进 ContentCard 的自动 plain"那条规矩）。
          props: { ...(b.props ?? {}), surface: "plain" },
          binding: b.binding,
        } as ExperienceBlockInstance
      }
      // 数据区块只看到"筛我的那些筛选"作用之后的行；筛选区块自己不展示数据，
      // 传原始行即可（它要靠全量算每个状态有几条）。
      entityRows={rowsForBlock(blockId)}
      chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
      // 筛选态是这个筛选区块自己的那一片
      filterState={filterState[blockId] ?? EMPTY_FILTER}
      filterFieldOptions={filterFieldOptions}
      dateRangeField={dateRangeField}
      onFilterChange={patch =>
        setFilterState(prev => ({
          ...prev,
          [blockId]: { ...(prev[blockId] ?? EMPTY_FILTER), ...patch },
        }))
      }
      selection={selection}
      onSelectionChange={(entityRef, rowIds) =>
        setSelection(prev => ({ rowIds: { ...prev.rowIds, [entityRef]: rowIds } }))
      }
      columnState={columnState}
      onColumnStateChange={(targetId, next) =>
        setColumnState(prev => ({ ...prev, [targetId]: next }))
      }
      // 列设置自己不绑行数据——它要列什么，得问它管的那张表当前有哪几列。
      targetColumns={targetColumnsOf(b)}
      fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
      fieldTypeOf={(_e: string, f: string) => FIELD_TYPE[f]}
      enumOptionsOf={(_e: string, f: string) => ENUM_OPTIONS[f] ?? []}
      pageActions={previewActions}
      onAction={handleAction}
      workflow={WORKFLOW}
    />
    );
  };

  const region = (key: string) => page.regions?.[key] ?? [];
  // 按 band 分带 —— 不再靠 `key === "header"` 猜。原来那种写法每加一个区域
  // 都得回来补一条特判，而漏了特判的表现是"区域静静地跑到了错误的位置"，
  // 界面上看不出是 bug。
  const shown = REGION_LAYOUT.filter(r => region(r.key).length > 0);
  const topRegions = shown.filter(r => r.band === "top");
  const mainRegions = shown.filter(r => r.band === "main");
  const asideRegions = shown.filter(r => r.band === "aside");
  const footerRegions = shown.filter(r => r.band === "footer");
  const overlayRegions = shown.filter(r => r.band === "overlay");

  // 权重按**这一页的范式**查 —— 同一个区域在不同范式下轻重不同（metrics 只有
  // 仪表盘才是主角）。手抄那版把它拍成全局一份，是错的。
  const weightOf = (key: string) => REGION_WEIGHTS[page.archetype]?.[key] ?? "supporting";

  const Panel = ({ r }: { r: (typeof REGION_LAYOUT)[number] }) => (
    <Card
      size="small"
      variant="borderless"
      styles={{ body: { padding: 0, overflow: "hidden" } }}
      className="mb-3 shadow-[0_1px_6px_rgba(15,23,42,0.08)]"
      data-testid={`region-${r.key}`}
    >
      <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-400">
        {r.label} · {weightOf(r.key)}
      </div>
      <div className="p-3">{region(r.key).map(renderBlock)}</div>
    </Card>
  );

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const flat = Object.entries(page.regions ?? {}).flatMap(([rk, items]) =>
        (items ?? []).map((b, i) => ({ ...b, id: `${rk}-${i}`, slot: rk, children: [] }))
      );
      const res = await fetch("/api/sliderule/components/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: page.name,
          industry: page.industry,
          pageKind: page.archetype,
          blocks: flat,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; preset?: { industry: string } };
      if (res.ok && body.ok) {
        setSavedAs(body.preset?.industry ?? page.industry);
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-8"
      data-testid="assembled-page-modal"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-[1400px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-slate-900">{page.name}</span>
            <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
              {page.industry}
            </span>
            <span className="rounded bg-[#e8eeff] px-2 py-0.5 text-[11px] text-[#3b5bdb]">
              {page.archetype}
            </span>
            {page.gatePassed && (
              <span
                data-testid="gate-passed"
                className="rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700"
              >
                过检查{page.attempts && page.attempts > 1 ? `（第 ${page.attempts} 版）` : ""}
              </span>
            )}
            {toast && (
              <span
                data-testid="assembled-toast"
                className="rounded bg-green-50 px-2 py-0.5 text-[11px] text-green-700"
              >
                {toast}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
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
          {page.tasks?.length > 0 && (
            <div
              data-testid="page-tasks"
              className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-slate-500"
            >
              <span className="text-slate-400">用户在这一页要：</span>
              {page.tasks.map(t => (
                <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#f0f2f5] p-4">
          <div className="mx-auto max-w-[1200px]">
            {topRegions.map(r => (
              <Panel key={r.key} r={r} />
            ))}
            <div className="flex flex-wrap gap-3">
              <div className="min-w-[320px] flex-[2]">
                {mainRegions.map(r => (
                  <Panel key={r.key} r={r} />
                ))}
              </div>
              {asideRegions.length > 0 && (
                <div className="min-w-[240px] flex-1">
                  {asideRegions.map(r => (
                    <Panel key={r.key} r={r} />
                  ))}
                </div>
              )}
            </div>
            {/* 浮层区：渲染出来就是几个按钮，点了才有东西 —— 它一点页面空间
                都不占，这正是 overlay 这个权重的意思。 */}
            {overlayRegions.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {overlayRegions.flatMap(r => region(r.key).map(renderBlock))}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作条 —— 照 pro-blocks 的 FooterToolbar：**贴在容器底部，
            不随内容滚**。这跟 overlay 不是一回事（overlay 点了才出来），
            也不能塞进正文流里：长表单把提交按钮放在表单末尾，用户得滚到底
            才看得见它，也看不见自己错在哪。所以它在滚动区外面。 */}
        {footerRegions.length > 0 && (
          <div
            data-testid="region-band-footer"
            className="shrink-0 border-t border-slate-200 bg-white px-4 py-2"
          >
            <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-2">
              {footerRegions.flatMap(r => region(r.key).map(renderBlock))}
            </div>
          </div>
        )}
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
  platform,
  linked,
}: {
  group: string;
  platform: string;
  linked: string;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, isScrolling, height } = useScrollerIn(containerRef);
  const { width } = useContainerPosition(containerRef, [height]);
  // 两个维度都从统一筛选条来（见 filterDims）——墙自己不再另摆一排 chip。
  const shown = React.useMemo(
    () =>
      BASE_COMPONENTS.filter(c => {
        if (group !== "all" && c.group !== group) return false;
        if (platform !== "all" && c.platform !== platform) return false;
        const used = (BLOCKS_USING[c.name] ?? []).length > 0;
        if (linked === "linked" && !used) return false;
        if (linked === "unlinked" && used) return false;
        return true;
      }),
    [group, platform, linked]
  );

  return (
    <>
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
                {/* 这个素材被哪些区块用了 —— 三层链路（基础组件 → 区块 → 模板）
                    的第一环，正着反着都得看得见。
                    
                    一个区块都没用到的，如实标「还没接进区块」：那意味着它目前
                    **不可能出现在任何生成的应用里**。这是覆盖缺口，不是 bug，
                    但看不见它就没法有意识地补。 */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {(BLOCKS_USING[c.name] ?? []).length > 0 ? (
                    <>
                      <span className="text-[10.5px] text-slate-400">用于区块</span>
                      {(BLOCKS_USING[c.name] ?? []).map(b => (
                        <span
                          key={b}
                          className="rounded bg-[#e8eeff] px-1.5 py-0.5 text-[10.5px] text-[#3b5bdb]"
                        >
                          {b}
                        </span>
                      ))}
                    </>
                  ) : (
                    <span
                      data-testid="base-unused"
                      className="rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-400"
                    >
                      还没接进区块
                    </span>
                  )}
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
  const [basePlatform, setBasePlatform] = React.useState<string>("all");
  const [baseLinked, setBaseLinked] = React.useState<string>("all");
  const [assembled, setAssembled] = React.useState<AssembledPage | null>(null);
  // 意图 —— 五阶段的第一阶段。说不出"这一页是给谁用的、要干什么"，后面
  // 全是猜的，所以它是必填而不是可选的高级选项。
  const [intent, setIntent] = React.useState("");
  const [askIntent, setAskIntent] = React.useState(false);
  const [baseBusy, setBaseBusy] = React.useState(false);

  /**
   * 从基础组件抽一屏 —— 传的是**当前筛选之后还在墙上的那些**，跟业务积木
   * 那条传 allowedTypes 同一条规矩：从看得见的里面抽。切到「数据录入」再点，
   * 抽出来的就是一屏全是录入件的东西，这是有意义的行为而不是 bug。
   */
  /**
   * 五阶段装配：意图 → 范式 → 区块 → 实例 → Gate。
   *
   * 换掉了此前那条"给模型 137 个基础组件的清单让它选几个排出来"——那条
   * 抽出来的是组件示例合集（Menu/Input/Button/Table/Pagination 各一张等大
   * 的卡，内容还是「甲 乙 12 34」）。区别不在提示词，在装配目标。
   *
   * 这里**不传组件清单**：候选集是服务端的业务区块，基础组件由区块自己解析，
   * 模型从头到尾不会命名一个组件。
   */
  const runAssemble = async () => {
    if (assembling) return;
    const text = intent.trim();
    if (!text) {
      setAskIntent(true);
      return;
    }
    setAssembling(true);
    setAssembleError(null);
    try {
      const res = await fetch("/api/sliderule/components/assemble-page", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: text,
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
      const body = (await res.json()) as AssembledPage & {
        ok?: boolean;
        error?: string;
        findings?: { code: string; why: string }[];
      };
      if (!res.ok || !body.ok) {
        // Gate 没过就如实说哪条没过——不降级展示一个坏页面。
        const why = (body.findings ?? []).map(f => f.why).join("；");
        setAssembleError(why ? `${body.error}：${why}` : body.error || `装配失败（HTTP ${res.status}）`);
        return;
      }
      setAssembled(body);
      setAskIntent(false);
    } catch (e) {
      setAssembleError(String(e instanceof Error ? e.message : e));
    } finally {
      setAssembling(false);
    }
  };
  const [assembling, setAssembling] = React.useState(false);
  const [assembleError, setAssembleError] = React.useState<string | null>(null);

  /**
   * AI 组装区块 —— 链路上的**另一次**组装（2026-08-08 用户定的分层）。
   *
   *   看模板档 → 组装模板：从现有区块里挑，摆进页面区域 → 产物是数据，直接渲染
   *   看组件档 → 组装区块：从基础组件里挑，定义一个新区块 → 产物是契约，人来实现
   *
   * 后者不生成代码，这是查过 GitHub 之后的判断：Ant Design 官方那个仓库就叫
   * `pro-blocks`，29 个「区块」（分析页/工作台/查询表格/高级详情/分步表单…）
   * **全是手写 React 源码**，`umi block add` 是把源码拷进项目的脚手架，不是
   * 运行时拼装。区块 = schema + 逻辑 + 关联，逻辑就是代码。
   *
   * 所以这里让模型做的是设计：看着 118 个还没被任何区块用上的素材，说出还缺
   * 哪个区块、它收什么、绑什么、落哪些区域。基础组件清单从这一侧传过去——
   * 那份目录是 TSX（每条挂着真实 render），搬不到 Python 侧。
   */
  const [proposals, setProposals] = React.useState<BlockProposalResult | null>(null);
  const runProposeBlocks = async () => {
    if (assembling) return;
    setAssembling(true);
    setAssembleError(null);
    try {
      const res = await fetch("/api/sliderule/components/propose-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseComponents: BASE_COMPONENTS.map(c => ({
            name: c.name,
            label: c.label,
            group: c.group,
            platform: c.platform,
            description: c.description,
            usedBy: BLOCKS_USING[c.name] ?? [],
          })),
        }),
      });
      const body = (await res.json()) as BlockProposalResult & {
        ok?: boolean;
        error?: string;
        findings?: { code: string; why: string }[];
      };
      if (!res.ok || !body.ok) {
        const why = (body.findings ?? []).map(f => f.why).join("；");
        setAssembleError(
          why ? `${body.error}：${why}` : body.error || `提议失败（HTTP ${res.status}）`
        );
        return;
      }
      setProposals(body);
    } catch (e) {
      setAssembleError(String(e instanceof Error ? e.message : e));
    } finally {
      setAssembling(false);
    }
  };

  const [device, setDevice] = React.useState<DeviceTier>("all");
  const [query, setQuery] = React.useState("");
  const [slot, setSlot] = React.useState<string>("all");
  // 默认不筛：档位上标着几个区块，点进来就该看得见几个。device / slot 本来
  // 就都是 "all"，此前只有这一维写死了具体范式，是这一排里唯一的例外。
  const [pageKind, setPageKind] = React.useState("all");

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
   * 当前范式下的区块。`"all"` 是**不筛**，不是"某个叫 all 的范式"。
   *
   * 2026-08-08 修：原来这里只有精确匹配，而范式那栏的选项里没有「全部」，
   * 于是「清空」（把每个维度都置成 `"all"`）之后去找 `pageKinds` 含 `"all"`
   * 的区块——目录里一个都没有（取值只有 workbench/dashboard/monitor/kanban/
   * calendar/wizard），页面直接变成「没有匹配的区块」。
   *
   * 同一个根还引出第二个症状：初值写死 `"workbench"` 且没有「全部」可选，
   * 所以这一档**永远在筛**，档位上标着 16 个区块，进去最多只看得见 13 个，
   * 没有任何一个状态能看到全部。
   */
  const pageKindBlocks = React.useMemo(
    () =>
      pageKind === "all"
        ? blocks
        : blocks.filter(block => (block.pageKinds ?? []).includes(pageKind)),
    [blocks, pageKind]
  );

  /**
   * 当前模式下**适用**的筛选维度。
   *
   * 这就是"级联关系"的正解：不适用的维度根本不构造出来，于是它在界面上
   * 不存在——而不是存在但点不动。此前三行 chip 常驻，在基础组件档下摆着
   * 区块的槽位筛选，点了什么也不会发生。
   */
  const filterDims = React.useMemo<FilterDim[]>(() => {
    if (mode === "base") {
      const byGroup: Record<string, number> = {};
      const byPlatform: Record<string, number> = {};
      for (const c of BASE_COMPONENTS) {
        byGroup[c.group] = (byGroup[c.group] ?? 0) + 1;
        byPlatform[c.platform] = (byPlatform[c.platform] ?? 0) + 1;
      }
      return [
        {
          key: "capability",
          label: "能力",
          value: baseGroup,
          onChange: setBaseGroup,
          options: [
            { value: "all", label: "全部", count: BASE_COMPONENTS.length },
            ...BASE_GROUPS.filter(g => byGroup[g]).map(g => ({
              value: g,
              label: g,
              count: byGroup[g],
            })),
          ],
        },
        {
          key: "linked",
          label: "接入",
          value: baseLinked,
          onChange: setBaseLinked,
          options: [
            { value: "all", label: "全部", count: BASE_COMPONENTS.length },
            {
              value: "linked",
              label: "已接进区块",
              count: BASE_COMPONENTS.filter(c => (BLOCKS_USING[c.name] ?? []).length > 0).length,
            },
            {
              value: "unlinked",
              label: "还没接进区块",
              count: BASE_COMPONENTS.filter(c => (BLOCKS_USING[c.name] ?? []).length === 0).length,
            },
          ],
        },
        {
          key: "platform",
          label: "端",
          value: basePlatform,
          onChange: setBasePlatform,
          options: [
            { value: "all", label: "全部", count: BASE_COMPONENTS.length },
            { value: "pc", label: "桌面端", count: byPlatform.pc ?? 0 },
            { value: "mobile", label: "手机端", count: byPlatform.mobile ?? 0 },
          ],
        },
      ];
    }
    if (mode === "presets") {
      return [
        {
          key: "industry",
          label: "行业",
          value: industry,
          onChange: setIndustry,
          options: [
            { value: "all", label: "全部", count: presetCount },
            ...industries.map(x => ({ value: x.industry, label: x.industry, count: x.count })),
          ],
        },
      ];
    }
    // 区块档：范式（页面形态）+ 区域（槽位）。计数跟着上一级走——
    // 槽位数说的是"在当前这类页面里这个槽位有几个区块可用"。
    return [
      {
        key: "pageKind",
        label: "范式",
        value: pageKind,
        onChange: setPageKind,
        options: [
          // 「全部」必须在场：下面的「清空」会把每个维度都置成 "all"，选项里
          // 没有它就等于把用户清进一个选不回来的空集（见 pageKindBlocks 注释）。
          { value: "all", label: "全部", count: blocks.length },
          ...PAGE_KINDS.map(k => ({
            value: k.key,
            label: k.label,
            count: blocks.filter(b => (b.pageKinds ?? []).includes(k.key)).length,
          })),
        ],
      },
      {
        key: "slot",
        label: "区域",
        value: slot,
        onChange: setSlot,
        options: [
          { value: "all", label: "全部", count: pageKindBlocks.length },
          ...Object.keys(CATALOG.pageRegions ?? {}).map(sl => ({
            value: sl,
            label: SLOT_LABEL[sl] ?? sl,
            count: pageKindBlocks.filter(b => (b.allowedRegions ?? []).includes(sl)).length,
          })),
        ],
      },
    ];
  }, [
    mode,
    baseGroup,
    basePlatform,
    baseLinked,
    industry,
    industries,
    presetCount,
    pageKind,
    slot,
    blocks,
    pageKindBlocks,
  ]);

  const filtered = React.useMemo(() => {
    const kw = query.trim().toLowerCase();
    return pageKindBlocks.filter(b => {
      const hitKw =
        !kw ||
        b.type.toLowerCase().includes(kw) ||
        (b.description ?? "").toLowerCase().includes(kw) ||
        (IMPL_BY_TYPE[b.type] ?? "").toLowerCase().includes(kw);
      const hitSlot = slot === "all" || (b.allowedRegions ?? []).includes(slot);
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

        {/* 模式切换 = Polaris 的 tabs：**先选看哪一层**，再谈筛什么。
            三层的维度互不相干（基础组件看能力/端、区块看范式/区域、模板看行业），
            所以层必须在筛选之上——放在同一行会让人以为它们是并列的筛选项。 */}
        <div
          className="mt-3 flex flex-wrap items-center gap-1.5"
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
            label="模板"
            count={presetCount}
            active={mode === "presets"}
            onClick={() => setMode("presets")}
          />
          {/* 按钮跟着档位走 —— 因为**这条链路上有两次组装，方向不同**
              （2026-08-08 用户定的分层）：

                看基础组件/区块 → 组装区块：从素材里挑，定义一个新区块
                看模板         → 组装模板：从现有区块里挑，摆进页面区域

              标签跟着档位变，动作也跟着变；只改标签不改动作就是骗人。 */}
          <button
            type="button"
            data-testid="components-assemble"
            disabled={assembling}
            onClick={() => void (mode === "presets" ? runAssemble() : runProposeBlocks())}
            className="ml-2 inline-flex items-center gap-1.5 rounded-lg bg-[#5b6cff] px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-50"
          >
            <Sparkles size={13} />
            {assembling
              ? mode === "presets"
                ? "组装中…"
                : "提议中…"
              : mode === "presets"
                ? "AI 组装模板"
                : "AI 组装区块"}
          </button>
        </div>

        {/* 筛选维度**按模式给**——不适用的根本不出现，而不是出现了点不动。
            这是用户说的"级联关系承载不住"的正解：基础组件档只有能力和端，
            区块档才有范式和区域，模板档只有行业。 */}
        <FilterBarRow
          dims={filterDims}
          extra={
            mode === "blocks" ? (
              <span className="contents" data-testid="components-device-switch">
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
              </span>
            ) : undefined
          }
        />
      </div>

      {/* 意图输入 —— 五阶段的第一阶段，摆在明面上。
          
          此前那条链路根本没有这一步：模型直接从组件清单开始挑，所以它永远
          不知道"用户在这一页要干什么"，出来的当然是组件合集。说不出意图就
          装配不了，这不是苛刻，是那一步本来就绕不过去。 */}
      {/* 只在模板档问意图 —— 组装区块问的不是"这一页干什么"，是"还缺哪个
          区块"，它看的是覆盖缺口，不需要意图。留着会变成切档之后一个点了
          没反应的输入框。 */}
      {mode === "presets" && askIntent && (
        <div
          data-testid="intent-prompt"
          className="mt-4 rounded-lg bg-white p-3 shadow-[0_1px_6px_rgba(15,23,42,0.08)]"
        >
          <div className="text-[12.5px] font-medium text-slate-700">
            这一页是给谁用的、他要在这儿完成什么？
          </div>
          <div className="mt-1 text-[11.5px] text-slate-400">
            说清楚任务，装配才有依据。例如：仓管每天查看商品库存、筛出缺货的、新增商品、补货
          </div>
          <div className="mt-2 flex gap-2">
            <input
              data-testid="intent-input"
              autoFocus
              value={intent}
              onChange={e => setIntent(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") void runAssemble();
              }}
              placeholder="例如：门店店长每天查看订单、按状态筛选、新建订单"
              className="flex-1 rounded-lg border-0 bg-slate-50 px-3 py-2 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200 focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25"
            />
            <button
              data-testid="intent-go"
              disabled={assembling || !intent.trim()}
              onClick={() => void runAssemble()}
              className="rounded-lg bg-[#5b6cff] px-4 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-50"
            >
              {assembling ? "装配中…" : "开始装配"}
            </button>
          </div>
        </div>
      )}

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
          onClose={() => setAssembled(null)}
          onSaved={() => void loadPresets()}
        />
      )}

      {proposals && (
        <BlockProposalModal result={proposals} onClose={() => setProposals(null)} />
      )}

      {mode === "base" ? (
        <BaseComponentWall group={baseGroup} platform={basePlatform} linked={baseLinked} />
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
