/**
 * PageDesignPanel — 页面设计器一期：右侧属性面板（对标用户 MIT 项目
 * web-designer 的属性面板范式：选中页面 → 右栏改属性 → 即改即渲染）。
 *
 * 一期编辑面：页面标题 / 表格列 / 表单字段 / 图表声明。字段与图表的
 * 选择器只提供当前主实体真实存在的字段——结构上不可能造出悬挂引用
 * （与门禁语义一致，防呆在源头）。改动写入本地设计覆盖层（不动推演
 * 产出的模型本体），面板顶部如实标注修改数并可一键重置。
 */

import React from "react";
import { Button, Checkbox, Input, Select, Card, Divider } from "antd";
import { DeleteOutlined, PlusOutlined, UndoOutlined } from "@ant-design/icons";
import type { PageChartSpec } from "../system-screens/five-system-model";
import type { AppFormFieldSchema, AppPageSchema } from "./app-runtime-schema";
import type { PageDesignOverride } from "./page-design-overrides";

const CHART_TYPES = [
  { value: "bar", label: "柱状 · 对比" },
  { value: "line", label: "折线 · 趋势" },
  { value: "pie", label: "饼图 · 占比" },
];

export function PageDesignPanel({
  page,
  entityId,
  entityFields,
  override,
  editCount,
  onChange,
  onResetAll,
}: {
  page: AppPageSchema;
  entityId: string;
  /** 主实体全部字段（选择器的合法域） */
  entityFields: AppFormFieldSchema[];
  override: PageDesignOverride;
  /** 全会话覆盖总数（如实标注） */
  editCount: number;
  onChange: (next: PageDesignOverride) => void;
  onResetAll: () => void;
}) {
  const currentColumns = override.columnFieldIds ?? page.columns.map((c) => c.id);
  const currentForm = override.formFieldIds ?? page.formFields.map((f) => f.id);
  const currentCharts: PageChartSpec[] =
    override.charts ??
    page.charts.map((c) => ({
      id: c.id,
      name: c.label,
      type: c.type,
      dimension: `${c.entityId}.${c.dimensionFieldId}`,
      metric: c.metric === "sum" && c.metricFieldId ? `sum:${c.entityId}.${c.metricFieldId}` : "count",
    }));

  const fieldOptions = entityFields.map((f) => ({
    value: `${entityId}.${f.id}`,
    label: f.label,
  }));
  const numberFieldOptions = entityFields
    .filter((f) => f.type === "number")
    .map((f) => ({ value: `sum:${entityId}.${f.id}`, label: `求和 · ${f.label}` }));

  const patchCharts = (charts: PageChartSpec[]) => onChange({ ...override, charts });

  return (
    <Card
      size="small"
      title={
        <span className="flex items-center gap-2">
          页面属性
          <span className="text-[10px] font-normal text-stone-400">设计模式</span>
        </span>
      }
      extra={
        <Button
          size="small"
          type="text"
          icon={<UndoOutlined />}
          onClick={onResetAll}
          title="清除本会话全部本地设计，回到推演原貌"
          data-testid="page-design-reset"
        >
          重置
        </Button>
      }
      style={{ width: 260, maxHeight: "100%", overflow: "auto" }}
      data-testid="page-design-panel"
    >
      {editCount > 0 && (
        <div
          className="mb-2 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 ring-1 ring-amber-200"
          data-testid="page-design-edit-count"
        >
          本地设计 · {editCount} 处修改（仅本浏览器，不改推演产出）
        </div>
      )}

      <div style={{ fontSize: 11, color: "#595959", marginBottom: 4 }}>页面标题</div>
      <Input
        size="small"
        value={override.title ?? page.title}
        onChange={(e) => onChange({ ...override, title: e.target.value })}
        data-testid="page-design-title"
      />

      <Divider style={{ margin: "12px 0 8px" }} />
      <div style={{ fontSize: 11, color: "#595959", marginBottom: 4 }}>
        表格列 <span style={{ color: "#bfbfbf" }}>（{currentColumns.length} 列）</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="page-design-columns">
        {entityFields.map((f) => (
          <Checkbox
            key={f.id}
            checked={currentColumns.includes(f.id)}
            onChange={(e) => {
              const next = e.target.checked
                ? [...currentColumns, f.id]
                : currentColumns.filter((id) => id !== f.id);
              onChange({ ...override, columnFieldIds: next });
            }}
            style={{ fontSize: 12 }}
          >
            <span style={{ fontSize: 12 }}>{f.label}</span>
          </Checkbox>
        ))}
      </div>

      <Divider style={{ margin: "12px 0 8px" }} />
      <div style={{ fontSize: 11, color: "#595959", marginBottom: 4 }}>
        表单字段 <span style={{ color: "#bfbfbf" }}>（新建/编辑弹窗）</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="page-design-form-fields">
        {entityFields.map((f) => (
          <Checkbox
            key={f.id}
            checked={currentForm.includes(f.id)}
            onChange={(e) => {
              const next = e.target.checked
                ? [...currentForm, f.id]
                : currentForm.filter((id) => id !== f.id);
              onChange({ ...override, formFieldIds: next });
            }}
          >
            <span style={{ fontSize: 12 }}>{f.label}</span>
          </Checkbox>
        ))}
      </div>

      <Divider style={{ margin: "12px 0 8px" }} />
      <div style={{ fontSize: 11, color: "#595959", marginBottom: 4 }}>
        图表 <span style={{ color: "#bfbfbf" }}>（声明式 · 只可选真实字段）</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="page-design-charts">
        {currentCharts.map((chart, i) => (
          <div key={chart.id || i} style={{ border: "1px solid #E7E2D9", borderRadius: 6, padding: 8 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <Input
                size="small"
                value={chart.name ?? ""}
                placeholder="图表名"
                onChange={(e) =>
                  patchCharts(currentCharts.map((c, j) => (j === i ? { ...c, name: e.target.value } : c)))
                }
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => patchCharts(currentCharts.filter((_, j) => j !== i))}
                title="删除图表"
              />
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <Select
                size="small"
                style={{ flex: 1 }}
                value={chart.type ?? "bar"}
                options={CHART_TYPES}
                onChange={(v) =>
                  patchCharts(currentCharts.map((c, j) => (j === i ? { ...c, type: v } : c)))
                }
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              <Select
                size="small"
                value={chart.dimension}
                placeholder="分组维度（字段）"
                options={fieldOptions}
                onChange={(v) =>
                  patchCharts(currentCharts.map((c, j) => (j === i ? { ...c, dimension: v } : c)))
                }
              />
              <Select
                size="small"
                value={chart.metric ?? "count"}
                options={[{ value: "count", label: "计数 · 行数" }, ...numberFieldOptions]}
                onChange={(v) =>
                  patchCharts(currentCharts.map((c, j) => (j === i ? { ...c, metric: v } : c)))
                }
              />
            </div>
          </div>
        ))}
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={fieldOptions.length === 0}
          onClick={() =>
            patchCharts([
              ...currentCharts,
              {
                id: `chart-local-${Date.now().toString(36)}`,
                name: "新图表",
                type: "bar",
                dimension: fieldOptions[0]?.value,
                metric: "count",
              },
            ])
          }
          data-testid="page-design-add-chart"
        >
          添加图表
        </Button>
      </div>
    </Card>
  );
}
