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
import { Empty } from "antd";
import { LayoutGrid, Search, Rows3, Monitor, Smartphone } from "lucide-react";
import { useContainerPosition } from "masonic";
import catalogJson from "@experience-blocks";
import { SpanMasonry } from "@/pages/agent-loop/dashboard/SpanMasonry";
import { useScrollerIn } from "@/pages/agent-loop/dashboard/useScrollerIn";
import { spanForColumnCount } from "@/pages/agent-loop/dashboard/app-wall-span";
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


/** 列宽下限与间距——照应用中心那面墙的写法，但值不同。
 *
 * 应用中心是 260：那面墙放的是应用截图，260 卡在信息条那排指标的换行点上。
 * 这里放的是**真组件**，宽度不够看到的就不是它真正的样子。
 *
 * 300 是试出来的，定的是**列数**不是单卡观感：1600px 视口下可用宽 ~1300，
 * 300 给 4 列 × 316px，340 只给 3 列。列数在这里比列宽要紧——9 个区块里有 4 个
 * 跨两列（见 isWideBlock），3 列时跨列卡占掉 2/3，剩下那一列很快见底，实测左列
 * 在第 5 张之后就空出一大段；4 列时跨列卡只占一半，短卡能继续往空位里填。
 *
 * 单卡这一头 316px 够用：需要横向空间的那几个（DataTable 摆列、
 * WorkflowTimeline 展开阶段）本来就是跨列卡，实得 648px。
 */
const WALL_COLUMN_WIDTH = 300;
const WALL_GUTTER = 16;

/** 手机档一列的宽度。真实手机壳内容区是 380px（见 FreeformPreviewScreen 的
 * DEVICE_CONTENT_WIDTH），加卡片左右内边距与手机边框的余量。 */
const PHONE_FRAME_WIDTH = 380;
const PHONE_COLUMN_WIDTH = PHONE_FRAME_WIDTH + 56;

type DeviceTier = "desktop" | "phone";

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

/** 筛选 chip——与 AppsWorkbench 的 TabButton / StatChip 同一套类名（含右侧计数）。
 *
 * icon 可选是照那边的分工来的：库切换那两个（我的应用 / 官方示例）没有图标，
 * 只有状态筛选那排（全部 / 推演中 / 已闭环 / 待补充）才带。混着用会让"这是切库"
 * 和"这是筛条件"两件事在视觉上分不开。 */
function FilterChip({
  icon, label, count, active, onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`components-chip-${label}`}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition ${
        active
          ? "bg-[#e8eeff] text-[#3b5bdb]"
          : "bg-transparent text-slate-500 hover:bg-white/60 hover:text-slate-700"
      }`}
      onClick={onClick}
    >
      {icon && <span className={active ? "opacity-100" : "opacity-70"}>{icon}</span>}
      <span>{label}</span>
      <span className={`tabular-nums text-[11px] ${active ? "text-[#3b5bdb]/80" : "text-slate-400"}`}>
        {count}
      </span>
    </button>
  );
}

/**
 * 区块卡——照应用中心的 CenterCard：画面铺满整卡，信息条以底部黑色渐变浮层
 * 压在画面上，不另占高度。
 *
 * 与那边唯一的实质差别：这里的"画面"是**活的组件**而不是一张截图，所以渲染区
 * 必须给底部留出 64px 内边距——渐变浮层会盖住最下面一带，不留就会把组件的最后
 * 一行内容压掉。截图不在乎盖住一点，活组件在乎。
 */
function BlockCard({ block, device }: { block: CatalogBlock; device: DeviceTier }) {
  const { block: instance, extra } = demoFor(block.type);
  const impl = IMPL_BY_TYPE[block.type];
  const phone = isPhoneExperienceBlock(block.type);
  const demoable = HAS_DEMO.has(block.type);
  // 手机档没有专属渲染器的，真实应用里是**拿桌面渲染器塞进窄壳**
  // （AppRuntimeScreen.tsx:1538 `forPhone && PHONE_EXPERIENCE_BLOCK_TYPES.has(...)`）。
  // 这里照做——只有照做，"未适配"的真实代价才看得见；换成一句"暂不支持"就把
  // 问题藏起来了，而这一页存在的意义正是把它露出来。
  const phoneFallback = device === "phone" && !phone;

  const rendered = demoable ? (
    device === "phone" && phone ? (
      <React.Suspense fallback={<div style={{ height: 120 }} />}>
        <LazyPhoneExperienceBlock
          block={instance}
          entityRows={ENTITY_ROWS}
          chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
          fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
          {...extra}
        />
      </React.Suspense>
    ) : (
      <ExperienceBlockBoundary
        block={instance}
        entityRows={ENTITY_ROWS}
        chartPalette={{ primary: PRIMARY, categorical: CHARTS }}
        fieldLabelOf={(_e: string, f: string) => FIELD_LABEL[f] ?? f}
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

  return (
    <div
      data-testid={`component-card-${block.type}`}
      title={block.description}
      className="group relative w-full overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm transition hover:border-[#1677ff]/60 hover:shadow-lg"
    >
      {/* 画面区：桌面档直接铺满；手机档套进一个 380px 的机身框里，
          宽度必须是真的——不套框只把卡变窄，看到的仍是桌面布局在窄容器里的样子，
          跟真机不是一回事。 */}
      {device === "phone" ? (
        <div className="flex justify-center px-4 pt-4" style={{ paddingBottom: 64 }}>
          <div
            className="overflow-hidden rounded-[22px] border-[6px] border-slate-800 bg-[#f5f5f5] shadow-inner"
            style={{ width: PHONE_FRAME_WIDTH }}
          >
            <div className="px-2.5 py-3">{rendered}</div>
          </div>
        </div>
      ) : (
        <div className="px-4 pt-4" style={{ paddingBottom: 64 }}>
          {rendered}
        </div>
      )}

      {/* 右上角：档位指示。手机档下如果是降级来的，直接写出来——一个灰图标
          说不清"它现在显示的东西其实是桌面渲染器"这件事。 */}
      <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-lg bg-white/85 px-2 py-1 ring-1 ring-slate-200/70 backdrop-blur-[2px]">
        {phoneFallback ? (
          <span className="text-[11px] font-medium text-amber-600">桌面档降级</span>
        ) : (
          <>
            <Monitor size={13} className="text-emerald-500" />
            <Smartphone size={13} className={phone ? "text-emerald-500" : "text-slate-300"} />
          </>
        )}
      </div>

      {/* 信息条：浮在画面底部，不占卡片高度（同 CenterCard 的黑色渐变 + backdrop-blur） */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 pb-2 pt-7 backdrop-blur-[1px]">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-white drop-shadow-sm">
            {block.type}
          </span>
          <span className="shrink-0 text-[11px] text-white/70">
            {impl ?? "实现未登记"}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/75">
          {(block.allowedSlots ?? []).map(s => (
            <span key={s} className="rounded bg-white/15 px-1.5 py-px">
              {SLOT_LABEL[s] ?? s}
            </span>
          ))}
          {(block.dataKinds ?? []).map(k => (
            <span key={k} className="rounded bg-sky-400/25 px-1.5 py-px text-sky-100">
              {DATAKIND_LABEL[k] ?? k}
            </span>
          ))}
          {block.freeformGenerated && (
            <span className="rounded bg-purple-400/25 px-1.5 py-px text-purple-100">AI 现场设计</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 区块墙。抽成组件的理由同 AppsWorkbench 的 AppWall：里面全是 hook，
 * 而墙在「有结果 / 搜索无结果」两岔里只有一岔渲染，写在外层就成了条件调用。 */
function BlockWall({ blocks, device }: { blocks: CatalogBlock[]; device: DeviceTier }) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { scrollTop, isScrolling, height } = useScrollerIn(containerRef);
  const { width } = useContainerPosition(containerRef, [height]);

  return (
    <div data-testid="components-wall" style={{ display: "contents" }}>
      <SpanMasonry<CatalogBlock>
        containerRef={containerRef}
        items={blocks}
        width={width}
        height={height}
        scrollTop={scrollTop}
        isScrolling={isScrolling}
        minColumnWidth={device === "phone" ? PHONE_COLUMN_WIDTH : WALL_COLUMN_WIDTH}
        gutter={WALL_GUTTER}
        overscanBy={2}
        // 实测各区块渲染高度 148~451px，取中位偏上；真实高度由 ResizeObserver 量，
        // 这个值只影响首屏还没量到时的总高估算。
        itemHeightEstimate={device === "phone" ? 420 : 330}
        itemKey={b => `${device}-${b.type}`}
        // 手机档不跨列：机身宽度是固定的 380px，跨两列只会让机身两侧多出空白，
        // 不会让内容变宽——跨列的前提是"内容能用上多出来的宽度"，这里用不上。
        getSpan={(b, _i, columnCount) =>
          device === "phone" ? 1 : spanForColumnCount(isWideBlock(b), columnCount)}
        className="mt-5"
        render={b => <BlockCard block={b} device={device} />}
      />
    </div>
  );
}

/** 页面形态：等尺寸网格（照应用中心「官方示例」那一栏的做法，不进瀑布流）。 */
function PageKindGrid() {
  return (
    <div
      data-testid="page-kinds"
      className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {PAGE_KINDS.map(k => (
        <div
          key={k.key}
          data-testid={`page-kind-${k.key}`}
          className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm transition hover:border-[#1677ff]/60 hover:shadow-lg"
        >
          <div className="flex items-baseline gap-2">
            <span className="text-[14.5px] font-semibold text-slate-900">{k.label}</span>
            <code className="text-[11.5px] text-slate-400">{k.key}</code>
          </div>
          <div className="mt-1.5 text-[12.5px] leading-relaxed text-slate-600">{k.desc}</div>
          <div className="mt-2 text-[11.5px] text-slate-400">成立条件：{k.need}</div>
        </div>
      ))}
    </div>
  );
}

export default function ComponentsLibraryPage() {
  const [tab, setTab] = React.useState<"blocks" | "kinds">("blocks");
  const [device, setDevice] = React.useState<DeviceTier>("desktop");
  const [query, setQuery] = React.useState("");
  const [slot, setSlot] = React.useState<string>("all");

  const blocks = CATALOG.blocks ?? [];
  const filtered = React.useMemo(() => {
    const kw = query.trim().toLowerCase();
    return blocks.filter(b => {
      const hitKw =
        !kw ||
        b.type.toLowerCase().includes(kw) ||
        (b.description ?? "").toLowerCase().includes(kw) ||
        (IMPL_BY_TYPE[b.type] ?? "").toLowerCase().includes(kw);
      const hitSlot = slot === "all" || (b.allowedSlots ?? []).includes(slot);
      return hitKw && hitSlot;
    });
  }, [blocks, query, slot]);

  // 先筛后铺：铺开只影响展示次序，不影响筛出来的集合。
  // 手机档不跨列，也就没有"宽卡挤成一坨"的问题，保持目录原序更好读。
  const ordered = React.useMemo(
    () => (device === "phone" ? filtered : interleaveWide(filtered)),
    [filtered, device]
  );
  const phoneReady = blocks.filter(b => isPhoneExperienceBlock(b.type)).length;

  return (
    <div data-testid="components-library" className="px-6 pb-10 pt-5 md:px-8 md:pt-6">
      {/* 吸顶头：与应用中心同一套（-mx/-mt 抵消外层内边距，保证背景铺满） */}
      <div className="sticky top-0 z-30 -mx-6 -mt-5 bg-[var(--sr-shell-bg,#fff)] px-6 pt-5 pb-3 md:-mx-8 md:-mt-6 md:px-8 md:pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5b6cff]">
              <LayoutGrid size={18} strokeWidth={2.2} />
            </span>
            <h1 className="text-[18px] font-bold tracking-tight text-slate-900 md:text-[20px]">
              组件库
            </h1>
          </div>

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
              disabled={tab !== "blocks"}
              className="w-full rounded-lg border-0 bg-white/70 py-2.5 pl-10 pr-4 text-[13px] text-slate-800 outline-none ring-1 ring-slate-200/60 placeholder:text-slate-400 transition focus:bg-white focus:ring-2 focus:ring-[#5b6cff]/25 disabled:opacity-50"
            />
          </div>

        </div>

        {/* 第二行：库切换 + 筛选 + 档位 —— 结构照 AppsWorkbench「第二行：库切换 +
            门语言筛选 / 分类」那一段：同一个 mt-4 / gap-1.5，库切换打头且不带图标，
            与后面的条件筛选之间用竖线分开，右端 ml-auto 放次级控件。
            原来这里是"tab 在第一行右侧 + 筛选另起一行 mt-2.5"，两行两套节奏。 */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <FilterChip
            label="体验区块"
            count={blocks.length}
            active={tab === "blocks"}
            onClick={() => setTab("blocks")}
          />
          <FilterChip
            label="页面形态"
            count={PAGE_KINDS.length}
            active={tab === "kinds"}
            onClick={() => setTab("kinds")}
          />

          {tab === "blocks" && (
            <>
              <span className="mx-1 hidden h-4 w-px bg-slate-200 sm:inline-block" />
              <FilterChip
                icon={<LayoutGrid size={13} />}
                label="全部槽位"
                count={blocks.length}
                active={slot === "all"}
                onClick={() => setSlot("all")}
              />
              {(CATALOG.allowedSlots ?? []).map(sl => (
                <FilterChip
                  key={sl}
                  icon={<Rows3 size={13} className="text-slate-400" />}
                  label={SLOT_LABEL[sl] ?? sl}
                  count={blocks.filter(b => (b.allowedSlots ?? []).includes(sl)).length}
                  active={slot === sl}
                  onClick={() => setSlot(sl)}
                />
              ))}
              <div className="ml-auto flex items-center gap-1.5">
                <FilterChip
                  icon={<Monitor size={13} className="text-slate-400" />}
                  label="桌面档"
                  count={blocks.length}
                  active={device === "desktop"}
                  onClick={() => setDevice("desktop")}
                />
                {/* 计数写 blocks.length 而不是 phoneReady：这个数字在 chip 上读作
                    "这一档有几张卡"，而手机档确实是 9 张全在（4 张专属渲染器 +
                    5 张桌面档降级）。写 4 会让人以为另外 5 个看不到。
                    真正的 4/9 由下面那行说明和每张卡上的「桌面档降级」角标交代。 */}
                <FilterChip
                  icon={<Smartphone size={13} className="text-slate-400" />}
                  label="手机档"
                  count={blocks.length}
                  active={device === "phone"}
                  onClick={() => setDevice("phone")}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* 说明行：应用中心那一页没有这一段，所以它是这一页额外的高度。
          压到 12px / slate-400 一行，读作图注而不是正文段落，尽量不破坏
          「吸顶头 → 内容」的节奏。手机档那句是有承载的（解释降级不是"不显示"），
          只在手机档出现。 */}
      <p className="mt-3 text-[12px] leading-relaxed text-slate-400">
        每一格都是<span className="text-slate-600">真实渲染器</span>按夹具数据现渲的，与线上应用同一套代码；
        清单读自 <code>experience_block_catalog.json</code>——AI 生成时对着的同一份契约。
        {tab === "blocks" && device === "phone" && (
          <>
            {" "}手机档 <span className="text-slate-600">{phoneReady}</span> 个有专属渲染器，
            另 <span className="text-amber-600">{blocks.length - phoneReady}</span> 个走
            <span className="text-amber-600">桌面档降级</span>——不是"不显示"，是真实应用里
            就拿桌面渲染器塞进 380px 窄壳（AppRuntimeScreen 的 forPhone 分支），卡里的挤压就是用户会看到的。
          </>
        )}
      </p>

      {tab === "kinds" ? (
        <PageKindGrid />
      ) : filtered.length === 0 ? (
        <Empty description="没有匹配的区块" className="py-16" />
      ) : (
        <BlockWall blocks={ordered} device={device} />
      )}
    </div>
  );
}
