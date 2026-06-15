import React from "react";
import {
  Check,
  CheckCircle2,
  DownloadCloud,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  deriveEndpoint,
  fetchProviderModels,
  modelSuggestionsFor,
  pingLlmEndpoint,
  presetGlyph,
  providerStatus,
  SEED_PRESETS,
  validateProviderConfig,
  type LlmModelDef,
  type LlmProviderConfig,
  type LlmProvidersConfig,
  type ModelCapability,
} from "@/lib/sliderule-llm-providers";

/** 列表行内可点切换的能力标签（工具/流式/视觉）。 */
const TOGGLEABLE_CAPS: ModelCapability[] = ["tools", "stream", "vision"];

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
const labelClass = "mb-1.5 block text-[12px] font-semibold text-slate-600";

const CAP_LABELS: Record<ModelCapability, string> = {
  vision: "视觉",
  tools: "工具",
  stream: "流式",
};

function ProviderBadge({ glyph, active }: { glyph: string; active?: boolean }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold ${
        active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
      }`}
    >
      {glyph}
    </span>
  );
}

/** 列表项右侧的配置状态点：绿=已配/就绪，琥珀=缺密钥，灰=未配。 */
function StatusDot({ status }: { status: ReturnType<typeof providerStatus> }) {
  const map: Record<ReturnType<typeof providerStatus>, { cls: string; title: string }> = {
    ready: { cls: "bg-emerald-500", title: "已启用 · 下一轮生效" },
    configured: { cls: "bg-emerald-400/70", title: "已配密钥（未启用）" },
    "needs-key": { cls: "bg-amber-400", title: "需要 API 密钥" },
    idle: { cls: "bg-slate-300", title: "未配置" },
  };
  const { cls, title } = map[status];
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} title={title} data-status={status} />;
}

/** 右栏分区卡片：标题 + 细分隔线，收拢留白。 */
function Section({
  title,
  action,
  children,
  testid,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  testid?: string;
}) {
  return (
    <section
      className="rounded-xl border border-slate-200 bg-white/60 p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]"
      data-testid={testid}
    >
      <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
        <h3 className="text-[13px] font-bold text-slate-800">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

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
        className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500"
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
  setDraft: (next: LlmProvidersConfig | null | ((prev: LlmProvidersConfig | null) => LlmProvidersConfig | null)) => void;
}) {
  const [selectedId, setSelectedId] = React.useState<string>(draft.providers[0]?.id ?? "");
  const selected =
    draft.providers.find((p) => p.id === selectedId) ?? draft.providers[0] ?? null;

  const [showKey, setShowKey] = React.useState(false);
  const [testState, setTestState] = React.useState<TestState>({ kind: "idle" });
  const testing = testState.kind === "testing";
  const [modelModalOpen, setModelModalOpen] = React.useState(false);
  const [editingModel, setEditingModel] = React.useState<LlmModelDef | null>(null);
  // Track the *original* model.id when we started editing (so rename of id doesn't leave a stale entry behind).
  const [editingOriginalModelId, setEditingOriginalModelId] = React.useState<string | null>(null);
  // Inline-confirm state (避免 window.confirm，与其它面板一致)。
  const [confirmingReset, setConfirmingReset] = React.useState(false);
  const [confirmingDeleteModelId, setConfirmingDeleteModelId] = React.useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = React.useState(false);

  const patchProvider = (patch: Partial<LlmProviderConfig>) => {
    // 改了连接相关字段 → 旧的测试结果作废，回到 idle，避免误导。
    if ("apiKey" in patch || "baseUrl" in patch || "protocol" in patch) {
      setTestState({ kind: "idle" });
    }
    setDraft((current: LlmProvidersConfig | null) => {
      if (!current) return current;
      const targetId = selectedId;
      if (!targetId) return current;
      return {
        ...current,
        providers: current.providers.map((p: LlmProviderConfig) => (p.id === targetId ? { ...p, ...patch } : p)),
      };
    });
  };

  // 切换厂商时清掉上一个厂商的测试结果。
  React.useEffect(() => {
    setTestState({ kind: "idle" });
  }, [selectedId]);

  const addCustomProvider = () => {
    const id = `custom-${Date.now()}`;
    const provider: LlmProviderConfig = {
      id,
      presetId: "custom",
      name: "自定义",
      protocol: "openai",
      apiKey: "",
      requiresApiKey: true,
      baseUrl: "",
      enabled: false,
      models: [],
    };
    setDraft((current: LlmProvidersConfig | null) => {
      if (!current) return current;
      return { ...current, providers: [...current.providers, provider] };
    });
    setSelectedId(id);
  };

  const removeProvider = (id: string) => {
    setDraft((current: LlmProvidersConfig | null) => {
      if (!current) return current;
      const nextProviders = current.providers.filter((p: LlmProviderConfig) => p.id !== id);
      return { ...current, providers: nextProviders };
    });
    if (selectedId === id) {
      // After removal, pick the first remaining provider (the setState for draft is async,
      // so we just clear and let the next render pick [0] via the selected derivation).
      setSelectedId("");
    }
  };

  const resetModels = () => {
    if (!selected) return;
    const preset = SEED_PRESETS.find((p) => p.presetId === selected.presetId);
    patchProvider({
      models: preset
        ? [{ id: preset.defaultModel, capabilities: ["tools", "stream"], enabled: true }]
        : [],
      defaultModelId: preset?.defaultModel,
    });
    setConfirmingReset(false);
  };

  /** 设为默认（纯偏好/展示，不改变进池集合与 executor 注入）。 */
  const setDefaultModel = (modelId: string) => patchProvider({ defaultModelId: modelId });

  /** 行内点切能力标签（工具/流式/视觉）。 */
  const toggleModelCap = (modelId: string, cap: ModelCapability) => {
    if (!selected) return;
    patchProvider({
      models: selected.models.map((x) =>
        x.id === modelId
          ? {
              ...x,
              capabilities: x.capabilities.includes(cap)
                ? x.capabilities.filter((c) => c !== cap)
                : [...x.capabilities, cap],
            }
          : x
      ),
    });
  };

  const deleteModel = (modelId: string) => {
    if (!selected) return;
    patchProvider({
      models: selected.models.filter((x) => x.id !== modelId),
      // 删掉默认模型时清空默认标记，避免悬空引用。
      defaultModelId: selected.defaultModelId === modelId ? undefined : selected.defaultModelId,
    });
    setConfirmingDeleteModelId(null);
  };

  /** 从厂商 `/models` 真实拉取并并入（去重，保留已有能力/启用状态）。 */
  const fetchModels = async () => {
    if (!selected || fetchingModels) return;
    setFetchingModels(true);
    const r = await fetchProviderModels({
      protocol: selected.protocol,
      baseUrl: selected.baseUrl,
      apiKey: selected.apiKey,
    });
    setFetchingModels(false);
    if (!r.ok || !r.models) {
      toast.error("拉取模型失败", { description: r.message });
      return;
    }
    const existing = new Set(selected.models.map((m) => m.id));
    const added = r.models
      .filter((id) => !existing.has(id))
      .map<LlmModelDef>((id) => ({ id, capabilities: ["tools", "stream"], enabled: false }));
    if (added.length === 0) {
      toast.info("没有新模型", { description: "列表已是最新" });
      return;
    }
    patchProvider({ models: [...selected.models, ...added] });
    toast.success("已拉取模型", { description: `新增 ${added.length} 个（默认未启用，按需勾选）` });
  };

  const upsertModel = (model: LlmModelDef, originalId?: string) => {
    if (!selected) return;
    const targetOldId = originalId ?? model.id;
    // Remove the entry that was being edited (important when user *renames* the model id).
    let models = selected.models.filter((x) => x.id !== targetOldId);
    // Insert/replace under the (possibly new) id.
    const idx = models.findIndex((x) => x.id === model.id);
    if (idx >= 0) {
      models = models.map((x, i) => (i === idx ? model : x));
    } else {
      models = [...models, model];
    }
    patchProvider({ models });
  };

  const runTest = async (modelId?: string) => {
    if (!selected) return;
    const model = modelId || selected.models.find((m) => m.enabled)?.id || selected.models[0]?.id || "";
    setTestState({ kind: "testing" });
    // 复用真实 ping（不 mock），三态内联反馈 + toast（兼顾 modal 内触发）。
    const r = await pingLlmEndpoint({
      protocol: selected.protocol,
      baseUrl: selected.baseUrl,
      apiKey: selected.apiKey,
      model,
    });
    if (r.ok) {
      setTestState({ kind: "ok", model, latencyMs: r.latencyMs });
      toast.success("连接成功", {
        description: `${selected.name} · ${model}${typeof r.latencyMs === "number" ? ` · ${r.latencyMs}ms` : ""}`,
      });
    } else {
      setTestState({ kind: "error", message: r.message });
      toast.error("连接失败", { description: r.message });
    }
  };

  const validation = selected
    ? validateProviderConfig(selected)
    : { keyError: null, baseUrlError: null };

  return (
    <div className="flex h-full min-h-0 flex-col min-[900px]:flex-row">
      {/* 中栏：厂商列表（窄屏折到顶部，宽屏左侧） */}
      <div className="flex shrink-0 flex-col border-b border-slate-200 bg-slate-50/60 min-[900px]:w-[210px] min-[900px]:border-b-0 min-[900px]:border-r">
        <ul
          className="max-h-[148px] flex-1 overflow-y-auto p-2 min-[900px]:max-h-none"
          data-testid="sliderule-provider-list"
        >
          {draft.providers.map((p) => {
            const active = p.id === selected?.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  data-provider={p.presetId}
                  aria-current={active}
                  className={`relative mb-0.5 flex w-full items-center gap-2 rounded-lg py-2 pl-3 pr-2 text-left transition ${
                    active ? "bg-white shadow-sm ring-1 ring-slate-200" : "hover:bg-white/70"
                  }`}
                >
                  {/* 选中高亮条 */}
                  <span
                    className={`absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full transition-colors ${
                      active ? "bg-indigo-500" : "bg-transparent"
                    }`}
                  />
                  <ProviderBadge glyph={presetGlyph(p.presetId)} active={active} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-700">
                    {p.name}
                  </span>
                  <StatusDot status={providerStatus(p)} />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t border-slate-200 p-2">
          <button
            type="button"
            onClick={addCustomProvider}
            data-testid="sliderule-provider-add"
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <Plus className="h-4 w-4" /> 添加
          </button>
        </div>
      </div>

      {/* 右栏：厂商详情 */}
      <div className="min-w-0 flex-1 overflow-y-auto bg-slate-50/30 px-6 py-5">
        {!selected ? (
          <p className="text-sm text-slate-400">左侧选择或添加一个厂商</p>
        ) : (
          <div className="space-y-4" data-testid="sliderule-provider-detail">
            {/* header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ProviderBadge glyph={presetGlyph(selected.presetId)} active />
                <div>
                  {selected.presetId === "custom" ? (
                    <input
                      value={selected.name}
                      onChange={(e) => patchProvider({ name: e.target.value })}
                      className="rounded border border-transparent px-1 text-base font-bold text-slate-900 outline-none hover:border-slate-200 focus:border-indigo-400"
                    />
                  ) : (
                    <h2 className="text-base font-bold text-slate-900">{selected.name}</h2>
                  )}
                  <p className="text-[11px] text-slate-400">
                    {selected.protocol === "anthropic" ? "Anthropic 协议" : "OpenAI 协议"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[12px] text-slate-500">
                  <button
                    type="button"
                    onClick={() => patchProvider({ enabled: !selected.enabled })}
                    aria-pressed={selected.enabled}
                    className={`relative h-5 w-9 rounded-full transition-colors ${
                      selected.enabled ? "bg-indigo-600" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                        selected.enabled ? "left-4" : "left-0.5"
                      }`}
                    />
                  </button>
                  启用
                </label>
                {selected.presetId === "custom" && (
                  <button
                    type="button"
                    onClick={() => removeProvider(selected.id)}
                    className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                    title="删除该厂商"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 连接 */}
            <Section title="连接" testid="sliderule-section-connection">
              <div>
                <label className={labelClass}>
                  <Key className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                  API 密钥
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKey ? "text" : "password"}
                      value={selected.apiKey}
                      onChange={(e) => patchProvider({ apiKey: e.target.value })}
                      placeholder="sk-..."
                      aria-invalid={!!validation.keyError}
                      className={`${inputClass} pr-9 font-mono ${
                        validation.keyError ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""
                      }`}
                      data-testid="sliderule-provider-apikey"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((s) => !s)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                      title={showKey ? "隐藏" : "显示"}
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => runTest()}
                    disabled={testing}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    data-testid="sliderule-provider-test"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {testing ? "测试中…" : "测试连接"}
                  </button>
                </div>
                {validation.keyError && (
                  <p className="mt-1 text-[11px] font-medium text-rose-500" data-testid="sliderule-key-error">
                    {validation.keyError}
                  </p>
                )}
                {/* 测试连接三态内联反馈 */}
                <TestConnectionResult state={testState} />
                <label className="mt-2 flex items-center gap-2 text-[12px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={selected.requiresApiKey}
                    onChange={(e) => patchProvider({ requiresApiKey: e.target.checked })}
                    className="h-3.5 w-3.5 accent-indigo-600"
                  />
                  需要 API 密钥（本地服务可取消勾选）
                </label>
              </div>

              <div className="mt-4">
                <label className={labelClass}>Base URL</label>
                <input
                  value={selected.baseUrl}
                  onChange={(e) => patchProvider({ baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  aria-invalid={!!validation.baseUrlError}
                  className={`${inputClass} font-mono ${
                    validation.baseUrlError ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""
                  }`}
                  data-testid="sliderule-provider-baseurl"
                />
                {validation.baseUrlError ? (
                  <p className="mt-1 text-[11px] font-medium text-rose-500" data-testid="sliderule-baseurl-error">
                    {validation.baseUrlError}
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-slate-400">
                    请求地址：{deriveEndpoint(selected.baseUrl, selected.protocol) || "（待填写 Base URL）"}
                  </p>
                )}
              </div>
            </Section>

            {/* 模型 */}
            <Section
              title="模型"
              testid="sliderule-section-models"
              action={
                <div className="flex items-center gap-2">
                  {confirmingReset ? (
                    <span className="flex items-center gap-1 text-[12px]" data-testid="sliderule-model-reset-confirm">
                      <span className="text-slate-500">重置为预设？</span>
                      <button
                        type="button"
                        onClick={resetModels}
                        className="rounded-lg bg-rose-600 px-2 py-1 text-[12px] font-semibold text-white transition hover:bg-rose-500"
                      >
                        确认
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingReset(false)}
                        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingReset(true)}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                      data-testid="sliderule-model-reset"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> 重置
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingModel(null);
                      setEditingOriginalModelId(null);
                      setModelModalOpen(true);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-indigo-500"
                    data-testid="sliderule-model-new"
                  >
                    <Plus className="h-3.5 w-3.5" /> 新建模型
                  </button>
                </div>
              }
            >
              {selected.models.length === 0 ? (
                <div
                  className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center"
                  data-testid="sliderule-model-empty"
                >
                  <p className="text-[12px] text-slate-400">还没有模型 — 新建，或从该厂商拉取列表</p>
                  <button
                    type="button"
                    onClick={fetchModels}
                    disabled={fetchingModels || !selected.baseUrl.trim()}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    data-testid="sliderule-model-fetch"
                  >
                    <DownloadCloud className="h-3.5 w-3.5" />
                    {fetchingModels ? "拉取中…" : "拉取模型列表"}
                  </button>
                </div>
              ) : (
                <ul className="space-y-1.5" data-testid="sliderule-model-list">
                  {selected.models.map((m) => {
                    const isDefault = selected.defaultModelId === m.id;
                    return (
                      <li
                        key={m.id}
                        className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          onChange={() =>
                            patchProvider({
                              models: selected.models.map((x) =>
                                x.id === m.id ? { ...x, enabled: !x.enabled } : x
                              ),
                            })
                          }
                          className="h-3.5 w-3.5 shrink-0 accent-indigo-600"
                          title={m.enabled ? "已启用" : "已停用"}
                        />
                        {/* 设为默认（单选，纯偏好） */}
                        <label
                          className="flex shrink-0 cursor-pointer items-center"
                          title={isDefault ? "默认模型" : "设为默认"}
                        >
                          <input
                            type="radio"
                            name={`default-model-${selected.id}`}
                            checked={isDefault}
                            onChange={() => setDefaultModel(m.id)}
                            className="peer sr-only"
                            data-testid={`sliderule-model-default-${m.id}`}
                          />
                          <Star
                            className={`h-3.5 w-3.5 transition ${
                              isDefault ? "fill-amber-400 text-amber-400" : "text-slate-300 hover:text-slate-400"
                            }`}
                          />
                        </label>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-mono text-[13px] text-slate-800">
                              {m.name?.trim() || m.id}
                            </span>
                            {isDefault && (
                              <span
                                className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700"
                                data-testid="sliderule-model-default-badge"
                              >
                                默认
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            {m.name?.trim() && (
                              <span className="font-mono text-[10px] text-slate-400">{m.id}</span>
                            )}
                            {TOGGLEABLE_CAPS.map((c) => {
                              const on = m.capabilities.includes(c);
                              return (
                                <button
                                  key={c}
                                  type="button"
                                  onClick={() => toggleModelCap(m.id, c)}
                                  aria-pressed={on}
                                  data-testid={`sliderule-model-cap-${m.id}-${c}`}
                                  className={`rounded px-1 py-0.5 text-[9px] font-medium transition ${
                                    on
                                      ? "bg-indigo-100 text-indigo-700"
                                      : "bg-slate-100 text-slate-400 hover:bg-slate-200"
                                  }`}
                                >
                                  {CAP_LABELS[c]}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingModel(m);
                            setEditingOriginalModelId(m.id);
                            setModelModalOpen(true);
                          }}
                          className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                          title="编辑"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {confirmingDeleteModelId === m.id ? (
                          <span className="flex shrink-0 items-center gap-1" data-testid="sliderule-model-delete-confirm">
                            <button
                              type="button"
                              onClick={() => deleteModel(m.id)}
                              className="rounded bg-rose-600 px-1.5 py-1 text-[11px] font-semibold text-white transition hover:bg-rose-500"
                            >
                              删除
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteModelId(null)}
                              className="rounded border border-slate-200 px-1.5 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
                            >
                              取消
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteModelId(m.id)}
                            className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                            title="删除"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>
        )}
      </div>

      {modelModalOpen && selected && (
        <ModelModal
          initial={editingModel}
          suggestions={modelSuggestionsFor(selected.presetId)}
          existingIds={selected.models.map((m) => m.id)}
          editingId={editingOriginalModelId}
          onCancel={() => {
            setModelModalOpen(false);
            setEditingOriginalModelId(null);
          }}
          onSave={(m) => {
            upsertModel(m, editingOriginalModelId ?? undefined);
            setModelModalOpen(false);
            setEditingOriginalModelId(null);
          }}
          onTest={(modelId) => runTest(modelId)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────── 新建/编辑模型 子弹窗 ───────────────────────────────────

function ModelModal({
  initial,
  suggestions = [],
  existingIds = [],
  editingId = null,
  onCancel,
  onSave,
  onTest,
}: {
  initial: LlmModelDef | null;
  /** 该厂商常见模型名建议（datalist 下拉，可自由输入）。 */
  suggestions?: string[];
  /** 该厂商已有模型 id（用于重名校验）。 */
  existingIds?: string[];
  /** 正在编辑的原始 id（重名校验时排除自身）。 */
  editingId?: string | null;
  onCancel: () => void;
  onSave: (m: LlmModelDef) => void;
  onTest: (modelId: string) => void;
}) {
  const [id, setId] = React.useState(initial?.id ?? "");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [caps, setCaps] = React.useState<ModelCapability[]>(
    initial?.capabilities ?? ["tools", "stream"]
  );
  const [contextWindow, setContextWindow] = React.useState(
    initial?.contextWindow != null ? String(initial.contextWindow) : ""
  );
  const [maxOutputTokens, setMaxOutputTokens] = React.useState(
    initial?.maxOutputTokens != null ? String(initial.maxOutputTokens) : ""
  );

  const trimmedId = id.trim();
  // 非空 + 不与同厂商其它模型重名（编辑时排除自身）。
  const duplicate =
    trimmedId.length > 0 &&
    existingIds.some((x) => x === trimmedId && x !== (editingId ?? initial?.id));
  const idError = trimmedId.length === 0 ? "模型 ID 不能为空" : duplicate ? "该厂商已有同名模型" : null;

  const toggleCap = (c: ModelCapability) =>
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const save = () => {
    if (idError) {
      toast.error(idError);
      return;
    }
    onSave({
      id: trimmedId,
      name: name.trim() || undefined,
      capabilities: caps,
      contextWindow: contextWindow ? Number(contextWindow) : undefined,
      maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : undefined,
      enabled: initial?.enabled ?? true,
    });
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={onCancel}>
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div
        className="relative flex w-[min(92vw,440px)] flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="sliderule-model-modal"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">{initial ? "编辑模型" : "新建模型"}</h3>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div>
          <label className={labelClass}>模型 ID</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="例如: gpt-4o"
            list={suggestions.length > 0 ? "sliderule-model-suggestions" : undefined}
            aria-invalid={!!idError}
            className={`${inputClass} font-mono ${idError ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""}`}
            data-testid="sliderule-model-id"
            autoFocus
          />
          {suggestions.length > 0 && (
            <datalist id="sliderule-model-suggestions">
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          {idError && (
            <p className="mt-1 text-[11px] font-medium text-rose-500" data-testid="sliderule-model-id-error">
              {idError}
            </p>
          )}
        </div>
        <div>
          <label className={labelClass}>显示名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="可选"
            className={inputClass}
          />
        </div>

        <div>
          <label className={labelClass}>能力</label>
          <div className="flex gap-2">
            {(["vision", "tools", "stream"] as ModelCapability[]).map((c) => {
              const on = caps.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCap(c)}
                  className={`flex items-center gap-1.5 rounded-lg border-2 px-3 py-1.5 text-[12px] font-medium transition ${
                    on
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {on && <Check className="h-3 w-3" />}
                  {CAP_LABELS[c]}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className={labelClass}>高级设置</label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="mb-1 block text-[11px] text-slate-400">上下文窗口</span>
              <input
                type="number"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="例如 128000"
                className={`${inputClass} font-mono`}
              />
            </div>
            <div>
              <span className="mb-1 block text-[11px] text-slate-400">最大输出 Token 数</span>
              <input
                type="number"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(e.target.value)}
                placeholder="例如 4096"
                className={`${inputClass} font-mono`}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-[13px] font-semibold text-slate-600">测试模型</span>
          <button
            type="button"
            onClick={() => {
              if (!id.trim()) {
                toast.error("请先填写模型 ID");
                return;
              }
              onTest(id.trim());
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <Zap className="h-3.5 w-3.5" /> 测试连接
          </button>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={save}
            disabled={!!idError}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-indigo-600"
            data-testid="sliderule-model-save"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
