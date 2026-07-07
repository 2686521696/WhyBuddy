/**
 * WorkflowRuntimePanel — 工作流「试运行」面（浏览器运行时 M0）。
 *
 * 像 ECharts 渲染图表一样，把模型 workflow 段渲染成一个可操作的审批流：
 * 发起实例 → 按当前节点的 assigneeRole 通过/驳回 → 分支时选择走向 → 终态 + 全程日志。
 * 状态零后端：内存 + localStorage（按 sessionId 隔离），模型换话题自动重建。
 */

import React from "react";
import type { FiveSystemModel } from "../system-screens/five-system-model";
import {
  type RuntimeState,
  type WorkflowInstance,
  initRuntimeState,
  startInstance,
  advanceInstance,
  outgoingTransitions,
  nodeById,
} from "./live-runtime";
import { loadRuntimeState, saveRuntimeState, notifyRuntimeChanged, subscribeRuntimeChanged } from "./runtime-persistence";

/** 持久化状态若引用了当前模型不存在的节点（换话题遗留），重建。 */
function compatibleWithModel(state: RuntimeState, model: FiveSystemModel): boolean {
  const nodeIds = new Set((model.workflow?.nodes ?? []).map((n) => n.id));
  return state.instances.every((i) => nodeIds.has(i.currentNodeId));
}

function StatusPill({ status }: { status: WorkflowInstance["status"] }) {
  const map = {
    running: "bg-[#F8E8E0] text-[#C4633F]",
    completed: "bg-emerald-50 text-emerald-700",
    rejected: "bg-red-50 text-red-600",
  } as const;
  const label = { running: "进行中", completed: "已完成", rejected: "已驳回" }[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status]}`}>{label}</span>;
}

export function WorkflowRuntimePanel({
  model,
  sessionId,
}: {
  model: FiveSystemModel;
  sessionId: string;
}) {
  const [state, setState] = React.useState<RuntimeState>(() => {
    const persisted = loadRuntimeState(sessionId);
    return persisted && compatibleWithModel(persisted, model)
      ? persisted
      : initRuntimeState(model);
  });
  const [branchChoice, setBranchChoice] = React.useState(0);

  // 与应用运行屏共享一份状态：对方（如页面表单提交发起实例）变更时重载
  React.useEffect(
    () =>
      subscribeRuntimeChanged(sessionId, () => {
        const persisted = loadRuntimeState(sessionId);
        if (persisted && compatibleWithModel(persisted, model)) setState(persisted);
      }),
    [sessionId, model]
  );

  const apply = (next: RuntimeState) => {
    setState(next);
    saveRuntimeState(sessionId, next);
    notifyRuntimeChanged(sessionId);
  };

  const latest = state.instances.at(-1) ?? null;
  const running = latest?.status === "running" ? latest : null;
  const currentNode = running ? nodeById(model, running.currentNodeId) : null;
  const branches = running ? outgoingTransitions(model, running.currentNodeId) : [];

  const handleStart = () => {
    const { state: next } = startInstance(
      state,
      model,
      `试运行实例 ${state.instances.length + 1}`,
      new Date().toISOString()
    );
    setBranchChoice(0);
    apply(next);
  };

  const handleAdvance = (action: "approve" | "reject") => {
    if (!running) return;
    const { state: next, error } = advanceInstance(
      state,
      model,
      running.id,
      action,
      new Date().toISOString(),
      { byRole: currentNode?.assigneeRole, viaTransitionIndex: branchChoice }
    );
    if (!error) {
      setBranchChoice(0);
      apply(next);
    }
  };

  const nodeName = (id: string) => nodeById(model, id)?.name || id;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4" data-testid="workflow-runtime-panel">
      {/* 当前实例操作区 */}
      {running && currentNode ? (
        <div className="rounded-xl border border-[#E7E2D9] bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-stone-800">{running.title}</span>
            <StatusPill status={running.status} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-stone-500">当前节点</span>
            <span className="rounded-lg bg-[#F5F1EA] px-2.5 py-1 font-medium text-stone-800">
              {currentNode.name || currentNode.id}
            </span>
            {currentNode.assigneeRole && (
              <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[11px] text-orange-700 ring-1 ring-orange-200">
                @{currentNode.assigneeRole}
              </span>
            )}
          </div>
          {branches.length > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-stone-500">通过后走向</span>
              {branches.map((b, i) => (
                <button
                  key={`${b.to}-${i}`}
                  type="button"
                  onClick={() => setBranchChoice(i)}
                  className={`rounded-full px-2.5 py-1 ring-1 transition-colors ${
                    branchChoice === i
                      ? "bg-[#F8E8E0] text-[#C4633F] ring-[#D97757]/40"
                      : "bg-white text-stone-600 ring-[#E7E2D9] hover:bg-[#F5F1EA]"
                  }`}
                >
                  {b.condition || nodeName(b.to)} → {nodeName(b.to)}
                </button>
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => handleAdvance("approve")}
              data-testid="runtime-approve"
              className="rounded-lg bg-[#D97757] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#C4633F]"
            >
              通过（{currentNode.assigneeRole || "当前角色"}）
            </button>
            <button
              type="button"
              onClick={() => handleAdvance("reject")}
              data-testid="runtime-reject"
              className="rounded-lg border border-[#E7E2D9] bg-white px-4 py-1.5 text-sm text-stone-600 transition-colors hover:bg-red-50 hover:text-red-600"
            >
              驳回
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-[#D8D1C4] bg-[#FAF9F5] p-5">
          <div className="text-sm text-stone-600">
            这是模型驱动的真实状态机：发起一个实例，按节点审批人逐步推进，走完整个业务闭环。
          </div>
          <button
            type="button"
            onClick={handleStart}
            data-testid="runtime-start"
            className="rounded-lg bg-[#D97757] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#C4633F]"
          >
            发起实例
          </button>
        </div>
      )}

      {/* 实例列表 + 日志 */}
      {state.instances.length > 0 && (
        <div className="rounded-xl border border-[#E7E2D9] bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-stone-500">
            实例与日志
          </div>
          <div className="mt-2 space-y-3">
            {[...state.instances].reverse().map((inst) => (
              <div key={inst.id}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-stone-700">{inst.title}</span>
                  <StatusPill status={inst.status} />
                </div>
                <ul className="mt-1 space-y-0.5 border-l border-[#EFEBE2] pl-3">
                  {inst.log.map((l, i) => (
                    <li key={i} className="text-[11px] leading-5 text-stone-500">
                      {l.action === "start" && `发起 · 停在「${nodeName(l.nodeId)}」`}
                      {l.action === "approve" && `「${nodeName(l.nodeId)}」通过${l.byRole ? ` · @${l.byRole}` : ""}`}
                      {l.action === "reject" && `「${nodeName(l.nodeId)}」驳回${l.byRole ? ` · @${l.byRole}` : ""} · 流程终止`}
                      {l.action === "complete" && "流程完成 ✓"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
