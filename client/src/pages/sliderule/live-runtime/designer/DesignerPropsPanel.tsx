/**
 * DesignerPropsPanel — 设计器二期右栏：propsSchema 驱动的属性面板。
 *
 * 对标 zip web-designer 的 PropertyPanel 范式：选中什么组件，
 * 面板就按该组件定义的 propsSchema 逐条渲染控件——注册表是唯一事实源，
 * 新组件加进注册表即自动获得属性面板，无需改这里。
 *
 * 数据感知控件（entitySelect/fieldIdMultiSelect/fieldRefSelect/metricSelect/
 * pageSelect）的选项全部来自五系统模型——结构上选不出悬挂引用。
 */

import React from "react";
import { Input, InputNumber, Select, Switch } from "antd";
import type { FiveSystemModel } from "../../system-screens/five-system-model";
import type { ComponentNode, PropertySchema, TreeIssue } from "./component-schema";
import { getComponentDefinition } from "./component-registry";

interface DesignerPropsPanelProps {
  node: ComponentNode;
  model: FiveSystemModel;
  issues: TreeIssue[];
  onPatchProps: (patch: Record<string, unknown>) => void;
  onRename: (name: string) => void;
  onToggle: (patch: { hidden?: boolean; locked?: boolean }) => void;
}

function PropControl({
  schema,
  node,
  model,
  onPatchProps,
}: {
  schema: PropertySchema;
  node: ComponentNode;
  model: FiveSystemModel;
  onPatchProps: (patch: Record<string, unknown>) => void;
}) {
  const value = node.props[schema.key] ?? schema.defaultValue;
  const set = (v: unknown) => onPatchProps({ [schema.key]: v });
  const entities = model.datamodel?.entities ?? [];

  switch (schema.type) {
    case "string":
      return (
        <Input
          size="small"
          value={(value as string) ?? ""}
          placeholder={schema.placeholder}
          onChange={(e) => set(e.target.value)}
        />
      );
    case "text":
      return (
        <Input.TextArea
          size="small"
          value={(value as string) ?? ""}
          placeholder={schema.placeholder}
          autoSize={{ minRows: 2, maxRows: 6 }}
          onChange={(e) => set(e.target.value)}
        />
      );
    case "number":
      return (
        <InputNumber
          size="small"
          style={{ width: "100%" }}
          value={value as number | undefined}
          min={schema.min}
          max={schema.max}
          onChange={(v) => set(v ?? schema.defaultValue ?? 0)}
        />
      );
    case "boolean":
      return <Switch size="small" checked={Boolean(value)} onChange={(v) => set(v)} />;
    case "select":
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={(value as string) ?? undefined}
          options={schema.options ?? []}
          onChange={(v) => set(v)}
        />
      );
    case "entitySelect":
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={(value as string) || undefined}
          placeholder="选择实体"
          options={entities.map((e) => ({ value: e.id, label: e.name || e.id }))}
          onChange={(v) => set(v)}
        />
      );
    case "fieldIdMultiSelect": {
      const entityId = String(node.props[schema.entityKey ?? "entityId"] ?? "");
      const entity = entities.find((e) => e.id === entityId);
      return (
        <Select
          size="small"
          mode="multiple"
          style={{ width: "100%" }}
          value={(value as string[]) ?? []}
          placeholder={entity ? "选择字段" : "先选实体"}
          disabled={!entity}
          options={(entity?.fields ?? []).map((f) => ({ value: f.id, label: f.name || f.id }))}
          onChange={(v) => set(v)}
        />
      );
    }
    case "fieldRefSelect":
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={(value as string) || undefined}
          placeholder="选择字段（实体.字段）"
          showSearch
          optionFilterProp="label"
          options={entities.flatMap((e) =>
            (e.fields ?? []).map((f) => ({
              value: `${e.id}.${f.id}`,
              label: `${e.name || e.id}.${f.name || f.id}`,
            }))
          )}
          onChange={(v) => set(v)}
        />
      );
    case "metricSelect": {
      const numeric = entities.flatMap((e) =>
        (e.fields ?? [])
          .filter((f) => f.type === "number")
          .map((f) => ({
            value: `sum:${e.id}.${f.id}`,
            label: `求和 · ${e.name || e.id}.${f.name || f.id}`,
          }))
      );
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={(value as string) || "count"}
          options={[{ value: "count", label: "计数（行数）" }, ...numeric]}
          onChange={(v) => set(v)}
        />
      );
    }
    case "pageSelect":
      return (
        <Select
          size="small"
          style={{ width: "100%" }}
          value={(value as string) || undefined}
          placeholder="选择页面"
          options={(model.page?.pages ?? []).map((p, i) => ({
            value: p.id || `page-${i + 1}`,
            label: p.name || p.id || `页面 ${i + 1}`,
          }))}
          onChange={(v) => set(v)}
        />
      );
    default:
      return null;
  }
}

export function DesignerPropsPanel({
  node,
  model,
  issues,
  onPatchProps,
  onRename,
  onToggle,
}: DesignerPropsPanelProps) {
  const def = getComponentDefinition(node.type);
  if (!def) {
    return (
      <div className="p-3 text-[11px] text-red-500">组件类型「{node.type}」未注册</div>
    );
  }
  // showWhen 条件显示：所列键与当前 props 全部相等才出现
  const visibleSchemas = def.propsSchema.filter((s) => {
    if (!s.showWhen) return true;
    return Object.entries(s.showWhen).every(
      ([k, v]) => (node.props[k] ?? undefined) === v
    );
  });
  const nodeIssues = issues.filter((i) => i.nodeId === node.id);

  return (
    <div className="flex h-full flex-col" data-testid="designer-props-panel">
      <div className="border-b border-stone-200 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-600 ring-1 ring-blue-200">
            {def.name}
          </span>
          <span className="font-mono text-[9px] text-stone-400">{node.id.slice(0, 18)}</span>
        </div>
        <Input
          size="small"
          className="mt-1.5"
          value={node.name ?? ""}
          placeholder={def.name}
          onChange={(e) => onRename(e.target.value)}
          addonBefore={<span className="text-[10px]">名称</span>}
          data-testid="designer-node-name"
        />
      </div>

      {nodeIssues.length > 0 && (
        <div className="border-b border-red-100 bg-red-50 px-3 py-1.5">
          {nodeIssues.map((i, k) => (
            <div key={k} className="text-[10px] text-red-600">
              ✗ {i.message}
            </div>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto px-3 py-2.5">
        {visibleSchemas.length === 0 && (
          <div className="text-[11px] text-stone-400">该组件无可配置属性</div>
        )}
        {visibleSchemas.map((s) => (
          <div key={s.key}>
            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-stone-500">
              {s.label}
              {s.tooltip && (
                <span className="text-[9px] font-normal text-stone-400" title={s.tooltip}>
                  ⓘ
                </span>
              )}
            </div>
            <PropControl schema={s} node={node} model={model} onPatchProps={onPatchProps} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-stone-200 px-3 py-2 text-[11px] text-stone-500">
        <label className="flex items-center gap-1.5">
          <Switch
            size="small"
            checked={Boolean(node.hidden)}
            onChange={(v) => onToggle({ hidden: v })}
          />
          隐藏
        </label>
        <label className="flex items-center gap-1.5">
          <Switch
            size="small"
            checked={Boolean(node.locked)}
            onChange={(v) => onToggle({ locked: v })}
          />
          锁定
        </label>
      </div>
    </div>
  );
}

export default DesignerPropsPanel;
