import React from "react";
import { Cpu, Eye, EyeOff, Globe, Key, Plus, Server, SlidersHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import {
  loadByokPool,
  saveByokPool,
  clearByokPool,
  validateByokPool,
  maskKey,
  PRESET_ENDPOINTS,
  PRESET_MODELS,
  type ByokPresetId,
  type ByokKeyEntry,
  type ByokPoolConfig,
} from "@/lib/sliderule-byok-config";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import type { ProjectionDensity } from "./sliderule-projection-constants";

const PRESET_IDS = Object.keys(PRESET_ENDPOINTS) as ByokPresetId[];

/** Square-tile picker metadata: display name + short family tag + initial glyph. */
const PROVIDER_META: Record<ByokPresetId, { name: string; tag: string }> = {
  openai: { name: "OpenAI", tag: "GPT" },
  anthropic: { name: "Anthropic", tag: "Claude" },
  deepseek: { name: "DeepSeek", tag: "deepseek" },
  openrouter: { name: "OpenRouter", tag: "聚合路由" },
  custom: { name: "自定义", tag: "Custom" },
};

type TabId = "llm" | "prefs";

type MarathonBudget = { maxTokens: number; declaredAt: string };

export type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  marathonBudget?: MarathonBudget;
  setMarathonBudget?: (b: MarathonBudget) => void;
};

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";
const labelClass = "mb-1 flex items-center gap-1 text-[10px] font-semibold text-slate-500";

/**
 * SlideRule 设置对话框（居中 modal）。
 * Tab「模型」= BYOK 多 key 池：key 只写本机 localStorage（sliderule:llm-pool:v1），
 * 绝不进会话/导出/遥测；配了有效 key 运行时浏览器直连，清空回退服务端 LLM（localhost）/ 演示（Pages）。
 * Tab「推演偏好」= 投影密度 / 默认推演模式 / 持续推演 token 预算。
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onClose } = props;
  const [tab, setTab] = React.useState<TabId>("llm");

  React.useEffect(() => {
    if (open) setTab("llm");
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4" onClick={onClose}>
        <div className="flex w-[min(96vw,1024px)] items-center justify-center gap-6">
          <div className="hidden h-[58vh] min-h-[360px] w-[180px] rounded-2xl border border-white/20 bg-white/10 backdrop-blur-[1px] lg:block" />
          <div
            className="flex max-h-[84vh] w-[min(92vw,460px)] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_20px_60px_rgb(15_23_42/0.25)]"
            data-testid="sliderule-settings-dialog"
            role="dialog"
            aria-label="设置"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="flex items-center justify-between border-b border-slate-200 px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/sliderule_logo_wordmark_transparent.png"
                alt="SlideRule"
                className="h-5"
                title="SlideRule"
              />
              <div className="flex flex-col">
                <h3 className="text-sm font-bold text-slate-900">设置</h3>
                <span className="text-[10px] text-slate-400">LLM 配置与推演偏好</span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              title="关闭"
              data-testid="sliderule-settings-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="border-b border-slate-200 px-3.5 py-2" role="tablist">
            <div className="inline-flex gap-1 rounded-xl bg-slate-100 p-1">
            <TabButton
              active={tab === "llm"}
              onClick={() => setTab("llm")}
              icon={<Cpu className="h-3.5 w-3.5" />}
              label="模型"
              testid="sliderule-settings-tab-llm"
            />
            <TabButton
              active={tab === "prefs"}
              onClick={() => setTab("prefs")}
              icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
              label="推演偏好"
              testid="sliderule-settings-tab-prefs"
            />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-slate-50/50 px-3.5 py-3">
            {tab === "llm" ? <LlmTab /> : <PrefsTab {...props} />}
          </div>
          </div>
        </div>
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  testid,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  testid: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testid}
      className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition-colors ${
        active
          ? "bg-white text-indigo-600 shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─────────────────────────────────────── 模型 / LLM (BYOK) ───────────────────────────────────────

function emptyDraft() {
  return {
    preset: "openai" as ByokPresetId,
    label: "",
    endpoint: "",
    model: PRESET_MODELS.openai,
    apiKey: "",
  };
}

function newEntryId(): string {
  return `user-key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function LlmTab() {
  const [entries, setEntries] = React.useState<ByokKeyEntry[]>([]);
  const [dispatch, setDispatch] = React.useState<ByokPoolConfig["dispatch"]>("least-busy");
  const [raceMode, setRaceMode] = React.useState(false);
  const [draft, setDraft] = React.useState(emptyDraft);
  const [showKey, setShowKey] = React.useState(false);

  React.useEffect(() => {
    const pool = loadByokPool();
    setEntries(pool?.entries ?? []);
    setDispatch(pool?.dispatch ?? "least-busy");
    setRaceMode(pool?.raceMode ?? false);
    setDraft(emptyDraft());
    setShowKey(false);
  }, []);

  const isCustom = draft.preset === "custom";

  const onPresetChange = (preset: ByokPresetId) => {
    setDraft((d) => ({
      ...d,
      preset,
      endpoint: preset === "custom" ? d.endpoint : PRESET_ENDPOINTS[preset],
      model: preset === "custom" ? d.model : PRESET_MODELS[preset],
    }));
  };

  const persist = (
    nextEntries: ByokKeyEntry[],
    nextDispatch = dispatch,
    nextRaceMode = raceMode
  ): boolean => {
    if (nextEntries.length === 0) {
      clearByokPool();
    } else {
      const pool: ByokPoolConfig = {
        version: 1,
        entries: nextEntries,
        dispatch: nextDispatch,
        raceMode: nextRaceMode,
      };
      const check = validateByokPool(pool);
      if (!check.ok) {
        toast.error("配置无效", { description: check.reason });
        return false;
      }
      saveByokPool(pool);
    }
    // Notify the session hook to live-switch the executor (browser-llm ↔ server-llm/demo).
    window.dispatchEvent(new CustomEvent("byok-config-changed"));
    return true;
  };

  const addKey = () => {
    const endpoint = isCustom ? draft.endpoint.trim() : PRESET_ENDPOINTS[draft.preset];
    const model = draft.model.trim() || PRESET_MODELS[draft.preset];
    if (!draft.apiKey.trim()) {
      toast.error("请输入 API Key");
      return;
    }
    if (!endpoint) {
      toast.error("custom 预设需要填写 endpoint");
      return;
    }
    const entry: ByokKeyEntry = {
      id: newEntryId(),
      label: draft.label.trim() || draft.preset,
      presetId: draft.preset,
      endpoint,
      model,
      apiKey: draft.apiKey.trim(),
      enabled: true,
    };
    const next = [...entries, entry];
    setEntries(next);
    if (persist(next)) {
      toast.success(`已添加 ${entry.label}`, { description: "下一轮推演将用你的 key 浏览器直连。" });
      setDraft(emptyDraft());
      setShowKey(false);
    }
  };

  const removeKey = (id: string) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    persist(next);
  };

  const toggleEnabled = (id: string) => {
    const next = entries.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e));
    setEntries(next);
    persist(next);
  };

  const clearAll = () => {
    setEntries([]);
    clearByokPool();
    window.dispatchEvent(new CustomEvent("byok-config-changed"));
    toast.success("已清空 BYOK 配置", {
      description: IS_GITHUB_PAGES ? "回退到演示模式。" : "回退到服务端 LLM。",
    });
  };

  return (
    <div className="space-y-3">
      <p className="rounded-xl border border-indigo-100 bg-indigo-50/70 px-3.5 py-2.5 text-[11px] leading-relaxed text-slate-600">
        填入有效 key 后，下一轮推演会用<strong className="text-slate-700">你的 key 浏览器直连</strong>对应厂商；
        留空则使用{IS_GITHUB_PAGES ? "内置演示数据" : "服务端 LLM（.env）"}。
        key 只写本机 localStorage，绝不进会话、导出或遥测。
      </p>

      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-500">已配置 key（{entries.length}/8）</span>
          {entries.length > 0 && (
            <button
              onClick={clearAll}
              className="text-[10px] text-rose-500 transition hover:text-rose-700 hover:underline"
            >
              全部清空
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-[11px] text-slate-400">
            还没有 key — 在下方添加一条开始
          </p>
        ) : (
          <ul className="space-y-1.5" data-testid="sliderule-llm-config-key-list">
            {entries.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5"
              >
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={() => toggleEnabled(e.id)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-indigo-600"
                  title={e.enabled ? "已启用（点击停用）" : "已停用（点击启用）"}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="truncate text-[11px] font-semibold text-slate-800">{e.label}</span>
                    <span className="shrink-0 rounded bg-slate-100 px-1 py-0.5 font-mono text-[9px] text-slate-500">
                      {e.presetId}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                        e.enabled
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-500"
                      }`}
                    >
                      {e.enabled ? "启用中" : "已停用"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[9px] text-slate-400">
                    {maskKey(e.apiKey)} · {e.model}
                  </div>
                </div>
                <button
                  onClick={() => removeKey(e.id)}
                  className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
                  title="删除这条 key"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
        <span className="text-[11px] font-semibold text-slate-600">添加 key</span>
        <div>
          <label className={labelClass}>
            <Server className="h-3 w-3" /> 厂商预设
          </label>
          <div className="grid grid-cols-3 gap-2" data-testid="sliderule-llm-config-preset">
            {PRESET_IDS.map((p) => {
              const active = draft.preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onPresetChange(p)}
                  data-preset={p}
                  aria-pressed={active}
                  title={PROVIDER_META[p].tag}
                  className={`flex aspect-square flex-col items-center justify-center gap-1.5 rounded-xl border-2 p-1 text-center transition ${
                    active
                      ? "border-indigo-500 bg-indigo-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm font-bold ${
                      active ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {PROVIDER_META[p].name.slice(0, 1)}
                  </span>
                  <span
                    className={`text-[10px] font-semibold leading-tight ${
                      active ? "text-indigo-700" : "text-slate-600"
                    }`}
                  >
                    {PROVIDER_META[p].name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className={labelClass}>
            <Cpu className="h-3 w-3" /> 模型
          </label>
          <input
            type="text"
            value={draft.model}
            onChange={(ev) => setDraft((d) => ({ ...d, model: ev.target.value }))}
            placeholder={PRESET_MODELS[draft.preset]}
            className={`${inputClass} font-mono`}
          />
        </div>

        {isCustom && (
          <div>
            <label className={labelClass}>
              <Globe className="h-3 w-3" /> Endpoint
            </label>
            <input
              type="text"
              value={draft.endpoint}
              onChange={(ev) => setDraft((d) => ({ ...d, endpoint: ev.target.value }))}
              placeholder="https://your-host/v1/chat/completions"
              className={`${inputClass} font-mono`}
            />
          </div>
        )}

        <div>
          <label className={labelClass}>
            <Key className="h-3 w-3" /> API Key
          </label>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={draft.apiKey}
              onChange={(ev) => setDraft((d) => ({ ...d, apiKey: ev.target.value }))}
              placeholder="sk-..."
              className={`${inputClass} pr-9 font-mono`}
              data-testid="sliderule-llm-config-apikey"
            />
            <button
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
              title={showKey ? "隐藏" : "显示"}
              type="button"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>

        <div>
          <label className={labelClass}>标签（可选）</label>
          <input
            type="text"
            value={draft.label}
            onChange={(ev) => setDraft((d) => ({ ...d, label: ev.target.value }))}
            placeholder={draft.preset}
            className={inputClass}
          />
        </div>

        <button
          onClick={addKey}
          disabled={entries.length >= 8}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="sliderule-llm-config-add"
        >
          <Plus className="h-3.5 w-3.5" />
          {entries.length >= 8 ? "已达 8 条上限" : "添加到池"}
        </button>
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-2.5">
        <span className="text-[11px] font-semibold text-slate-600">池调度</span>
        <div>
          <label className={labelClass}>分发策略</label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { v: "least-busy", t: "最空闲", d: "选当前最空闲的 key" },
                { v: "round-robin", t: "轮流", d: "按顺序逐个轮流" },
              ] as const
            ).map((o) => {
              const active = dispatch === o.v;
              return (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => {
                    setDispatch(o.v);
                    persist(entries, o.v, raceMode);
                  }}
                  aria-pressed={active}
                  className={`flex flex-col items-start gap-0.5 rounded-xl border-2 px-2.5 py-2 text-left transition ${
                    active
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${active ? "text-indigo-700" : "text-slate-700"}`}>
                    {o.t}
                  </span>
                  <span className="text-[9px] leading-tight text-slate-400">{o.d}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !raceMode;
            setRaceMode(next);
            persist(entries, dispatch, next);
          }}
          aria-pressed={raceMode}
          className={`flex w-full items-center justify-between rounded-xl border-2 px-2.5 py-2 text-left transition ${
            raceMode ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300"
          }`}
        >
          <span className="flex flex-col gap-0.5">
            <span className={`text-[11px] font-semibold ${raceMode ? "text-indigo-700" : "text-slate-700"}`}>
              竞速模式
            </span>
            <span className="text-[9px] leading-tight text-slate-400">多 key 并发抢答 · 更快但更费 token</span>
          </span>
          <span
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
              raceMode ? "bg-indigo-600" : "bg-slate-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
                raceMode ? "left-3.5" : "left-0.5"
              }`}
            />
          </span>
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────── 推演偏好 ───────────────────────────────────────

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: Array<{ value: T; label: string; hint?: string }>;
  onChange?: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(opt.value)}
          title={opt.hint}
          className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
            value === opt.value
              ? "bg-white text-slate-800 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function PrefsTab(props: SettingsDialogProps) {
  const {
    projectionDensity,
    onProjectionDensityChange,
    driveMode,
    setDriveMode,
    marathonBudget,
    setMarathonBudget,
  } = props;

  const budget = marathonBudget?.maxTokens ?? 12000;

  return (
    <div className="space-y-3" data-testid="sliderule-settings-prefs">
      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
        <label className={labelClass}>投影密度</label>
        <Segmented
          value={projectionDensity}
          onChange={onProjectionDensityChange}
          options={[
            { value: "compact", label: "简", hint: "精简投影，只显示关键节点" },
            { value: "detailed", label: "详", hint: "展开证据/阶段/树的溯源链" },
          ]}
        />
        <p className="mt-1 text-[10px] text-slate-400">控制推演图节点展开的详略程度。</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
        <label className={labelClass}>默认推演模式</label>
        <Segmented
          value={driveMode}
          onChange={setDriveMode}
          options={[
            { value: "single", label: "深思一轮", hint: "想清楚一个问题就停，等你确认下一步" },
            { value: "marathon", label: "持续推演", hint: "自动多轮推进，直到预算/前沿尽/需要人工介入" },
          ]}
        />
        <p className="mt-1 text-[10px] text-slate-400">与底部输入框的模式选择同步。</p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-2.5">
        <label className={labelClass}>持续推演 token 预算</label>
        <input
          type="number"
          min={1000}
          step={1000}
          value={budget}
          disabled={!setMarathonBudget}
          onChange={(ev) => {
            const n = Number.parseInt(ev.target.value, 10);
            if (Number.isFinite(n) && n > 0) {
              setMarathonBudget?.({ maxTokens: n, declaredAt: new Date().toISOString() });
            }
          }}
          className={`${inputClass} font-mono`}
          data-testid="sliderule-settings-budget"
        />
        <p className="mt-1 text-[10px] text-slate-400">
          持续推演模式单条消息的 token 上限，达到后停在等待人工介入。
        </p>
      </div>
    </div>
  );
}
