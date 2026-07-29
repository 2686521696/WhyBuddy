/**
 * AppRuntimeScreen — JSON 渲染出的"真系统"（应用运行，浏览器运行时 M1.6）。
 *
 * el-form-renderer / el-data-table 哲学：菜单、统计卡、图表、表格、表单、
 * 详情抽屉全部由 app-runtime-schema（从五系统模型推导的 JSON）驱动，
 * antd（稳定版 5.x）渲染成 Ant Design Pro 风格的后台系统。
 * 零后端、零数据库：状态在 live-runtime 内核 + localStorage。
 *
 * 多端画布：桌面 1440×810（16:9）/ 平板 1112×834 / 手机 390×844，
 * 均按固定设计分辨率渲染再 CSS transform 等比缩放（"缩放 iframe"效果）；
 * 手机端换 App 壳（顶栏 + 卡片列表 + 底部标签导航）。弹层经
 * getPopupContainer 挂进画布随缩放（antd 5 trigger 自带 scale 校正）。
 *
 * 图表遵循 dataviz 规范：单色细条 + 数值直标（文字用墨色不用系列色）、
 * 状态环图配图例文字+计数（不靠颜色单独传达）、状态色经校验
 * （#1677ff/#52c41a/#ff4d4f，CVD ΔE 15.9 PASS）。
 */

import React from "react";
import { createPortal } from "react-dom";
import {
  Layout,
  Menu,
  Table,
  Button,
  Modal,
  Input,
  InputNumber,
  Select,
  Tag,
  Steps,
  Space,
  Card,
  Statistic,
  Breadcrumb,
  Avatar,
  Timeline,
  Drawer,
  Descriptions,
  ConfigProvider,
  theme as antdTheme,
  message,
  Popover,
  Popconfirm,
  Tooltip,
  Checkbox,
  Form,
  Alert,
  Skeleton,
  Empty,
  Badge,
} from "antd";
import {
  DashboardOutlined,
  TableOutlined,
  ProfileOutlined,
  FormOutlined,
  AppstoreOutlined,
  UserOutlined,
  PlusOutlined,
  LockOutlined,
  SettingOutlined,
  BarChartOutlined,
  BookOutlined,
  CalendarOutlined,
  FileTextOutlined,
  GlobalOutlined,
  HeartOutlined,
  SafetyOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import { resolveEntityRef } from "../system-screens/five-system-model";
import {
  resolveIdentityTheme,
  hexToRgba,
  admThemeVars,
} from "./identity-themes";
import { autoPlaceGrid } from "./grid-compact";
import { deriveLayoutTokens } from "./design-tokens";
import {
  buildAiActionInputs,
  deriveAppRuntimeSchema,
  type AppAiActionSchema,
  type AppChartSchema,
  type AppFormFieldSchema,
  type AppPageChartSchema,
  type AppPageFeedSchema,
  type AppPageRankingSchema,
  type AppPageSchema,
  type AppRuntimeSchema,
} from "./app-runtime-schema";
import {
  buildEchartsOption,
  buildEntityRowcountOption,
  buildInstanceStatusOption,
} from "./build-echarts-option";

// ECharts 基建走独立 chunk（React.lazy）：主 bundle 不背 echarts，
// 首个带图表声明的页面打开时才加载。
const LazyEchartsChart = React.lazy(() => import("./EchartsChart"));
// 手机档 UI 基建（antd-mobile）同样独立 chunk：切到手机设备档才加载。
const LazyPhonePageList = React.lazy(
  () => import("./phone-mobile/PhonePageList")
);
const LazyPhoneTabBar = React.lazy(() => import("./phone-mobile/PhoneTabBar"));
const LazyPhoneFormPopup = React.lazy(
  () => import("./phone-mobile/PhoneFormPopup")
);
const LazyPhoneDetailPopup = React.lazy(
  () => import("./phone-mobile/PhoneDetailPopup")
);
const LazyPhoneRolePicker = React.lazy(
  () => import("./phone-mobile/PhoneRolePicker")
);
const LazyPhoneHome = React.lazy(() => import("./phone-mobile/PhoneHome"));
const LazyPhoneDetailFields = React.lazy(
  () => import("./phone-mobile/PhoneDetailFields")
);
const LazyPhoneActionButton = React.lazy(
  () => import("./phone-mobile/PhoneActionButton")
);
const LazyPhonePageSections = React.lazy(
  () => import("./phone-mobile/PhonePageSections")
);
const LazyPhoneKanban = React.lazy(
  () => import("./phone-mobile/PhoneKanban")
);
const LazyPhoneSeedNotice = React.lazy(
  () => import("./phone-mobile/PhoneSeedNotice")
);
const LazyPhoneCalendar = React.lazy(
  () => import("./phone-mobile/PhoneCalendar")
);
import {
  type RuntimeState,
  type RuntimeRow,
  initRuntimeState,
  addRow,
  deleteRow,
  updateRow,
  validateRowValues,
  startInstance,
  nodeById,
} from "./live-runtime";
import {
  seedRuntimeState,
  dropSeedRowsFor,
  entityShowsSeed,
  seedRowCount,
} from "./demo-seed";
import { normalizeFieldOptions } from "./field-display";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
  subscribeRuntimeChanged,
  loadRuntimeRole,
  saveRuntimeRole,
  notifyRoleChanged,
  subscribeRoleChanged,
} from "./runtime-persistence";
import {
  accessForRole,
  pageAccessForRole,
  resolveVisiblePageId,
  type PageAccess,
} from "./rbac-preview";
import {
  ExperienceBlockBoundary,
  type PageFilterState,
  type FilterFieldOption,
  type QuickActionButtonSpec,
} from "./block-registry";
import {
  resolveDesignRecipe,
  designRecipeAlgorithms,
  DARK_CANVAS_BG,
} from "./design-recipes";
import { buildColumnFeatures } from "./table-features";
import { FieldValue } from "./FieldValue";
import { FieldEditor } from "./FieldEditor";
import {
  collectFreeformBlockRefKeys,
  dedupeBlocksByPanelKey,
  dropLegacyPanelsCoveredByBlocks,
} from "./page-panel-dedupe";
import { KanbanBoard, CalendarBoard } from "./PageViews";
// 看板分组是纯函数，桌面与手机共用同一份——两档各分各的会让同一条记录
// 在两个档位落进不同的列。
import {
  groupRowsForKanban,
  localDateKey,
  rowsByDateKey,
  type KanbanColumn,
} from "./page-views";
import { AiSuggestionCard } from "./AiSuggestionCard";
import { CodeProjectionView } from "./CodeProjectionView";
import { confirmDestructive, notify } from "./phone-mobile/phone-feedback";
import type { AppPageStatSchema } from "./app-runtime-schema";
import type { XrayTarget } from "../XrayPanel";

// 多端设计分辨率（固定渲染 + 等比缩放）
const DEVICE_SPECS = {
  desktop: { w: 1440, h: 810, label: "桌面" },
  tablet: { w: 1112, h: 834, label: "平板" },
  phone: { w: 390, h: 844, label: "手机" },
} as const;
type DeviceKey = keyof typeof DEVICE_SPECS;

/**
 * 弹层在各设备画布里的尺寸。
 *
 * antd Modal 是桌面组件：不给 width 默认 520px、垂直偏移 top:100。手机画布
 * 才 390 宽，520 直接顶穿两边——展会上访客点「新建」就能看见。旁边的详情
 * Drawer 早就按 isPhone 改成了底部弹起，Modal 这块漏了。
 *
 * 手机上按原生表单页的做法处理：左右各留 16 边距、垂直居中、内容超高自己
 * 滚（画布是固定 390×844 的等比缩放渲染，不是真实视口，所以这里按设计分辨率
 * 算死值而不是用 vh）。
 */
export function deviceModalSizing(device: DeviceKey): {
  width: number;
  centered: boolean;
  bodyMaxHeight: number;
} {
  const spec = DEVICE_SPECS[device];
  if (device === "phone") {
    return {
      width: spec.w - 32,
      centered: true,
      // 减掉标题栏 + 按钮栏 + 上下留白，剩下的给表单内容
      bodyMaxHeight: Math.round(spec.h * 0.6),
    };
  }
  return {
    width: 520,
    centered: false,
    bodyMaxHeight: Math.round(spec.h * 0.7),
  };
}

/** 容器实测尺寸 → 等比缩放系数（min(宽比, 高比)，letterbox 居中）。 */
function useScaleToFit(
  designW: number,
  designH: number
): {
  ref: React.RefObject<HTMLDivElement | null>;
  scale: number;
} {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setScale(Math.min(w / designW, h / designH));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [designW, designH]);
  return { ref, scale };
}

const MENU_ICONS = [
  TableOutlined,
  ProfileOutlined,
  FormOutlined,
  AppstoreOutlined,
];

// E40.2 品牌图标封闭集（id 合法域在 @legal identityIcons；未知 id 回退 boxes）
const BRAND_ICONS: Record<
  string,
  React.ComponentType<{ style?: React.CSSProperties }>
> = {
  boxes: AppstoreOutlined,
  chart: BarChartOutlined,
  shield: SafetyOutlined,
  cart: ShoppingCartOutlined,
  users: TeamOutlined,
  calendar: CalendarOutlined,
  file: FileTextOutlined,
  spark: ThunderboltOutlined,
  globe: GlobalOutlined,
  wrench: ToolOutlined,
  heart: HeartOutlined,
  book: BookOutlined,
};

// --- 图表（dataviz 规范：墨色文字、细标记、状态色已校验） --------------------
const INK = { label: "#595959", value: "#262626", faint: "#bfbfbf" };
const STATUS_META: Record<string, { color: string; label: string }> = {
  running: { color: "#1677ff", label: "进行中" },
  completed: { color: "#52c41a", label: "已完成" },
  rejected: { color: "#ff4d4f", label: "已驳回" },
};

/**
 * 页面级 KPI 卡取值（加厚 schema 一期）：对着运行时行数据求值声明的
 * metric。sum/avg 只统计能解析成数值的行（脏值跳过，不猜）；
 * avg 无可统计行时返回 null——渲染层如实显示"—"，不冒充 0。
 */
function pageStatValue(
  stat: AppPageStatSchema,
  rows: Array<{ values: Record<string, unknown> }>
): number | null {
  if (stat.metric === "count") return rows.length;
  const nums = rows
    .map(r => Number(r.values[stat.metricFieldId ?? ""]))
    .filter(n => Number.isFinite(n));
  if (stat.metric === "sum") return nums.reduce((a, b) => a + b, 0);
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Step 6 FilterBar：本页主实体行数据过滤（枚举精确匹配 AND 日期范围）。
 * 只作用于与 page.entityId 直接绑定的视图（Table/看板/日历）——stats/
 * rankings/feeds 各自可能引用不同实体（state.entities[其他 entityId]），
 * 语义上不归这份"本页主实体"过滤态管，不在这里处理。
 */
function applyPageFilter(
  rows: RuntimeRow[],
  filterState: PageFilterState | undefined,
  dateFieldId: string | null | undefined
): RuntimeRow[] {
  if (!filterState) return rows;
  let out = rows;
  const activeEnumEntries = Object.entries(
    filterState.enumFilters ?? {}
  ).filter(([, v]) => Boolean(v));
  for (const [fieldId, value] of activeEnumEntries) {
    out = out.filter(r => String(r.values[fieldId] ?? "") === value);
  }
  if (filterState.dateRange && dateFieldId) {
    const [from, to] = filterState.dateRange;
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs)) {
      out = out.filter(r => {
        const raw = r.values[dateFieldId];
        if (!raw) return false;
        const t = new Date(String(raw)).getTime();
        return Number.isFinite(t) && t >= fromMs && t <= toMs;
      });
    }
  }
  return out;
}

/** 工作台统计卡取值：对着运行时状态求值 schema 声明的 source。 */
function statValue(
  state: RuntimeState,
  schema: AppRuntimeSchema,
  source: string
): number {
  if (source.startsWith("entity:"))
    return (state.entities[source.slice("entity:".length)] ?? []).length;
  if (source === "instances:running")
    return state.instances.filter(i => i.status === "running").length;
  if (source === "instances:total") return state.instances.length;
  if (source === "roles") return schema.roles.length;
  return 0;
}

export function AppRuntimeScreen({
  model,
  sessionId,
  appTitle,
  onActivePageChange,
  xrayActive = false,
  onXrayTarget,
  controlsContainer,
}: {
  model: FiveSystemModel;
  sessionId: string;
  appTitle?: string;
  /** 当前页变化时上报（游标透视栏跟随应用内导航） */
  onActivePageChange?: (pageId: string) => void;
  /** 元素级游标：开启时被埋点的元素悬停上报目标 + 描边高亮 */
  xrayActive?: boolean;
  onXrayTarget?: (target: XrayTarget | null) => void;
  /** 档位切换条的外部挂载点（studio 顶条「游标」左侧）。传了本 prop 就
   *  不再浮在画布左上角：元素就绪前不渲染切换条（避免闪跳）。 */
  controlsContainer?: HTMLElement | null;
}) {
  // 2026-07-24：间距/圆角/阴影刻度——直接吃 antd 自己的 Design Token（见
  // design-tokens.ts 头部注释），不是另起一套静态数字。卡片族（KPI/图表/
  // 排行/动态）的 padding/margin/gap 统一从这里取，不再各处手写数字。
  const { token: antdToken } = antdTheme.useToken();
  const layout = React.useMemo(
    () => deriveLayoutTokens(antdToken),
    [antdToken]
  );

  // 表格列设置（表格自带能力）：按 pageId 记用户勾选的列；undefined = 默认列
  const [tableColPrefs, setTableColPrefs] = React.useState<
    Record<string, string[]>
  >({});

  const schema = React.useMemo(
    () => deriveAppRuntimeSchema(model, appTitle || "推演应用"),
    [model, appTitle]
  );
  // hydrate 后统一过一遍 seedRuntimeState：只给"完全为空的实体"铺演示行，
  // 幂等且不碰已有真实数据（见 demo-seed.ts 的三条边界）。放在 load 之后
  // 而不是只在 init 里，是因为别的面板可能先存过一份没种子的状态。
  const hydrate = React.useCallback(
    () => seedRuntimeState(loadRuntimeState(sessionId) ?? initRuntimeState(model), model),
    [sessionId, model]
  );
  const [state, setState] = React.useState<RuntimeState>(hydrate);
  const [activePageId, setActivePageId] = React.useState<string>(
    () => schema?.landingPageId ?? "home"
  );
  // Step 8：preferredDevice 只定默认打开视图，用户仍可手动切换设备档。
  // 平板档已从切换条下架（见下方档位切换注释），declared "tablet" 时按
  // 未声明处理，回落 desktop，避免初始态落进一个切换条选不中的档位。
  const [device, setDevice] = React.useState<DeviceKey>(() =>
    schema?.identity.preferredDevice === "phone" ? "phone" : "desktop"
  );
  // 代码视图档（代码视图一期）：schema 的确定性代码投影——与设备档并列的
  // 观察视角切换，开着时替换缩放画布（代码要整幅面积，不做 16:9 缩放）
  const [codeView, setCodeView] = React.useState(false);
  // 当前角色与 RBAC 屏「角色预览」共享（localStorage + 事件），谁改都实时生效
  const [role, setRole] = React.useState<string | undefined>(
    () => loadRuntimeRole(sessionId) ?? schema?.roles[0]
  );
  // Step 6 FilterBar：按 pageId 存一份本地过滤态（视图态，不进 STATE/门禁）。
  const [pageFilters, setPageFilters] = React.useState<
    Record<string, PageFilterState>
  >({});
  const [formOpen, setFormOpen] = React.useState(false);
  const [formValues, setFormValues] = React.useState<Record<string, unknown>>(
    {}
  );
  const [detailRow, setDetailRow] = React.useState<RuntimeRow | null>(null);
  // 手机档看板当前选中的状态列（桌面档并排显示所有列，不需要这个 state）
  const [phoneKanbanKey, setPhoneKanbanKey] = React.useState("");
  // 手机档日历选中的那一天（null = 不筛，显示全部）
  const [phoneCalDate, setPhoneCalDate] = React.useState<Date | null>(null);
  // AI 生成：正在跑的能力 id + 最近一次失败诊断（fail-closed，不冒充输出）
  const [aiRunningCapId, setAiRunningCapId] = React.useState<string | null>(
    null
  );
  const [aiError, setAiError] = React.useState<{
    code: string;
    detail: string;
  } | null>(null);
  // AI 建议（加厚 schema 三期"可解释输出"）：生成结果先落建议卡，
  // 用户确认才写回行字段——AI 永远是建议式，不直改数据。
  const [aiSuggestion, setAiSuggestion] = React.useState<{
    action: AppAiActionSchema;
    entityId: string;
    rowId: string;
    output: string;
    confidence: number | null;
    rationale: string | null;
  } | null>(null);
  const spec = DEVICE_SPECS[device];
  const { ref: fitRef, scale } = useScaleToFit(spec.w, spec.h);
  // 弹层（Modal/Select/Drawer）挂进画布，跟随 transform 缩放
  const [canvasEl, setCanvasEl] = React.useState<HTMLDivElement | null>(null);

  // 与工作流试运行面共享一份状态：对方变更时重载
  React.useEffect(
    () =>
      subscribeRuntimeChanged(sessionId, () => setState(hydrate())),
    [sessionId, hydrate]
  );
  React.useEffect(
    () =>
      subscribeRoleChanged(sessionId, () => {
        const next = loadRuntimeRole(sessionId);
        if (next) setRole(next);
      }),
    [sessionId]
  );

  const changeRole = (next: string) => {
    setRole(next);
    saveRuntimeRole(sessionId, next);
    notifyRoleChanged(sessionId);
  };

  // 角色 → 页面可见性/操作权（RBAC 模型驱动；公共页恒可见）
  const pageAccess = React.useMemo(() => {
    const map = new Map<string, PageAccess>();
    if (!schema) return map;
    for (const a of pageAccessForRole(
      schema.pages,
      accessForRole(model, role)
    )) {
      map.set(a.pageId, a);
    }
    return map;
  }, [schema, model, role]);

  // 会话或模型换了一套时，从新模型声明的落地页重新进入；旧模型仍是 home。
  React.useEffect(() => {
    if (schema) setActivePageId(schema.landingPageId);
  }, [sessionId, schema?.landingPageId]);

  // 当前页对该角色不可见时，降级到第一个可见业务页；一个都没有才回旧工作台。
  React.useEffect(() => {
    if (!schema) return;
    const resolved = resolveVisiblePageId(
      schema.pages,
      pageAccess,
      activePageId,
      schema.home.id
    );
    if (resolved !== activePageId) setActivePageId(resolved);
  }, [activePageId, pageAccess, schema]);

  React.useEffect(() => {
    onActivePageChange?.(activePageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageId]);

  if (!schema) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-stone-400">
        本话题模型缺少页面/实体定义，推演闭环后可运行应用
      </div>
    );
  }

  const isPhone = device === "phone";
  const isTablet = device === "tablet";
  const modalSizing = deviceModalSizing(device);
  const isHome = activePageId === "home";
  const page: AppPageSchema | null = isHome
    ? null
    : (schema.pages.find(p => p.id === activePageId) ??
      schema.pages[0] ??
      null);
  const currentTitle = isHome ? schema.home.title : (page?.title ?? "");
  const allRows = page?.entityId ? (state.entities[page.entityId] ?? []) : [];
  /**
   * 本页主表里还剩几行演示种子（0 = 展示的全是真实数据）。
   *
   * 一页里的表格、图表、KPI、体验区块吃的都是这同一批行，所以标注也只需要
   * 这一处——不给每个渲染器各挂一个徽标（那样一页能挂出七八个"示例数据"，
   * 反而没人看）。用户往这张表写第一条真实数据时种子整批清掉，徽标随之消失。
   */
  const pageSeedCount = seedRowCount(state, page?.entityId);

  // Step 6 FilterBar：本页可筛的枚举字段（有声明选项的 enum 字段）+
  // 可选日期范围字段（主实体第一个 date/datetime 字段）。
  const filterableEnumFields: FilterFieldOption[] = page
    ? page.detailFields
        .filter(f => f.type === "enum" && (f.options?.length ?? 0) > 0)
        .map(f => ({
          id: f.id,
          label: f.label,
          options: (f.options ?? []).map(o => ({
            value: o.id,
            label: o.label,
          })),
        }))
    : [];
  const dateRangeField = page
    ? (() => {
        const f = page.detailFields.find(
          fi => fi.type === "date" || fi.type === "datetime"
        );
        return f ? { id: f.id, label: f.label } : null;
      })()
    : null;
  const activePageFilter: PageFilterState = page
    ? (pageFilters[page.id] ?? { enumFilters: {} })
    : { enumFilters: {} };
  const rows = applyPageFilter(allRows, activePageFilter, dateRangeField?.id);

  const handlePageFilterChange = (patch: Partial<PageFilterState>) => {
    if (!page) return;
    const pageId = page.id;
    setPageFilters(prev => {
      const cur = prev[pageId] ?? { enumFilters: {} };
      return {
        ...prev,
        [pageId]: {
          enumFilters: { ...cur.enumFilters, ...(patch.enumFilters ?? {}) },
          dateRange:
            patch.dateRange !== undefined
              ? patch.dateRange
              : (cur.dateRange ?? null),
        },
      };
    });
  };

  // Step 6 QuickActionPanel：本页 navigate/createRecord 候选动作，标签现拼
  // （navigate→目标页标题；createRecord→目标实体名）。pageActions[].permitted
  // 派生时恒 true（deriveAppRuntimeSchema 没有角色上下文），真实权限判定和
  // handleBlockAction 点击时同一套公式（pageAccess.grantedActions），这里
  // 重算是为了按钮态本身就诚实——不能显示可点、点了却因权限被吞。
  const quickActionButtons: QuickActionButtonSpec[] = page
    ? page.pageActions
        .filter(a => a.type === "navigate" || a.type === "createRecord")
        .map(a => {
          const pa = pageAccess.get(page.id);
          const permitted =
            !a.permissionRef ||
            (pa?.grantedActions ?? []).includes(a.permissionRef);
          if (a.type === "navigate") {
            const target = schema.pages.find(p => p.id === a.targetPageRef);
            return {
              id: a.id,
              label: target ? `前往 ${target.title}` : "跳转",
              permitted,
            };
          }
          const entity = resolveEntityRef(a.entityRef, model);
          return {
            id: a.id,
            label: entity.resolved ? `新建 ${entity.label}` : "新建",
            permitted,
          };
        })
    : [];

  /**
   * enum 字段取值声明的查询（entityId + fieldId → 归一化 options）。
   *
   * 页面图表的 options 在 schema 派生时就带上了，freeform 的 chart 节点是
   * LLM 现写的 `{entityRef, dimensionFieldId}`，手里没有字段定义——不给它
   * 这个查询，环图图例就只能写取值 id（`refunded` / `unpaid`）。
   */
  const enumOptionsOf = React.useCallback(
    (entityId: string, fieldId: string) => {
      const field = model?.datamodel?.entities
        ?.find(e => e.id === entityId)
        ?.fields?.find(f => f.id === fieldId);
      return normalizeFieldOptions(field?.type, field?.options);
    },
    [model]
  );

  /**
   * 字段显示名查询，给 DataTable 区块的列头用（2026-07-28）。
   *
   * 区块渲染器手里只有 binding.entityRef 和运行时行数据，没有字段定义，
   * 于是列头一直在打印字段 id（`lot_code`），跟同页其它表格的中文列名
   * 坐在一起格外刺眼。查不到回落 undefined，渲染器自己退回字段 id。
   */
  const fieldLabelOf = React.useCallback(
    (entityId: string, fieldId: string) =>
      model?.datamodel?.entities
        ?.find(e => e.id === entityId)
        ?.fields?.find(f => f.id === fieldId)?.name || undefined,
    [model]
  );

  // antd v5 的静态 message.xxx() 拿不到 ConfigProvider 上下文（控制台明写着
  // 「Static function can not consume context like dynamic theme」）——身份主色、
  // 深色/紧凑档、圆角配方全都下发不到提示条上。改用 hook 版拿带上下文的实例，
  // messageHolder 挂在 ConfigProvider 里面（见下方渲染处）。
  const [messageApi, messageHolder] = message.useMessage();
  /** 提示的统一出口：设备分流 + 落在画布内 + 带主题上下文，调用点只给档位和文案。 */
  const toast = React.useCallback(
    (kind: "success" | "warning" | "info" | "error", content: string) =>
      notify(isPhone, kind, content, () => canvasEl, messageApi),
    [isPhone, canvasEl, messageApi]
  );

  const apply = (next: RuntimeState) => {
    setState(next);
    saveRuntimeState(sessionId, next);
    notifyRuntimeChanged(sessionId);
  };

  // 元素级游标探针：开着游标时，埋点元素悬停上报目标 + 类名描边（对齐焦点）
  const probe = (t: XrayTarget): React.HTMLAttributes<HTMLElement> =>
    xrayActive && onXrayTarget
      ? {
          className: "xray-el",
          onMouseEnter: () => onXrayTarget(t),
          onMouseLeave: () => onXrayTarget(null),
        }
      : {};

  const refRowsFor = (field: AppFormFieldSchema) => {
    if (!field.refEntityId) return [];
    return (state.entities[field.refEntityId] ?? []).map(r => ({
      id: r.id,
      label: String(Object.values(r.values)[0] ?? r.id),
    }));
  };

  /** 关详情：未确认的 AI 建议随之丢弃（不悄悄写回）。两个设备档共用。 */
  const closeDetail = () => {
    setDetailRow(null);
    setAiError(null);
    setAiSuggestion(null);
  };

  /** enum 字段的历史取值（已写入行里出现过的，去重）——无声明取值时的候选来源。 */
  const enumOptionsFor = (field: AppFormFieldSchema) => {
    if (field.type !== "enum" || !page?.entityId) return [];
    return [
      ...new Set(
        (state.entities[page.entityId] ?? [])
          .map(r => String(r.values[field.id] ?? "").trim())
          .filter(Boolean)
      ),
    ];
  };

  const handleCreate = () => {
    if (!page?.entityId) return;
    const problems = validateRowValues(model, page.entityId, formValues);
    if (problems.length > 0) {
      toast("warning", problems.join("；"));
      return;
    }
    // 第一条真实数据落地前，先把这张表的演示种子整批清掉——种子和真实数据
    // 不混表，否则用户找不到自己刚写的那条，「示例数据」徽标也不再准确。
    const { state: next } = addRow(
      dropSeedRowsFor(state, page.entityId),
      page.entityId,
      formValues,
      new Date().toISOString()
    );
    apply(next);
    setFormOpen(false);
    setFormValues({});
    toast("success", "已保存");
  };

  /**
   * AI 生成（三期"可解释输出"）：当前行喂给绑定能力（真 LLM，explain 通道），
   * 成功后不直接写回——先落建议卡（建议值+置信度+依据），用户确认才应用。
   */
  const runAiAction = async (action: AppAiActionSchema) => {
    if (!page?.entityId || !detailRow || aiRunningCapId) return;
    const entityId = page.entityId;
    const rowId = detailRow.id;
    setAiRunningCapId(action.capId);
    setAiError(null);
    setAiSuggestion(null);
    try {
      const res = await fetch("/api/sliderule/aigc-tryrun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: {
            id: action.capId,
            name: action.label,
            inputFields: action.inputFields,
            outputField: `${entityId}.${action.outputFieldId}`,
          },
          inputs: buildAiActionInputs(action, entityId, detailRow.values),
          goal: appTitle,
          explain: true,
        }),
      });
      const body = res.ok
        ? ((await res.json()) as {
            ok: boolean;
            output?: string;
            confidence?: number;
            rationale?: string;
            code?: string;
            detail?: string;
          })
        : { ok: false, code: `HTTP_${res.status}`, detail: await res.text() };
      if (!body.ok || body.output === undefined) {
        setAiError({ code: body.code ?? "UNKNOWN", detail: body.detail ?? "" });
        return;
      }
      setAiSuggestion({
        action,
        entityId,
        rowId,
        output: body.output,
        confidence:
          typeof body.confidence === "number" ? body.confidence : null,
        rationale: body.rationale?.trim() || null,
      });
    } catch (e) {
      setAiError({ code: "NETWORK_ERROR", detail: String(e) });
    } finally {
      setAiRunningCapId(null);
    }
  };

  /** 建议卡「确认并应用」：此刻才真正写回行字段。 */
  const applyAiSuggestion = () => {
    if (!aiSuggestion) return;
    const { action, entityId, rowId, output } = aiSuggestion;
    const next = updateRow(state, entityId, rowId, {
      [action.outputFieldId]: output,
    });
    apply(next);
    const updated = (next.entities[entityId] ?? []).find(r => r.id === rowId);
    if (updated) setDetailRow(updated);
    setAiSuggestion(null);
    toast("success", `已应用 AI 建议 →「${action.outputLabel}」`);
  };

  const handleSubmitToWorkflow = (rowId: string, rowLabel: string) => {
    if (!page?.entityId) return;
    const { state: next, instance } = startInstance(
      state,
      model,
      `${page.title} · ${rowLabel}`,
      new Date().toISOString(),
      { entityId: page.entityId, rowId }
    );
    if (instance) {
      apply(next);
      toast("success", `已提交审批：${instance.title}（到 Workflow 试运行里推进）`);
    }
  };

  // 行操作跨设备共用同一套 onClick，只换按钮壳：手机档 antd-mobile Button
  // （触摸目标够大、按下有原生反馈），桌面档 antd type="link"。外层容器也分档
  // ——antd Space 是桌面组件，手机上直接用 flex，少一层 PC DOM。
  const rowActions = (row: RuntimeRow) => {
    const submit = (e: React.MouseEvent) => {
      e.stopPropagation();
      handleSubmitToWorkflow(
        row.id,
        String(Object.values(row.values)[0] ?? row.id)
      );
    };
    const remove = (e: React.MouseEvent) => {
      e.stopPropagation();
      apply(deleteRow(state, page!.entityId!, row.id));
    };
    if (isPhone) {
      return (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {page?.workflowLinked && (
            <span
              {...probe({ kind: "workflow", label: "提交审批", pageId: page.id })}
            >
              <React.Suspense fallback={null}>
                <LazyPhoneActionButton color="primary" onClick={submit}>
                  提交审批
                </LazyPhoneActionButton>
              </React.Suspense>
            </span>
          )}
          <React.Suspense fallback={null}>
            <LazyPhoneActionButton color="danger" onClick={remove}>
              删除
            </LazyPhoneActionButton>
          </React.Suspense>
        </div>
      );
    }
    return (
      <Space size="small">
        {page?.workflowLinked && (
          <span
            {...probe({ kind: "workflow", label: "提交审批", pageId: page.id })}
          >
            <Button size="small" type="link" onClick={submit}>
              提交审批
            </Button>
          </span>
        )}
        {/* 删除是不可逆的，此前一点就没了——展会上访客手一滑就把演示数据
            删掉，还不知道自己干了什么。antd Popconfirm 是这个场景的标准解，
            不用自己搭一个确认弹框。手机档不套：那边是左滑出删除键，
            滑动本身已经是"不会误触"的确认动作。 */}
        <Popconfirm
          title="删除这条记录？"
          description="删掉之后无法恢复。"
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          getPopupContainer={() => canvasEl ?? document.body}
          onConfirm={() => {
            apply(deleteRow(state, page!.entityId!, row.id));
            toast("success", "已删除");
          }}
        >
          <Button
            size="small"
            type="link"
            danger
            onClick={e => e.stopPropagation()}
          >
            删除
          </Button>
        </Popconfirm>
      </Space>
    );
  };

  // 表格列：列设置勾选优先（从实体全字段挑），否则默认列；
  // 每列自带排序（按字段类型）与筛选（enum/低基数真实取值）——表格自带能力，不走设计面板。
  // kanban 范式的看板列字段（派生层已保证是主实体 enum 字段；再解析一次
  // 拿到带 options 的完整字段 schema，解析不到 = 视图退回表格）
  const kanbanStatusField =
    page && page.view.kind === "kanban" && page.view.statusFieldId
      ? page.detailFields.find(f => f.id === page.view.statusFieldId)
      : undefined;

  const chosenColIds = page ? tableColPrefs[page.id] : undefined;
  const shownColumns = chosenColIds
    ? (page?.detailFields ?? []).filter(f => chosenColIds.includes(f.id))
    : (page?.columns ?? []);
  const columns = [
    ...shownColumns.map(c => ({
      title: c.label,
      dataIndex: ["values", c.id],
      key: c.id,
      ellipsis: true,
      // 列头过滤下拉的候选值取全量 allRows（不随 FilterBar 收窄），避免选项
      // 随筛选结果消失。
      ...buildColumnFeatures(c, allRows),
      onHeaderCell: () =>
        page?.entityId
          ? probe({
              kind: "field",
              entityId: page.entityId,
              fieldId: c.id,
              label: c.label,
            })
          : {},
      // 字段语义渲染（加厚 schema 一期）：enum tone 徽标 / 金额 / 进度条 / 星级 / 脱敏
      render: (v: unknown) => <FieldValue field={c} value={v} />,
    })),
    {
      title: "操作",
      key: "__actions",
      width: 170,
      render: (_: unknown, row: RuntimeRow) => rowActions(row),
    },
  ];

  // 列设置（ProTable 式齿轮）：从实体全字段勾选表格列
  const columnSettings = page && page.detailFields.length > 0 && (
    <Popover
      trigger="click"
      placement="bottomRight"
      content={
        <div
          style={{
            maxHeight: 260,
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {page.detailFields.map(f => {
            const current =
              tableColPrefs[page.id] ?? page.columns.map(c => c.id);
            const checked = current.includes(f.id);
            return (
              <Checkbox
                key={f.id}
                checked={checked}
                onChange={e => {
                  const next = e.target.checked
                    ? [...current, f.id]
                    : current.filter(id => id !== f.id);
                  // 保实体字段声明序 + 至少保留一列
                  const ordered = page.detailFields
                    .map(d => d.id)
                    .filter(id => next.includes(id));
                  if (ordered.length > 0)
                    setTableColPrefs(prev => ({ ...prev, [page.id]: ordered }));
                }}
              >
                {f.label}
              </Checkbox>
            );
          })}
        </div>
      }
    >
      <Button
        size="small"
        type="text"
        icon={<SettingOutlined />}
        title="列设置"
        data-testid="app-table-col-settings"
      />
    </Popover>
  );

  const recentInstances = [...state.instances].slice(-5).reverse();

  // E40.2 应用身份：主题 token 决定品牌区/主色/内容底色/图表配色；缺省 = azure（老模型渲染与历史一致）。
  // 声明必须在 chartCard 之前——homeContent 是即时求值的 JSX（非函数），
  // 里面 .map(chartCard) 在这一行就会同步执行，晚声明会触发 TDZ 报错。
  const identityTheme = resolveIdentityTheme(
    schema.identity.themeId,
    schema.identity.generatedTheme
  );

  // 工作台内置图：ECharts 基建（与页面级声明图表同一 lazy chunk / 同一套 dataviz 约定）
  /** 图表正文（真图 or 诚实空态）——两个设备档共用，只有外面那层卡片不同。 */
  const chartBody = (chart: AppChartSchema, height: number) => {
    let option: Record<string, unknown> | null = null;
    let emptyHint = "";
    const ariaLabel = chart.label;
    if (chart.source === "entities:rowcount") {
      option = buildEntityRowcountOption(
        (model.datamodel?.entities ?? []).slice(0, 6).map(e => ({
          label: e.name || e.id,
          value: (state.entities[e.id] ?? []).length,
        })),
        { primary: identityTheme.primary, categorical: identityTheme.charts }
      );
      emptyHint = "暂无数据 — 到业务页面「新建」写入";
    } else if (chart.source === "instances:status") {
      const counts: Record<string, number> = {};
      for (const inst of state.instances)
        counts[inst.status] = (counts[inst.status] ?? 0) + 1;
      option = buildInstanceStatusOption(counts);
      emptyHint = "暂无流程实例 — 到业务页面「提交审批」发起";
    }
    if (!option)
      return (
        <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>
          {emptyHint}
        </div>
      );
    return (
      <React.Suspense
        fallback={
          <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>
            图表加载中…
          </div>
        }
      >
        <LazyEchartsChart
          option={option}
          height={height}
          ariaLabel={ariaLabel}
        />
      </React.Suspense>
    );
  };

  const chartCard = (chart: AppChartSchema) => (
    <Card
      key={chart.id}
      title={chart.label}
      size="small"
      style={{ flex: 1, minWidth: 0 }}
      data-testid={`app-runtime-${chart.id}`}
    >
      {chartBody(chart, 168)}
    </Card>
  );

  const timelineCard = (
    <Card title="审批动态" size="small" style={{ flex: 1.2, minWidth: 0 }}>
      {recentInstances.length === 0 ? (
        <div style={{ fontSize: 11, color: INK.faint }}>
          暂无流程实例 — 到业务页面「提交审批」发起
        </div>
      ) : (
        <Timeline
          items={recentInstances.map(inst => {
            const meta = STATUS_META[inst.status] ?? STATUS_META.running;
            return {
              color:
                inst.status === "running"
                  ? "blue"
                  : inst.status === "completed"
                    ? "green"
                    : "red",
              children: (
                <div style={{ fontSize: 12 }}>
                  <div
                    style={{
                      color: INK.value,
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {inst.title}
                  </div>
                  <div style={{ color: INK.label, marginTop: 2 }}>
                    {nodeById(model, inst.currentNodeId)?.name ??
                      inst.currentNodeId}
                    <Tag
                      style={{ marginLeft: 8 }}
                      color={
                        meta.color === "#1677ff"
                          ? "processing"
                          : inst.status === "completed"
                            ? "success"
                            : "error"
                      }
                    >
                      {meta.label}
                    </Tag>
                  </div>
                </div>
              ),
            };
          })}
        />
      )}
    </Card>
  );

  // 桌面/平板档首页。手机档走 phoneHomeContent（antd-mobile），所以这里
  // 不再有 isPhone 分支——留着会让人以为手机还走这条路。
  const homeContent = (
    <>
      <div style={{ display: "flex", gap: 16 }}>
        {schema.home.stats.map(s => (
          <Card
            key={s.id}
            size="small"
            style={{ flex: 1 }}
            styles={{ body: { padding: "16px 20px" } }}
          >
            <Statistic
              title={s.label}
              value={statValue(state, schema, s.source)}
              suffix={s.suffix}
            />
          </Card>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        {schema.home.charts.map(chartCard)}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        <Card title="快速入口" size="small" style={{ flex: 1 }}>
          <Space wrap>
            {schema.pages.map(p => {
              const locked = pageAccess.get(p.id)?.visible === false;
              return (
                <Button
                  key={p.id}
                  icon={locked ? <LockOutlined /> : undefined}
                  disabled={locked}
                  title={
                    locked ? `当前角色（${role ?? "-"}）无本页权限` : undefined
                  }
                  onClick={() => setActivePageId(p.id)}
                >
                  {p.title}
                </Button>
              );
            })}
          </Space>
          {[...pageAccess.values()].some(a => !a.visible) && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#999" }}>
              <LockOutlined /> 当前角色不可见{" "}
              {[...pageAccess.values()].filter(a => !a.visible).length} 个页面 —
              右上角切换角色试试（RBAC 权限实时生效）
            </div>
          )}
        </Card>
        {timelineCard}
      </div>
    </>
  );

  // 手机端首页：同一份数据（统计/图表/审批动态）交给 antd-mobile 渲染。
  // 桌面档那版是 antd 的 Card+Statistic+Timeline —— 之前手机档跟着复用，
  // 只加了几个 isPhone 三元调间距：间距对了，组件还是 PC 的。
  const phoneHomeContent = (
    <React.Suspense
      fallback={
        <Skeleton active paragraph={{ rows: 4 }} style={{ padding: "12px 4px" }} />
      }
    >
      <LazyPhoneHome
        stats={schema.home.stats.map(s => ({
          id: s.id,
          label: s.label,
          value: statValue(state, schema, s.source),
          suffix: s.suffix,
        }))}
        charts={schema.home.charts.map(c => ({
          id: c.id,
          label: c.label,
          node: chartBody(c, 148),
        }))}
        timeline={recentInstances.map(inst => ({
          id: inst.id,
          title: inst.title,
          nodeLabel:
            nodeById(model, inst.currentNodeId)?.name ?? inst.currentNodeId,
          statusLabel: (STATUS_META[inst.status] ?? STATUS_META.running).label,
          status:
            inst.status === "completed"
              ? "completed"
              : inst.status === "rejected"
                ? "rejected"
                : "running",
        }))}
        timelineEmptyHint="暂无流程实例 — 到业务页面「提交审批」发起"
      />
    </React.Suspense>
  );

  // 方案 C 的两张名单：哪些 kind 属于"总览页"、哪些区块类型属于"KPI/图表类"。
  // 总览页归 freeformOverview（AI 现场设计，每个应用长得不一样）；
  // 业务页归积木（模板渲染，整齐可预期）。
  const OVERVIEW_KINDS = new Set(["monitor", "dashboard"]);
  const KPI_BLOCK_TYPES = new Set(["MetricGrid", "TrendChart"]);

  // 2026-07-29：设计者可以用 blockRef 把排行榜/动态流直接摆进 freeform 版式里
  //（见 page-panel-dedupe.ts）。摆进去了，外面的脚手架和固定骨架就都不再画
  // 同一份——否则又是一份数据两张卡，而且破坏它设计的留白节奏。
  const freeformPlacedKeys = React.useMemo(
    () => collectFreeformBlockRefKeys(page?.freeformOverview),
    [page?.freeformOverview]
  );

  // 体验区块渲染：桌面壳与手机壳共用同一份摆法逻辑，只有槽位来源分档。
  // 抽成函数之前它内联在 defaultPageContent 里，于是手机档一个区块都渲染不到。
  const renderExperienceBlockScaffold = (forPhone: boolean) => {
    if (!page) return null;
        // 保守策略：_fromLegacy 区块只是转换占位，渲染仍走旧路径（statsBand 等）。
        // 真正的新模型 blocks 不带 _fromLegacy，走 ExperienceBlockBoundary。
        const directBlocks = page.experienceBlocks
          .filter(
            b =>
              !(b as import("./block-registry").ExperienceBlockInstance)
                ._fromLegacy
          )
          // 归属划分（2026-07-28）：KPI/图表在一页里只能由一条路负责。
          //
          // 总览页（monitor/dashboard）的 stats/charts 会被 ENRICH 重新设计成
          // freeformOverview——那是同一份声明的美化版，不是另一份内容。这类页
          // 上再出 MetricGrid/TrendChart 积木，就会和总览区画出两张说同一件事
          // 的卡。这里直接把它们摘掉：不指望 LLM 一定守规矩，渲染层兜死。
          //
          // 反方向在下面（statsBand/chartsBand 让位给积木）。
          .filter(b => !(OVERVIEW_KINDS.has(page.view.kind) && KPI_BLOCK_TYPES.has(b.type)))
          // 同一条"一页一个主人"的规矩，用在表格上（2026-07-28 真跑发现）。
          //
          // 每一页本来就会把自己的主实体渲染成一张表——带中文列名、枚举彩色标签、
          // 排序/筛选/分页/行内操作。DataTable 积木绑同一个实体时画的是**同一批行**，
          // 却只有裸字段名（lot_code / supplier_id）、没有枚举标签、没有操作，
          // 于是一页里同样的数据出现两遍，上面那遍还更难看。
          //
          // 实测：放开 DataTable 生成后，五个业务页全中——模型不知道"这一页已经
          // 自带主实体表"，只当页面是张白纸。所以跟 KPI 一样在渲染层兜死。
          //
          // 只摘"绑主实体"的那些；绑**别的**实体的 DataTable 是真新增内容
          //（例如库存页上挂一张供应商表），必须留着。
          .filter(
            b =>
              !(
                b.type === "DataTable" &&
                page.entityId &&
                (b.binding as { entityRef?: string } | undefined)?.entityRef ===
                  page.entityId
              )
          )
          // 同一条规矩的第三例（2026-07-28）：总览页不要筛选条。
          //
          // FilterBar 筛的是"本页主实体行"，可总览页压根不逐行展示数据，
          // 筛了看不出任何变化；更糟的是它绑单个实体，而总览页的 KPI/图表
          // 通常跨好几个实体（真跑那次跨了 4 个），筛一个也管不着另外三个。
          // 也就是说它在这类页面上是**功能性无效**的，不只是难看。
          .filter(b => !(OVERVIEW_KINDS.has(page.view.kind) && b.type === "FilterBar"));
        // 积木内部的自我去重：模型偶尔把同一份榜/流声明两次（见
        // page-panel-dedupe.ts 的内容指纹判定）。
        const dedupedBlocks = dedupeBlocksByPanelKey(directBlocks, freeformPlacedKeys);
        if (dedupedBlocks.length === 0) return null;

        // Step 5：区块事件 → 页面动作调度（零破坏，不影响 aiActions 路径）。
        const handleBlockAction = (
          actionId: string,
          eventData?: Record<string, unknown>
        ) => {
          const action = page.pageActions.find(a => a.id === actionId);
          if (!action) return;
          // 实际权限检查：permissionRef 须在当前角色 grantedActions 里。
          const pa = pageAccess.get(page.id);
          const permitted =
            !action.permissionRef ||
            (pa?.grantedActions ?? []).includes(action.permissionRef);
          if (!permitted) return;
          switch (action.type) {
            case "navigate":
              if (action.targetPageRef) setActivePageId(action.targetPageRef);
              break;
            case "createRecord":
              // 复用既有「新建」表单：只支持目标实体=本页主实体的场景（表单
              // 字段就是照本页主实体拼的）；指向别的实体如实拒绝，不假装能建。
              if (action.entityRef && action.entityRef === page.entityId) {
                setFormValues({});
                setFormOpen(true);
              } else {
                toast("info", "该操作指向的实体暂不支持在此页创建");
              }
              break;
            case "changeFilter":
              console.log("[action:changeFilter]", actionId, eventData);
              break;
            default:
              console.log(`[action:${action.type}]`, actionId, eventData);
          }
        };

        const renderBlock = (block: (typeof dedupedBlocks)[number]) => (
          <ExperienceBlockBoundary
            key={block.id}
            block={block}
            onAction={handleBlockAction}
            pageActions={quickActionButtons}
            filterState={activePageFilter}
            filterFieldOptions={filterableEnumFields}
            dateRangeField={dateRangeField}
            onFilterChange={handlePageFilterChange}
            workflow={model.workflow}
            entityRows={state.entities}
            chartPalette={{
              primary: identityTheme.primary,
              categorical: identityTheme.charts,
            }}
            enumOptionsOf={enumOptionsOf}
            fieldLabelOf={fieldLabelOf}
          />
        );

        // Step 7：未声明 layout（或声明后 5 槽位全空，schema 层已判定并回 null）
        // 时保留原顺序平铺，视觉零变化。
        if (!page.layout) {
          return (
            <div
              className="mb-3 grid gap-2"
              data-testid="app-runtime-experience-block-scaffold"
            >
              {dedupedBlocks.map(renderBlock)}
            </div>
          );
        }

        const blockById = new Map(dedupedBlocks.map(b => [b.id, b]));
        // 手机档用 layout.mobile 覆盖（未声明则退回桌面槽位，同一套摆法）。
        // forPhone 由调用方传入——从前这里读的是 isPhone，而这段代码只在桌面
        // 壳里跑（手机壳走 phonePageContent），isPhone 恒 false，layout.mobile
        // 是死字段：LLM 在生成它、Gate 在校验它，运行时永远读不到。
        const slotSource =
          forPhone && page.layout.mobile
            ? { ...page.layout, ...page.layout.mobile }
            : page.layout;
        const slotBlocks = (ids: string[]) =>
          ids
            .map(bid => blockById.get(bid))
            .filter((b): b is NonNullable<typeof b> => !!b);
        const summaryBlocks = slotBlocks(slotSource.summary ?? []);
        const primaryBlocks = slotBlocks(slotSource.primary ?? []);
        const secondaryBlocks = slotBlocks(slotSource.secondary ?? []);
        const activityBlocks = slotBlocks(slotSource.activity ?? []);
        const contentBlocks = slotBlocks(slotSource.content ?? []);
        const placedIds = new Set(
          [
            ...summaryBlocks,
            ...primaryBlocks,
            ...secondaryBlocks,
            ...activityBlocks,
            ...contentBlocks,
          ].map(b => b.id)
        );
        // 声明了 layout 但没被任何槽位引用到的区块：如实照样渲染，不能因为
        // 没排进槽位就悄悄丢内容——排在末尾，视觉上标为"未分配槽位"。
        const orphanBlocks = dedupedBlocks.filter(b => !placedIds.has(b.id));

        return (
          <div
            className="mb-3 flex flex-col gap-2"
            data-testid="app-runtime-experience-block-layout"
          >
            {summaryBlocks.length > 0 && (
              <div
                className="flex flex-wrap gap-2"
                data-testid="app-runtime-layout-summary"
              >
                {summaryBlocks.map(renderBlock)}
              </div>
            )}
            {(primaryBlocks.length > 0 || secondaryBlocks.length > 0) && (
              <div className="flex flex-col gap-2 md:flex-row md:items-start">
                {primaryBlocks.length > 0 && (
                  <div
                    className="flex min-w-0 flex-[2] flex-col gap-2"
                    data-testid="app-runtime-layout-primary"
                  >
                    {primaryBlocks.map(renderBlock)}
                  </div>
                )}
                {secondaryBlocks.length > 0 && (
                  <div
                    className="flex min-w-0 flex-1 flex-col gap-2"
                    data-testid="app-runtime-layout-secondary"
                  >
                    {secondaryBlocks.map(renderBlock)}
                  </div>
                )}
              </div>
            )}
            {activityBlocks.length > 0 && (
              <div
                className="flex flex-col gap-2"
                data-testid="app-runtime-layout-activity"
              >
                {activityBlocks.map(renderBlock)}
              </div>
            )}
            {contentBlocks.length > 0 && (
              <div
                className="flex flex-col gap-2"
                data-testid="app-runtime-layout-content"
              >
                {contentBlocks.map(renderBlock)}
              </div>
            )}
            {orphanBlocks.length > 0 && (
              <div
                className="grid gap-2"
                data-testid="app-runtime-layout-unassigned"
              >
                {orphanBlocks.map(renderBlock)}
              </div>
            )}
          </div>
        );
  };

  // 页面级 KPI 的取数抽成一处，桌面 statsBand 与手机档共用——两边各算一遍的
  // 话，同一个指标在两个档位会出现一个有值、一个是"—"。只有摆法分档，取数不分。
  //
  // 2026-07-28：这里原本在"真实值为 0/null 时"临时造一批预览行算个数出来，
  // 那是只给 KPI 打的补丁——同一页的表格、图表、体验区块照样空着，一页里
  // 半边有数半边空。现在种子行已经在**运行时状态**这一层铺好了
  //（demo-seed.ts），所有取数口径共用同一批行，这里只需照常算，
  // 外加如实标一句"这些行是示例"。
  const pageStatDisplay = (stat: AppPageStatSchema) => {
    const rows = state.entities[stat.entityId] ?? [];
    return {
      value: pageStatValue(stat, rows),
      isPreview: entityShowsSeed(state, stat.entityId),
    };
  };

  // 页面图表的手机形态：取数与桌面 renderChartCard 完全一致
  //（同一个 buildEchartsOption + 同一份主题色），只把高度压到 140，
  // 空态文案也照搬——两个档位不能对同一份数据给出不同说法。
  const phoneChartNode = (chart: AppPageChartSchema) => {
    const chartRows = state.entities[chart.entityId] ?? [];
    if (chartRows.length === 0)
      return (
        <div style={{ fontSize: 11, color: INK.faint, padding: "12px 0" }}>
          暂无数据 — 写入「{chart.dimensionLabel}」后自动出图
        </div>
      );
    const option = buildEchartsOption(chart, chartRows, {
      primary: identityTheme.primary,
      categorical: identityTheme.charts,
    });
    // 维度取不到值时 buildEchartsOption 返回 null —— 如实给空态，不画空图
    if (!option)
      return (
        <div style={{ fontSize: 11, color: INK.faint, padding: "12px 0" }}>
          暂无数据 — 写入「{chart.dimensionLabel}」后自动出图
        </div>
      );
    return (
      <React.Suspense
        fallback={
          <div style={{ fontSize: 11, color: INK.faint, padding: "12px 0" }}>
            图表加载中…
          </div>
        }
      >
        <LazyEchartsChart
          option={option}
          height={140}
          ariaLabel={`${chart.label}：按${chart.dimensionLabel}统计${chart.metricLabel}`}
        />
      </React.Suspense>
    );
  };

  // 手机档看板：列分组复用桌面同一个纯函数 groupRowsForKanban——两档如果各分
  // 各的，同一条记录可能在桌面归 A 列、手机归"未归类"。这里只决定"当前看哪
  // 一列"，分组本身不重写。
  const phoneKanban =
    page && page.view.kind === "kanban" && kanbanStatusField
      ? groupRowsForKanban(
          rows,
          kanbanStatusField.id,
          kanbanStatusField.options ?? []
        )
      : null;
  // 选中列：默认第一列。列集合变了（换页/状态取值变化）时回到第一列，
  // 而不是卡在一个已经不存在的 key 上显示空白。
  const phoneKanbanKeys = (phoneKanban ?? [])
    .map((c: KanbanColumn) => c.id)
    .join("|");
  React.useEffect(() => {
    setPhoneKanbanKey(phoneKanban?.[0]?.id ?? "");
  }, [phoneKanbanKeys]);
  const phoneKanbanRows =
    phoneKanban?.find((c: KanbanColumn) => c.id === phoneKanbanKey)?.rows ??
    rows;

  // 手机档按 pageKind 决定出哪几段。取数与桌面共用（pageStatDisplay /
  // phoneChartNode），只有摆法分档——同一个指标不能在两个档位算出不同的数。
  const phoneSectionData = (() => {
    if (!page) return null;
    const kind = page.view.kind;
    const wantsMetrics =
      kind === "dashboard" || kind === "monitor" || kind === "workbench";
    const wantsSteps = kind === "wizard";
    const stats =
      wantsMetrics && page.stats.length > 0
        ? page.stats.map(stat => {
            const { value, isPreview } = pageStatDisplay(stat);
            return {
              id: stat.id,
              label: stat.label,
              value,
              isPreview,
              prefix: stat.format === "money" ? "¥" : undefined,
              suffix: stat.format === "percent" ? "%" : undefined,
              precision:
                value !== null && Number.isInteger(value)
                  ? 0
                  : stat.format === "money"
                    ? 2
                    : 1,
            };
          })
        : [];
    const charts =
      wantsMetrics && page.charts.length > 0
        ? page.charts.map(c => ({
            id: c.id,
            label: c.label,
            node: phoneChartNode(c),
          }))
        : [];
    // wizard：流程节点即步骤条。桌面用横向 Steps，手机竖排更读得下来。
    const steps =
      wantsSteps && (model?.workflow?.nodes?.length ?? 0) > 0
        ? (model?.workflow?.nodes ?? []).slice(0, 8).map(n => ({
            id: n.id,
            title: n.name || n.id,
            description: n.phase,
          }))
        : [];
    if (stats.length === 0 && charts.length === 0 && steps.length === 0)
      return null;
    return { stats, charts, steps };
  })();

  // 手机档日历：只算"哪些天有数据"和"选中那天有哪些行"。归组复用桌面
  // CalendarBoard 同一个 rowsByDateKey——两档对同一个值算出不同的天，
  // 会让日历上的圆点和下面的列表自己打架。
  const phoneCalendar =
    page && page.view.kind === "calendar" && page.view.dateFieldId
      ? (() => {
          const byKey = rowsByDateKey(rows, page.view.dateFieldId);
          const marked = new Set(byKey.keys());
          const selKey = phoneCalDate ? localDateKey(phoneCalDate) : null;
          // 选中日无记录时给空数组（不是回退全量）——用户点了 3 号就该看到
          // 3 号的情况，"这天没有"本身是答案。
          const filtered = selKey ? (byKey.get(selKey) ?? []) : rows;
          return { marked, filtered };
        })()
      : null;

  // 日历壳：非日历页直接透传（同 PhoneKanbanShell 的理由）。
  const PhoneCalendarShell = ({
    data,
    children,
  }: {
    data: { marked: Set<string>; filtered: unknown[] } | null;
    children: React.ReactNode;
  }) => {
    if (!data) return <>{children}</>;
    return (
      <React.Suspense fallback={<>{children}</>}>
        <LazyPhoneCalendar
          markedDates={data.marked}
          value={phoneCalDate}
          onChange={setPhoneCalDate}
        >
          {children}
        </LazyPhoneCalendar>
      </React.Suspense>
    );
  };

  // 手机档列表最终喂什么行：看板页给选中列、日历页给选中日、其余全量。
  // 两种范式不会同时出现（view.kind 是单选），所以这里是顺序取第一个命中的。
  const phoneListRows = phoneKanban
    ? phoneKanbanRows
    : (phoneCalendar?.filtered as typeof rows | undefined) ?? rows;

  // 看板壳：非看板页（columns 为 null/空）直接透传 children，省得在 JSX 里
  // 写"条件包裹"那种两份几乎一样的分支。
  const PhoneKanbanShell = ({
    columns,
    activeKey,
    onChange,
    children,
  }: {
    columns: KanbanColumn[] | null;
    activeKey: string;
    onChange: (k: string) => void;
    children: React.ReactNode;
  }) => {
    if (!columns || columns.length === 0) return <>{children}</>;
    return (
      <React.Suspense fallback={<>{children}</>}>
        <LazyPhoneKanban
          columns={columns.map(c => ({
            key: c.id,
            label: c.label,
            count: c.rows.length,
          }))}
          activeKey={activeKey}
          onChange={onChange}
        >
          {children}
        </LazyPhoneKanban>
      </React.Suspense>
    );
  };

  // 本页有没有 KPI/图表类积木——决定固定骨架要不要让位（方案 C 反方向）。
  // 只看非 legacy 的真区块：_fromLegacy 是转换占位，本来就走旧路径渲染。
  const pageHasKpiBlocks = Boolean(
    page &&
      !OVERVIEW_KINDS.has(page.view.kind) &&
      page.experienceBlocks.some(
        b =>
          !(b as import("./block-registry").ExperienceBlockInstance)._fromLegacy &&
          KPI_BLOCK_TYPES.has(b.type)
      )
  );

  // 手机端业务页：体验区块 + 卡片列表（前 3 字段 + 操作），Pro App 的移动端习惯
  const phonePageContent = page && (
    // data-page-kind：手机档按 pageKind 出不同骨架，把 kind 摆到 DOM 上，
    // 测试和真机排查都能直接看出"这页该长什么样"，不用去翻模型。
    <div
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
      data-testid="phone-page-content"
      data-page-kind={page.view.kind}
    >
      {/* 演示种子的如实标注，与桌面页卡上那个 Tag 同源（pageShowsSeed），
          一页只标一处。手机档没有 Card title 的位置，用 antd-mobile 的
          NoticeBar——此前这里是手搓的一个橙字小方块，跟旁边的移动端组件
          不是一套观感（见 PhoneSeedNotice 的注释）。 */}
      {pageSeedCount > 0 && (
        <React.Suspense fallback={null}>
          <LazyPhoneSeedNotice count={pageSeedCount} />
        </React.Suspense>
      )}
      {/* 体验区块：与桌面壳同一份摆法逻辑，槽位走 layout.mobile（未声明则退回
          桌面槽位）。从前手机档只有一个裸列表——桌面有的 KPI/图表/筛选条/流程
          时间线，手机一个都拿不到。 */}
      {renderExperienceBlockScaffold(true)}
      {/* pageKind 骨架：schema 有 6 种，手机档此前一种都没有（无论什么 kind
          都渲染成同一个裸列表）。dashboard/monitor 出 KPI + 图表，wizard 出
          流程步骤——形态复用首页那套（Grid 两列 / Steps 竖排）。 */}
      {phoneSectionData && (
        <React.Suspense fallback={null}>
          <LazyPhonePageSections {...phoneSectionData} />
        </React.Suspense>
      )}
      <React.Suspense
        fallback={
          <Skeleton active paragraph={{ rows: 4 }} style={{ padding: "12px 4px" }} />
        }
      >
        {/* 看板：桌面并排的状态列在手机上改成按状态分页（CapsuleTabs 横向
            可滚，状态多时下一个露一角，不用自己拼滚动提示）。非看板页
            phoneKanban 为 null，PhoneKanban 直接透传 children。 */}
        <PhoneKanbanShell
          columns={phoneKanban}
          activeKey={phoneKanbanKey}
          onChange={setPhoneKanbanKey}
        >
        <PhoneCalendarShell data={phoneCalendar}>
        <LazyPhonePageList
          rows={phoneListRows}
          descFields={page.detailFields
            .slice(1, 4)
            .map(f => ({ id: f.id, label: f.label }))}
          createProbeProps={probe({
            kind: "action",
            label: "新建",
            pageId: page.id,
            permission: pageAccess.get(page.id)?.createPermission ?? null,
            granted: pageAccess.get(page.id)?.canCreate !== false,
            role,
          })}
          canCreate={
            Boolean(page.entityId) &&
            pageAccess.get(page.id)?.canCreate !== false
          }
          createLockedHint={
            pageAccess.get(page.id)?.canCreate === false
              ? `当前角色（${role ?? "-"}）无新建权限`
              : undefined
          }
          onCreate={() => {
            setFormValues({});
            setFormOpen(true);
          }}
          onOpenRow={row => setDetailRow(row as RuntimeRow)}
          renderRowActions={row => rowActions(row as RuntimeRow)}
          // 左滑动作：与行内按钮同一套 handler，只换触发方式。给了 swipeActions
          // 之后 PhonePageList 不再渲染行内按钮，行高省一截。
          swipeActions={row => {
            const r = row as RuntimeRow;
            const acts: Array<{
              key: string;
              text: string;
              color?: "primary" | "warning" | "danger";
              onClick: () => void;
            }> = [];
            if (page.workflowLinked)
              acts.push({
                key: "submit",
                text: "提交审批",
                color: "primary",
                onClick: () =>
                  handleSubmitToWorkflow(
                    r.id,
                    String(Object.values(r.values)[0] ?? r.id)
                  ),
              });
            acts.push({
              key: "delete",
              text: "删除",
              color: "danger",
              // 删除不可逆，桌面档早就套了 Popconfirm；手机档此前是滑开一点
              // 就没了、连提示都没有。Dialog.confirm 返回 Promise<boolean>，
              // 确认了才真删，删完给一句 Toast。
              onClick: () => {
                void confirmDestructive(
                  "删除这条记录？",
                  "删掉之后无法恢复。",
                  () => canvasEl
                ).then(ok => {
                  if (!ok) return;
                  apply(deleteRow(state, page.entityId!, r.id));
                  toast("success", "已删除");
                });
              },
            });
            return acts;
          }}
        />
        </PhoneCalendarShell>
        </PhoneKanbanShell>
      </React.Suspense>
    </div>
  );

  const detailInstances = detailRow
    ? state.instances.filter(i => i.entityRef?.rowId === detailRow.id)
    : [];

  // 详情内容块：桌面/手机走 Drawer，平板走右栏主从面板（同一 JSX 两处挂载）
  // 字段标签（带 X 光探针）与值的渲染跨设备共用，只有「摆法」分档：
  // 手机走 antd-mobile List（一行一字段），桌面留 antd Descriptions。
  const detailFieldNodes =
    detailRow && page
      ? page.detailFields.map(f => ({
          id: f.id,
          label: page.entityId ? (
            <span
              {...probe({
                kind: "field",
                entityId: page.entityId,
                fieldId: f.id,
                label: f.label,
              })}
            >
              {f.label}
            </span>
          ) : (
            f.label
          ),
          value: (
            <FieldValue
              field={f}
              value={detailRow.values[f.id]}
              phone={isPhone}
            />
          ),
        }))
      : [];

  const detailBody = detailRow && page && (
    <>
      {isPhone ? (
        <React.Suspense fallback={null}>
          <LazyPhoneDetailFields fields={detailFieldNodes} />
        </React.Suspense>
      ) : (
        <Descriptions
          size="small"
          column={1}
          items={detailFieldNodes.map(f => ({
            key: f.id,
            label: f.label,
            children: f.value,
          }))}
        />
      )}
      {page.aiActions.length > 0 && (
        <>
          <div
            style={{
              marginTop: 16,
              fontSize: 12,
              fontWeight: 600,
              color: INK.value,
            }}
          >
            AI 能力 · {page.aiActions.length}
          </div>
          <div
            style={{
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {page.aiActions.map(action => (
              <div
                key={action.capId}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <span
                  {...probe({
                    kind: "ai",
                    capId: action.capId,
                    label: action.label,
                  })}
                >
                  {isPhone ? (
                    // 手机档用 antd-mobile Button：触摸目标更大、按下有原生
                    // 反馈；antd 的 size="small" ghost 在指尖下太小太轻。
                    <React.Suspense fallback={null}>
                      <LazyPhoneActionButton
                        size="small"
                        color="primary"
                        testId={`app-ai-action-${action.capId}`}
                        loading={aiRunningCapId === action.capId}
                        disabled={
                          aiRunningCapId !== null &&
                          aiRunningCapId !== action.capId
                        }
                        onClick={() => runAiAction(action)}
                      >
                        ✨ {action.label}
                      </LazyPhoneActionButton>
                    </React.Suspense>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      ghost
                      data-testid={`app-ai-action-${action.capId}`}
                      loading={aiRunningCapId === action.capId}
                      disabled={
                        aiRunningCapId !== null &&
                        aiRunningCapId !== action.capId
                      }
                      onClick={() => runAiAction(action)}
                    >
                      ✨ {action.label}
                    </Button>
                  )}
                </span>
                <span style={{ fontSize: 11, color: INK.faint }}>
                  → 写回「{action.outputLabel}」
                </span>
              </div>
            ))}
          </div>
          {aiRunningCapId && (
            <div style={{ marginTop: 8, fontSize: 11, color: INK.faint }}>
              真 LLM 生成中……（与五系统生成同一通道）
            </div>
          )}
          {aiSuggestion && aiSuggestion.rowId === detailRow.id && (
            <AiSuggestionCard
              outputLabel={aiSuggestion.action.outputLabel}
              output={aiSuggestion.output}
              confidence={aiSuggestion.confidence}
              rationale={aiSuggestion.rationale}
              onApply={applyAiSuggestion}
              onDismiss={() => setAiSuggestion(null)}
            />
          )}
          {aiError && (
            // 此前是手写的红框（#fff2f0/#ffccc7 写死），深色档下红底红字读不出来，
            // 也不跟主题的 colorError 走。antd Alert 就是干这个的。
            <Alert
              data-testid="app-ai-error"
              type="error"
              showIcon
              style={{ marginTop: 8 }}
              message={
                <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 11 }}>
                  {aiError.code}
                </span>
              }
              description={<span style={{ fontSize: 11 }}>{aiError.detail}</span>}
            />
          )}
        </>
      )}

      <div
        style={{
          marginTop: 16,
          fontSize: 12,
          fontWeight: 600,
          color: INK.value,
        }}
      >
        关联审批实例 · {detailInstances.length}
      </div>
      {detailInstances.length === 0 ? (
        <div style={{ fontSize: 12, color: INK.faint, marginTop: 6 }}>
          本行尚未提交审批
        </div>
      ) : (
        detailInstances.map(inst => {
          const meta = STATUS_META[inst.status] ?? STATUS_META.running;
          return (
            <div
              key={inst.id}
              style={{ marginTop: 8, fontSize: 12, color: INK.label }}
            >
              {inst.title} ·{" "}
              {nodeById(model, inst.currentNodeId)?.name ?? inst.currentNodeId}
              <Tag
                style={{ marginLeft: 8 }}
                color={
                  inst.status === "running"
                    ? "processing"
                    : inst.status === "completed"
                      ? "success"
                      : "error"
                }
              >
                {meta.label}
              </Tag>
            </div>
          );
        })
      )}
    </>
  );

  // E40.5：三条数据带抽成积木——monitor 骨架把图表与榜/流排成主侧两栏，
  // 其余范式保持历史堆叠顺序（stats → widgets → charts）。
  const statsBand = page && (
    <>
      {page.stats.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            marginBottom: layout.space.sm,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-stats"
        >
          {page.stats.map(stat => {
            // Phase B: 真实数据为零时用预览种子数据填充，加"示例"标注
            const { value: displayVal, isPreview } = pageStatDisplay(stat);
            return (
              <Card
                key={stat.id}
                size="small"
                style={{ flex: 1, minWidth: 140 }}
                styles={{
                  body: {
                    padding: `${layout.space.sm}px ${layout.space.md}px`,
                  },
                }}
                data-testid={`app-runtime-page-stat-${stat.id}`}
              >
                {displayVal === null ? (
                  <Statistic title={stat.label} value="—" />
                ) : (
                  <>
                    <Statistic
                      title={stat.label}
                      value={displayVal}
                      precision={
                        Number.isInteger(displayVal)
                          ? 0
                          : stat.format === "money"
                            ? 2
                            : 1
                      }
                      prefix={stat.format === "money" ? "¥" : undefined}
                      suffix={stat.format === "percent" ? "%" : undefined}
                    />
                    {isPreview && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "#adb5bd",
                          marginTop: 2,
                          display: "block",
                        }}
                      >
                        示例数据
                      </span>
                    )}
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );

  // E40.6 修复：monitor 骨架之前把 chartsBand（主列）和 widgetsBand（侧列）
  // 拆成两个各自独立宽度的 flex 列——rankings+feeds 摞起来比 charts 那一行
  // 高时，主列下方就会空出一块（真实撞到：2 图表 114px 高 vs 排行+动态摞起来
  // 233px 高，主列下方净空 120px 左右什么都没有）。抽成下面这三个纯函数，
  // monitorCombinedCards 把图表/排行/动态卡片放进同一个 flex-wrap 流里，
  // 不再按列预分宽度，卡片跟着内容高度自然排布，不会再留出这种空档。
  const renderRankingCard = (ranking: AppPageRankingSchema) => {
    if (!page) return null;
    {
      const rankRows = [...(state.entities[ranking.entityId] ?? [])]
        .map(row => ({ row, v: Number(row.values[ranking.sortFieldId]) }))
        .filter(({ v }) => Number.isFinite(v))
        .sort((a, b) => b.v - a.v)
        .slice(0, ranking.limit);
      const titleFieldId =
        page.detailFields.find(f => f.type === "string" && f.id !== "id")?.id ??
        "id";
      return (
        <Card
          key={ranking.id}
          size="small"
          title={ranking.label}
          style={{ flex: 1, minWidth: 240 }}
          data-testid={`app-runtime-ranking-${ranking.id}`}
        >
          {rankRows.length === 0 ? (
            <div style={{ color: "#999", fontSize: 12 }}>
              暂无数据 — 录入带「{ranking.sortLabel}」的记录后自动上榜
            </div>
          ) : (
            rankRows.map(({ row, v }, i) => (
              <div
                key={row.id || String(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: layout.space.xs,
                  padding: `${layout.space.xxs}px 0`,
                  borderBottom:
                    i < rankRows.length - 1 ? "1px solid #f5f5f5" : "none",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: layout.radius.md,
                    textAlign: "center",
                    lineHeight: "20px",
                    fontSize: 11,
                    fontWeight: 600,
                    flexShrink: 0,
                    background:
                      i < 3 ? "var(--app-primary,#1677ff)" : "#f0f0f0",
                    color: i < 3 ? "#fff" : "#8c8c8c",
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                  }}
                >
                  {String(row.values[titleFieldId] ?? "—")}
                </span>
                <span
                  style={{ fontSize: 13, fontWeight: 600, color: "#262626" }}
                >
                  {v.toLocaleString("zh-CN")}
                </span>
              </div>
            ))
          )}
        </Card>
      );
    }
  };

  const renderFeedCard = (feed: AppPageFeedSchema) => {
    if (!page) return null;
    const levelField = page.detailFields.find(f => f.id === feed.levelFieldId);
    const feedRows = [...(state.entities[feed.entityId] ?? [])]
      .filter(row => row.values[feed.timeFieldId])
      .sort((a, b) =>
        String(b.values[feed.timeFieldId] ?? "").localeCompare(
          String(a.values[feed.timeFieldId] ?? "")
        )
      )
      .slice(0, 6);
    const titleFieldId =
      page.detailFields.find(f => f.type === "string" && f.id !== "id")?.id ??
      "id";
    return (
      <Card
        key={feed.id}
        size="small"
        title={feed.label}
        style={{ flex: 1, minWidth: 240 }}
        data-testid={`app-runtime-feed-${feed.id}`}
      >
        {feedRows.length === 0 ? (
          <div style={{ color: "#999", fontSize: 12 }}>
            暂无动态 — 新记录会按时间倒序流入这里
          </div>
        ) : (
          feedRows.map((row, i) => {
            const levelValue = String(
              row.values[feed.levelFieldId ?? ""] ?? ""
            );
            const option = levelField?.options?.find(o => o.id === levelValue);
            return (
              <div
                key={row.id || String(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: layout.space.xs,
                  padding: `${layout.space.xxs}px 0`,
                  borderBottom:
                    i < feedRows.length - 1 ? "1px solid #f5f5f5" : "none",
                }}
              >
                {option && (
                  <Tag
                    color={option.tone === "danger" ? "error" : option.tone}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {option.label}
                  </Tag>
                )}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontSize: 13,
                  }}
                >
                  {String(row.values[titleFieldId] ?? "—")}
                </span>
                <span style={{ fontSize: 11, color: "#8c8c8c", flexShrink: 0 }}>
                  {String(row.values[feed.timeFieldId] ?? "")}
                </span>
              </div>
            );
          })
        )}
      </Card>
    );
  };

  const widgetsBand = page && (
    <>
      {(page.rankings.length > 0 || page.feeds.length > 0) && (
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            marginBottom: layout.space.sm,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-widgets"
        >
          {page.rankings.map(renderRankingCard)}
          {page.feeds.map(renderFeedCard)}
        </div>
      )}
    </>
  );

  const renderChartCard = (chart: AppPageChartSchema) => {
    if (!page) return null;
    const chartRows = state.entities[chart.entityId] ?? [];
    const option = buildEchartsOption(chart, chartRows, {
      primary: identityTheme.primary,
      categorical: identityTheme.charts,
    });
    return (
      <Card
        key={chart.id}
        size="small"
        title={chart.label}
        style={{
          flex: 1,
          // dashboard 范式：图表升主角，两列铺开（表格退居下方小表）
          minWidth: page.view.kind === "dashboard" ? "45%" : 220,
        }}
        // 试过 Tremor 的"图表 height:100% 跟着卡片拉伸"思路，真机验证是反面
        // 案例：卡片被 monitorCombinedRow 的 alignItems:"stretch" 拉高是个
        // 多轮布局才收敛的过程，ECharts 的 ResizeObserver 在中间某次尺寸
        // （355×264）上调用了 resize()，最终容器收敛到 246×202 后再没收到
        // 新的 resize，画布跟容器错位、图表整个看起来是空的——这正是 shadcn
        // ChartContainer 讨论里"图表必须有明确高度锚点，不能指望流式百分比
        // 高度在容器还在变化时也能测准"的真实反面教材。改回图表固定高度
        // （不跟着卡片拉伸），卡片被拉高时用 justifyContent:"center" 把
        // 固定高度的图表在多出来的空间里居中，而不是让图表本身去追一个
        // 还没稳定下来的容器尺寸。
        styles={{
          body: {
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          },
        }}
        data-testid={`app-runtime-page-chart-${chart.id}`}
      >
        {option ? (
          <React.Suspense
            fallback={
              <Skeleton.Node active style={{ width: "100%", height: 200 }} />
            }
          >
            <LazyEchartsChart
              option={option}
              height={200}
              ariaLabel={`${chart.label}：按${chart.dimensionLabel}统计${chart.metricLabel}`}
            />
          </React.Suspense>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={`写入「${chart.dimensionLabel}」后自动出图`}
            style={{ margin: `${layout.space.md}px 0` }}
          />
        )}
      </Card>
    );
  };

  const chartsBand = page && (
    <>
      {page.charts.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            marginBottom: layout.space.sm,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-charts"
        >
          {page.charts.map(renderChartCard)}
        </div>
      )}
    </>
  );

  // E40.6 修复：monitor 骨架的 chartsBand/widgetsBand 之前拆成两个各自独立
  // 宽度的 flex 列（图表主列 + 排行/动态侧列），排行+动态摞起来比图表那一行
  // 高时，主列下方就会净空出一块（真实撞到：2 图表 114px 高 vs 排行+动态
  // 233px 高，主列下方空出 120px 左右）。第一版临时改成单条 flex-wrap 流
  // 绕开了这一次，但卡片一多、高度差异一大，从左到右顺序换行不会往回找
  // 空位，还是会留白——现在接上 grid-compact.ts（搬自 GitHub 上
  // react-grid-layout 的核心压实算法，见该文件头部）："最短列优先"贪心
  // 摆放 + 竖直压实兜底，卡片按估算高度自动分列、列内紧贴堆叠，不会再
  // 留出空档。高度是估算值（图表固定/排行动态按真实行数算），不追求
  // 像素级精确，只保证不留白。
  const monitorCombinedRow =
    page &&
    (() => {
      const CHART_HEIGHT_ESTIMATE = 230; // 卡片头(40) + echarts 固定 180 + 内边距
      const ROW_HEIGHT_ESTIMATE = 30; // 排行/动态每行的实测行高（padding 5px*2 + 内容）
      const LIST_CHROME_ESTIMATE = 56; // 卡片头(40) + 上下内边距

      const cardHeights: Array<{ i: string; h: number }> = [
        ...page.charts.map(c => ({
          i: `chart:${c.id}`,
          h: CHART_HEIGHT_ESTIMATE,
        })),
        ...page.rankings.map(r => {
          const rowCount = Math.min(
            (state.entities[r.entityId] ?? []).length,
            r.limit
          );
          return {
            i: `ranking:${r.id}`,
            h:
              LIST_CHROME_ESTIMATE +
              Math.max(1, rowCount) * ROW_HEIGHT_ESTIMATE,
          };
        }),
        ...page.feeds.map(f => {
          const rowCount = Math.min(
            (state.entities[f.entityId] ?? []).length,
            6
          );
          return {
            i: `feed:${f.id}`,
            h:
              LIST_CHROME_ESTIMATE +
              Math.max(1, rowCount) * ROW_HEIGHT_ESTIMATE,
          };
        }),
      ];
      if (cardHeights.length === 0) return null;

      const cols = Math.min(3, cardHeights.length);
      const placed = autoPlaceGrid(cardHeights, cols);

      const nodeById = new Map<string, React.ReactNode>([
        ...page.charts.map(c => [`chart:${c.id}`, renderChartCard(c)] as const),
        ...page.rankings.map(
          r => [`ranking:${r.id}`, renderRankingCard(r)] as const
        ),
        ...page.feeds.map(f => [`feed:${f.id}`, renderFeedCard(f)] as const),
      ]);

      const columns: string[][] = Array.from({ length: cols }, () => []);
      for (const item of [...placed].sort((a, b) => a.y - b.y)) {
        columns[item.x]?.push(item.i);
      }

      return (
        // alignItems: "stretch"（不是 flex-start）——列与列之间高度天然不同步
        // （比如这一列就 1 张图表卡，隔壁摞了排行+动态两张），flex-start 会让
        // 矮的那列在自己内容结束处直接停住，下面空出一块没有任何元素的白底，
        // 用户截图圈过的就是这个（真去查过 DOM，那块确实不是渲染了个空
        // Card，就是纯背景）。改 stretch 后每一列都撑到最高列那么高，列内
        // 卡片本来就带的 flex:1（renderChartCard/renderRankingCard/
        // renderFeedCard 三处都设了）会把卡片自己的边框/背景撑满这段高度——
        // 富余空间留在卡片"内部"（看起来是留白排版），不再是卡片外面一块
        // 没有归属的裸白背景。
        <div
          style={{
            display: "flex",
            gap: layout.space.sm,
            alignItems: "stretch",
          }}
          data-testid="app-runtime-monitor-combined"
        >
          {columns.map((ids, colIdx) => (
            <div
              key={colIdx}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: layout.space.sm,
              }}
            >
              {ids.map(id => (
                <React.Fragment key={id}>{nodeById.get(id)}</React.Fragment>
              ))}
            </div>
          ))}
        </div>
      );
    })();

  // 2026-07-24：monitor 页面的总览区块——freeformOverview 是 Python
  // enrich_monitor_page_overviews 按这个页面已声明的 stats/charts 当内容
  // 清单、交给 FreeformInsight 设计出来的 KPI+图表版式（不再是所有 app
  // 首页都长一样的固定网格骨架）。数字仍然经 ExperienceBlockBoundary →
  // renderFreeformNode 的 dataRef 现算校验，不会因为换了渲染路径就失去
  // "不能编数字"这层保证。未声明（老快照/生成失败）时下面的
  // monitorCombinedRow 固定骨架原样兜底。
  //
  // 故意不包含 rankings/feeds——FreeformInsight 的 dataRef 只能表达聚合值
  // （count/sum/avg），没有"枚举真实第 N 行记录"的能力（真机测试过：LLM
  // 收到这个要求后只能画出表头+空表身）。排行榜/动态流这类必须逐行展示
  // 真实记录的内容，固定走 monitorDynamicLists 下面的动态渲染。
  const monitorFreeformOverview = page?.freeformOverview ? (
    <div data-testid="app-runtime-monitor-freeform-overview">
      <ExperienceBlockBoundary
        block={{
          id: `${page.id}:freeform-overview`,
          type: "FreeformInsight",
          freeformContent: page.freeformOverview,
        }}
        entityRows={state.entities}
        chartPalette={{
          primary: identityTheme.primary,
          categorical: identityTheme.charts,
        }}
        enumOptionsOf={enumOptionsOf}
        fieldLabelOf={fieldLabelOf}
      />
    </div>
  ) : null;

  // freeformOverview 只负责 KPI+图表；排行榜/动态流这类"必须是真实逐行
  // 记录"的内容永远走这条真实动态渲染路径（renderRankingCard/
  // renderFeedCard 直接读 state.entities 真实行数据），跟 freeformOverview
  // 是否存在无关——两者并列渲染，不是互斥关系。
  //
  // 2026-07-28 去重：模型会把同一份动态流在 blocks 和 feeds 两条通道里各
  // 声明一遍（真跑逮到：绑定逐字段相同、只有 id 和名字不同），于是首页出
  // 现两张一模一样的卡。撞车时保留积木那份（它带槽位摆放 + 新渲染器），
  // 这里只渲染没被积木覆盖的。判定见 page-panel-dedupe.ts。
  const dedupedLists = page
    ? dropLegacyPanelsCoveredByBlocks(
        { rankings: page.rankings, feeds: page.feeds },
        page.experienceBlocks,
        freeformPlacedKeys
      )
    : { rankings: [], feeds: [] };
  const monitorDynamicLists =
    page && (dedupedLists.rankings.length > 0 || dedupedLists.feeds.length > 0) ? (
      <div
        style={{
          display: "flex",
          gap: layout.space.sm,
          flexWrap: "wrap",
          marginTop: layout.space.sm,
        }}
        data-testid="app-runtime-monitor-dynamic-lists"
      >
        {dedupedLists.rankings.map(renderRankingCard)}
        {dedupedLists.feeds.map(renderFeedCard)}
      </div>
    ) : null;


  // 一次求值、多处摆位（见下方 D1 注释）
  const blockScaffold = renderExperienceBlockScaffold(false);

  const defaultPageContent = page && (
    <Card
      size="small"
      title={
        <Space size={6}>
          <span>{page.title}</span>
          {pageSeedCount > 0 && (
            <Tooltip
              title={`本页 ${allRows.length} 条记录里有 ${pageSeedCount} 条是自动铺的演示数据；点「新建」写入第一条真实记录后即被整批取代`}
            >
              <Tag
                color="orange"
                style={{ marginInlineEnd: 0, fontWeight: 400 }}
                data-testid="app-runtime-seed-tag"
              >
                示例数据 {pageSeedCount}
              </Tag>
            </Tooltip>
          )}
        </Space>
      }
      extra={
        <Space size="small">
          {page.actions.slice(0, 3).map(a => (
            <Tag key={a} color="blue" style={{ marginInlineEnd: 0 }}>
              {a}
            </Tag>
          ))}
          {columnSettings}
          <span
            {...probe({
              kind: "action",
              label: "新建",
              pageId: page.id,
              permission: pageAccess.get(page.id)?.createPermission ?? null,
              granted: pageAccess.get(page.id)?.canCreate !== false,
              role,
            })}
          >
            <Button
              type="primary"
              icon={
                pageAccess.get(page.id)?.canCreate === false ? (
                  <LockOutlined />
                ) : (
                  <PlusOutlined />
                )
              }
              onClick={() => {
                setFormValues({});
                setFormOpen(true);
              }}
              disabled={
                !page.entityId || pageAccess.get(page.id)?.canCreate === false
              }
              title={
                pageAccess.get(page.id)?.canCreate === false
                  ? `当前角色（${role ?? "-"}）未持有 ${pageAccess.get(page.id)?.createPermission ?? ""}`
                  : undefined
              }
              data-testid="app-runtime-create"
            >
              新建
            </Button>
          </span>
        </Space>
      }
    >
      {/* D1（2026-07-28）：总览页的积木脚手架挪到设计版式**后面**去渲染。
          此前它固定排在最前，于是首页第一眼看到的是排行榜/动态流这两张
          外挂卡，AI 现场设计的总览区反倒被压到下面——顺序把主次颠倒了。
          非总览页保持原样（那些页的积木本来就是页面主角）。

          脚手架只求值一次、在下面每个分支里显式摆位——不这么写就得在
          "总览页"那个条件外面再判一次 kind，dashboard 没有 freeformOverview
          时会掉进最末的兜底分支、积木一个都渲染不出来（第一版就是这个洞）。 */}
      {!OVERVIEW_KINDS.has(page.view.kind) && blockScaffold}
      {page.view.kind === "wizard" &&
        (model?.workflow?.nodes?.length ?? 0) > 0 && (
          <Steps
            size="small"
            current={0}
            items={(model?.workflow?.nodes ?? []).slice(0, 8).map(n => ({
              title: n.name || n.id,
              description: n.phase,
            }))}
            style={{ marginBottom: 14 }}
            data-testid="app-runtime-wizard-steps"
          />
        )}
      {page.view.kind === "monitor" ? (
        monitorFreeformOverview ? (
          <>
            {monitorFreeformOverview}
            {blockScaffold}
            {monitorDynamicLists}
          </>
        ) : (
          <>
            {blockScaffold}
            {statsBand}
            {monitorCombinedRow}
          </>
        )
      ) : page.view.kind === "dashboard" && monitorFreeformOverview ? (
        // 2026-07-27：dashboard 页也吃 freeformOverview——此前只有 monitor
        // 一个 kind 走得到设计版式，LLM 把总览页写成 dashboard 时整条
        // "照参考图设计"的产出送不到页面上（首页恒回固定骨架的根因之一）。
        // dashboard 特有的 widgetsBand（快速入口等）保留，不被设计版式吞掉。
        <>
          {monitorFreeformOverview}
          {blockScaffold}
          {widgetsBand}
          {monitorDynamicLists}
        </>
      ) : pageHasKpiBlocks ? (
        // 方案 C 反方向：业务页声明了 MetricGrid/TrendChart 积木时，固定骨架的
        // statsBand/chartsBand 让位——两条路画的是同一份指标，都渲染就是两张
        // 说同一件事的卡。widgetsBand（快速入口等）不属于 KPI/图表，照常保留。
        <>{widgetsBand}</>
      ) : (
        <>
          {/* dashboard 页没有 freeformOverview 时会走到这里（pageHasKpiBlocks
              要求非总览页，所以 dashboard 永远不满足上一支）。总览页的脚手架
              在上面被跳过了，得在这里补回来，否则积木整页消失。 */}
          {OVERVIEW_KINDS.has(page.view.kind) ? blockScaffold : null}
          {statsBand}
          {widgetsBand}
          {chartsBand}
        </>
      )}
      {isTablet ? (
        // 平板范式：紧凑双栏（iPad 式主从视图）——左列表右详情，详情不走 Drawer
        <div
          style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
          data-testid="app-runtime-tablet-split"
        >
          <div style={{ flex: 3, minWidth: 0 }}>
            <Table
              size="small"
              rowKey="id"
              // 双栏下收窄列表：最多 4 个数据列 + 操作列（字段少时不重复操作列）
              columns={
                columns
                  .slice(0, Math.min(4, columns.length - 1))
                  .concat(columns.slice(-1)) as any
              }
              dataSource={rows}
              onRow={row => ({
                onClick: () => setDetailRow(row as RuntimeRow),
                style: { cursor: "pointer" },
              })}
              rowClassName={row =>
                (row as RuntimeRow).id === detailRow?.id
                  ? "ant-table-row-selected"
                  : ""
              }
              pagination={rows.length > 10 ? { pageSize: 10 } : false}
              locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
            />
          </div>
          <Card
            size="small"
            title={detailRow ? "详情" : "详情 · 未选中"}
            style={{ flex: 2, minWidth: 0 }}
            data-testid="app-runtime-tablet-detail"
          >
            {detailRow ? (
              detailBody
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="点击左侧行查看详情与 AI 能力"
                style={{ padding: "16px 0" }}
              />
            )}
          </Card>
        </div>
      ) : page.view.kind === "kanban" && kanbanStatusField ? (
        // 页面范式（加厚 schema 二期）：kanban——列来自 statusField 声明取值，
        // 卡片点击进详情抽屉。平板保持主从双栏（详情面板依赖表格视图）。
        <KanbanBoard
          rows={rows}
          statusField={kanbanStatusField}
          cardFields={page.columns.filter(f => f.id !== kanbanStatusField.id)}
          onOpenRow={setDetailRow}
        />
      ) : page.view.kind === "calendar" && page.view.dateFieldId ? (
        // calendar——自建月历，默认展示数据所在月；事件按 colorBy tone 着色
        <CalendarBoard
          rows={rows}
          dateFieldId={page.view.dateFieldId}
          colorByField={page.detailFields.find(
            f => f.id === page.view.colorByFieldId
          )}
          titleFieldId={
            page.columns.find(f => f.id !== page.view.dateFieldId)?.id
          }
          onOpenRow={setDetailRow}
        />
      ) : (
        <Table
          size={page.view.kind === "dashboard" ? "small" : "middle"}
          rowKey="id"
          columns={columns as any}
          dataSource={rows}
          onRow={row => ({
            onClick: () => setDetailRow(row as RuntimeRow),
            style: { cursor: "pointer" },
          })}
          pagination={
            page.view.kind === "dashboard"
              ? rows.length > 5 && { pageSize: 5 }
              : rows.length > 8 && { pageSize: 8 }
          }
          locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
        />
      )}
    </Card>
  );

  const pageContent = defaultPageContent;

  // identityTheme 已在上面 chartCard 之前声明（菜单项抽出来给 side/top 两种导航形态共用）。
  // Step 9：视觉配方——只管密度/深色开关/圆角，主色仍归 identityTheme；两者叠加。
  const designRecipe = resolveDesignRecipe(schema.identity.designRecipeRef);
  const brandGradient = `linear-gradient(135deg,${identityTheme.primary},${identityTheme.gradTo})`;
  const BrandIcon = BRAND_ICONS[schema.identity.icon] ?? AppstoreOutlined;
  const hasLegacyHomeMenu = schema.menus[0]?.pageId === schema.home.id;
  const navMenuItems = schema.menus.map((m, i) => {
    const locked =
      m.pageId !== "home" && pageAccess.get(m.pageId)?.visible === false;
    const Icon =
      m.pageId === "home"
        ? DashboardOutlined
        : locked
          ? LockOutlined
          : MENU_ICONS[
              (i - (hasLegacyHomeMenu ? 1 : 0) + MENU_ICONS.length) %
                MENU_ICONS.length
            ];
    // 菜单项右侧挂本页主实体的行数（antd Badge）。此前侧栏只有一列文字，
    // 哪一页有货、哪一页是空的要挨个点进去才知道；有了计数，应用一打开就
    // 有"这套系统里已经有数据在跑"的实感。锁住的页不显示——那是权限信息，
    // 不该从计数里泄出去。
    const rowCount = (() => {
      if (locked || m.pageId === "home") return 0;
      const entityId = schema.pages.find(p => p.id === m.pageId)?.entityId;
      return entityId ? (state.entities[entityId]?.length ?? 0) : 0;
    })();
    return {
      key: m.pageId,
      icon: <Icon />,
      label: (
        <span
          data-testid={`app-runtime-menu-${m.pageId}`}
          {...probe({ kind: "menu", pageId: m.pageId, label: m.label })}
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          {m.label}
          {rowCount > 0 && (
            <Badge
              count={rowCount}
              overflowCount={99}
              color={hexToRgba(identityTheme.primaryFg, 0.22)}
              style={{ color: identityTheme.sidebarText, fontSize: 10, boxShadow: "none" }}
            />
          )}
        </span>
      ),
      disabled: locked,
      title: locked ? `当前角色（${role ?? "-"}）无本页权限` : m.label,
    };
  });

  const desktopShell = (
    <Layout style={{ height: "100%" }} data-testid="app-shell-side">
      <Layout.Sider
        width={device === "tablet" ? 176 : 208}
        theme="dark"
        // antd 的 Layout.siderBg token 是当 background-color 用的，塞一个
        // linear-gradient(...) 字符串进去会被静默吃掉、退化成纯色（实测
        // 2026-07-24）。渐变必须走这条原生 style.background，token 仍然
        //留着当纯色场景的默认值（generatedTheme 没给渐变时两条路径同值，
        // 互不冲突）。
        style={{ background: identityTheme.sidebarBg }}
      >
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 16px",
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              flexShrink: 0,
              background: brandGradient,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            data-testid="app-brand-mark"
          >
            <BrandIcon style={{ color: "#fff", fontSize: 15 }} />
          </div>
          <span
            style={{
              // 标题文字直接落在 identityTheme.sidebarBg 上（跟图标不一样，图标
              // 在小色块徽标里，背景永远是 brandGradient）——之前写死白字，主题
              // 生成出浅色/近白侧边栏时标题就看不见了，改跟 sidebarText 走。
              color: identityTheme.sidebarText,
              fontWeight: 600,
              fontSize: 15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
            title={schema.appName}
          >
            {schema.appName}
          </span>
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[activePageId]}
          onClick={({ key }) => setActivePageId(String(key))}
          items={navMenuItems}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{
            background: "#fff",
            padding: "0 20px",
            height: 56,
            lineHeight: "56px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            boxShadow: "0 1px 4px rgba(0,21,41,0.08)",
            zIndex: 1,
          }}
        >
          <Breadcrumb
            items={[{ title: schema.appName }, { title: currentTitle }]}
          />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "#999" }}>当前角色</span>
          <Select
            size="small"
            style={{ minWidth: 140 }}
            value={role}
            onChange={changeRole}
            options={schema.roles.map(r => ({ value: r, label: r }))}
            data-testid="app-runtime-role"
          />
          <Avatar
            size={30}
            style={{ background: identityTheme.primary }}
            icon={<UserOutlined />}
          />
        </Layout.Header>
        <Layout.Content style={{ padding: 20, overflow: "auto" }}>
          {isHome ? homeContent : pageContent}
        </Layout.Content>
      </Layout>
    </Layout>
  );

  // E40.2 nav=top：监控/总览型产品的顶栏形态——品牌区 + 横向主菜单 +
  // 角色切换收在同一条深色 Header，内容区独占全宽（菜单少的域更开阔）。
  const topShell = (
    <Layout style={{ height: "100%" }} data-testid="app-shell-top">
      <Layout.Header
        style={{
          background: identityTheme.sidebarBg,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "0 16px",
          height: 52,
          lineHeight: "52px",
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            flexShrink: 0,
            background: brandGradient,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          data-testid="app-brand-mark"
        >
          <BrandIcon style={{ color: "#fff", fontSize: 14 }} />
        </div>
        <span
          style={{
            // 同上：文字直接落在 identityTheme.sidebarBg 上，不能写死白色。
            color: identityTheme.sidebarText,
            fontWeight: 600,
            fontSize: 15,
            whiteSpace: "nowrap",
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
          title={schema.appName}
        >
          {schema.appName}
        </span>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[activePageId]}
          onClick={({ key }) => setActivePageId(String(key))}
          items={navMenuItems}
          style={{ flex: 1, minWidth: 0, background: "transparent" }}
        />
        <span
          style={{
            fontSize: 13,
            color: identityTheme.sidebarText,
            opacity: 0.65,
          }}
        >
          当前角色
        </span>
        <Select
          size="small"
          style={{ minWidth: 140 }}
          value={role}
          onChange={changeRole}
          options={schema.roles.map(r => ({ value: r, label: r }))}
          data-testid="app-runtime-role"
        />
        <Avatar
          size={28}
          style={{ background: identityTheme.primary }}
          icon={<UserOutlined />}
        />
      </Layout.Header>
      <Layout.Content style={{ padding: 20, overflow: "auto" }}>
        {isHome ? homeContent : pageContent}
      </Layout.Content>
    </Layout>
  );

  const phoneShell = (
    <div
      data-testid="app-shell-phone"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#f0f2f5",
      }}
    >
      <div
        style={{
          height: 48,
          flexShrink: 0,
          background: "#fff",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          boxShadow: "0 1px 4px rgba(0,21,41,0.08)",
          zIndex: 1,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            background: brandGradient,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <BrandIcon style={{ color: "#fff", fontSize: 12 }} />
        </div>
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {currentTitle}
        </span>
        <span style={{ flex: 1 }} />
        {/* 角色切换：手机档用 antd-mobile Picker（整屏滚轮，手指点得准），
            不用 antd Select——它的下拉浮层在缩放过的画布里定位会飘。 */}
        <React.Suspense fallback={<span style={{ width: 96, height: 24 }} />}>
          <LazyPhoneRolePicker
            roles={schema.roles}
            value={role}
            onChange={changeRole}
            getContainer={() => canvasEl ?? document.body}
          />
        </React.Suspense>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {isHome ? phoneHomeContent : phonePageContent}
      </div>
      <div style={{ flexShrink: 0 }}>
        <React.Suspense
          fallback={
            <div
              style={{
                height: 54,
                background: "#fff",
                borderTop: "1px solid #f0f0f0",
              }}
            />
          }
        >
          <LazyPhoneTabBar
            items={schema.menus.map(m => ({
              pageId: m.pageId,
              label: m.label,
              locked:
                m.pageId !== "home" &&
                pageAccess.get(m.pageId)?.visible === false,
            }))}
            activeId={activePageId}
            onChange={setActivePageId}
            // 锁定 tab 点了要出声：灰图标 + title 在触屏上等于没有提示，
            // 用户只会以为点不动是应用卡了。走同一个 notify（手机档=Toast）。
            onLockedTap={item =>
              notify(
                true,
                "warning",
                `当前角色（${role ?? "-"}）无「${item.label}」权限`,
                () => canvasEl
              )
            }
          />
        </React.Suspense>
      </div>
    </div>
  );

  return (
    <div
      ref={fitRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: "transparent" }}
      data-testid="app-runtime-screen"
      data-landing-page-id={schema.landingPageId ?? ""}
      data-active-page-id={activePageId ?? ""}
    >
      {codeView ? (
        // 档位胶囊浮在画布上（旧消费方）时才需要 pt-11 头带给它让位；
        // 切换条已 portal 到顶条（studio）时代码区铺满、无多余留白（用户反馈）
        <div
          className={`absolute inset-0 ${controlsContainer === undefined ? "pt-11" : ""}`}
          style={{ background: "#f7f8fa" }}
          data-testid="app-runtime-code-host"
        >
          <CodeProjectionView model={model} appName={appTitle} />
        </div>
      ) : null}
      <div
        style={{
          width: spec.w * scale,
          height: spec.h * scale,
          position: "relative",
          display: codeView ? "none" : undefined,
        }}
      >
        <div
          ref={setCanvasEl}
          className={xrayActive ? "xray-scan" : undefined}
          style={{
            width: spec.w,
            height: spec.h,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            // E40.2：主题变量下发（非 antd 的裸元素经 var(--app-primary) 吃主题）
            ["--app-primary" as string]: identityTheme.primary,
            ["--app-primary-hover" as string]: identityTheme.primaryHover,
            // 手机档的 antd-mobile 组件不吃 ConfigProvider 的 token，只认
            // --adm-* 变量。挂在画布上（而不是 :root），生成主题就只染这个
            // 应用，不会漏到 SlideRule 自己的界面上。
            ...admThemeVars(identityTheme),
            // Step 9：深色配方覆盖 canvas 底色（不读 identityTheme.contentBg，
            // 避免深色配方叠浅色主题时底色反而变浅）。
            background: designRecipe.dark
              ? DARK_CANVAS_BG
              : identityTheme.contentBg,
            borderRadius: isPhone ? 12 : 5,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(60,50,30,0.18)",
          }}
        >
          <ConfigProvider
            getPopupContainer={() => canvasEl ?? document.body}
            theme={{
              // E40.2：身份主题的主色一把翻全部 antd 组件（按钮/选中态/链接…）
              // Step 9：配方叠加圆角 + 深色/紧凑 algorithm；高对比额外加深边框、
              // 略增字号（无障碍场景，antd token 全局生效，不用逐组件改）。
              token: {
                colorPrimary: identityTheme.primary,
                borderRadius: designRecipe.borderRadius,
                padding: designRecipe.padding,
                ...(designRecipe.highContrast
                  ? {
                      colorBorder: "#000000",
                      colorBorderSecondary: "#00000040",
                      fontSize: 15,
                    }
                  : {}),
              },
              algorithm: designRecipeAlgorithms(designRecipe, isTablet),
              // 8 套身份主题此前只染了头像/图标这些边角元素——Sider/Menu 的
              // theme="dark" 是 antd 内置深蓝 #001529，跟 identityTheme 完全无关，
              // 导致 8 套主题的侧栏永远长一个样。这里用 antd v5 的组件级 token
              // 把侧栏底色/文字接到 identityTheme.sidebarBg/sidebarText；选中态
              // 直接复用 primary/primaryFg（对齐 tweakcn 真实预设的
              // sidebar-primary 惯例：选中态就是主色本身，不用另起一套配色）。
              components: {
                Layout: { siderBg: identityTheme.sidebarBg },
                Menu: {
                  darkItemBg: identityTheme.sidebarBg,
                  darkSubMenuItemBg: identityTheme.sidebarBg,
                  darkItemColor: identityTheme.sidebarText,
                  // 之前写死白底白字假设侧边栏永远深色——生成主题给浅色侧边栏
                  // 时这层 hover 反馈直接消失/文字不可读，改成跟主色调一层
                  // 半透明叠色，深浅侧边栏都看得见、且跟品牌色呼应。
                  darkItemHoverBg: hexToRgba(identityTheme.primary, 0.12),
                  darkItemHoverColor: identityTheme.sidebarText,
                  darkItemSelectedBg: identityTheme.primary,
                  darkItemSelectedColor: identityTheme.primaryFg,
                  // 2026-07-24 修复真实撞到的坑：antd 的 darkItemDisabledColor
                  // 默认值是"白色 25% 透明度"（colorTextLightSolid 打折），
                  // 这个默认值假设侧边栏永远是深色——生成主题给了纯白侧边栏
                  // （sidebarBg:"#FFFFFF"）时，无权限菜单项的文字/锁图标变成
                  // 白底白字，直接隐形（真机截图核实：8 个菜单项里 5 个被
                  // 锁的位置只剩一段空白，肉眼看不出还有内容）。改成跟
                  // sidebarText 同色但打透明度，深浅侧边栏都能读出"这项被
                  // 锁住了"而不是凭空消失。
                  darkItemDisabledColor: hexToRgba(
                    identityTheme.sidebarText,
                    0.35
                  ),
                },
              },
            }}
          >
            {/* message 的挂载点必须在 ConfigProvider 里面，提示条才吃得到
                身份主色/深色档/圆角配方；挂外面等于白用 hook 版。 */}
            {messageHolder}
            {isPhone
              ? phoneShell
              : schema.identity.nav === "top"
                ? topShell
                : desktopShell}

            {/* 新建表单：手机档走 antd-mobile Popup（底部弹起），桌面档留 antd
                Modal。同一份 formFields / formValues / handleCreate，只换容器
                和录入控件——PC 弹框塞进 390 画布会顶穿两边，实测过。 */}
            {isPhone ? (
              <React.Suspense fallback={null}>
                <LazyPhoneFormPopup
                  open={formOpen}
                  title={`新建 · ${page?.title ?? ""}`}
                  fields={page?.formFields ?? []}
                  values={formValues}
                  onChange={(fieldId, v) =>
                    setFormValues(prev => ({ ...prev, [fieldId]: v }))
                  }
                  onCancel={() => setFormOpen(false)}
                  onSubmit={handleCreate}
                  refRowsFor={refRowsFor}
                  enumOptionsFor={enumOptionsFor}
                  fieldProbeProps={f =>
                    page?.entityId
                      ? probe({
                          kind: "field",
                          entityId: page.entityId,
                          fieldId: f.id,
                          label: f.label,
                        })
                      : {}
                  }
                  getContainer={() => canvasEl ?? document.body}
                />
              </React.Suspense>
            ) : (
              <Modal
                title={`新建 · ${page?.title ?? ""}`}
                open={formOpen}
                onOk={handleCreate}
                onCancel={() => setFormOpen(false)}
                okText="保存"
                cancelText="取消"
                destroyOnHidden
                width={modalSizing.width}
                centered={modalSizing.centered}
                styles={{
                  body: {
                    maxHeight: modalSizing.bodyMaxHeight,
                    overflowY: "auto",
                  },
                }}
                getContainer={() => canvasEl ?? document.body}
              >
                {/* antd Form：此前是手写 div + 12px 灰字当 label，没有必填
                    标记、没有错误态、label 也不对齐，右边还挂着 `string`
                    `number` 这种给开发看的类型名。改用 Form 之后这些是白送的——
                    手机档早就在用 antd-mobile 的 Form，PC 反倒落在后面。
                    Form.Item 一律**不给 name**：值仍由 formValues 这个受控
                    state 持有（handleCreate 照旧读它）。不带 name 的 Form.Item
                    在 antd 里就是纯布局容器（form-item.js:213 直接走
                    renderLayout），跟父级受控的值兼容，不会来抢数据。 */}
                <Form
                  layout="vertical"
                  size="small"
                  requiredMark
                  style={{ paddingTop: 8 }}
                >
                  {(page?.formFields ?? []).map(f => (
                    <Form.Item
                      key={f.id}
                      label={f.label}
                      style={{ marginBottom: 14 }}
                    >
                      {/* 游标探针挂在内层 div，不挂 Form.Item——Form.Item 的
                          props 是它自己的一套（onReset 等签名跟 DOM 事件不兼容），
                          它也不会把陌生 prop 透传到 DOM 上。 */}
                      <div
                        {...(page?.entityId
                          ? probe({
                              kind: "field",
                              entityId: page.entityId,
                              fieldId: f.id,
                              label: f.label,
                            })
                          : {})}
                      >
                        <FieldEditor
                          field={f}
                          value={formValues[f.id]}
                          refRows={refRowsFor(f)}
                          enumOptions={enumOptionsFor(f)}
                          onChange={v =>
                            setFormValues(prev => ({ ...prev, [f.id]: v }))
                          }
                        />
                      </div>
                    </Form.Item>
                  ))}
                </Form>
              </Modal>
            )}

            {/* 行详情：手机档走 antd-mobile Popup，桌面档留 antd Drawer。
                原来是把桌面 Drawer 掰成 placement="bottom" 冒充移动端；
                Popup 才是移动端原生形态（圆角/拖拽条/遮罩关闭都是默认行为）。
                正文 detailBody 跨设备共用，这里只换容器。 */}
            {isPhone ? (
              <React.Suspense fallback={null}>
                <LazyPhoneDetailPopup
                  open={detailRow !== null}
                  title={`详情 · ${page?.title ?? currentTitle}`}
                  onClose={closeDetail}
                  getContainer={() => canvasEl ?? document.body}
                >
                  {detailBody}
                </LazyPhoneDetailPopup>
              </React.Suspense>
            ) : (
              <Drawer
                title={`详情 · ${page?.title ?? currentTitle}`}
                open={detailRow !== null && !isTablet}
                onClose={closeDetail}
                placement="right"
                width={420}
                destroyOnHidden
                getContainer={() => canvasEl ?? document.body}
                data-testid="app-runtime-detail"
              >
                {detailBody}
              </Drawer>
            )}
          </ConfigProvider>
        </div>
      </div>

      {/* 档位切换（画布外的排练控制）：设备档 + 代码投影视角。
          平板档已按用户裁决从切换条下架（渲染范式代码保留，随时可回归）。
          有外部挂载点（studio 顶条）时 portal 过去，否则浮在画布左上角。 */}
      {(() => {
        const inBar = controlsContainer !== undefined;
        const gearBar = (
          <div
            className={
              inBar
                ? "flex items-center gap-0.5 rounded-full bg-[#e9edf2] p-0.5"
                : "absolute left-3 top-2 flex items-center gap-0.5 rounded-full bg-black/25 p-0.5"
            }
          >
            {(["desktop", "phone"] as DeviceKey[]).map(key => (
              <button
                key={key}
                type="button"
                data-testid={`app-device-${key}`}
                onClick={() => {
                  setCodeView(false);
                  setDevice(key);
                }}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                  !codeView && device === key
                    ? "bg-white text-stone-800 shadow-sm"
                    : inBar
                      ? "text-stone-500 hover:text-stone-700"
                      : "text-white/85 hover:text-white"
                }`}
              >
                {DEVICE_SPECS[key].label}
              </button>
            ))}
            <button
              type="button"
              data-testid="app-device-code"
              onClick={() => setCodeView(true)}
              title="schema 的确定性代码投影（只读）"
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                codeView
                  ? "bg-white text-stone-800 shadow-sm"
                  : inBar
                    ? "text-stone-500 hover:text-stone-700"
                    : "text-white/85 hover:text-white"
              }`}
            >
              代码
            </button>
          </div>
        );
        if (!inBar) return gearBar;
        return controlsContainer
          ? createPortal(gearBar, controlsContainer)
          : null;
      })()}
      {!codeView && (
        <span
          className="absolute bottom-2 right-3 rounded-full bg-black/30 px-2 py-0.5 font-mono text-[9px] text-white/90"
          title={`固定 ${spec.w}×${spec.h} 设计分辨率，按容器等比缩放显示`}
        >
          {spec.w}×{spec.h} · {Math.round(scale * 100)}%
        </span>
      )}
    </div>
  );
}
