import React from "react";
import { Cpu, Server, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import type { ProjectionDensity } from "./sliderule-projection-constants";
import { LlmProviderSettings } from "./LlmProviderSettings";
import { LlmChannelPanel } from "./LlmChannelPanel";
import {
  clearRuntimeRole,
  clearRuntimeState,
  loadRuntimeState,
  notifyRuntimeChanged,
} from "./live-runtime/runtime-persistence";
import {
  isEnabledProviderReady,
  loadProvidersConfig,
  saveProvidersConfig,
  type LlmProvidersConfig,
} from "@/lib/sliderule-llm-providers";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";

type CategoryId = "channel" | "llm" | "system";

type MarathonBudget = { maxTokens: number; declaredAt: string };

export type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  /** 本话题运行时数据（行/实例/角色）的会话 id，供「数据管理」清理 */
  sessionId?: string;
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
  driveMode?: "single" | "marathon";
  setDriveMode?: (m: "single" | "marathon") => void;
  marathonBudget?: MarathonBudget;
  setMarathonBudget?: (b: MarathonBudget) => void;
};

const NAV_ITEMS: Array<{ id: CategoryId; label: string; icon: React.ReactNode }> = [
  { id: "channel", label: "推演通道", icon: <Server className="h-4 w-4" /> },
  { id: "llm", label: "浏览器直连", icon: <Cpu className="h-4 w-4" /> },
  { id: "system", label: "系统设置", icon: <SlidersHorizontal className="h-4 w-4" /> },
];

/**
 * 浏览器直连分类的显隐：它是 GitHub Pages 纯浏览器 Demo（无服务端）的唯一
 * LLM 通道，那里必须有；本地/服务端场景是噪音，默认隐藏——除非用户曾经
 * 启用过厂商（老配置仍在生效，必须留入口可见可关，不做暗门）。
 */
function showBrowserDirectTab(): boolean {
  if (IS_GITHUB_PAGES) return true;
  try {
    return loadProvidersConfig()?.providers.some((p) => p.enabled) ?? false;
  } catch {
    return false;
  }
}

/**
 * SlideRule 设置中心（Cherry Studio 风格三栏）。
 * 推演通道分类 = 服务端真通道（五系统生成/评审/AI 写回实际走的 LLM）配置；
 * 浏览器直连分类 = provider-centric BYOK 备用池（仅无服务端时的直连路径消费）；
 * 系统设置分类 = 推演偏好（投影密度 / 默认模式 / 预算）+ 运行时数据管理。
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onClose } = props;
  const [category, setCategory] = React.useState<CategoryId>("channel");
  const [draft, setDraft] = React.useState<LlmProvidersConfig | null>(null);
  // Capture the snapshot we loaded when the dialog was opened (for dirty check + no-op Save guard).
  const initialLlmDraftRef = React.useRef<LlmProvidersConfig | null>(null);

  React.useEffect(() => {
    if (open) {
      setCategory("channel");
      setShowUnsavedConfirm(false);
      const loaded = loadProvidersConfig();
      setDraft(loaded);
      // Deep copy for comparison (simple + sufficient for this config shape).
      initialLlmDraftRef.current = loaded ? JSON.parse(JSON.stringify(loaded)) : null;
    } else {
      initialLlmDraftRef.current = null;
      setShowUnsavedConfirm(false);
    }
  }, [open]);

  const isLlmDirty = React.useMemo(() => {
    if (!draft || !initialLlmDraftRef.current) return false;
    return JSON.stringify(draft) !== JSON.stringify(initialLlmDraftRef.current);
  }, [draft]);

  const [showUnsavedConfirm, setShowUnsavedConfirm] = React.useState(false);

  if (!open) return null;

  const guardedClose = () => {
    if (showUnsavedConfirm) {
      // Click outside / X while confirm is shown → cancel the confirm (common UX)
      setShowUnsavedConfirm(false);
      return;
    }
    if (isLlmDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    onClose();
  };

  const cancelUnsaved = () => setShowUnsavedConfirm(false);
  const forceClose = () => {
    setShowUnsavedConfirm(false);
    onClose();
  };

  const handleSave = () => {
    if (!draft) return;
    // Only persist + toast when there is a meaningful change (avoids "设置已保存" spam on no-op).
    if (!isLlmDirty) {
      setShowUnsavedConfirm(false);
      onClose();
      return;
    }
    // 阻塞非法配置：启用的厂商必须密钥就绪 + Base URL 合法（否则进池会失败）。
    const invalid = draft.providers.find((p) => p.enabled && !isEnabledProviderReady(p));
    if (invalid) {
      toast.error("配置未通过校验", {
        description: `「${invalid.name}」已启用但密钥或 Base URL 不完整，请修正后保存。`,
      });
      return;
    }
    saveProvidersConfig(draft);
    // After a real save, treat current draft as the new baseline so further accidental Save is no-op.
    initialLlmDraftRef.current = JSON.parse(JSON.stringify(draft));
    setShowUnsavedConfirm(false);
    const enabled = draft.providers.filter((p) => p.enabled).length ?? 0;
    toast.success("设置已保存", {
      description: enabled > 0 ? `已启用 ${enabled} 个厂商，下一轮推演生效。` : "未启用厂商，使用服务端 LLM。",
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-[#2A2620]/40 backdrop-blur-sm" onClick={guardedClose} />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4" onClick={guardedClose}>
        <div
          className="relative flex h-[min(86vh,760px)] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-2xl border border-[#E7E2D9] bg-white shadow-[0_24px_70px_rgb(68_60_44/0.28)]"
          data-testid="sliderule-settings-dialog"
          role="dialog"
          aria-label="设置"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={guardedClose}
            className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-stone-400 transition hover:bg-[#F0EDE5] hover:text-stone-700"
            title="关闭"
            data-testid="sliderule-settings-close"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex min-h-0 flex-1">
            {/* 左栏：分类导航 */}
            <nav className="flex w-[190px] shrink-0 flex-col gap-1 border-r border-[#E7E2D9] bg-[#F5F1EA]/70 p-3">
              <div className="mb-3 flex items-center gap-2 px-2 py-2">
                <img
                  src="/assets/sliderule_logo_wordmark_transparent.png"
                  alt="SlideRule"
                  className="h-8"
                  title="SlideRule 设置"
                />
              </div>
              {NAV_ITEMS.filter((item) => item.id !== "llm" || showBrowserDirectTab()).map((item) => {
                const active = category === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setCategory(item.id)}
                    data-testid={`sliderule-settings-nav-${item.id}`}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                      active
                        ? "bg-[#F8E8E0] text-[#B0552F]"
                        : "text-stone-600 hover:bg-white hover:text-stone-800"
                    }`}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                );
              })}
            </nav>

            {/* 内容区 */}
            <div className="flex min-w-0 flex-1 flex-col">
              {category === "channel" ? (
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <LlmChannelPanel />
                </div>
              ) : category === "llm" ? (
                draft ? (
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mx-6 mt-4 rounded-xl bg-[#F5F1EA] px-4 py-2.5 text-[11px] leading-5 text-stone-500 ring-1 ring-[#E7E2D9]">
                      备用通道：仅「浏览器直连」模式（本地无服务端时）消费这里的配置；
                      服务端推演不读它——真通道在左侧「推演通道」里配。
                    </div>
                    <LlmProviderSettings draft={draft} setDraft={setDraft} />
                  </div>
                ) : null
              ) : (
                <div className="flex-1 overflow-y-auto px-6 py-5">
                  <SystemPrefs {...props} />
                </div>
              )}
            </div>
          </div>

          {/* 底部操作 */}
          <div className="flex items-center justify-end gap-2 border-t border-[#E7E2D9] px-4 py-3">
            {showUnsavedConfirm ? (
              <div className="flex w-full items-center justify-between gap-3 text-[12px]">
                <span className="text-rose-600">有未保存的更改，关闭将丢失更改。</span>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={cancelUnsaved}
                    className="rounded-lg border border-[#E7E2D9] bg-white px-4 py-2 text-[13px] font-semibold text-stone-600 transition hover:bg-[#F5F1EA]"
                  >
                    取消
                  </button>
                  <button
                    onClick={forceClose}
                    className="rounded-lg bg-rose-600 px-5 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-rose-500"
                  >
                    确认关闭
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  onClick={guardedClose}
                  className="rounded-lg border border-[#E7E2D9] bg-white px-4 py-2 text-[13px] font-semibold text-stone-600 transition hover:bg-[#F5F1EA]"
                  data-testid="sliderule-settings-close"
                >
                  关闭
                </button>
                {/* 底部保存只管「浏览器直连」草稿；推演通道/系统设置各自即时生效 */}
                {category === "llm" && (
                  <button
                    onClick={handleSave}
                    disabled={!isLlmDirty}
                    className="rounded-lg bg-[#D97757] px-5 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-[#C4633F] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#C4633F]"
                    data-testid="sliderule-settings-save"
                  >
                    保存
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────── 系统设置（推演偏好） ───────────────────────────────────

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
    <div className="flex max-w-md gap-1 rounded-lg bg-[#F0EDE5] p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(opt.value)}
          title={opt.hint}
          className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
            value === opt.value ? "bg-white text-stone-800 shadow-sm" : "text-stone-500 hover:text-stone-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SystemPrefs(props: SettingsDialogProps) {
  const {
    projectionDensity,
    onProjectionDensityChange,
    driveMode,
    setDriveMode,
    marathonBudget,
    setMarathonBudget,
  } = props;
  const budget = marathonBudget?.maxTokens ?? 12000;
  const labelClass = "mb-1.5 block text-[12px] font-semibold text-stone-600";

  return (
    <div className="max-w-xl space-y-6" data-testid="sliderule-settings-prefs">
      <div>
        <label className={labelClass}>投影密度</label>
        <Segmented
          value={projectionDensity}
          onChange={onProjectionDensityChange}
          options={[
            { value: "compact", label: "简", hint: "精简投影，只显示关键节点" },
            { value: "detailed", label: "详", hint: "展开证据/阶段/树的溯源链" },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-stone-400">控制推演图节点展开的详略程度。</p>
      </div>

      <div>
        <label className={labelClass}>默认推演模式</label>
        <Segmented
          value={driveMode}
          onChange={setDriveMode}
          options={[
            { value: "single", label: "深思一轮", hint: "想清楚一个问题就停，等你确认下一步" },
            { value: "marathon", label: "持续推演", hint: "自动多轮推进，直到预算/前沿尽/需要人工介入" },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-stone-400">与底部输入框的模式选择同步。</p>
      </div>

      <div>
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
          className="w-full max-w-md rounded-lg border border-[#E7E2D9] bg-white px-3 py-2 font-mono text-[13px] text-stone-800 outline-none transition focus:border-[#D97757] focus:ring-2 focus:ring-[#F3DCD0]"
          data-testid="sliderule-settings-budget"
        />
        <p className="mt-1.5 text-[11px] text-stone-400">
          持续推演模式单条消息的 token 上限，达到后停在等待人工介入。
        </p>
      </div>

      <RuntimeDataSection sessionId={props.sessionId} />
    </div>
  );
}

/** 数据管理：本话题运行时数据（实体行/流程实例/角色视角）的查看与清空。 */
function RuntimeDataSection({ sessionId }: { sessionId?: string }) {
  const [version, setVersion] = React.useState(0);
  const summary = React.useMemo(() => {
    if (!sessionId) return null;
    const state = loadRuntimeState(sessionId);
    if (!state) return { rows: 0, instances: 0 };
    return {
      rows: Object.values(state.entities).reduce((n, list) => n + list.length, 0),
      instances: state.instances.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, version]);

  if (!sessionId) return null;

  const clear = () => {
    clearRuntimeState(sessionId);
    clearRuntimeRole(sessionId);
    notifyRuntimeChanged(sessionId);
    setVersion((v) => v + 1);
    toast.success("已清空本话题运行时数据", {
      description: "实体行、流程实例与角色视角已重置；模型与推演过程不受影响。",
    });
  };

  return (
    <div className="border-t border-[#E7E2D9] pt-5">
      <label className="mb-1.5 block text-[12px] font-semibold text-stone-600">运行时数据（本话题）</label>
      <p className="text-[11px] text-stone-400">
        运行应用/数据表/试运行产生的排练数据存在浏览器本机：当前
        <span className="mx-1 font-mono text-stone-500">{summary?.rows ?? 0}</span>行数据 ·
        <span className="mx-1 font-mono text-stone-500">{summary?.instances ?? 0}</span>个流程实例。
      </p>
      <button
        type="button"
        onClick={clear}
        data-testid="sliderule-settings-clear-runtime"
        className="mt-2.5 rounded-lg border border-rose-200 bg-rose-50/60 px-4 py-2 text-[12px] font-semibold text-rose-600 transition hover:bg-rose-100"
      >
        清空本话题运行时数据
      </button>
      <p className="mt-1.5 text-[11px] text-stone-400">
        只清排练数据（行/实例/角色视角），不动五系统模型与会话记录。
      </p>
    </div>
  );
}
