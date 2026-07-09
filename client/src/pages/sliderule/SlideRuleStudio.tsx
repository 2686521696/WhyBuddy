/**
 * SlideRuleStudio — 统一页主布局容器（左 38% + 右 62%）
 *
 * 左侧：Chat 对话区（ClaudeChatSurface，含唯一空态：logo 水印 + hero 文案 + 示例 chips）。
 *
 * 右侧主舞台（方向 B：应用为主，五系统是游标透视层）——三态：
 *   theater — 推演进行中（SSE activeSkillId 驱动），系统屏生成剧场逐屏亮相；
 *   app     — 闭环出应用后，运行应用整高铺满为默认舞台；「游标」开关透视
 *             当前页面背后的实体/流程/角色/AI，点任何一节侧滑抽屉深入系统屏；
 *   board   — 尚无可运行应用（空会话/未闭环），保留六系统缩略 + 证据看板。
 * 六系统屏不再是并列切屏，而是应用的透视层（抽屉承载，全部保留）。
 */

import React, { useState, useCallback, useMemo, useEffect } from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";
import { SkillThumbnailBar } from "./SkillThumbnailBar";
import { ActiveSystemScreen } from "./system-screens/ActiveSystemScreen";
import {
  mergeFiveSystemModels,
  parseFiveSystemModelFromContents,
  parseFiveSystemModelFromPerSkillEvidence,
  parsePartialFiveSystemModel,
  type SkillRuntimeGraphLike,
} from "./system-screens/five-system-model";
import { deriveAppRuntimeSchema } from "./live-runtime/app-runtime-schema";
import { AppRuntimeScreen } from "./live-runtime/AppRuntimeScreen";
import { XrayPanel, type XrayTarget } from "./XrayPanel";
import { Crosshair, X } from "lucide-react";

const XRAY_PREF_KEY = "sliderule:xray-on";

/** 抽屉标题：系统的中文名（游标语境下不再用英文胶囊） */
const SKILL_LABELS: Record<SkillId, string> = {
  dataModel: "数据模型",
  workflow: "工作流",
  rbac: "角色权限",
  page: "页面",
  aigc: "AI 能力",
  appBundle: "应用装配 · 联动总图",
};

interface SlideRuleStudioProps {
  // --- Chat panel (left) ---
  chatSlot: React.ReactNode;

  // --- Right panel data ---
  activeSkillId: SkillId | null;
  publishClosure?: PublishClosureSummary | null;
  /** Latest mermaid string from an SSE skill_result event */
  latestMermaid?: string | null;
  /** Per-skill raw content accumulated from SSE skill_result events */
  skillContents?: Partial<Record<SkillId, string>>;
  /** Persisted cross-skill runtime graph (python /drive-full projection) */
  skillRuntimeGraph?: SkillRuntimeGraphLike | null;
  /** 试运行（浏览器运行时）状态的持久化命名空间 */
  sessionId?: string;
  /** 运行应用标题（话题名） */
  appTitle?: string;

  /** 右侧主舞台是否显示。空会话（用户还没输入）时隐藏——欢迎页独占全宽，
   *  不摆一排空壳看板；首条消息发出后舞台才登场。默认 true。 */
  stageVisible?: boolean;

  /** 推演进行中（驱动一轮消息期间）。 */
  isRunning?: boolean;
  /** LLM 实时输出（llm_delta 累积）+ 来源标签。推演中右侧舞台实时消费：
   *  五系统起草的部分 JSON 能拼出页面时应用实时长出来；拼不出时只报
   *  "推演中"（实时想法由左栏流出，不重复）。 */
  llmDraft?: string;
  llmDraftLabel?: string | null;

  className?: string;
}

export function SlideRuleStudio({
  chatSlot,
  activeSkillId,
  publishClosure,
  latestMermaid,
  skillContents,
  skillRuntimeGraph,
  sessionId,
  appTitle,
  stageVisible = true,
  isRunning = false,
  llmDraft = "",
  llmDraftLabel = null,
  className = "",
}: SlideRuleStudioProps) {
  // Allow manual override of the displayed screen (click thumbnail, board/theater 态)
  const [manualSkill, setManualSkill] = useState<SkillId | null>(null);

  // SSE events take priority during a run; manual selection persists between runs.
  const displaySkillId = activeSkillId ?? manualSkill;

  const handleThumbnailSelect = useCallback((id: SkillId) => {
    setManualSkill(id);
  }, []);

  // 五系统模型在此解析一次：舞台判定（能否运行应用）+ 抽屉/游标共享
  const settledModel = useMemo(
    () =>
      mergeFiveSystemModels(
        parseFiveSystemModelFromContents(skillContents ?? {}),
        parseFiveSystemModelFromPerSkillEvidence(
          publishClosure?.perSkillEvidence
        )
      ),
    [skillContents, publishClosure?.perSkillEvidence]
  );

  // 起草中的部分模型：五系统 JSON 还在流式生成时容错解析（每 +300 字符重解一次，
  // 避免逐 delta 重渲染）。仅实时预览——最终真实模型仍以闭环证据为准。
  const isDraftingModel =
    isRunning && llmDraftLabel === "five-system-model" && !!llmDraft;
  const draftParseKey = isDraftingModel
    ? Math.floor(llmDraft.length / 300)
    : -1;
  const draftModel = useMemo(
    () => (isDraftingModel ? parsePartialFiveSystemModel(llmDraft) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按长度桶节流重解
    [isDraftingModel, draftParseKey]
  );

  const fiveSystemModel = settledModel ?? draftModel;
  const modelIsDraft = !settledModel && !!draftModel;
  const appSchema = useMemo(
    () => deriveAppRuntimeSchema(fiveSystemModel, appTitle || "推演应用"),
    [fiveSystemModel, appTitle]
  );

  // 舞台：推演剧场 > 应用主舞台（含起草实时预览）> 推演想法直播 > 证据看板
  const stage: "theater" | "app" | "live" | "board" = activeSkillId
    ? "theater"
    : appSchema && fiveSystemModel
      ? "app"
      : isRunning && llmDraft
        ? "live"
        : "board";

  // 游标开关（计算尺游标 hairline 的品牌梗；偏好持久化）+ 跟随应用内当前页
  const [xrayOn, setXrayOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(XRAY_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleXray = useCallback(() => {
    setXrayOn(v => {
      try {
        localStorage.setItem(XRAY_PREF_KEY, v ? "0" : "1");
      } catch {}
      if (v) setXrayTarget(null); // 关游标时清掉残留焦点
      return !v;
    });
  }, []);
  const [appActivePageId, setAppActivePageId] = useState<string>("home");
  // 元素级焦点：应用内被悬停元素的背后声明（AR）
  const [xrayTarget, setXrayTarget] = useState<XrayTarget | null>(null);

  // 系统屏抽屉（游标深入 / 抽屉内六系统横向切换）
  const [drawerSkill, setDrawerSkill] = useState<SkillId | null>(null);
  useEffect(() => {
    if (!drawerSkill) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setDrawerSkill(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerSkill]);

  // 空会话：欢迎页独占全宽，右侧舞台整体不渲染（用户还没输入，没内容可看）
  if (!stageVisible) {
    return (
      <div className={`flex h-full w-full overflow-hidden ${className}`}>
        <div className="flex h-full w-full flex-col bg-[#f7f8fa]">
          {chatSlot}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-full w-full overflow-hidden ${className}`}>
      {/* Left panel — 38% — Chat（对话 + 实时推演过程） */}
      <div
        className="flex h-full shrink-0 flex-col border-r border-[#e5e7eb] bg-[#f7f8fa]"
        style={{ width: "38%" }}
      >
        {chatSlot}
      </div>

      {/* Right panel — 62% — 主舞台 */}
      {/* 与左侧 IM 同一底色（用户反馈：右侧多种颜色不统一） */}
      <div className="relative flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[#f7f8fa] p-4">
        {stage === "app" && fiveSystemModel ? (
          <>
            {/* 应用主舞台：细头条（话题 + 游标开关），其下应用整高铺满 */}
            <div
              className="flex shrink-0 items-center gap-2"
              data-testid="sliderule-app-stage-bar"
            >
              <span className="min-w-0 truncate text-[12px] font-semibold text-stone-600">
                {appTitle || "推演应用"}
              </span>
              {modelIsDraft ? (
                <span className="flex items-center gap-1.5 rounded-full bg-[#FDF6F1] px-2 py-0.5 text-[10px] font-medium text-[#C05621]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#1677ff]" />
                  生成中 · 实时渲染
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  运行中
                </span>
              )}
              <button
                type="button"
                onClick={toggleXray}
                data-testid="sliderule-xray-toggle"
                aria-pressed={xrayOn}
                className={`ml-auto flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold transition ${
                  xrayOn
                    ? "border-transparent bg-[#1677ff] text-white shadow-sm"
                    : "border-[#e5e7eb] bg-white text-stone-600 hover:border-[#d3d8e0] hover:bg-[#f8f9fb]"
                }`}
                title="计算尺的游标：对齐到元素，读出它在五系统刻度上的对应声明"
              >
                <Crosshair className="h-4 w-4" />
                游标
              </button>
            </div>
            <div
              className="flex min-h-0 flex-1 gap-3"
              data-testid="sliderule-app-stage"
            >
              {/* 画布直接浮在奶油底上（自带投影），不再包白色卡框叠色 */}
              <div className="min-w-0 flex-1 overflow-hidden">
                <AppRuntimeScreen
                  // 起草预览：模型每 +300 字符长一截，重挂让新页面/字段即刻上屏
                  key={modelIsDraft ? `draft-${draftParseKey}` : "settled"}
                  model={fiveSystemModel}
                  sessionId={sessionId ?? "sliderule-v51-product"}
                  appTitle={appTitle}
                  onActivePageChange={setAppActivePageId}
                  xrayActive={xrayOn}
                  onXrayTarget={setXrayTarget}
                />
              </div>
              {xrayOn && appSchema && (
                <XrayPanel
                  model={fiveSystemModel}
                  schema={appSchema}
                  activePageId={appActivePageId}
                  target={xrayTarget}
                  onOpenSystem={setDrawerSkill}
                />
              )}
            </div>
          </>
        ) : stage === "live" ? (
          /* 模型还没成形（轮内步骤 / 起草早期）：右侧只报"推演中"——实时想法
             已在左栏流出（用户反馈：右侧别重复直播内容），应用成形后接管舞台。 */
          <div
            className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3"
            data-testid="sliderule-live-stage"
          >
            <span className="inline-flex gap-1">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="h-2 w-2 animate-pulse rounded-full bg-[#1677ff]/60"
                  style={{ animationDelay: `${i * 150}ms` }}
                />
              ))}
            </span>
            <div className="text-[13px] font-medium text-stone-500">推演中</div>
            <div className="text-[11px] text-stone-400">
              应用成形后将在这里实时渲染
            </div>
          </div>
        ) : (
          <>
            {/* 推演剧场 / 证据看板：沿用六系统缩略 + 16:9 系统屏 */}
            <div className="flex shrink-0 items-center">
              <SkillThumbnailBar
                activeSkillId={displaySkillId}
                publishClosure={publishClosure}
                onSelect={handleThumbnailSelect}
              />
            </div>

            <ActiveSystemScreen
              activeSkillId={displaySkillId}
              publishClosure={publishClosure}
              latestMermaid={latestMermaid}
              skillContents={skillContents}
              skillRuntimeGraph={skillRuntimeGraph}
              sessionId={sessionId}
              appTitle={appTitle}
              className="min-h-0 flex-1"
            />
          </>
        )}

        {/* 系统屏抽屉：单类别全幅呈现——点哪类看哪类（用户反馈：去六系统切换条、去白卡嵌套、占满区域） */}
        {drawerSkill && (
          <div
            className="absolute inset-0 z-40 flex flex-col bg-[#f7f8fa]"
            data-testid="sliderule-system-drawer"
          >
            <div className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
              <span className="text-[13px] font-semibold text-stone-800">
                {SKILL_LABELS[drawerSkill]}
              </span>
              <span className="text-[11px] text-stone-400">
                游标透视 · 应用背后的声明
              </span>
              <button
                type="button"
                onClick={() => setDrawerSkill(null)}
                data-testid="sliderule-system-drawer-close"
                className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 transition hover:bg-[#e9edf2] hover:text-stone-700"
                title="关闭（Esc）"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <ActiveSystemScreen
              activeSkillId={drawerSkill}
              publishClosure={publishClosure}
              latestMermaid={latestMermaid}
              skillContents={skillContents}
              skillRuntimeGraph={skillRuntimeGraph}
              sessionId={sessionId}
              appTitle={appTitle}
              model={fiveSystemModel}
              fill
              className="min-h-0 flex-1"
            />
          </div>
        )}
      </div>
    </div>
  );
}
