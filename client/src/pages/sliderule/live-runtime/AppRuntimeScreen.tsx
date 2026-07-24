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
  Checkbox,
  Rate,
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
import { resolveIdentityTheme, hexToRgba } from "./identity-themes";
import {
  buildAiActionInputs,
  deriveAppRuntimeSchema,
  type AppAiActionSchema,
  type AppChartSchema,
  type AppFormFieldSchema,
  type AppPageChartSchema,
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
import { resolveDesignRecipe, designRecipeAlgorithms, DARK_CANVAS_BG } from "./design-recipes";
import { buildColumnFeatures } from "./table-features";
import { FieldValue } from "./FieldValue";
import { KanbanBoard, CalendarBoard } from "./PageViews";
import { AiSuggestionCard } from "./AiSuggestionCard";
import { CodeProjectionView } from "./CodeProjectionView";
import type { AppPageStatSchema } from "./app-runtime-schema";
import { generatePreviewSeedRows, computePreviewStat } from "./app-runtime-schema";
import type { XrayTarget } from "../XrayPanel";

// 多端设计分辨率（固定渲染 + 等比缩放）
const DEVICE_SPECS = {
  desktop: { w: 1440, h: 810, label: "桌面" },
  tablet: { w: 1112, h: 834, label: "平板" },
  phone: { w: 390, h: 844, label: "手机" },
} as const;
type DeviceKey = keyof typeof DEVICE_SPECS;

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
const BRAND_ICONS: Record<string, React.ComponentType<{ style?: React.CSSProperties }>> = {
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

function FieldInput({
  field,
  value,
  refRows,
  enumOptions = [],
  onChange,
}: {
  field: AppFormFieldSchema;
  value: unknown;
  refRows: Array<{ id: string; label: string }>;
  /** enum 字段的既有取值（来自已写入的行，去重）——有历史值时变成真下拉 */
  enumOptions?: string[];
  onChange: (v: unknown) => void;
}) {
  if (field.type === "number") {
    // format 富化（加厚 schema 一期）：星级用 Rate；金额/百分比/进度/评分
    // 给量纲前后缀与合理边界——录入界面直接长出字段语义。
    if (field.format === "rating") {
      return (
        <Rate
          allowHalf
          value={Number(value) || 0}
          onChange={v => onChange(v)}
        />
      );
    }
    const bounded =
      field.format === "percent" ||
      field.format === "progress" ||
      field.format === "score";
    return (
      <InputNumber
        style={{ width: "100%" }}
        value={value as number | undefined}
        onChange={v => onChange(v)}
        placeholder={field.label}
        prefix={field.format === "money" ? "¥" : undefined}
        suffix={
          field.format === "percent" || field.format === "progress"
            ? "%"
            : undefined
        }
        min={bounded ? 0 : undefined}
        max={bounded ? 100 : undefined}
      />
    );
  }
  if (field.type === "date" || field.type === "datetime") {
    return (
      <Input
        type={field.type === "date" ? "date" : "datetime-local"}
        value={(value as string) ?? ""}
        onChange={e => onChange(e.target.value)}
      />
    );
  }
  if (field.type === "enum") {
    // 声明取值（加厚 schema 一期）→ 严格下拉（schema 即真相，不再自由输入）
    if (field.options && field.options.length > 0) {
      return (
        <Select
          style={{ width: "100%" }}
          value={(value as string) || undefined}
          onChange={v => onChange(v ?? "")}
          options={field.options.map(o => ({ value: o.id, label: o.label }))}
          placeholder={`选择${field.label}`}
          allowClear
        />
      );
    }
    // 无声明：已有历史取值 → 真枚举下拉（仍允许输入新值）；无数据时保持自由输入
    return (
      <Select
        style={{ width: "100%" }}
        mode="tags"
        maxCount={1}
        value={value ? [String(value)] : []}
        onChange={v => onChange(v.at(-1) ?? "")}
        options={enumOptions.map(o => ({ value: o, label: o }))}
        placeholder={
          enumOptions.length > 0
            ? `选择或输入${field.label}`
            : `${field.label}（输入后回车）`
        }
      />
    );
  }
  if (field.type === "ref" && refRows.length > 0) {
    return (
      <Select
        style={{ width: "100%" }}
        value={(value as string) || undefined}
        onChange={v => onChange(v)}
        options={refRows.map(r => ({ value: r.id, label: r.label }))}
        placeholder={`选择${field.label}`}
        showSearch
        optionFilterProp="label"
      />
    );
  }
  if (field.type === "text") {
    // 长文本（描述/备注/正文类）→ 多行输入
    return (
      <Input.TextArea
        value={(value as string) ?? ""}
        onChange={e => onChange(e.target.value)}
        placeholder={field.label}
        autoSize={{ minRows: 2, maxRows: 5 }}
      />
    );
  }
  return (
    <Input
      value={(value as string) ?? ""}
      onChange={e => onChange(e.target.value)}
      placeholder={field.label}
    />
  );
}

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
  const activeEnumEntries = Object.entries(filterState.enumFilters ?? {}).filter(
    ([, v]) => Boolean(v)
  );
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
  // 表格列设置（表格自带能力）：按 pageId 记用户勾选的列；undefined = 默认列
  const [tableColPrefs, setTableColPrefs] = React.useState<
    Record<string, string[]>
  >({});

  const schema = React.useMemo(
    () => deriveAppRuntimeSchema(model, appTitle || "推演应用"),
    [model, appTitle]
  );
  const [state, setState] = React.useState<RuntimeState>(() => {
    return loadRuntimeState(sessionId) ?? initRuntimeState(model);
  });
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
      subscribeRuntimeChanged(sessionId, () =>
        setState(loadRuntimeState(sessionId) ?? initRuntimeState(model))
      ),
    [sessionId, model]
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
  const isHome = activePageId === "home";
  const page: AppPageSchema | null = isHome
    ? null
    : (schema.pages.find(p => p.id === activePageId) ??
      schema.pages[0] ??
      null);
  const currentTitle = isHome ? schema.home.title : (page?.title ?? "");
  const allRows = page?.entityId ? (state.entities[page.entityId] ?? []) : [];

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
            patch.dateRange !== undefined ? patch.dateRange : (cur.dateRange ?? null),
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
            !a.permissionRef || (pa?.grantedActions ?? []).includes(a.permissionRef);
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

  const handleCreate = () => {
    if (!page?.entityId) return;
    const problems = validateRowValues(model, page.entityId, formValues);
    if (problems.length > 0) {
      message.warning(problems.join("；"));
      return;
    }
    const { state: next } = addRow(
      state,
      page.entityId,
      formValues,
      new Date().toISOString()
    );
    apply(next);
    setFormOpen(false);
    setFormValues({});
    message.success("已保存");
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
    message.success(`已应用 AI 建议 →「${action.outputLabel}」`);
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
      message.success(
        `已提交审批：${instance.title}（到 Workflow 试运行里推进）`
      );
    }
  };

  const rowActions = (row: RuntimeRow) => (
    <Space size="small">
      {page?.workflowLinked && (
        <span
          {...probe({ kind: "workflow", label: "提交审批", pageId: page.id })}
        >
          <Button
            size="small"
            type="link"
            onClick={e => {
              e.stopPropagation();
              handleSubmitToWorkflow(
                row.id,
                String(Object.values(row.values)[0] ?? row.id)
              );
            }}
          >
            提交审批
          </Button>
        </span>
      )}
      <Button
        size="small"
        type="link"
        danger
        onClick={e => {
          e.stopPropagation();
          apply(deleteRow(state, page!.entityId!, row.id));
        }}
      >
        删除
      </Button>
    </Space>
  );

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
  const chartCard = (chart: AppChartSchema) => {
    let option: Record<string, unknown> | null = null;
    let emptyHint = "";
    let ariaLabel = chart.label;
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
    return (
      <Card
        key={chart.id}
        title={chart.label}
        size="small"
        style={{ flex: 1, minWidth: 0 }}
        data-testid={`app-runtime-${chart.id}`}
      >
        {option ? (
          <React.Suspense
            fallback={
              <div
                style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}
              >
                图表加载中…
              </div>
            }
          >
            <LazyEchartsChart
              option={option}
              height={168}
              ariaLabel={ariaLabel}
            />
          </React.Suspense>
        ) : (
          <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>
            {emptyHint}
          </div>
        )}
      </Card>
    );
  };

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

  const homeContent = (
    <>
      <div
        style={{
          display: isPhone ? "grid" : "flex",
          gridTemplateColumns: "1fr 1fr",
          gap: isPhone ? 8 : 16,
        }}
      >
        {schema.home.stats.map(s => (
          <Card
            key={s.id}
            size="small"
            style={{ flex: 1 }}
            styles={{ body: { padding: isPhone ? "10px 14px" : "16px 20px" } }}
          >
            <Statistic
              title={s.label}
              value={statValue(state, schema, s.source)}
              suffix={s.suffix}
            />
          </Card>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: isPhone ? "column" : "row",
          gap: isPhone ? 8 : 16,
          marginTop: isPhone ? 8 : 16,
        }}
      >
        {schema.home.charts.map(chartCard)}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: isPhone ? "column" : "row",
          gap: isPhone ? 8 : 16,
          marginTop: isPhone ? 8 : 16,
        }}
      >
        {!isPhone && (
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
                      locked
                        ? `当前角色（${role ?? "-"}）无本页权限`
                        : undefined
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
                {[...pageAccess.values()].filter(a => !a.visible).length} 个页面
                — 右上角切换角色试试（RBAC 权限实时生效）
              </div>
            )}
          </Card>
        )}
        {timelineCard}
      </div>
    </>
  );

  // 手机端业务页：卡片列表（前 3 字段 + 操作），Pro App 的移动端习惯
  const phonePageContent = page && (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <React.Suspense
        fallback={
          <div
            style={{
              textAlign: "center",
              fontSize: 12,
              color: INK.faint,
              padding: "24px 0",
            }}
          >
            移动端组件加载中…
          </div>
        }
      >
        <LazyPhonePageList
          rows={rows}
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
        />
      </React.Suspense>
    </div>
  );

  const detailInstances = detailRow
    ? state.instances.filter(i => i.entityRef?.rowId === detailRow.id)
    : [];

  // 详情内容块：桌面/手机走 Drawer，平板走右栏主从面板（同一 JSX 两处挂载）
  const detailBody = detailRow && page && (
    <>
      <Descriptions
        size="small"
        column={1}
        items={page.detailFields.map(f => ({
          key: f.id,
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
          children: <FieldValue field={f} value={detailRow.values[f.id]} />,
        }))}
      />
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
                  <Button
                    size="small"
                    type="primary"
                    ghost
                    data-testid={`app-ai-action-${action.capId}`}
                    loading={aiRunningCapId === action.capId}
                    disabled={
                      aiRunningCapId !== null && aiRunningCapId !== action.capId
                    }
                    onClick={() => runAiAction(action)}
                  >
                    ✨ {action.label}
                  </Button>
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
            <div
              data-testid="app-ai-error"
              style={{
                marginTop: 8,
                padding: "6px 10px",
                borderRadius: 8,
                background: "#fff2f0",
                border: "1px solid #ffccc7",
                fontSize: 11,
                color: "#cf1322",
              }}
            >
              <span style={{ fontFamily: "monospace", fontWeight: 600 }}>
                {aiError.code}
              </span>
              <span style={{ marginLeft: 6 }}>{aiError.detail}</span>
            </div>
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
            gap: 12,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-stats"
        >
          {page.stats.map(stat => {
            const realRows = state.entities[stat.entityId] ?? [];
            const v = pageStatValue(stat, realRows);
            // Phase B: 真实数据为零时用预览种子数据填充，加"示例"标注
            const entity = model?.datamodel?.entities?.find(e => e.id === stat.entityId);
            const seedRows = (v === 0 || v === null) && entity
              ? generatePreviewSeedRows(
                  {
                    id: entity.id,
                    fields: entity.fields?.map(f => ({
                      id: f.id,
                      type: f.type,
                      options: f.options?.map(o => o.label ?? o.id),
                    })),
                  },
                  6
                )
              : null;
            const displayVal = seedRows
              ? computePreviewStat(stat.metric, stat.metricFieldId, seedRows)
              : v;
            const isPreview = seedRows !== null && displayVal !== null && displayVal > 0;
            return (
              <Card
                key={stat.id}
                size="small"
                style={{ flex: 1, minWidth: 140 }}
                styles={{ body: { padding: "12px 16px" } }}
                data-testid={`app-runtime-page-stat-${stat.id}`}
              >
                {displayVal === null ? (
                  <Statistic title={stat.label} value="—" />
                ) : (
                  <>
                    <Statistic
                      title={stat.label}
                      value={displayVal}
                      precision={Number.isInteger(displayVal) ? 0 : stat.format === "money" ? 2 : 1}
                      prefix={stat.format === "money" ? "¥" : undefined}
                      suffix={stat.format === "percent" ? "%" : undefined}
                    />
                    {isPreview && (
                      <span style={{ fontSize: 10, color: "#adb5bd", marginTop: 2, display: "block" }}>
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

  const widgetsBand = page && (
    <>
      {(page.rankings.length > 0 || page.feeds.length > 0) && (
        <div
          style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}
          data-testid="app-runtime-page-widgets"
        >
          {page.rankings.map(ranking => {
            const rankRows = [...(state.entities[ranking.entityId] ?? [])]
              .map(row => ({ row, v: Number(row.values[ranking.sortFieldId]) }))
              .filter(({ v }) => Number.isFinite(v))
              .sort((a, b) => b.v - a.v)
              .slice(0, ranking.limit);
            const titleFieldId =
              page.detailFields.find(
                f => f.type === "string" && f.id !== "id"
              )?.id ?? "id";
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
                        gap: 8,
                        padding: "5px 0",
                        borderBottom: i < rankRows.length - 1 ? "1px solid #f5f5f5" : "none",
                      }}
                    >
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          textAlign: "center",
                          lineHeight: "20px",
                          fontSize: 11,
                          fontWeight: 600,
                          flexShrink: 0,
                          background: i < 3 ? "var(--app-primary,#1677ff)" : "#f0f0f0",
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
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#262626" }}>
                        {v.toLocaleString("zh-CN")}
                      </span>
                    </div>
                  ))
                )}
              </Card>
            );
          })}
          {page.feeds.map(feed => {
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
              page.detailFields.find(
                f => f.type === "string" && f.id !== "id"
              )?.id ?? "id";
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
                    const levelValue = String(row.values[feed.levelFieldId ?? ""] ?? "");
                    const option = levelField?.options?.find(o => o.id === levelValue);
                    return (
                      <div
                        key={row.id || String(i)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "5px 0",
                          borderBottom: i < feedRows.length - 1 ? "1px solid #f5f5f5" : "none",
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
          })}
        </div>
      )}
    </>
  );

  const chartsBand = page && (
    <>
      {page.charts.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
          data-testid="app-runtime-page-charts"
        >
          {page.charts.map((chart: AppPageChartSchema) => {
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
                data-testid={`app-runtime-page-chart-${chart.id}`}
              >
                {option ? (
                  <React.Suspense
                    fallback={
                      <div
                        style={{
                          fontSize: 11,
                          color: INK.faint,
                          padding: "16px 0",
                        }}
                      >
                        图表加载中…
                      </div>
                    }
                  >
                    <LazyEchartsChart
                      option={option}
                      height={180}
                      ariaLabel={`${chart.label}：按${chart.dimensionLabel}统计${chart.metricLabel}`}
                    />
                  </React.Suspense>
                ) : (
                  <div
                    style={{
                      fontSize: 11,
                      color: INK.faint,
                      padding: "16px 0",
                    }}
                  >
                    暂无数据 — 写入「{chart.dimensionLabel}」后自动出图
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );

  const defaultPageContent = page && (
    <Card
      size="small"
      title={page.title}
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
      {(() => {
        // 保守策略：_fromLegacy 区块只是转换占位，渲染仍走旧路径（statsBand 等）。
        // 真正的新模型 blocks 不带 _fromLegacy，走 ExperienceBlockBoundary。
        const directBlocks = page.experienceBlocks.filter(
          b => !(b as import("./block-registry").ExperienceBlockInstance)._fromLegacy
        );
        if (directBlocks.length === 0) return null;

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
                message.info("该操作指向的实体暂不支持在此页创建");
              }
              break;
            case "changeFilter":
              console.log("[action:changeFilter]", actionId, eventData);
              break;
            default:
              console.log(`[action:${action.type}]`, actionId, eventData);
          }
        };

        const renderBlock = (block: (typeof directBlocks)[number]) => (
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
            chartPalette={{ primary: identityTheme.primary, categorical: identityTheme.charts }}
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
              {directBlocks.map(renderBlock)}
            </div>
          );
        }

        const blockById = new Map(directBlocks.map(b => [b.id, b]));
        // 手机档用 layout.mobile 覆盖（未声明则退回桌面槽位，同一套摆法）。
        const slotSource = isPhone && page.layout.mobile
          ? { ...page.layout, ...page.layout.mobile }
          : page.layout;
        const slotBlocks = (ids: string[]) =>
          ids.map(bid => blockById.get(bid)).filter((b): b is NonNullable<typeof b> => !!b);
        const summaryBlocks = slotBlocks(slotSource.summary ?? []);
        const primaryBlocks = slotBlocks(slotSource.primary ?? []);
        const secondaryBlocks = slotBlocks(slotSource.secondary ?? []);
        const activityBlocks = slotBlocks(slotSource.activity ?? []);
        const contentBlocks = slotBlocks(slotSource.content ?? []);
        const placedIds = new Set(
          [...summaryBlocks, ...primaryBlocks, ...secondaryBlocks, ...activityBlocks, ...contentBlocks].map(
            b => b.id
          )
        );
        // 声明了 layout 但没被任何槽位引用到的区块：如实照样渲染，不能因为
        // 没排进槽位就悄悄丢内容——排在末尾，视觉上标为"未分配槽位"。
        const orphanBlocks = directBlocks.filter(b => !placedIds.has(b.id));

        return (
          <div
            className="mb-3 flex flex-col gap-2"
            data-testid="app-runtime-experience-block-layout"
          >
            {summaryBlocks.length > 0 && (
              <div className="flex flex-wrap gap-2" data-testid="app-runtime-layout-summary">
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
              <div className="flex flex-col gap-2" data-testid="app-runtime-layout-activity">
                {activityBlocks.map(renderBlock)}
              </div>
            )}
            {contentBlocks.length > 0 && (
              <div className="flex flex-col gap-2" data-testid="app-runtime-layout-content">
                {contentBlocks.map(renderBlock)}
              </div>
            )}
            {orphanBlocks.length > 0 && (
              <div className="grid gap-2" data-testid="app-runtime-layout-unassigned">
                {orphanBlocks.map(renderBlock)}
              </div>
            )}
          </div>
        );
      })()}
      {page.view.kind === "wizard" && (model?.workflow?.nodes?.length ?? 0) > 0 && (
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
        <>
          {statsBand}
          <div
            style={{ display: "flex", gap: 12, alignItems: "flex-start" }}
            data-testid="app-runtime-monitor-split"
          >
            <div style={{ flex: 2, minWidth: 0 }}>{chartsBand}</div>
            <div style={{ flex: 1, minWidth: 220 }}>{widgetsBand}</div>
          </div>
        </>
      ) : (
        <>
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
              <div
                style={{
                  fontSize: 12,
                  color: INK.faint,
                  padding: "24px 0",
                  textAlign: "center",
                }}
              >
                点击左侧行查看详情与 AI 能力
              </div>
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
    return {
      key: m.pageId,
      icon: <Icon />,
      label: (
        <span
          data-testid={`app-runtime-menu-${m.pageId}`}
          {...probe({ kind: "menu", pageId: m.pageId, label: m.label })}
        >
          {m.label}
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
        <span style={{ fontSize: 13, color: identityTheme.sidebarText, opacity: 0.65 }}>
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
        <Select
          size="small"
          style={{ minWidth: 104 }}
          value={role}
          onChange={changeRole}
          options={schema.roles.map(r => ({ value: r, label: r }))}
          data-testid="app-runtime-role"
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {isHome ? homeContent : phonePageContent}
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
            // Step 9：深色配方覆盖 canvas 底色（不读 identityTheme.contentBg，
            // 避免深色配方叠浅色主题时底色反而变浅）。
            background: designRecipe.dark ? DARK_CANVAS_BG : identityTheme.contentBg,
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
                  ? { colorBorder: "#000000", colorBorderSecondary: "#00000040", fontSize: 15 }
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
                },
              },
            }}
          >
            {isPhone
              ? phoneShell
              : schema.identity.nav === "top"
                ? topShell
                : desktopShell}

            <Modal
              title={`新建 · ${page?.title ?? ""}`}
              open={formOpen}
              onOk={handleCreate}
              onCancel={() => setFormOpen(false)}
              okText="保存"
              cancelText="取消"
              destroyOnHidden
              getContainer={() => canvasEl ?? document.body}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  paddingTop: 8,
                }}
              >
                {(page?.formFields ?? []).map(f => (
                  <div
                    key={f.id}
                    {...(page?.entityId
                      ? probe({
                          kind: "field",
                          entityId: page.entityId,
                          fieldId: f.id,
                          label: f.label,
                        })
                      : {})}
                  >
                    <div
                      style={{ fontSize: 12, color: "#666", marginBottom: 4 }}
                    >
                      {f.label}
                      <span style={{ color: "#bbb", marginLeft: 6 }}>
                        {f.type}
                      </span>
                    </div>
                    <FieldInput
                      field={f}
                      value={formValues[f.id]}
                      refRows={refRowsFor(f)}
                      enumOptions={
                        f.type === "enum" && page?.entityId
                          ? [
                              ...new Set(
                                (state.entities[page.entityId] ?? [])
                                  .map(r => String(r.values[f.id] ?? "").trim())
                                  .filter(Boolean)
                              ),
                            ]
                          : []
                      }
                      onChange={v =>
                        setFormValues(prev => ({ ...prev, [f.id]: v }))
                      }
                    />
                  </div>
                ))}
              </div>
            </Modal>

            <Drawer
              title={`详情 · ${page?.title ?? currentTitle}`}
              open={detailRow !== null && !isTablet}
              onClose={() => {
                setDetailRow(null);
                setAiError(null);
                setAiSuggestion(null); // 未确认的建议随抽屉关闭丢弃（不悄悄写回）
              }}
              placement={isPhone ? "bottom" : "right"}
              height={isPhone ? "72%" : undefined}
              width={isPhone ? undefined : 420}
              destroyOnHidden
              getContainer={() => canvasEl ?? document.body}
              data-testid="app-runtime-detail"
            >
              {detailBody}
            </Drawer>
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
