/**
 * LlmProviderSettings — 浏览器直连（BYOK 备用池）的极简配置面板。
 *
 * 它只是 GitHub Pages 纯浏览器 Demo（无服务端）场景的备用通道，按这个
 * 定位收敛到功能骨架：选厂商 → 启用 → 密钥 / Base URL / 模型 → 测试连接。
 * 模型 CRUD、能力标签、排序、拉取模型列表、多 key 调度策略等重装饰一律
 * 移除（调度字段仍保留在 draft 里原样保存，不在 UI 暴露）。
 *
 * 密钥只写本机 localStorage，绝不进会话/导出/遥测。
 */

import React from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  pingLlmEndpoint,
  providerStatus,
  SEED_PRESETS,
  validateProviderConfig,
  type LlmProviderConfig,
  type LlmProvidersConfig,
} from "@/lib/sliderule-llm-providers";

const inputClass =
  "w-full rounded-lg border border-[#E7E2D9] bg-white px-3 py-2 font-mono text-[13px] text-stone-800 outline-none transition focus:border-[#D97757] focus:ring-2 focus:ring-[#F3DCD0]";
const labelClass = "mb-1.5 block text-[12px] font-semibold text-stone-600";

/** 测试连接的三态（idle 不渲染）。 */
export type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; model: string; latencyMs?: number }
  | { kind: "error"; message: string };

/** 测试连接结果的内联反馈：loading / 绿✓+模型+延迟 / 红+脱敏原因。 */
export function TestConnectionResult({ state }: { state: TestState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "testing") {
    return (
      <p
        className="mt-2 flex items-center gap-1.5 text-[12px] text-stone-500"
        data-testid="sliderule-test-result"
        data-state="testing"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在测试连接…
      </p>
    );
  }
  if (state.kind === "ok") {
    return (
      <p
        className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-emerald-600"
        data-testid="sliderule-test-result"
        data-state="ok"
      >
        <CheckCircle2 className="h-3.5 w-3.5" /> 连接成功 · {state.model}
        {typeof state.latencyMs === "number" ? ` · ${state.latencyMs}ms` : ""}
      </p>
    );
  }
  return (
    <p
      className="mt-2 flex items-center gap-1.5 text-[12px] font-medium text-rose-600"
      data-testid="sliderule-test-result"
      data-state="error"
    >
      <XCircle className="h-3.5 w-3.5 shrink-0" /> <span className="min-w-0">{state.message}</span>
    </p>
  );
}

export function LlmProviderSettings({
  draft,
  setDraft,
}: {
  draft: LlmProvidersConfig;
  setDraft: (next: LlmProvidersConfig) => void;
}) {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(draft.providers[0]?.id);
  const [testState, setTestState] = React.useState<TestState>({ kind: "idle" });
  const selected = draft.providers.find((p) => p.id === selectedId) ?? draft.providers[0] ?? null;

  const patch = (updates: Partial<LlmProviderConfig>) => {
    if (!selected) return;
    setDraft({
      ...draft,
      providers: draft.providers.map((p) => (p.id === selected.id ? { ...p, ...updates } : p)),
    });
  };

  const modelValue =
    selected?.defaultModelId ||
    selected?.models.find((m) => m.enabled)?.id ||
    selected?.models[0]?.id ||
    "";
  const setModel = (id: string) =>
    patch(
      id.trim()
        ? {
            models: [{ id: id.trim(), capabilities: ["tools", "stream"], enabled: true }],
            defaultModelId: id.trim(),
          }
        : { models: [], defaultModelId: undefined }
    );

  const runTest = async () => {
    if (!selected || testState.kind === "testing") return;
    const model =
      modelValue || SEED_PRESETS.find((s) => s.presetId === selected.presetId)?.defaultModel || "";
    setTestState({ kind: "testing" });
    const r = await pingLlmEndpoint({
      protocol: selected.protocol,
      baseUrl: selected.baseUrl,
      apiKey: selected.apiKey,
      model,
    });
    if (r.ok) {
      setTestState({ kind: "ok", model, latencyMs: r.latencyMs });
    } else {
      setTestState({ kind: "error", message: r.message });
      toast.error("连接失败", { description: r.message });
    }
  };

  const validation = selected
    ? validateProviderConfig(selected)
    : { keyError: null, baseUrlError: null };
  const presetDefaultModel = selected
    ? SEED_PRESETS.find((s) => s.presetId === selected.presetId)?.defaultModel ?? ""
    : "";

  return (
    <div className="flex h-full min-h-0">
      {/* 左：厂商列表（纯文字 + 启用状态点） */}
      <ul
        className="w-[170px] shrink-0 overflow-y-auto border-r border-[#E7E2D9] p-2"
        data-testid="sliderule-provider-list"
      >
        {draft.providers.map((p) => {
          const active = p.id === selected?.id;
          const status = providerStatus(p);
          return (
            <li key={p.id}>
              <button
                type="button"
                aria-current={active || undefined}
                onClick={() => {
                  setSelectedId(p.id);
                  setTestState({ kind: "idle" });
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition ${
                  active ? "bg-[#F8E8E0] font-semibold text-[#B0552F]" : "text-stone-600 hover:bg-[#F5F1EA]"
                }`}
              >
                <span className="truncate">{p.name}</span>
                {p.enabled && (
                  <span
                    data-status={status}
                    className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                      status === "ready" ? "bg-emerald-500" : "bg-amber-400"
                    }`}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {/* 右：选中厂商的最小表单 */}
      {selected && (
        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          <div className="max-w-xl space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-[15px] font-semibold text-stone-800">{selected.name}</div>
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-stone-500">
                启用
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(e) => patch({ enabled: e.target.checked })}
                  data-testid="sliderule-provider-enabled"
                  className="h-4 w-4 accent-[#D97757]"
                />
              </label>
            </div>

            <div>
              <label className={labelClass}>API 密钥</label>
              <input
                type="password"
                className={inputClass}
                value={selected.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder={selected.requiresApiKey ? "sk-…" : "本地服务可留空"}
                data-testid="sliderule-provider-key"
              />
              {validation.keyError && selected.enabled && (
                <p className="mt-1 text-[11px] text-rose-600">{validation.keyError}</p>
              )}
              <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px] text-stone-400">
                <input
                  type="checkbox"
                  checked={!selected.requiresApiKey}
                  onChange={(e) => patch({ requiresApiKey: !e.target.checked })}
                  className="h-3 w-3 accent-[#D97757]"
                />
                本地服务，免密钥（如 Ollama）
              </label>
            </div>

            <div>
              <label className={labelClass}>Base URL</label>
              <input
                className={inputClass}
                value={selected.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                data-testid="sliderule-provider-baseurl"
              />
              {validation.baseUrlError && selected.enabled && (
                <p className="mt-1 text-[11px] text-rose-600">{validation.baseUrlError}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>模型</label>
              <input
                className={inputClass}
                value={modelValue}
                onChange={(e) => setModel(e.target.value)}
                placeholder={presetDefaultModel || "模型 id"}
                data-testid="sliderule-provider-model"
              />
            </div>

            <div>
              <button
                type="button"
                onClick={runTest}
                disabled={testState.kind === "testing"}
                className="rounded-lg border border-[#E7E2D9] bg-white px-4 py-2 text-[13px] font-semibold text-stone-600 transition hover:bg-[#F5F1EA] disabled:opacity-50"
                data-testid="sliderule-provider-test"
              >
                {testState.kind === "testing" ? "测试中…" : "测试连接"}
              </button>
              <TestConnectionResult state={testState} />
            </div>

            <p className="text-[11px] text-stone-400">
              密钥仅存本机浏览器，不进会话/导出/遥测。改完点右下角「保存」生效。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
