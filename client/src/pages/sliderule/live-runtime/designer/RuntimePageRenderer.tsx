/**
 * RuntimePageRenderer — 设计器二期批次3：设计树的运行时渲染（PreviewEngine 等价）。
 *
 * 画布里搭的组件树在运行应用里按真数据渲染：
 *   - 数据表格/数据表单/图表 → 绑定实体的运行时行数据（与默认渲染同一状态源，
 *     表单写入走同一校验与持久化管线）；
 *   - 审批进度 → 最近流程实例在主链路上的真实位置；
 *   - 按钮/链接块的两个真事件：打开页面（应用内导航）/ 发起审批（起实例）；
 *   - 输入系列是无绑定的通用控件（可交互、不落库——设计器三期做字段级绑定）。
 *
 * 与设计态 NodeVisual 的分工：那边是静态骨架（示例行），这边是活数据。
 */

import React from "react";
import { Button as AntButton, Card, Divider as AntDivider, Input, message, Steps, Table, Tabs } from "antd";
import { PictureOutlined } from "@ant-design/icons";
import type { FiveSystemModel } from "../../system-screens/five-system-model";
import type { ComponentNode } from "./component-schema";
import { getComponentDefinition } from "./component-registry";
import type { RuntimeRow, RuntimeState } from "../live-runtime";
import type { AppPageChartSchema } from "../app-runtime-schema";
import { buildEchartsOption } from "../build-echarts-option";
import { buildColumnFeatures } from "../table-features";

const LazyEchartsChart = React.lazy(() => import("../EchartsChart"));

/** 渲染上下文：状态与动作全部由 AppRuntimeScreen 注入（渲染器不自持状态源） */
export interface RuntimeRenderCtxValue {
  model: FiveSystemModel;
  state: RuntimeState;
  /** 表单提交：校验+写入+持久化由宿主管线负责；true=成功（清空表单） */
  onAddRow: (entityId: string, values: Record<string, unknown>) => boolean;
  /** 事件动作①：应用内导航 */
  onOpenPage: (pageId: string) => void;
  /** 事件动作②：发起审批实例 */
  onStartApproval: () => void;
}

const RuntimeRenderCtx = React.createContext<RuntimeRenderCtxValue | null>(null);

function runAction(ctx: RuntimeRenderCtxValue, props: Record<string, unknown>) {
  const kind = String(props.actionKind ?? "none");
  if (kind === "openPage") {
    const pageId = String(props.actionPageId ?? "");
    if (pageId) ctx.onOpenPage(pageId);
    else message.info("链接未绑定目标页面（画布设计里配置）");
  } else if (kind === "startApproval") {
    ctx.onStartApproval();
  }
}

// --- 数据组件 ---------------------------------------------------------------

function LiveDataTable({ node }: { node: ComponentNode }) {
  const ctx = React.useContext(RuntimeRenderCtx)!;
  const entityId = String(node.props.entityId ?? "");
  const entity = (ctx.model.datamodel?.entities ?? []).find((e) => e.id === entityId);
  const fieldIds = (node.props.columnFieldIds as string[] | undefined) ?? [];
  const fields = (entity?.fields ?? []).filter((f) => fieldIds.includes(f.id));
  if (!entity || fields.length === 0) {
    return <div className="py-3 text-center text-[11px] text-stone-400">数据表格未绑定实体/列（画布设计里配置）</div>;
  }
  const rows = ctx.state.entities[entityId] ?? [];
  const pageSize = Number(node.props.pageSize ?? 5);
  return (
    <Table
      size="small"
      rowKey="id"
      columns={fields.map((f) => ({
        title: f.name || f.id,
        dataIndex: ["values", f.id],
        // 表格自带能力：按字段类型排序 + enum/低基数真实取值筛选
        ...buildColumnFeatures({ id: f.id, type: f.type }, rows as RuntimeRow[]),
        render: (v: unknown) => (v === undefined || v === null || v === "" ? "—" : String(v)),
      }))}
      dataSource={rows as RuntimeRow[]}
      pagination={rows.length > pageSize ? { pageSize } : false}
      locale={{ emptyText: "暂无数据 — 用数据表单写入第一条" }}
    />
  );
}

function LiveDataForm({ node }: { node: ComponentNode }) {
  const ctx = React.useContext(RuntimeRenderCtx)!;
  const [values, setValues] = React.useState<Record<string, unknown>>({});
  const entityId = String(node.props.entityId ?? "");
  const entity = (ctx.model.datamodel?.entities ?? []).find((e) => e.id === entityId);
  const fieldIds = (node.props.formFieldIds as string[] | undefined) ?? [];
  const fields = (entity?.fields ?? []).filter((f) => fieldIds.includes(f.id));
  if (!entity || fields.length === 0) {
    return <div className="py-3 text-center text-[11px] text-stone-400">数据表单未绑定实体/字段（画布设计里配置）</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
      {fields.map((f) => (
        <div key={f.id}>
          <div className="mb-1 text-[11px] text-stone-500">{f.name || f.id}</div>
          <Input
            size="small"
            type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
            value={(values[f.id] as string) ?? ""}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                [f.id]: f.type === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value,
              }))
            }
            placeholder={f.name || f.id}
          />
        </div>
      ))}
      <div className="col-span-2">
        <AntButton
          type="primary"
          size="small"
          onClick={() => {
            if (ctx.onAddRow(entityId, values)) setValues({});
          }}
        >
          {String(node.props.submitLabel ?? "提交")}
        </AntButton>
      </div>
    </div>
  );
}

function LiveChart({ node }: { node: ComponentNode }) {
  const ctx = React.useContext(RuntimeRenderCtx)!;
  const dimension = String(node.props.dimension ?? "");
  const dot = dimension.indexOf(".");
  const entityId = dot > 0 ? dimension.slice(0, dot) : "";
  const dimFieldId = dot > 0 ? dimension.slice(dot + 1) : "";
  const entity = (ctx.model.datamodel?.entities ?? []).find((e) => e.id === entityId);
  const dimField = entity?.fields?.find((f) => f.id === dimFieldId);
  if (!entity || !dimField) {
    return <div className="py-3 text-center text-[11px] text-stone-400">图表未绑定维度（画布设计里配置）</div>;
  }
  const rawMetric = String(node.props.metric ?? "count");
  let metric: "count" | "sum" = "count";
  let metricFieldId: string | undefined;
  let metricLabel = "数量";
  if (rawMetric.startsWith("sum:")) {
    const mref = rawMetric.slice(4);
    const mdot = mref.indexOf(".");
    const mField =
      mdot > 0 && mref.slice(0, mdot) === entityId
        ? entity.fields?.find((f) => f.id === mref.slice(mdot + 1))
        : undefined;
    if (mField) {
      metric = "sum";
      metricFieldId = mField.id;
      metricLabel = mField.name || mField.id;
    }
  }
  const rawType = String(node.props.chartType ?? "bar");
  const chart: AppPageChartSchema = {
    id: node.id,
    label: String(node.props.title ?? "图表"),
    type: rawType === "line" || rawType === "pie" ? rawType : "bar",
    entityId,
    dimensionFieldId: dimFieldId,
    dimensionLabel: dimField.name || dimFieldId,
    metric,
    metricFieldId,
    metricLabel,
  };
  const rows = ctx.state.entities[entityId] ?? [];
  const option = buildEchartsOption(chart, rows as RuntimeRow[]);
  return (
    <Card size="small" title={chart.label}>
      {option ? (
        <React.Suspense fallback={<div className="py-4 text-[11px] text-stone-300">图表加载中…</div>}>
          <LazyEchartsChart
            option={option}
            height={180}
            ariaLabel={`${chart.label}：按${chart.dimensionLabel}统计${chart.metricLabel}`}
          />
        </React.Suspense>
      ) : (
        <div className="py-4 text-[11px] text-stone-300">暂无数据 — 写入「{chart.dimensionLabel}」后自动出图</div>
      )}
    </Card>
  );
}

function LiveApprovalProgress({ node }: { node: ComponentNode }) {
  const ctx = React.useContext(RuntimeRenderCtx)!;
  const nodes = ctx.model.workflow?.nodes ?? [];
  if (nodes.length === 0) {
    return <div className="py-3 text-center text-[11px] text-stone-400">模型未声明流程节点</div>;
  }
  // 最近一个实例的真实位置（进行中优先，其次最新）
  const instances = ctx.state.instances;
  const inst = [...instances].reverse().find((i) => i.status === "running") ?? instances.at(-1);
  const currentIdx = inst ? Math.max(0, nodes.findIndex((n) => n.id === inst.currentNodeId)) : 0;
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-stone-500">
        {String(node.props.title ?? "审批进度")}
        {inst ? (
          <span className="font-normal text-stone-400">
            {inst.title} ·{" "}
            {inst.status === "running" ? "进行中" : inst.status === "completed" ? "已完成" : "已驳回"}
          </span>
        ) : (
          <span className="font-normal text-stone-400">暂无实例 — 发起审批后点亮</span>
        )}
      </div>
      <Steps
        size="small"
        current={inst?.status === "completed" ? nodes.length - 1 : currentIdx}
        status={inst?.status === "rejected" ? "error" : undefined}
        items={nodes.slice(0, 6).map((n) => ({ title: n.name || n.id }))}
      />
    </div>
  );
}

// --- 递归渲染 ---------------------------------------------------------------

const CONTAINER_BG: Record<string, string> = {
  none: "",
  white: "bg-white shadow-sm rounded",
  gray: "bg-stone-100 rounded",
};

function RenderNode({ node }: { node: ComponentNode }): React.ReactNode {
  const ctx = React.useContext(RuntimeRenderCtx)!;
  if (node.hidden) return null;
  const def = getComponentDefinition(node.type);
  const p = node.props;
  const children = node.children ?? [];
  const gap = Number(p.gap ?? 12);

  switch (node.type) {
    case "container":
      return (
        <div
          className={CONTAINER_BG[String(p.background ?? "none")] ?? ""}
          style={{ display: "flex", flexDirection: "column", gap, padding: Number(p.padding ?? 0) || undefined }}
        >
          {children.map((c) => (
            <RenderNode key={c.id} node={c} />
          ))}
        </div>
      );
    case "columns":
      return (
        <div style={{ display: "flex", gap, alignItems: "stretch" }}>
          {children.map((c) => (
            <div key={c.id} style={{ flex: 1, minWidth: 0 }}>
              <RenderNode node={c} />
            </div>
          ))}
        </div>
      );
    case "group":
      return (
        <Card size="small" title={String(p.title ?? "分组")} variant={p.bordered === false ? "borderless" : "outlined"}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {children.map((c) => (
              <RenderNode key={c.id} node={c} />
            ))}
          </div>
        </Card>
      );
    case "tabs": {
      const titles = String(p.titles ?? "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      if (children.length === 0) return null;
      return (
        <Tabs
          size="small"
          items={children.map((c, i) => ({
            key: c.id,
            label: titles[i] || `页签 ${i + 1}`,
            children: <RenderNode node={c} />,
          }))}
        />
      );
    }
    case "text": {
      const variant = String(p.variant ?? "body");
      const cls =
        variant === "title"
          ? "text-lg font-semibold text-stone-800"
          : variant === "subtitle"
          ? "text-sm font-medium text-stone-700"
          : variant === "caption"
          ? "text-xs text-stone-400"
          : "text-sm text-stone-600";
      return <div className={cls}>{String(p.content ?? "")}</div>;
    }
    case "image": {
      const src = String(p.src ?? "");
      const height = Number(p.height ?? 160);
      return src ? (
        <img src={src} alt={String(p.alt ?? "")} style={{ height }} className="w-full rounded object-cover" />
      ) : (
        <div className="flex w-full items-center justify-center rounded bg-stone-100 text-stone-300" style={{ height }}>
          <PictureOutlined className="text-2xl" />
        </div>
      );
    }
    case "button":
      return (
        <div>
          <AntButton
            type={(p.buttonType as "primary" | "default" | "dashed" | "link") ?? "primary"}
            size="small"
            onClick={() => runAction(ctx, p)}
            data-testid={`live-button-${node.id}`}
          >
            {String(p.label ?? "按钮")}
          </AntButton>
        </div>
      );
    case "link-block":
      return (
        <button
          type="button"
          onClick={() => runAction(ctx, p)}
          data-testid={`live-linkblock-${node.id}`}
          className="flex w-full items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-blue-300"
        >
          <span>
            <span className="block text-sm font-medium text-stone-800">{String(p.title ?? "链接块")}</span>
            <span className="block text-[11px] text-stone-400">{String(p.desc ?? "")}</span>
          </span>
          <span className="text-stone-300">→</span>
        </button>
      );
    case "divider":
      return (
        <AntDivider plain style={{ margin: "4px 0" }}>
          {String(p.label ?? "") || undefined}
        </AntDivider>
      );
    case "input":
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <Input size="small" placeholder={String(p.placeholder ?? "")} />
        </div>
      );
    case "textarea":
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <Input.TextArea rows={Number(p.rows ?? 3)} placeholder={String(p.placeholder ?? "")} />
        </div>
      );
    case "select": {
      const opts = String(p.options ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <select className="w-full rounded border border-stone-300 px-2 py-1 text-sm text-stone-700">
            {opts.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </div>
      );
    }
    case "date-picker":
      return (
        <div>
          <div className="mb-1 text-[11px] text-stone-500">{String(p.label ?? "")}</div>
          <Input size="small" type="date" />
        </div>
      );
    case "data-table":
      return <LiveDataTable node={node} />;
    case "data-form":
      return <LiveDataForm node={node} />;
    case "chart":
      return <LiveChart node={node} />;
    case "approval-progress":
      return <LiveApprovalProgress node={node} />;
    default:
      return (
        <div className="rounded bg-red-50 px-2 py-1 text-[10px] text-red-500">
          未注册组件类型 {def?.name ?? node.type}
        </div>
      );
  }
}

export function RuntimePageRenderer({
  tree,
  ctx,
}: {
  tree: ComponentNode;
  ctx: RuntimeRenderCtxValue;
}) {
  return (
    <RuntimeRenderCtx.Provider value={ctx}>
      <div data-testid="runtime-designed-page">
        <RenderNode node={tree} />
      </div>
    </RuntimeRenderCtx.Provider>
  );
}

export default RuntimePageRenderer;
