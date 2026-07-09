/**
 * AigcPipelinePanel — AIGC 屏的「能力编排」视图（编排二期）。
 *
 * 二期升级：链路试跑改走浏览器端图执行器（flow-executor，移植自用户 MIT
 * 项目的拓扑排序执行引擎）——管线经 derivePipelineFlow 投影成 FlowDefinition
 * （端口 = 数据模型字段 ref），逐节点真跑 /aigc-tryrun，步骤卡实时点亮
 * （running/success/failed/skipped），执行日志逐步展示。
 * 诚实边界不变：节点失败 fail-fast（重试 1 次后停），不伪造下游产物。
 * 定位（用户裁决）：编排由推演产出、只读 Flow 展示给用户看——不开放
 * 画布编辑；链卡+箭头+衔接字段就是流程图本体，SSR/测试下可验证。
 */

import React from "react";
import {
  type AigcPipeline,
  type FiveSystemModel,
  resolveFieldRef,
} from "../system-screens/five-system-model";
import { derivePipelineFlow, makeAigcNodeRunner } from "./flow-definition";
import { executeFlow, type FlowResult, type NodeRunStatus } from "./flow-executor";

const STATUS_RING: Record<NodeRunStatus, string> = {
  running: "border-pink-400 ring-2 ring-pink-100",
  success: "border-emerald-300 bg-emerald-50/40",
  failed: "border-red-300 bg-red-50/60",
  skipped: "border-[#E7E2D9] opacity-50",
};

export function AigcPipelinePanel({
  model,
  goal,
}: {
  model: FiveSystemModel;
  goal?: string;
}) {
  const pipelines = model.aigc?.pipelines ?? [];
  const capabilities = model.aigc?.capabilities ?? [];

  const [activeIdx, setActiveIdx] = React.useState(0);
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [statuses, setStatuses] = React.useState<Record<string, NodeRunStatus>>({});
  const [result, setResult] = React.useState<FlowResult | null>(null);

  const pipeline: AigcPipeline | null = pipelines[activeIdx] ?? pipelines[0] ?? null;
  const projection = React.useMemo(
    () => derivePipelineFlow(pipeline, capabilities),
    [pipeline, capabilities]
  );
  const steps = projection.flow.nodes.map((n) => projection.capByNodeId.get(n.node_id)!);
  const handoffRefs = new Set(projection.flow.edges.map((e) => e.source_port ?? ""));

  const run = async () => {
    if (projection.reason || running) return;
    setRunning(true);
    setResult(null);
    setStatuses({});
    try {
      const flow = { ...projection.flow, variables: { ...inputs } };
      const res = await executeFlow(flow, makeAigcNodeRunner(projection.capByNodeId, goal), {
        onNodeStatus: (nodeId, status) =>
          setStatuses((prev) => ({ ...prev, [nodeId]: status })),
      });
      setResult(res);
    } finally {
      setRunning(false);
    }
  };

  if (pipelines.length === 0) {
    return (
      <div
        className="flex h-full items-center justify-center px-6 text-center text-xs text-stone-400"
        data-testid="aigc-pipeline-empty"
      >
        本话题模型未声明能力编排——当两个能力经数据字段衔接（一个的输出是另一个的输入）时，
        推演会自动产出管线
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-4" data-testid="aigc-pipeline-panel">
      {/* 管线选择 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] text-stone-400">能力编排</span>
        {pipelines.map((p, i) => (
          <button
            key={p.id || i}
            type="button"
            data-testid={`aigc-pipeline-${p.id || i}`}
            onClick={() => {
              setActiveIdx(i);
              setInputs({});
              setResult(null);
              setStatuses({});
            }}
            className={`rounded-full px-2 py-0.5 text-[11px] ring-1 transition-colors ${
              i === activeIdx
                ? "bg-pink-50 text-pink-700 ring-pink-200"
                : "bg-white text-stone-500 ring-[#E7E2D9] hover:text-stone-700"
            }`}
          >
            {p.name || p.id || `管线 ${i + 1}`}
          </button>
        ))}
      </div>

      {/* 步骤链：能力卡（执行状态实时点亮）+ 衔接字段标注 */}
      <div className="flex flex-wrap items-stretch gap-2" data-testid="aigc-pipeline-chain">
        {steps.map((cap, i) => {
          const status = statuses[cap.id ?? ""];
          return (
            <React.Fragment key={cap.id || i}>
              {i > 0 && (
                <div className="flex flex-col items-center justify-center px-1">
                  <span className="text-stone-300">⭢</span>
                  <span
                    className="max-w-[120px] truncate font-mono text-[9px] text-stone-400"
                    title={`衔接字段：${steps[i - 1]?.outputField ?? ""}（上一步产出注入本步输入）`}
                  >
                    {steps[i - 1]?.outputField ?? ""}
                  </span>
                </div>
              )}
              <div
                className={`min-w-[150px] flex-1 rounded-md border bg-white p-2.5 transition-all ${
                  status ? STATUS_RING[status] : "border-[#E7E2D9]"
                }`}
                data-testid={`aigc-pipeline-node-${cap.id}`}
                data-status={status ?? "idle"}
              >
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-700">
                  {status === "running" && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pink-500" />
                  )}
                  {status === "success" && <span className="text-emerald-600">✓</span>}
                  {status === "failed" && <span className="text-red-600">✗</span>}
                  {i + 1}. {cap.name || cap.id}
                </div>
                <div className="mt-1 space-y-0.5">
                  {(cap.inputFields ?? []).map((ref) => {
                    const res = resolveFieldRef(ref, model);
                    const isHandoff = handoffRefs.has(ref);
                    return (
                      <div key={ref} className="flex items-center gap-1 text-[9px]">
                        <span className={res.resolved ? "text-stone-400" : "text-red-500"}>
                          ← {res.resolved ? res.label : `✗ ${ref}`}
                        </span>
                        {isHandoff && (
                          <span className="rounded bg-pink-50 px-1 text-[8px] text-pink-500">
                            由上一步注入
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {cap.outputField && (
                    <div className="text-[9px] text-stone-500">
                      → {resolveFieldRef(cap.outputField, model).label || cap.outputField}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* 手工输入 + 试跑（图执行器：拓扑序逐节点真跑，状态实时点亮） */}
      <div className="rounded-md border border-[#E7E2D9] bg-[#FBF9F4] p-3">
        <div className="text-[11px] font-semibold text-stone-600">链路试跑</div>
        {projection.manualInputRefs.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {projection.manualInputRefs.map((ref) => {
              const res = resolveFieldRef(ref, model);
              return (
                <div key={ref} className="flex items-center gap-2">
                  <span className="w-40 shrink-0 truncate text-[10px] text-stone-500" title={ref}>
                    {res.resolved ? res.label : ref}
                  </span>
                  <input
                    value={inputs[ref] ?? ""}
                    onChange={(e) => setInputs((prev) => ({ ...prev, [ref]: e.target.value }))}
                    placeholder="输入值"
                    className="min-w-0 flex-1 rounded border border-[#E7E2D9] bg-white px-2 py-1 text-[11px] outline-none focus:border-pink-300"
                  />
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          data-testid="aigc-pipeline-run"
          disabled={running || projection.reason !== null}
          onClick={run}
          className="mt-2 rounded-full bg-pink-500 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
          title={projection.reason ?? undefined}
        >
          {running ? "链路运行中…（逐节点真跑 LLM）" : `试跑整条链（${steps.length} 步）`}
        </button>
      </div>

      {/* 执行日志：逐节点产出 / fail-fast 诊断 */}
      {result && (
        <div className="space-y-2" data-testid="aigc-pipeline-result">
          {result.error && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-600">
              {result.error}
            </div>
          )}
          {result.logs.map((log, i) => {
            const cap = projection.capByNodeId.get(log.node_id);
            const output = log.outputs?.[cap?.outputField || "output"];
            return (
              <div
                key={log.node_id || i}
                className={`rounded-md border p-2.5 ${
                  log.status === "success"
                    ? "border-[#E7E2D9] bg-white"
                    : log.status === "skipped"
                    ? "border-[#E7E2D9] bg-white opacity-50"
                    : "border-red-200 bg-red-50/60"
                }`}
              >
                <div className="flex items-center gap-2 text-[10px]">
                  <span
                    className={
                      log.status === "success"
                        ? "text-emerald-600"
                        : log.status === "skipped"
                        ? "text-stone-400"
                        : "text-red-600"
                    }
                  >
                    {log.status === "success" ? "✓" : log.status === "skipped" ? "⊘" : "✗"}
                  </span>
                  <span className="font-semibold text-stone-700">
                    {i + 1}. {cap?.name || log.node_id}
                  </span>
                  {typeof log.duration_ms === "number" && (
                    <span className="text-stone-300">{(log.duration_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
                {log.status === "success" && (
                  <div className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-stone-600">
                    {String(output ?? "")}
                  </div>
                )}
                {log.status === "failed" && (
                  <div className="mt-1 text-[10px] text-red-600">{log.error}</div>
                )}
              </div>
            );
          })}
          {result.status === "failed" && result.logs.length > 0 && (
            <div className="text-[10px] text-stone-400">
              链路中断（fail-fast：下游缺上游产物，不伪造后续节点；失败节点已重试 1 次）
            </div>
          )}
        </div>
      )}
    </div>
  );
}
