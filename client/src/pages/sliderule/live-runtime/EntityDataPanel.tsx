/**
 * EntityDataPanel — DataModel 屏的「数据表」视图（浏览器运行时 M2）。
 *
 * 实体行的直接编辑面：按实体切页，单元格即改即存（onBlur/Enter 提交，
 * number 字段经 validateRowValues 校验，非法值不落库并如实提示）。
 * 与「运行应用」「工作流试运行」共享同一份 localStorage 运行时状态——
 * 这里改一格，运行应用的表格实时变。零后端、零数据库。
 */

import React from "react";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import {
  type RuntimeState,
  initRuntimeState,
  addRow,
  updateRow,
  deleteRow,
  validateRowValues,
} from "./live-runtime";
import {
  loadRuntimeState,
  saveRuntimeState,
  notifyRuntimeChanged,
  subscribeRuntimeChanged,
} from "./runtime-persistence";

function EditableCell({
  value,
  onCommit,
}: {
  value: unknown;
  onCommit: (raw: string) => void;
}) {
  const text = value === undefined || value === null ? "" : String(value);
  return (
    <input
      className="w-full min-w-16 rounded border border-transparent bg-transparent px-1.5 py-1 text-xs text-stone-700 transition-colors hover:border-[#E7E2D9] focus:border-blue-300 focus:bg-white focus:outline-none"
      defaultValue={text}
      onBlur={(e) => {
        if (e.target.value !== text) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function EntityDataPanel({
  model,
  sessionId,
}: {
  model: FiveSystemModel;
  sessionId: string;
}) {
  const entities = model.datamodel?.entities ?? [];
  const [state, setState] = React.useState<RuntimeState>(
    () => loadRuntimeState(sessionId) ?? initRuntimeState(model)
  );
  const [activeEntityId, setActiveEntityId] = React.useState<string | null>(
    entities[0]?.id ?? null
  );
  const [problem, setProblem] = React.useState<string | null>(null);

  // 运行应用/工作流侧变更时重载（同一份状态）
  React.useEffect(
    () =>
      subscribeRuntimeChanged(sessionId, () =>
        setState(loadRuntimeState(sessionId) ?? initRuntimeState(model))
      ),
    [sessionId, model]
  );

  const apply = (next: RuntimeState) => {
    setState(next);
    saveRuntimeState(sessionId, next);
    notifyRuntimeChanged(sessionId);
  };

  const entity = entities.find((e) => e.id === activeEntityId) ?? entities[0] ?? null;
  const fields = entity?.fields ?? [];
  const rows = entity ? state.entities[entity.id] ?? [] : [];

  const commitCell = (rowId: string, fieldId: string, raw: string) => {
    if (!entity) return;
    const row = rows.find((r) => r.id === rowId);
    const merged = { ...(row?.values ?? {}), [fieldId]: raw };
    const problems = validateRowValues(model, entity.id, merged);
    if (problems.length > 0) {
      // fail-closed：非法值不落库，如实提示（输入框失焦后仍显示旧值）
      setProblem(problems.join("；"));
      return;
    }
    setProblem(null);
    apply(updateRow(state, entity.id, rowId, { [fieldId]: raw }));
  };

  if (entities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-stone-400">
        本话题模型缺少实体定义，推演闭环后可编辑数据
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4" data-testid="datamodel-data-panel">
      <div className="rounded bg-blue-50 px-3 py-2 text-[11px] text-blue-700 ring-1 ring-blue-200">
        单元格即改即存 —— 与「运行应用」「工作流试运行」共享同一份运行时数据
      </div>

      {/* 实体切页 */}
      <div className="flex flex-wrap gap-1.5">
        {entities.map((e) => (
          <button
            key={e.id}
            type="button"
            data-testid={`datamodel-entity-${e.id}`}
            onClick={() => setActiveEntityId(e.id)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition-colors ${
              e.id === entity?.id
                ? "bg-blue-500 text-white ring-blue-500"
                : "bg-white text-stone-600 ring-[#E7E2D9] hover:bg-blue-50"
            }`}
          >
            {e.name || e.id}
            <span className={e.id === entity?.id ? "ml-1 opacity-80" : "ml-1 text-stone-400"}>
              {(state.entities[e.id] ?? []).length}
            </span>
          </button>
        ))}
      </div>

      {problem && (
        <div className="rounded bg-red-50 px-3 py-2 text-[11px] text-red-600 ring-1 ring-red-200">
          未保存：{problem}
        </div>
      )}

      <div className="overflow-hidden rounded-md border border-[#E7E2D9]">
        <table className="w-full text-xs">
          <thead className="bg-[#F5F1EA]">
            <tr>
              {fields.map((f) => (
                <th key={f.id} className="px-2 py-2 text-left font-semibold text-stone-600">
                  {f.name || f.id}
                  <span className="ml-1 font-normal text-stone-400">{f.type}</span>
                </th>
              ))}
              <th className="w-14 px-2 py-2 text-left font-semibold text-stone-600">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EFEBE2] bg-white">
            {rows.map((row) => (
              <tr key={row.id}>
                {fields.map((f) => (
                  <td key={f.id} className="px-1 py-0.5">
                    <EditableCell
                      value={row.values[f.id]}
                      onCommit={(raw) => commitCell(row.id, f.id, raw)}
                    />
                  </td>
                ))}
                <td className="px-2 py-0.5">
                  <button
                    type="button"
                    className="text-[11px] text-red-400 hover:text-red-600"
                    onClick={() => entity && apply(deleteRow(state, entity.id, row.id))}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={fields.length + 1} className="px-3 py-6 text-center text-stone-300">
                  暂无数据 — 点下方「新增一行」或到运行应用里「新建」
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div>
        <button
          type="button"
          data-testid="datamodel-add-row"
          onClick={() => {
            if (!entity) return;
            apply(addRow(state, entity.id, {}, new Date().toISOString()).state);
          }}
          className="rounded-full bg-blue-500 px-3 py-1 text-[11px] font-medium text-white hover:bg-blue-600"
        >
          ＋ 新增一行
        </button>
      </div>
    </div>
  );
}
