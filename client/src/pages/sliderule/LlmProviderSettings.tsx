import React from "react";
import {
  Check,
  Eye,
  EyeOff,
  Key,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  deriveEndpoint,
  pingLlmEndpoint,
  presetGlyph,
  providerStatus,
  SEED_PRESETS,
  type LlmModelDef,
  type LlmProviderConfig,
  type LlmProvidersConfig,
  type ModelCapability,
} from "@/lib/sliderule-llm-providers";

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
  const [testing, setTesting] = React.useState(false);
  const [modelModalOpen, setModelModalOpen] = React.useState(false);
  const [editingModel, setEditingModel] = React.useState<LlmModelDef | null>(null);
  // Track the *original* model.id when we started editing (so rename of id doesn't leave a stale entry behind).
  const [editingOriginalModelId, setEditingOriginalModelId] = React.useState<string | null>(null);

  const patchProvider = (patch: Partial<LlmProviderConfig>) => {
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
    });
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
    setTesting(true);
    const r = await pingLlmEndpoint({
      protocol: selected.protocol,
      baseUrl: selected.baseUrl,
      apiKey: selected.apiKey,
      model,
    });
    setTesting(false);
    if (r.ok) toast.success("连接成功", { description: `${selected.name} · ${model}` });
    else toast.error("连接失败", { description: r.message });
  };

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
                      className={`${inputClass} pr-9 font-mono`}
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
                  className={`${inputClass} font-mono`}
                  data-testid="sliderule-provider-baseurl"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  请求地址：{deriveEndpoint(selected.baseUrl, selected.protocol) || "（待填写 Base URL）"}
                </p>
              </div>
            </Section>

            {/* 模型 */}
            <Section
              title="模型"
              testid="sliderule-section-models"
              action={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={resetModels}
                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-slate-600 transition hover:bg-slate-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> 重置
                  </button>
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
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-[12px] text-slate-400">
                  还没有模型 — 点「新建模型」添加
                </p>
              ) : (
                <ul className="space-y-1.5" data-testid="sliderule-model-list">
                  {selected.models.map((m) => (
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
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[13px] text-slate-800">
                          {m.name?.trim() || m.id}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {m.name?.trim() && (
                            <span className="font-mono text-[10px] text-slate-400">{m.id}</span>
                          )}
                          {m.capabilities.map((c) => (
                            <span
                              key={c}
                              className="rounded bg-slate-100 px-1 py-0.5 text-[9px] font-medium text-slate-500"
                            >
                              {CAP_LABELS[c]}
                            </span>
                          ))}
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
                      <button
                        type="button"
                        onClick={() =>
                          patchProvider({ models: selected.models.filter((x) => x.id !== m.id) })
                        }
                        className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                        title="删除"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        )}
      </div>

      {modelModalOpen && selected && (
        <ModelModal
          initial={editingModel}
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
  onCancel,
  onSave,
  onTest,
}: {
  initial: LlmModelDef | null;
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

  const toggleCap = (c: ModelCapability) =>
    setCaps((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const save = () => {
    if (!id.trim()) {
      toast.error("请填写模型 ID");
      return;
    }
    onSave({
      id: id.trim(),
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
            className={`${inputClass} font-mono`}
            data-testid="sliderule-model-id"
            autoFocus
          />
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
            className="rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-indigo-500"
            data-testid="sliderule-model-save"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
