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
  message,
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
import { buildEchartsOption } from "./build-echarts-option";

// ECharts 基建走独立 chunk（React.lazy）：主 bundle 不背 echarts，
// 首个带图表声明的页面打开时才加载。
const LazyEchartsChart = React.lazy(() => import("./EchartsChart"));
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
import { accessForRole, pageAccessForRole, type PageAccess } from "./rbac-preview";
import type { XrayTarget } from "../XrayPanel";

// 多端设计分辨率（固定渲染 + 等比缩放）
const DEVICE_SPECS = {
  desktop: { w: 1440, h: 810, label: "桌面" },
  tablet: { w: 1112, h: 834, label: "平板" },
  phone: { w: 390, h: 844, label: "手机" },
} as const;
type DeviceKey = keyof typeof DEVICE_SPECS;

/** 容器实测尺寸 → 等比缩放系数（min(宽比, 高比)，letterbox 居中）。 */
function useScaleToFit(designW: number, designH: number): {
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

const MENU_ICONS = [TableOutlined, ProfileOutlined, FormOutlined, AppstoreOutlined];

// --- 图表（dataviz 规范：墨色文字、细标记、状态色已校验） --------------------
const INK = { label: "#595959", value: "#262626", faint: "#bfbfbf" };
const BAR_HUE = "#1677ff";
const STATUS_META: Record<string, { color: string; label: string }> = {
  running: { color: "#1677ff", label: "进行中" },
  completed: { color: "#52c41a", label: "已完成" },
  rejected: { color: "#ff4d4f", label: "已驳回" },
};

function EntityBarChart({ items }: { items: Array<{ label: string; value: number }> }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const rowH = 26;
  const labelW = 96;
  const chartW = 300;
  if (items.length === 0 || items.every((i) => i.value === 0)) {
    return <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>暂无数据 — 到业务页面「新建」写入</div>;
  }
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${labelW + chartW + 44} ${items.length * rowH}`}
      role="img"
      aria-label="各实体数据量"
    >
      {items.map((item, i) => {
        const w = Math.max((item.value / max) * chartW, item.value > 0 ? 6 : 0);
        const y = i * rowH;
        return (
          <g key={item.label}>
            <title>{`${item.label}：${item.value} 行`}</title>
            <text x={labelW - 8} y={y + rowH / 2 + 4} textAnchor="end" fontSize={11} fill={INK.label}>
              {item.label.length > 7 ? `${item.label.slice(0, 7)}…` : item.label}
            </text>
            <rect x={labelW} y={y + 6} width={Math.max(w, 2)} height={14} rx={4} fill={item.value > 0 ? BAR_HUE : "#f0f0f0"} />
            <text x={labelW + Math.max(w, 2) + 6} y={y + rowH / 2 + 4} fontSize={11} fill={INK.value}>
              {item.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function donutSector(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0},${y0} A${r1},${r1} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`;
}

function StatusDonutChart({ counts }: { counts: Record<string, number> }) {
  const entries = Object.entries(STATUS_META)
    .map(([key, meta]) => ({ key, ...meta, value: counts[key] ?? 0 }))
    .filter((e) => e.value > 0);
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total === 0) {
    return <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>暂无流程实例 — 到业务页面「提交审批」发起</div>;
  }
  let angle = -Math.PI / 2;
  const segs = entries.map((e) => {
    const span = (e.value / total) * Math.PI * 2;
    const seg = { ...e, a0: angle, a1: angle + span };
    angle += span;
    return seg;
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <svg width={116} height={116} viewBox="0 0 116 116" role="img" aria-label="审批状态分布">
        {segs.length === 1 ? (
          <g>
            <title>{`${segs[0].label}：${segs[0].value} 件`}</title>
            <circle cx={58} cy={58} r={46} fill="none" stroke={segs[0].color} strokeWidth={22} />
          </g>
        ) : (
          segs.map((s) => (
            <g key={s.key}>
              <title>{`${s.label}：${s.value} 件`}</title>
              {/* 2px 白描边 = 分段留缝，不靠颜色分界 */}
              <path d={donutSector(58, 58, 35, 57, s.a0, s.a1)} fill={s.color} stroke="#fff" strokeWidth={2} />
            </g>
          ))
        )}
        <text x={58} y={55} textAnchor="middle" fontSize={18} fontWeight={600} fill={INK.value}>
          {total}
        </text>
        <text x={58} y={71} textAnchor="middle" fontSize={10} fill={INK.label}>
          实例
        </text>
      </svg>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {entries.map((e) => (
          <div key={e.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: INK.label }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: e.color, flexShrink: 0 }} />
            {e.label}
            <span style={{ color: INK.value, fontWeight: 600 }}>{e.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  refRows,
  onChange,
}: {
  field: AppFormFieldSchema;
  value: unknown;
  refRows: Array<{ id: string; label: string }>;
  onChange: (v: unknown) => void;
}) {
  if (field.type === "number") {
    return (
      <InputNumber
        style={{ width: "100%" }}
        value={value as number | undefined}
        onChange={(v) => onChange(v)}
        placeholder={field.label}
      />
    );
  }
  if (field.type === "date" || field.type === "datetime") {
    return (
      <Input type={field.type === "date" ? "date" : "datetime-local"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
    );
  }
  if (field.type === "enum") {
    return (
      <Select
        style={{ width: "100%" }}
        mode="tags"
        maxCount={1}
        value={value ? [String(value)] : []}
        onChange={(v) => onChange(v.at(-1) ?? "")}
        placeholder={`${field.label}（输入后回车）`}
      />
    );
  }
  if (field.type === "ref" && refRows.length > 0) {
    return (
      <Select
        style={{ width: "100%" }}
        value={(value as string) || undefined}
        onChange={(v) => onChange(v)}
        options={refRows.map((r) => ({ value: r.id, label: r.label }))}
        placeholder={`选择${field.label}`}
      />
    );
  }
  return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={field.label} />;
}

/** 工作台统计卡取值：对着运行时状态求值 schema 声明的 source。 */
function statValue(state: RuntimeState, schema: AppRuntimeSchema, source: string): number {
  if (source.startsWith("entity:")) return (state.entities[source.slice("entity:".length)] ?? []).length;
  if (source === "instances:running") return state.instances.filter((i) => i.status === "running").length;
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
  const schema = React.useMemo(
    () => deriveAppRuntimeSchema(model, appTitle || "推演应用"),
    [model, appTitle]
  );
  const [state, setState] = React.useState<RuntimeState>(() => {
    return loadRuntimeState(sessionId) ?? initRuntimeState(model);
  });
  const [activePageId, setActivePageId] = React.useState<string>("home");
  const [device, setDevice] = React.useState<DeviceKey>("desktop");
  // 当前角色与 RBAC 屏「角色预览」共享（localStorage + 事件），谁改都实时生效
  const [role, setRole] = React.useState<string | undefined>(
    () => loadRuntimeRole(sessionId) ?? schema?.roles[0]
  );
  const [formOpen, setFormOpen] = React.useState(false);
  const [formValues, setFormValues] = React.useState<Record<string, unknown>>({});
  const [detailRow, setDetailRow] = React.useState<RuntimeRow | null>(null);
  // AI 生成：正在跑的能力 id + 最近一次失败诊断（fail-closed，不冒充输出）
  const [aiRunningCapId, setAiRunningCapId] = React.useState<string | null>(null);
  const [aiError, setAiError] = React.useState<{ code: string; detail: string } | null>(null);
  const spec = DEVICE_SPECS[device];
  const { ref: fitRef, scale } = useScaleToFit(spec.w, spec.h);
  // 弹层（Modal/Select/Drawer）挂进画布，跟随 transform 缩放
  const [canvasEl, setCanvasEl] = React.useState<HTMLDivElement | null>(null);

  // 与工作流试运行面共享一份状态：对方变更时重载
  React.useEffect(
    () => subscribeRuntimeChanged(sessionId, () => setState(loadRuntimeState(sessionId) ?? initRuntimeState(model))),
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
    for (const a of pageAccessForRole(schema.pages, accessForRole(model, role))) {
      map.set(a.pageId, a);
    }
    return map;
  }, [schema, model, role]);

  // 当前页对该角色不可见时回工作台（角色切换的直观反馈）
  React.useEffect(() => {
    if (activePageId !== "home" && pageAccess.get(activePageId)?.visible === false) {
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
  const isHome = activePageId === "home";
  const page: AppPageSchema | null = isHome
    ? null
    : schema.pages.find((p) => p.id === activePageId) ?? schema.pages[0] ?? null;
  const currentTitle = isHome ? schema.home.title : page?.title ?? "";
  const rows = page?.entityId ? state.entities[page.entityId] ?? [] : [];

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
    return (state.entities[field.refEntityId] ?? []).map((r) => ({
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
    const { state: next } = addRow(state, page.entityId, formValues, new Date().toISOString());
    apply(next);
    setFormOpen(false);
    setFormValues({});
    message.success("已保存");
  };

  /** AI 生成：当前行喂给绑定能力（真 LLM），成功后把输出写回本行字段。 */
  const runAiAction = async (action: AppAiActionSchema) => {
    if (!page?.entityId || !detailRow || aiRunningCapId) return;
    const entityId = page.entityId;
    const rowId = detailRow.id;
    setAiRunningCapId(action.capId);
    setAiError(null);
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
        }),
      });
      const body = res.ok
        ? ((await res.json()) as { ok: boolean; output?: string; code?: string; detail?: string })
        : { ok: false, code: `HTTP_${res.status}`, detail: await res.text() };
      if (!body.ok || body.output === undefined) {
        setAiError({ code: body.code ?? "UNKNOWN", detail: body.detail ?? "" });
        return;
      }
      const next = updateRow(state, entityId, rowId, { [action.outputFieldId]: body.output });
      apply(next);
      const updated = (next.entities[entityId] ?? []).find((r) => r.id === rowId);
      if (updated) setDetailRow(updated);
      message.success(`AI 已写回「${action.outputLabel}」`);
    } catch (e) {
      setAiError({ code: "NETWORK_ERROR", detail: String(e) });
    } finally {
      setAiRunningCapId(null);
    }
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
      message.success(`已提交审批：${instance.title}（到 Workflow 试运行里推进）`);
    }
  };

  const rowActions = (row: RuntimeRow) => (
    <Space size="small">
      {page?.workflowLinked && (
        <span {...probe({ kind: "workflow", label: "提交审批", pageId: page.id })}>
          <Button
            size="small"
            type="link"
            onClick={(e) => {
              e.stopPropagation();
              handleSubmitToWorkflow(row.id, String(Object.values(row.values)[0] ?? row.id));
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
        onClick={(e) => {
          e.stopPropagation();
          apply(deleteRow(state, page!.entityId!, row.id));
        }}
      >
        删除
      </Button>
    </Space>
  );

  const columns = [
    ...(page?.columns ?? []).map((c) => ({
      title: c.label,
      dataIndex: ["values", c.id],
      key: c.id,
      ellipsis: true,
      onHeaderCell: () =>
        page?.entityId
          ? probe({ kind: "field", entityId: page.entityId, fieldId: c.id, label: c.label })
          : {},
      render: (v: unknown) => (v === undefined || v === "" ? <span style={{ color: "#bbb" }}>—</span> : String(v)),
    })),
    {
      title: "操作",
      key: "__actions",
      width: 170,
      render: (_: unknown, row: RuntimeRow) => rowActions(row),
    },
  ];

  const recentInstances = [...state.instances].slice(-5).reverse();

  const chartCard = (chart: AppChartSchema) => {
    let body: React.ReactNode = null;
    if (chart.source === "entities:rowcount") {
      body = (
        <EntityBarChart
          items={(model.datamodel?.entities ?? []).slice(0, 6).map((e) => ({
            label: e.name || e.id,
            value: (state.entities[e.id] ?? []).length,
          }))}
        />
      );
    } else if (chart.source === "instances:status") {
      const counts: Record<string, number> = {};
      for (const inst of state.instances) counts[inst.status] = (counts[inst.status] ?? 0) + 1;
      body = <StatusDonutChart counts={counts} />;
    }
    return (
      <Card key={chart.id} title={chart.label} size="small" style={{ flex: 1, minWidth: 0 }} data-testid={`app-runtime-${chart.id}`}>
        {body}
      </Card>
    );
  };

  const timelineCard = (
    <Card title="审批动态" size="small" style={{ flex: 1.2, minWidth: 0 }}>
      {recentInstances.length === 0 ? (
        <div style={{ fontSize: 11, color: INK.faint }}>暂无流程实例 — 到业务页面「提交审批」发起</div>
      ) : (
        <Timeline
          items={recentInstances.map((inst) => {
            const meta = STATUS_META[inst.status] ?? STATUS_META.running;
            return {
              color: inst.status === "running" ? "blue" : inst.status === "completed" ? "green" : "red",
              children: (
                <div style={{ fontSize: 12 }}>
                  <div style={{ color: INK.value, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {inst.title}
                  </div>
                  <div style={{ color: INK.label, marginTop: 2 }}>
                    {nodeById(model, inst.currentNodeId)?.name ?? inst.currentNodeId}
                    <Tag style={{ marginLeft: 8 }} color={meta.color === "#1677ff" ? "processing" : inst.status === "completed" ? "success" : "error"}>
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
      <div style={{ display: isPhone ? "grid" : "flex", gridTemplateColumns: "1fr 1fr", gap: isPhone ? 8 : 16 }}>
        {schema.home.stats.map((s) => (
          <Card key={s.id} size="small" style={{ flex: 1 }} styles={{ body: { padding: isPhone ? "10px 14px" : "16px 20px" } }}>
            <Statistic title={s.label} value={statValue(state, schema, s.source)} suffix={s.suffix} />
          </Card>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", gap: isPhone ? 8 : 16, marginTop: isPhone ? 8 : 16 }}>
        {schema.home.charts.map(chartCard)}
      </div>
      <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", gap: isPhone ? 8 : 16, marginTop: isPhone ? 8 : 16 }}>
        {!isPhone && (
          <Card title="快速入口" size="small" style={{ flex: 1 }}>
            <Space wrap>
              {schema.pages.map((p) => {
                const locked = pageAccess.get(p.id)?.visible === false;
                return (
                  <Button
                    key={p.id}
                    icon={locked ? <LockOutlined /> : undefined}
                    disabled={locked}
                    title={locked ? `当前角色（${role ?? "-"}）无本页权限` : undefined}
                    onClick={() => setActivePageId(p.id)}
                  >
                    {p.title}
                  </Button>
                );
              })}
            </Space>
            {[...pageAccess.values()].some((a) => !a.visible) && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#999" }}>
                <LockOutlined /> 当前角色不可见{" "}
                {[...pageAccess.values()].filter((a) => !a.visible).length} 个页面 —
                右上角切换角色试试（RBAC 权限实时生效）
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
          block
          icon={pageAccess.get(page.id)?.canCreate === false ? <LockOutlined /> : <PlusOutlined />}
          disabled={!page.entityId || pageAccess.get(page.id)?.canCreate === false}
          onClick={() => {
            setFormValues({});
            setFormOpen(true);
          }}
          data-testid="app-runtime-create"
        >
          新建
        </Button>
      </span>
      {rows.length === 0 && (
        <div style={{ textAlign: "center", fontSize: 12, color: INK.faint, padding: "24px 0" }}>
          暂无数据 — 点「新建」写入第一条真实数据
        </div>
      )}
      {rows.map((row) => (
        <Card key={row.id} size="small" hoverable onClick={() => setDetailRow(row)} styles={{ body: { padding: "10px 12px" } }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: INK.value }}>
            {String(Object.values(row.values)[0] ?? row.id)}
          </div>
          {page.detailFields.slice(1, 4).map((f) => (
            <div key={f.id} style={{ display: "flex", fontSize: 12, marginTop: 4 }}>
              <span style={{ color: INK.label, width: 88, flexShrink: 0 }}>{f.label}</span>
              <span style={{ color: INK.value }}>{String(row.values[f.id] ?? "—")}</span>
            </div>
          ))}
          <div style={{ marginTop: 6, textAlign: "right" }}>{rowActions(row)}</div>
        </Card>
      ))}
    </div>
  );

  const pageContent = page && (
    <Card
      size="small"
      title={page.title}
      extra={
        <Space size="small">
          {page.actions.slice(0, 3).map((a) => (
            <Tag key={a} color="blue" style={{ marginInlineEnd: 0 }}>
              {a}
            </Tag>
          ))}
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
              icon={pageAccess.get(page.id)?.canCreate === false ? <LockOutlined /> : <PlusOutlined />}
              onClick={() => {
                setFormValues({});
                setFormOpen(true);
              }}
              disabled={!page.entityId || pageAccess.get(page.id)?.canCreate === false}
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
      {page.charts.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }} data-testid="app-runtime-page-charts">
          {page.charts.map((chart: AppPageChartSchema) => {
            const chartRows = state.entities[chart.entityId] ?? [];
            const option = buildEchartsOption(chart, chartRows);
            return (
              <Card
                key={chart.id}
                size="small"
                title={chart.label}
                style={{ flex: 1, minWidth: 220 }}
                data-testid={`app-runtime-page-chart-${chart.id}`}
              >
                {option ? (
                  <React.Suspense
                    fallback={<div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>图表加载中…</div>}
                  >
                    <LazyEchartsChart
                      option={option}
                      height={180}
                      ariaLabel={`${chart.label}：按${chart.dimensionLabel}统计${chart.metricLabel}`}
                    />
                  </React.Suspense>
                ) : (
                  <div style={{ fontSize: 11, color: INK.faint, padding: "16px 0" }}>
                    暂无数据 — 写入「{chart.dimensionLabel}」后自动出图
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <Table
        size="middle"
        rowKey="id"
        columns={columns as any}
        dataSource={rows}
        onRow={(row) => ({ onClick: () => setDetailRow(row as RuntimeRow), style: { cursor: "pointer" } })}
        pagination={rows.length > 8 ? { pageSize: 8 } : false}
        locale={{ emptyText: "暂无数据 — 点「新建」写入第一条真实数据" }}
      />
    </Card>
  );

  const desktopShell = (
    <Layout style={{ height: "100%" }}>
      <Layout.Sider width={device === "tablet" ? 176 : 208} theme="dark">
        <div style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 16px" }}>
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
            style={{ color: "#fff", fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
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
            const locked = m.pageId !== "home" && pageAccess.get(m.pageId)?.visible === false;
            const Icon = m.pageId === "home" ? DashboardOutlined : locked ? LockOutlined : MENU_ICONS[(i - 1 + MENU_ICONS.length) % MENU_ICONS.length];
            return {
              key: m.pageId,
              icon: <Icon />,
              label: <span {...probe({ kind: "menu", pageId: m.pageId, label: m.label })}>{m.label}</span>,
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
          <Breadcrumb items={[{ title: schema.appName }, { title: currentTitle }]} />
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 13, color: "#999" }}>当前角色</span>
          <Select
            size="small"
            style={{ minWidth: 140 }}
            value={role}
            onChange={changeRole}
            options={schema.roles.map((r) => ({ value: r, label: r }))}
            data-testid="app-runtime-role"
          />
          <Avatar size={30} style={{ background: "#1677ff" }} icon={<UserOutlined />} />
        </Layout.Header>
        <Layout.Content style={{ padding: 20, overflow: "auto" }}>
          {isHome ? homeContent : pageContent}
        </Layout.Content>
      </Layout>
    </Layout>
  );

  const phoneShell = (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#f0f2f5" }}>
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
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "linear-gradient(135deg,#1677ff,#69b1ff)", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {currentTitle}
        </span>
        <span style={{ flex: 1 }} />
        <Select
          size="small"
          style={{ minWidth: 104 }}
          value={role}
          onChange={changeRole}
          options={schema.roles.map((r) => ({ value: r, label: r }))}
          data-testid="app-runtime-role"
        />
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10 }}>
        {isHome ? homeContent : phonePageContent}
      </div>
      <div
        style={{
          height: 54,
          flexShrink: 0,
          background: "#fff",
          borderTop: "1px solid #f0f0f0",
          display: "flex",
          overflowX: "auto",
        }}
        data-testid="app-runtime-tabbar"
      >
        {schema.menus.map((m, i) => {
          const locked = m.pageId !== "home" && pageAccess.get(m.pageId)?.visible === false;
          const active = activePageId === m.pageId;
          const Icon = m.pageId === "home" ? DashboardOutlined : locked ? LockOutlined : MENU_ICONS[(i - 1 + MENU_ICONS.length) % MENU_ICONS.length];
          return (
            <button
              key={m.pageId}
              type="button"
              disabled={locked}
              onClick={() => setActivePageId(m.pageId)}
              title={locked ? `当前角色（${role ?? "-"}）无本页权限` : m.label}
              style={{
                minWidth: 64,
                flex: "1 0 auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                border: "none",
                background: "none",
                cursor: locked ? "not-allowed" : "pointer",
                color: locked ? "#bfbfbf" : active ? "#1677ff" : "#595959",
                fontSize: 10,
              }}
            >
              <Icon style={{ fontSize: 17 }} />
              <span style={{ maxWidth: 72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const detailInstances = detailRow
    ? state.instances.filter((i) => i.entityRef?.rowId === detailRow.id)
    : [];

  return (
    <div
      ref={fitRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      style={{ background: "transparent" }}
      data-testid="app-runtime-screen"
    >
      <div style={{ width: spec.w * scale, height: spec.h * scale, position: "relative" }}>
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
          <ConfigProvider getPopupContainer={() => canvasEl ?? document.body}>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 8 }}>
                {(page?.formFields ?? []).map((f) => (
                  <div
                    key={f.id}
                    {...(page?.entityId
                      ? probe({ kind: "field", entityId: page.entityId, fieldId: f.id, label: f.label })
                      : {})}
                  >
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                      {f.label}
                      <span style={{ color: "#bbb", marginLeft: 6 }}>{f.type}</span>
                    </div>
                    <FieldInput
                      field={f}
                      value={formValues[f.id]}
                      refRows={refRowsFor(f)}
                      onChange={(v) => setFormValues((prev) => ({ ...prev, [f.id]: v }))}
                    />
                  </div>
                ))}
              </div>
            </Modal>

            <Drawer
              title={`详情 · ${page?.title ?? currentTitle}`}
              open={detailRow !== null}
              onClose={() => {
                setDetailRow(null);
                setAiError(null);
              }}
              placement={isPhone ? "bottom" : "right"}
              height={isPhone ? "72%" : undefined}
              width={isPhone ? undefined : 420}
              destroyOnHidden
              getContainer={() => canvasEl ?? document.body}
              data-testid="app-runtime-detail"
            >
              {detailRow && page && (
                <>
                  <Descriptions
                    size="small"
                    column={1}
                    items={page.detailFields.map((f) => ({
                      key: f.id,
                      label: page.entityId ? (
                        <span {...probe({ kind: "field", entityId: page.entityId, fieldId: f.id, label: f.label })}>
                          {f.label}
                        </span>
                      ) : (
                        f.label
                      ),
                      children:
                        detailRow.values[f.id] === undefined || detailRow.values[f.id] === ""
                          ? "—"
                          : String(detailRow.values[f.id]),
                    }))}
                  />
                  {page.aiActions.length > 0 && (
                    <>
                      <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600, color: INK.value }}>
                        AI 能力 · {page.aiActions.length}
                      </div>
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                        {page.aiActions.map((action) => (
                          <div key={action.capId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span {...probe({ kind: "ai", capId: action.capId, label: action.label })}>
                              <Button
                                size="small"
                                type="primary"
                                ghost
                                data-testid={`app-ai-action-${action.capId}`}
                                loading={aiRunningCapId === action.capId}
                                disabled={aiRunningCapId !== null && aiRunningCapId !== action.capId}
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
                          <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{aiError.code}</span>
                          <span style={{ marginLeft: 6 }}>{aiError.detail}</span>
                        </div>
                      )}
                    </>
                  )}

                  <div style={{ marginTop: 16, fontSize: 12, fontWeight: 600, color: INK.value }}>
                    关联审批实例 · {detailInstances.length}
                  </div>
                  {detailInstances.length === 0 ? (
                    <div style={{ fontSize: 12, color: INK.faint, marginTop: 6 }}>
                      本行尚未提交审批
                    </div>
                  ) : (
                    detailInstances.map((inst) => {
                      const meta = STATUS_META[inst.status] ?? STATUS_META.running;
                      return (
                        <div key={inst.id} style={{ marginTop: 8, fontSize: 12, color: INK.label }}>
                          {inst.title} · {nodeById(model, inst.currentNodeId)?.name ?? inst.currentNodeId}
                          <Tag style={{ marginLeft: 8 }} color={inst.status === "running" ? "processing" : inst.status === "completed" ? "success" : "error"}>
                            {meta.label}
                          </Tag>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </Drawer>
          </ConfigProvider>
        </div>
      </div>

      {/* 设备切换（画布外的排练控制，不属于被渲染的系统本身） */}
      <div className="absolute left-3 top-2 flex items-center gap-0.5 rounded-full bg-black/25 p-0.5">
        {(Object.keys(DEVICE_SPECS) as DeviceKey[]).map((key) => (
          <button
            key={key}
            type="button"
            data-testid={`app-device-${key}`}
            onClick={() => setDevice(key)}
            className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
              device === key ? "bg-white text-stone-800 shadow-sm" : "text-white/85 hover:text-white"
            }`}
          >
            {DEVICE_SPECS[key].label}
          </button>
        ))}
      </div>
      <span
        className="absolute bottom-2 right-3 rounded-full bg-black/30 px-2 py-0.5 font-mono text-[9px] text-white/90"
        title={`固定 ${spec.w}×${spec.h} 设计分辨率，按容器等比缩放显示`}
      >
        {spec.w}×{spec.h} · {Math.round(scale * 100)}%
      </span>
    </div>
  );
}
