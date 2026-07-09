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
} from "@ant-design/icons";
import type { FiveSystemModel } from "../system-screens/five-system-model";
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
  type PageAccess,
} from "./rbac-preview";
import { buildColumnFeatures } from "./table-features";
import { FieldValue } from "./FieldValue";
import { KanbanBoard, CalendarBoard } from "./PageViews";
import { AiSuggestionCard } from "./AiSuggestionCard";
import { CodeProjectionView } from "./CodeProjectionView";
import type { AppPageStatSchema } from "./app-runtime-schema";
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
}: {
  model: FiveSystemModel;
  sessionId: string;
  appTitle?: string;
  /** 当前页变化时上报（游标透视栏跟随应用内导航） */
  onActivePageChange?: (pageId: string) => void;
  /** 元素级游标：开启时被埋点的元素悬停上报目标 + 描边高亮 */
  xrayActive?: boolean;
  onXrayTarget?: (target: XrayTarget | null) => void;
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
  const [activePageId, setActivePageId] = React.useState<string>("home");
  const [device, setDevice] = React.useState<DeviceKey>("desktop");
  // 代码视图档（代码视图一期）：schema 的确定性代码投影——与设备档并列的
  // 观察视角切换，开着时替换缩放画布（代码要整幅面积，不做 16:9 缩放）
  const [codeView, setCodeView] = React.useState(false);
  // 当前角色与 RBAC 屏「角色预览」共享（localStorage + 事件），谁改都实时生效
  const [role, setRole] = React.useState<string | undefined>(
    () => loadRuntimeRole(sessionId) ?? schema?.roles[0]
  );
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

  // 当前页对该角色不可见时回工作台（角色切换的直观反馈）
  React.useEffect(() => {
    if (
      activePageId !== "home" &&
      pageAccess.get(activePageId)?.visible === false
    ) {
      setActivePageId("home");
    }
  }, [activePageId, pageAccess]);

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
  const rows = page?.entityId ? (state.entities[page.entityId] ?? []) : [];

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
      ...buildColumnFeatures(c, rows),
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
        }))
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
            const v = pageStatValue(stat, state.entities[stat.entityId] ?? []);
            return (
              <Card
                key={stat.id}
                size="small"
                style={{ flex: 1, minWidth: 140 }}
                styles={{ body: { padding: "12px 16px" } }}
                data-testid={`app-runtime-page-stat-${stat.id}`}
              >
                {v === null ? (
                  <Statistic title={stat.label} value="—" />
                ) : (
                  <Statistic
                    title={stat.label}
                    value={v}
                    precision={
                      Number.isInteger(v) ? 0 : stat.format === "money" ? 2 : 1
                    }
                    prefix={stat.format === "money" ? "¥" : undefined}
                    suffix={stat.format === "percent" ? "%" : undefined}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}
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
            const option = buildEchartsOption(chart, chartRows);
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

  const desktopShell = (
    <Layout style={{ height: "100%" }}>
      <Layout.Sider width={device === "tablet" ? 176 : 208} theme="dark">
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
              background: "linear-gradient(135deg,#1677ff,#69b1ff)",
            }}
          />
          <span
            style={{
              color: "#fff",
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
          items={schema.menus.map((m, i) => {
            const locked =
              m.pageId !== "home" &&
              pageAccess.get(m.pageId)?.visible === false;
            const Icon =
              m.pageId === "home"
                ? DashboardOutlined
                : locked
                  ? LockOutlined
                  : MENU_ICONS[(i - 1 + MENU_ICONS.length) % MENU_ICONS.length];
            return {
              key: m.pageId,
              icon: <Icon />,
              label: (
                <span
                  {...probe({ kind: "menu", pageId: m.pageId, label: m.label })}
                >
                  {m.label}
                </span>
              ),
              disabled: locked,
              title: locked ? `当前角色（${role ?? "-"}）无本页权限` : m.label,
            };
          })}
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
            style={{ background: "#1677ff" }}
            icon={<UserOutlined />}
          />
        </Layout.Header>
        <Layout.Content style={{ padding: 20, overflow: "auto" }}>
          {isHome ? homeContent : pageContent}
        </Layout.Content>
      </Layout>
    </Layout>
  );

  const phoneShell = (
    <div
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
            background: "linear-gradient(135deg,#1677ff,#69b1ff)",
            flexShrink: 0,
          }}
        />
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
      <div style={{ flexShrink: 0 }} data-testid="app-runtime-tabbar">
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
    >
      {codeView ? (
        <div className="absolute inset-0" data-testid="app-runtime-code-host">
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
            background: "#f0f2f5",
            borderRadius: isPhone ? 12 : 5,
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(60,50,30,0.18)",
          }}
        >
          <ConfigProvider
            getPopupContainer={() => canvasEl ?? document.body}
            theme={
              isTablet ? { algorithm: antdTheme.compactAlgorithm } : undefined
            }
          >
            {isPhone ? phoneShell : desktopShell}

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

      {/* 档位切换（画布外的排练控制）：三档设备 + 代码投影视角 */}
      <div className="absolute left-3 top-2 flex items-center gap-0.5 rounded-full bg-black/25 p-0.5">
        {(Object.keys(DEVICE_SPECS) as DeviceKey[]).map(key => (
          <button
            key={key}
            type="button"
            data-testid={`app-device-${key}`}
            onClick={() => {
              setCodeView(false);
              setDevice(key);
            }}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
              !codeView && device === key
                ? "bg-white text-stone-800 shadow-sm"
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
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
            codeView
              ? "bg-white text-stone-800 shadow-sm"
              : "text-white/85 hover:text-white"
          }`}
        >
          代码
        </button>
      </div>
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
