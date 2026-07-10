import React from "react";
import { Cpu, Server, SlidersHorizontal, X } from "lucide-react";
import { Switch } from "antd";
import { toast } from "sonner";
import {
  enableCompletionNotify,
  loadEnterBehavior,
  loadNotifyCompletePref,
  loadReduceMotionPref,
  setEnterBehavior,
  setNotifyCompletePref,
  setReduceMotionPref,
  type EnterBehavior,
} from "./user-prefs";
import {
  PROJECTION_DENSITY_STORAGE_KEY,
  type ProjectionDensity,
} from "./sliderule-projection-constants";
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

type CategoryId = "channel" | "llm" | "system";

export type SettingsSurfaceProps = {
  /** 本话题运行时数据（行/实例/角色）的会话 id，供「数据管理」清理 */
  sessionId?: string;
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
};

export type SettingsDialogProps = SettingsSurfaceProps & {
  open: boolean;
  onClose: () => void;
};

/* 系统设置排第一并作默认落点（用户裁决）：偏好/数据管理是日常高频项，
   推演通道/浏览器直连是一次配好就少动的接线 */
const NAV_ITEMS: Array<{
  id: CategoryId;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    id: "system",
    label: "系统设置",
    icon: <SlidersHorizontal className="h-4 w-4" />,
  },
  { id: "channel", label: "推演通道", icon: <Server className="h-4 w-4" /> },
  { id: "llm", label: "浏览器直连", icon: <Cpu className="h-4 w-4" /> },
];

/**
 * SlideRule 设置中心（Cherry Studio 风格三栏）。
 * 系统设置分类排第一且为默认落点（偏好 + 数据管理，日常高频）；
 * 推演通道分类 = 服务端真通道（五系统生成/评审/AI 写回实际走的 LLM）配置；
 * 浏览器直连分类 = provider-centric BYOK 备用池（仅无服务端时的直连路径消费，
 * 自定义厂商重要，常驻可见）；
 * 系统设置分类 = 推演偏好（投影密度）+ 运行时数据管理。
 * （"默认推演模式/预算"已随模式选择器一并从产品面移除——推演恒走
 * drive-full-stream 单发闭环，马拉松是 Dev 面的工程能力。）
 *
 * 弹窗形态保留给需要就地配置的场景；主入口是侧栏「设置」整页（SettingsPage）。
 */
export function SettingsDialog(props: SettingsDialogProps) {
  const { open, onClose, ...surface } = props;
  if (!open) return null;
  return <SettingsSurface mode="dialog" onClose={onClose} {...surface} />;
}

/**
 * 侧栏「设置」的整页形态：铺满内容区，无遮罩/关闭按钮。
 * 推演偏好（投影密度）直接落 localStorage——与推演页共用同一存储键，
 * 切回推演视图重挂载后即生效。
 */
export function SettingsPage() {
  const [density, setDensity] = React.useState<ProjectionDensity>(() => {
    try {
      return localStorage.getItem(PROJECTION_DENSITY_STORAGE_KEY) === "detailed"
        ? "detailed"
        : "compact";
    } catch {
      return "compact";
    }
  });
  const sessionId = React.useMemo(() => {
    try {
      return (
        localStorage.getItem("sliderule:active-session-id") ||
        "sliderule-v51-product"
      );
    } catch {
      return "sliderule-v51-product";
    }
  }, []);

  return (
    <SettingsSurface
      mode="page"
      sessionId={sessionId}
      projectionDensity={density}
      onProjectionDensityChange={d => {
        setDensity(d);
        try {
          localStorage.setItem(PROJECTION_DENSITY_STORAGE_KEY, d);
        } catch {}
      }}
    />
  );
}

function SettingsSurface(
  props: SettingsSurfaceProps & {
    mode: "dialog" | "page";
    onClose?: () => void;
  }
) {
  const { mode, onClose } = props;
  const isDialog = mode === "dialog";
  const [category, setCategory] = React.useState<CategoryId>("system");
  const [draft, setDraft] = React.useState<LlmProvidersConfig | null>(() =>
    loadProvidersConfig()
  );
  // Snapshot loaded at mount (for dirty check + no-op Save guard).
  const initialLlmDraftRef = React.useRef<LlmProvidersConfig | null>(
    draft ? JSON.parse(JSON.stringify(draft)) : null
  );

  const isLlmDirty = React.useMemo(() => {
    if (!draft || !initialLlmDraftRef.current) return false;
    return JSON.stringify(draft) !== JSON.stringify(initialLlmDraftRef.current);
  }, [draft]);

  const [showUnsavedConfirm, setShowUnsavedConfirm] = React.useState(false);

  const guardedClose = () => {
    if (!isDialog) return;
    if (showUnsavedConfirm) {
      // Click outside / X while confirm is shown → cancel the confirm (common UX)
      setShowUnsavedConfirm(false);
      return;
    }
    if (isLlmDirty) {
      setShowUnsavedConfirm(true);
      return;
    }
    onClose?.();
  };

  const cancelUnsaved = () => setShowUnsavedConfirm(false);
  const forceClose = () => {
    setShowUnsavedConfirm(false);
    onClose?.();
  };

  const handleSave = () => {
    if (!draft) return;
    // Only persist + toast when there is a meaningful change (avoids "设置已保存" spam on no-op).
    if (!isLlmDirty) {
      setShowUnsavedConfirm(false);
      if (isDialog) onClose?.();
      return;
    }
    // 阻塞非法配置：启用的厂商必须密钥就绪 + Base URL 合法（否则进池会失败）。
    const invalid = draft.providers.find(
      p => p.enabled && !isEnabledProviderReady(p)
    );
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
    const enabled = draft.providers.filter(p => p.enabled).length ?? 0;
    toast.success("设置已保存", {
      description:
        enabled > 0
          ? `已启用 ${enabled} 个厂商，下一轮推演生效。`
          : "未启用厂商，使用服务端 LLM。",
    });
  };

  const card = (
    <div
      className={
        isDialog
          ? "relative flex h-[min(86vh,760px)] w-[min(96vw,1180px)] flex-col overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-[0_24px_70px_rgb(15_23_42/0.28)]"
          : "relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border border-[#e5e7eb] bg-white shadow-[0_1px_8px_rgb(15_23_42/0.06)]"
      }
      data-testid={
        isDialog ? "sliderule-settings-dialog" : "sliderule-settings-page"
      }
      role={isDialog ? "dialog" : undefined}
      aria-label="设置"
      onClick={isDialog ? e => e.stopPropagation() : undefined}
    >
      {isDialog && (
        <button
          onClick={guardedClose}
          className="absolute right-3 top-3 z-10 rounded p-1.5 text-stone-400 transition hover:bg-[#e9edf2] hover:text-stone-700"
          title="关闭"
          data-testid="sliderule-settings-close"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左栏：分类导航 */}
        {/* 分类导航不放品牌 logo：侧栏已有品牌位，这里重复是噪音（用户反馈） */}
        <nav className="flex w-[190px] shrink-0 flex-col gap-1 border-r border-[#e5e7eb] bg-[#eef0f4]/70 p-3">
          {NAV_ITEMS.map(item => {
            const active = category === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                data-testid={`sliderule-settings-nav-${item.id}`}
                className={`flex items-center gap-2.5 rounded px-3 py-2 text-[13px] font-semibold transition ${
                  active
                    ? "bg-[#e6f4ff] text-[#1677ff]"
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
                <div className="mx-6 mt-4 rounded-md bg-[#eef0f4] px-4 py-2.5 text-[11px] leading-5 text-stone-500 ring-1 ring-[#e5e7eb]">
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

      {/* 底部操作：整页形态只有「浏览器直连」有保存钮，其余分类无按钮就不渲染空条 */}
      {(isDialog || category === "llm") && (
        <div className="flex items-center justify-end gap-2 border-t border-[#e5e7eb] px-4 py-3">
          {isDialog && showUnsavedConfirm ? (
            <div className="flex w-full items-center justify-between gap-3 text-[12px]">
              <span className="text-rose-600">
                有未保存的更改，关闭将丢失更改。
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={cancelUnsaved}
                  className="rounded border border-[#e5e7eb] bg-white px-4 py-2 text-[13px] font-semibold text-stone-600 transition hover:bg-[#eef0f4]"
                >
                  取消
                </button>
                <button
                  onClick={forceClose}
                  className="rounded bg-rose-600 px-5 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-rose-500"
                >
                  确认关闭
                </button>
              </div>
            </div>
          ) : (
            <>
              {isDialog && (
                <button
                  onClick={guardedClose}
                  className="rounded border border-[#e5e7eb] bg-white px-4 py-2 text-[13px] font-semibold text-stone-600 transition hover:bg-[#eef0f4]"
                  data-testid="sliderule-settings-close"
                >
                  关闭
                </button>
              )}
              {/* 底部保存只管「浏览器直连」草稿；推演通道/系统设置各自即时生效 */}
              {category === "llm" && (
                <button
                  onClick={handleSave}
                  disabled={!isLlmDirty}
                  className="rounded bg-[#1677ff] px-5 py-2 text-[13px] font-bold text-white shadow-sm transition hover:bg-[#0958d9] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#0958d9]"
                  data-testid="sliderule-settings-save"
                >
                  保存
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  if (!isDialog) return card;
  return (
    <>
      <div
        className="fixed inset-0 z-[80] bg-[#2A2620]/40 backdrop-blur-sm"
        onClick={guardedClose}
      />
      <div
        className="fixed inset-0 z-[81] flex items-center justify-center p-4"
        onClick={guardedClose}
      >
        {card}
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
    <div className="flex max-w-md gap-1 rounded bg-[#e9edf2] p-1">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(opt.value)}
          title={opt.hint}
          className={`flex-1 rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors ${
            value === opt.value
              ? "bg-white text-stone-800 shadow-sm"
              : "text-stone-500 hover:text-stone-700"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SystemPrefs(props: SettingsSurfaceProps) {
  const { projectionDensity, onProjectionDensityChange } = props;
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
            {
              value: "detailed",
              label: "详",
              hint: "展开证据/阶段/树的溯源链",
            },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-stone-400">
          控制推演图节点展开的详略程度。
        </p>
      </div>

      <UserPrefsSection />

      <RuntimeDataSection sessionId={props.sessionId} />

      <PrivacyFactsSection />
    </div>
  );
}

/** 偏好：减少动效 / 完成通知 / Enter 键行为（即改即生效，localStorage 持久化）。 */
function UserPrefsSection() {
  const [reduceMotion, setReduceMotion] = React.useState(loadReduceMotionPref);
  const [notifyComplete, setNotifyComplete] = React.useState(
    loadNotifyCompletePref
  );
  const [enterMode, setEnterMode] =
    React.useState<EnterBehavior>(loadEnterBehavior);
  const labelClass = "mb-1.5 block text-[12px] font-semibold text-stone-600";

  const toggleNotify = async (next: boolean) => {
    if (!next) {
      setNotifyCompletePref(false);
      setNotifyComplete(false);
      return;
    }
    // 开启需要浏览器授权；被拒绝就如实保持关闭，不装作开了
    const ok = await enableCompletionNotify();
    setNotifyComplete(ok);
    if (!ok) {
      toast.error("浏览器未授权通知", {
        description:
          "通知权限被拒绝或不可用，开关保持关闭。可在浏览器地址栏的站点设置里重新允许通知后再开。",
      });
    }
  };

  return (
    <div
      className="space-y-5 border-t border-[#e5e7eb] pt-5"
      data-testid="sliderule-settings-user-prefs"
    >
      {/* items-center：开关滑块相对左侧「标题+说明」块垂直居中（用户反馈） */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label className={labelClass}>减少动态效果</label>
          <p className="text-[11px] leading-5 text-stone-400">
            关闭思考点弹跳、文字翻滚、光标闪烁等界面动画；系统开启「减弱动态效果」时自动生效。
          </p>
        </div>
        <Switch
          checked={reduceMotion}
          onChange={v => {
            setReduceMotionPref(v);
            setReduceMotion(v);
          }}
          data-testid="sliderule-pref-reduce-motion"
        />
      </div>

      {/* items-center：开关滑块相对左侧「标题+说明」块垂直居中（用户反馈） */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label className={labelClass}>推演完成通知</label>
          <p className="text-[11px] leading-5 text-stone-400">
            长推演时切到别的标签页也不会错过结果：完成时浏览器弹一条通知；停留在本页时不打扰。
          </p>
        </div>
        <Switch
          checked={notifyComplete}
          onChange={toggleNotify}
          data-testid="sliderule-pref-notify-complete"
        />
      </div>

      <div>
        <label className={labelClass}>Enter 键行为</label>
        <Segmented
          value={enterMode}
          onChange={(v: EnterBehavior) => {
            setEnterBehavior(v);
            setEnterMode(v);
          }}
          options={[
            {
              value: "enter",
              label: "Enter 发送",
              hint: "Enter 发送，Shift+Enter 换行",
            },
            {
              value: "ctrl-enter",
              label: "Ctrl+Enter 发送",
              hint: "Enter 换行，Ctrl/Cmd+Enter 发送",
            },
          ]}
        />
        <p className="mt-1.5 text-[11px] text-stone-400">
          Shift+Enter 始终换行；改动即时生效。
        </p>
      </div>
    </div>
  );
}

/** 隐私事实（人话版）：只陈述当前实现已成立的事实，不做承诺式营销。 */
function PrivacyFactsSection() {
  return (
    <div
      className="border-t border-[#e5e7eb] pt-5"
      data-testid="sliderule-settings-privacy-facts"
    >
      <label className="mb-1.5 block text-[12px] font-semibold text-stone-600">
        你的数据存在哪里
      </label>
      <ul className="space-y-1.5 text-[11px] leading-5 text-stone-400">
        <li>
          ·「浏览器直连」里填的 LLM 密钥只存在这台浏览器的本地存储里，
          不会上传到 SlideRule 服务端；换浏览器或清站点数据后需要重填。
        </li>
        <li>
          · 走「推演通道」（服务端）时，密钥配置在服务器环境变量里，
          不经过你的浏览器。
        </li>
        <li>
          · 话题会话（消息与五系统模型）保存在推演服务端，用于恢复历史会话；
          在侧栏删除会话即删除。
        </li>
        <li>
          · 运行应用的排练数据（实体行/流程实例/角色视角）只存浏览器本机，
          可用上方「清空本话题运行时数据」随时清掉。
        </li>
      </ul>
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
      rows: Object.values(state.entities).reduce(
        (n, list) => n + list.length,
        0
      ),
      instances: state.instances.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, version]);

  if (!sessionId) return null;

  const clear = () => {
    clearRuntimeState(sessionId);
    clearRuntimeRole(sessionId);
    notifyRuntimeChanged(sessionId);
    setVersion(v => v + 1);
    toast.success("已清空本话题运行时数据", {
      description: "实体行、流程实例与角色视角已重置；模型与推演过程不受影响。",
    });
  };

  return (
    <div className="border-t border-[#e5e7eb] pt-5">
      <label className="mb-1.5 block text-[12px] font-semibold text-stone-600">
        运行时数据（本话题）
      </label>
      <p className="text-[11px] text-stone-400">
        运行应用/数据表/试运行产生的排练数据存在浏览器本机：当前
        <span className="mx-1 font-mono text-stone-500">
          {summary?.rows ?? 0}
        </span>
        行数据 ·
        <span className="mx-1 font-mono text-stone-500">
          {summary?.instances ?? 0}
        </span>
        个流程实例。
      </p>
      <button
        type="button"
        onClick={clear}
        data-testid="sliderule-settings-clear-runtime"
        className="mt-2.5 rounded border border-rose-200 bg-rose-50/60 px-4 py-2 text-[12px] font-semibold text-rose-600 transition hover:bg-rose-100"
      >
        清空本话题运行时数据
      </button>
      <p className="mt-1.5 text-[11px] text-stone-400">
        只清排练数据（行/实例/角色视角），不动五系统模型与会话记录。
      </p>
    </div>
  );
}
