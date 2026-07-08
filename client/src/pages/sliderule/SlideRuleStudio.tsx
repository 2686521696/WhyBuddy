/**
 * SlideRuleStudio — 统一页主布局容器（左 38% + 右 62%）
 *
 * 左侧：Chat 对话区（ClaudeChatSurface，含唯一空态：logo 水印 + hero 文案 + 示例 chips）。
 *
 * 右侧主舞台（方向 B：应用为主，五系统是 X 光）——三态：
 *   theater — 推演进行中（SSE activeSkillId 驱动），系统屏生成剧场逐屏亮相；
 *   app     — 闭环出应用后，运行应用整高铺满为默认舞台；「X 光」开关透视
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
  type SkillRuntimeGraphLike,
} from "./system-screens/five-system-model";
import { deriveAppRuntimeSchema } from "./live-runtime/app-runtime-schema";
import { AppRuntimeScreen } from "./live-runtime/AppRuntimeScreen";
import { XrayPanel, type XrayTarget } from "./XrayPanel";
import { ScanEye, X } from "lucide-react";

const XRAY_PREF_KEY = "sliderule:xray-on";

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
  className = "",
}: SlideRuleStudioProps) {
  // Allow manual override of the displayed screen (click thumbnail, board/theater 态)
  const [manualSkill, setManualSkill] = useState<SkillId | null>(null);

  // SSE events take priority during a run; manual selection persists between runs.
  const displaySkillId = activeSkillId ?? manualSkill;

  const handleThumbnailSelect = useCallback((id: SkillId) => {
    setManualSkill(id);
  }, []);

  // 五系统模型在此解析一次：舞台判定（能否运行应用）+ 抽屉/X 光共享
  const fiveSystemModel = useMemo(
    () =>
      mergeFiveSystemModels(
        parseFiveSystemModelFromContents(skillContents ?? {}),
        parseFiveSystemModelFromPerSkillEvidence(publishClosure?.perSkillEvidence)
      ),
    [skillContents, publishClosure?.perSkillEvidence]
  );
  const appSchema = useMemo(
    () => deriveAppRuntimeSchema(fiveSystemModel, appTitle || "推演应用"),
    [fiveSystemModel, appTitle]
  );

  // 三态舞台：推演剧场 > 应用主舞台 > 证据看板
  const stage: "theater" | "app" | "board" = activeSkillId
    ? "theater"
    : appSchema && fiveSystemModel
      ? "app"
      : "board";

  // X 光开关（偏好持久化）+ 跟随应用内当前页
  const [xrayOn, setXrayOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(XRAY_PREF_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleXray = useCallback(() => {
    setXrayOn((v) => {
      try {
        localStorage.setItem(XRAY_PREF_KEY, v ? "0" : "1");
      } catch {}
      if (v) setXrayTarget(null); // 关 X 光时清掉残留焦点
      return !v;
    });
  }, []);
  const [appActivePageId, setAppActivePageId] = useState<string>("home");
  // 元素级焦点：应用内被悬停元素的背后声明（AR）
  const [xrayTarget, setXrayTarget] = useState<XrayTarget | null>(null);

  // 系统屏抽屉（X 光深入 / 抽屉内六系统横向切换）
  const [drawerSkill, setDrawerSkill] = useState<SkillId | null>(null);
  useEffect(() => {
    if (!drawerSkill) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setDrawerSkill(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerSkill]);

  return (
    <div className={`flex h-full w-full overflow-hidden ${className}`}>
      {/* Left panel — 38% — Chat（对话 + 实时推演过程） */}
      <div className="flex h-full shrink-0 flex-col border-r border-[#E7E2D9] bg-[#FAF9F5]"
           style={{ width: "38%" }}>
        {chatSlot}
      </div>

      {/* Right panel — 62% — 主舞台 */}
      <div className="relative flex min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-[#F5F1EA] p-4">
        {stage === "app" && fiveSystemModel ? (
          <>
            {/* 应用主舞台：细头条（话题 + X 光开关），其下应用整高铺满 */}
            <div className="flex shrink-0 items-center gap-2" data-testid="sliderule-app-stage-bar">
              <span className="min-w-0 truncate text-[12px] font-semibold text-stone-600">
                {appTitle || "推演应用"}
              </span>
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                运行中
              </span>
              <button
                type="button"
                onClick={toggleXray}
                data-testid="sliderule-xray-toggle"
                aria-pressed={xrayOn}
                className={`ml-auto flex h-8 items-center gap-1.5 rounded-full border px-3.5 text-[12px] font-semibold transition ${
                  xrayOn
                    ? "border-transparent bg-[#D97757] text-white shadow-sm"
                    : "border-[#E7E2D9] bg-white text-stone-600 hover:border-[#D8D1C4] hover:bg-[#FAF8F3]"
                }`}
                title="透视当前页面背后的实体/流程/角色/AI"
              >
                <ScanEye className="h-4 w-4" />
                X 光
              </button>
            </div>
            <div className="flex min-h-0 flex-1 gap-3" data-testid="sliderule-app-stage">
              <div className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-[#E7E2D9] bg-white shadow-sm">
                <AppRuntimeScreen
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

        {/* 系统屏抽屉：X 光深入入口；六系统在抽屉头横向切换（全部保留，不再是主界面并列切屏） */}
        {drawerSkill && (
          <>
            <div
              className="absolute inset-0 z-30 bg-[#2A2620]/30 backdrop-blur-[2px]"
              onClick={() => setDrawerSkill(null)}
            />
            <div
              className="absolute bottom-0 right-0 top-0 z-40 flex w-[min(92%,1080px)] flex-col gap-2 border-l border-[#E7E2D9] bg-[#F5F1EA] p-3 shadow-[-18px_0_50px_rgb(68_60_44/0.25)]"
              data-testid="sliderule-system-drawer"
            >
              <div className="flex shrink-0 items-center gap-2">
                <SkillThumbnailBar
                  activeSkillId={drawerSkill}
                  publishClosure={publishClosure}
                  onSelect={setDrawerSkill}
                />
                <button
                  type="button"
                  onClick={() => setDrawerSkill(null)}
                  data-testid="sliderule-system-drawer-close"
                  className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E7E2D9] bg-white text-stone-500 transition hover:bg-[#FAF8F3]"
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
          </>
        )}
      </div>
    </div>
  );
}
