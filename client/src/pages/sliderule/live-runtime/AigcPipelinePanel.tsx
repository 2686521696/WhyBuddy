/**
 * AigcPipelinePanel — AIGC 屏的「能力编排」视图（编排一期）。
 *
 * 模型声明的线性管线（aigc.pipelines）可视化 + 链路试跑：
 * - 步骤链卡片：能力名 + 衔接字段标注（上一步 outputField ⭢ 下一步输入），
 *   衔接字段与门禁 handoff 校验同一规则，图上如实标注；
 * - 首步输入表单（衔接字段之外的输入才需要人填，衔接字段标「由上一步注入」）；
 * - 链路试跑：POST /api/sliderule/aigc-pipeline-tryrun（复用五系统生成同一
 *   LLM 通道），fail-fast，逐步展示产出/失败诊断——诚实边界与单步试跑一致。
 */

import React from "react";
import {
  type AigcCapability,
  type AigcPipeline,
  type FiveSystemModel,
  resolveFieldRef,
} from "../system-screens/five-system-model";

interface StepResult {
  id?: string;
  name?: string;
  ok: boolean;
  output?: string;
  code?: string;
  detail?: string;
  elapsedMs?: number;
}

interface PipelineRunResult {
  ok: boolean;
  code?: string;
  detail?: string;
  steps: StepResult[];
}

export function AigcPipelinePanel({
  model,
  goal,
}: {
  model: FiveSystemModel;
  goal?: string;
}) {
  const pipelines = model.aigc?.pipelines ?? [];
  const capById = React.useMemo(() => {
    const map = new Map<string, AigcCapability>();
    for (const cap of model.aigc?.capabilities ?? []) {
      if (cap.id) map.set(cap.id, cap);
    }
    return map;
  }, [model.aigc?.capabilities]);

  const [activeIdx, setActiveIdx] = React.useState(0);
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<PipelineRunResult | null>(null);

  const pipeline: AigcPipeline | null = pipelines[activeIdx] ?? pipelines[0] ?? null;
  const steps = React.useMemo(
    () =>
      (pipeline?.steps ?? [])
        .map((id) => capById.get(id))
        .filter((c): c is AigcCapability => Boolean(c)),
    [pipeline, capById]
  );

  // 衔接字段集合：这些输入由上一步注入，不需要人填
  const handoffRefs = React.useMemo(() => {
    const refs = new Set<string>();
    for (const cap of steps.slice(0, -1)) {
      if (cap.outputField) refs.add(cap.outputField);
    }
    return refs;
  }, [steps]);

  const firstStepManualInputs = (steps[0]?.inputFields ?? []).filter(
    (ref) => !handoffRefs.has(ref)
  );

  const run = async () => {
    if (!pipeline || steps.length < 2 || running) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/sliderule/aigc-pipeline-tryrun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipeline: { id: pipeline.id, name: pipeline.name },
          steps: steps.map((c) => ({
            id: c.id,
            name: c.name,
            inputFields: c.inputFields,
            outputField: c.outputField,
          })),
          inputs,
          goal,
        }),
      });
      if (!res.ok) {
        setResult({ ok: false, code: `HTTP_${res.status}`, detail: await res.text(), steps: [] });
      } else {
        setResult((await res.json()) as PipelineRunResult);
      }
    } catch (e) {
      setResult({ ok: false, code: "NETWORK_ERROR", detail: String(e), steps: [] });
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

      {/* 步骤链：能力卡 + 衔接字段标注 */}
      <div className="flex flex-wrap items-stretch gap-2" data-testid="aigc-pipeline-chain">
        {steps.map((cap, i) => (
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
            <div className="min-w-[150px] flex-1 rounded-md border border-[#E7E2D9] bg-white p-2.5">
              <div className="text-[11px] font-semibold text-stone-700">
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
        ))}
      </div>

      {/* 首步输入 + 试跑 */}
      <div className="rounded-md border border-[#E7E2D9] bg-[#FBF9F4] p-3">
        <div className="text-[11px] font-semibold text-stone-600">链路试跑</div>
        {firstStepManualInputs.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {firstStepManualInputs.map((ref) => {
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
          disabled={running || steps.length < 2}
          onClick={run}
          className="mt-2 rounded-full bg-pink-500 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-pink-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? "链路运行中…（逐步真跑 LLM）" : `试跑整条链（${steps.length} 步）`}
        </button>
      </div>

      {/* 结果：逐步产出 / fail-fast 诊断 */}
      {result && (
        <div className="space-y-2" data-testid="aigc-pipeline-result">
          {result.code && (
            <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[10px] text-red-600">
              <span className="font-mono font-semibold">{result.code}</span>
              <span className="ml-1.5">{result.detail}</span>
            </div>
          )}
          {result.steps.map((s, i) => (
            <div
              key={s.id || i}
              className={`rounded-md border p-2.5 ${
                s.ok ? "border-[#E7E2D9] bg-white" : "border-red-200 bg-red-50/60"
              }`}
            >
              <div className="flex items-center gap-2 text-[10px]">
                <span className={s.ok ? "text-emerald-600" : "text-red-600"}>
                  {s.ok ? "✓" : "✗"}
                </span>
                <span className="font-semibold text-stone-700">
                  {i + 1}. {s.name || s.id}
                </span>
                {typeof s.elapsedMs === "number" && (
                  <span className="text-stone-300">{(s.elapsedMs / 1000).toFixed(1)}s</span>
                )}
              </div>
              {s.ok ? (
                <div className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-stone-600">
                  {s.output}
                </div>
              ) : (
                <div className="mt-1 text-[10px] text-red-600">
                  <span className="font-mono font-semibold">{s.code}</span>
                  <span className="ml-1.5">{s.detail}</span>
                </div>
              )}
            </div>
          ))}
          {!result.ok && result.steps.length > 0 && result.steps.length < (steps.length || 0) && (
            <div className="text-[10px] text-stone-400">
              链路在第 {result.steps.length} 步中断（fail-fast：下游缺上游产物，不伪造后续步骤）
            </div>
          )}
        </div>
      )}
    </div>
  );
}
