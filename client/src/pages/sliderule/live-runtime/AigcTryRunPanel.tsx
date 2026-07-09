/**
 * AigcTryRunPanel — AIGC 屏的「能力试跑」视图（浏览器运行时 M2）。
 *
 * 选一项模型里声明的 AI 能力，按 inputFields 填输入值，真调一次 LLM
 * （POST /api/sliderule/aigc-tryrun，复用五系统生成同一通道）。
 * 诚实边界与生成路径一致：flag 关/失败 → 结构化诊断如实展示，不伪造输出。
 */

import React from "react";
import {
  type FiveSystemModel,
  resolveFieldRef,
} from "../system-screens/five-system-model";

interface TryRunResult {
  ok: boolean;
  output?: string;
  code?: string;
  detail?: string;
  elapsedMs?: number;
}

export function AigcTryRunPanel({
  model,
  goal,
}: {
  model: FiveSystemModel;
  goal?: string;
}) {
  const capabilities = model.aigc?.capabilities ?? [];
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [inputs, setInputs] = React.useState<Record<string, string>>({});
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<TryRunResult | null>(null);

  const cap = capabilities[activeIdx] ?? capabilities[0] ?? null;

  const selectCap = (idx: number) => {
    setActiveIdx(idx);
    setInputs({});
    setResult(null);
  };

  const run = async () => {
    if (!cap || running) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/sliderule/aigc-tryrun", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capability: {
            id: cap.id,
            name: cap.name,
            inputFields: cap.inputFields,
            outputField: cap.outputField,
          },
          inputs,
          goal,
        }),
      });
      if (!res.ok) {
        setResult({
          ok: false,
          code: `HTTP_${res.status}`,
          detail: await res.text(),
        });
      } else {
        setResult((await res.json()) as TryRunResult);
      }
    } catch (e) {
      setResult({ ok: false, code: "NETWORK_ERROR", detail: String(e) });
    } finally {
      setRunning(false);
    }
  };

  if (capabilities.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-stone-400">
        本话题模型未声明 AI 能力，推演闭环后可试跑
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col gap-3 overflow-auto p-4"
      data-testid="aigc-tryrun-panel"
    >
      <div className="rounded bg-pink-50 px-3 py-2 text-[11px] text-pink-700 ring-1 ring-pink-200">
        真跑一次：走与五系统生成同一条 LLM 通道，输出/失败均如实展示
      </div>

      {/* 能力切页 */}
      <div className="flex flex-wrap gap-1.5">
        {capabilities.map((c, i) => (
          <button
            key={c.id || c.name || i}
            type="button"
            data-testid={`aigc-tryrun-cap-${c.id || i}`}
            onClick={() => selectCap(i)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 transition-colors ${
              i === activeIdx
                ? "bg-pink-500 text-white ring-pink-500"
                : "bg-white text-stone-600 ring-[#e5e7eb] hover:bg-pink-50"
            }`}
          >
            {c.name || c.id}
          </button>
        ))}
      </div>

      {cap && (
        <div className="rounded-md border border-[#e5e7eb] bg-white p-3">
          <div className="text-[11px] font-semibold text-stone-600">
            输入字段
          </div>
          <div className="mt-2 flex flex-col gap-2">
            {(cap.inputFields ?? []).map(ref => {
              const res = resolveFieldRef(ref, model);
              return (
                <label
                  key={ref}
                  className="flex items-center gap-2 text-[11px]"
                >
                  <span
                    className={`w-36 shrink-0 truncate ${res.resolved ? "text-stone-500" : "text-red-500"}`}
                    title={ref}
                  >
                    {res.resolved ? res.label : `✗ ${res.label}`}
                  </span>
                  <input
                    className="flex-1 rounded border border-[#e5e7eb] px-2 py-1 text-xs focus:border-pink-300 focus:outline-none"
                    value={inputs[ref] ?? ""}
                    placeholder="填一个试跑值"
                    onChange={e =>
                      setInputs(prev => ({ ...prev, [ref]: e.target.value }))
                    }
                  />
                </label>
              );
            })}
            {(cap.inputFields ?? []).length === 0 && (
              <span className="text-[10px] text-stone-300">
                该能力未声明输入字段
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              data-testid="aigc-tryrun-run"
              onClick={run}
              disabled={running}
              className={`rounded-full px-3 py-1 text-[11px] font-medium text-white transition-colors ${
                running ? "bg-stone-300" : "bg-pink-500 hover:bg-pink-600"
              }`}
            >
              {running ? "LLM 生成中…" : "▶ 试跑"}
            </button>
            {cap.outputField && (
              <span className="text-[10px] text-stone-400">
                输出 → {resolveFieldRef(cap.outputField, model).label}
              </span>
            )}
            {result?.elapsedMs !== undefined && (
              <span className="ml-auto font-mono text-[10px] text-stone-400">
                {(result.elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </div>
      )}

      {running && (
        <div className="rounded-md bg-[#2A2620] px-3 py-2 font-mono text-[10px] text-stone-400">
          ▍等待 LLM 返回……（同一通道，真实调用）
        </div>
      )}
      {result && result.ok && (
        <div
          className="rounded-md bg-[#2A2620] px-3 py-2.5 font-mono text-[11px] leading-5 text-emerald-200 whitespace-pre-wrap"
          data-testid="aigc-tryrun-output"
        >
          {result.output}
        </div>
      )}
      {result && !result.ok && (
        <div
          className="rounded-md border border-red-200 bg-red-50/60 px-3 py-2 text-[11px] text-red-600"
          data-testid="aigc-tryrun-error"
        >
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono font-medium">
            {result.code}
          </span>
          <span className="ml-2">{result.detail}</span>
        </div>
      )}
    </div>
  );
}
