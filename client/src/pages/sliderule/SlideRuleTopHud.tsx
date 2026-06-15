import React from "react";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import type { BrainstormGraphTelemetry } from "@shared/blueprint/brainstorm-reasoning-graph";
import { deriveStatusBarFacts } from "./derive-status-bar";
import { autopilotTheme } from "./autopilot-theme";
import type { SlideRuleExecutorMode } from "./types";
import type { ProjectionDensity } from "./sliderule-projection-constants";
import { IS_GITHUB_PAGES } from "@/lib/deploy-target";
import { Layers, Settings2 } from "lucide-react";

export function SlideRuleTopHud({
  state,
  goal,
  turnCount,
  isRunning,
  driveLoopCount,
  telemetry,
  executorMode,
  projectionDensity,
  onProjectionDensityChange,
  viewMode,
  onViewModeChange,
  onResetSession,
  onOpenSettings,
  onOpenDeliverables,
}: {
  state: V5SessionState;
  goal: string;
  turnCount: number;
  isRunning: boolean;
  driveLoopCount?: number;
  telemetry?: BrainstormGraphTelemetry | null;
  executorMode?: SlideRuleExecutorMode;
  projectionDensity?: ProjectionDensity;
  onProjectionDensityChange?: (density: ProjectionDensity) => void;
  viewMode?: "overview" | "collaboration" | "reasoning";
  onViewModeChange?: (mode: "overview" | "collaboration" | "reasoning") => void;
  onResetSession?: () => void;
  onOpenSettings?: () => void;
  onOpenDeliverables?: () => void;
}) {
  const facts = deriveStatusBarFacts(state, {
    turnCount,
    isRunning,
    driveLoopCount,
    immersion: true,
    executorMode,
  });

  return (
    <header
      className={autopilotTheme.immersionOverlayHeader}
      data-testid="sliderule-status-bar"
    >
      <div className="flex w-full items-start justify-between gap-4">

        <div
          className={`${autopilotTheme.overlayBar} min-w-0 flex-1 pr-4`}
        >
          <img
            src="/assets/sliderule_logo_wordmark_transparent.png"
            alt="SlideRule"
            className="mr-3 h-[42px] w-auto max-w-[156px] shrink-0 object-contain opacity-95 sm:h-[46px]"
            title="SlideRule"
          />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            STATUS
          </span>
          {IS_GITHUB_PAGES && (
            <span
              className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-800 ring-1 ring-inset ring-indigo-200/80"
              data-testid="sliderule-pages-demo-badge"
            >
              GitHub Pages 演示
            </span>
          )}
          <span
            data-testid="sliderule-conclusion-badge"
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${facts.conclusionClassName}`}
          >
            {facts.conclusionLabel}
          </span>
          <span
            data-testid="sliderule-grounding-badge"
            title={facts.groundingHint || facts.groundingLabel}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${facts.groundingClassName}`}
          >
            {facts.groundingLabel}
          </span>
          <span
            data-testid="sliderule-executor-mode"
            className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-medium ring-1 ring-inset ${facts.executorModeClassName}`}
          >
            {facts.executorModeLabel}
          </span>
          {facts.groundingHint && (
            <span
              className="hidden text-[10px] text-amber-700 lg:inline"
              data-testid="sliderule-grounding-hint"
            >
              {facts.groundingHint}
            </span>
          )}
          <span className="hidden h-3 w-px bg-slate-300 sm:inline-block" aria-hidden />
          {/* K6.5: 详略开关可发现性提示 - 首次或切换时建议切详模式看溯源链 (ev/phase/tree 子节点) */}
          {turnCount > 0 && projectionDensity === "compact" && onProjectionDensityChange && (
            <span
              className="ml-1 hidden text-[9px] text-amber-600 lg:inline cursor-pointer hover:underline"
              title="切详模式看证据/阶段/树溯源链"
              onClick={() => onProjectionDensityChange("detailed")}
            >
              [切详看溯源]
            </span>
          )}

          {/* M5 real: budget + costLedger usage (Knife 6). M4 policy. Sync to hud for marathon. */}
          {((state as any).costLedger?.length || (state as any).autopilotPolicy) && (
            <span className="ml-2 text-[8px] text-indigo-300" title="M5: 真实 costLedger 累计 + marathon budget。M4 policy 代答。">
              自动驾驶 · 预算 {((state as any).costLedger || []).length}条记录 / 预设上限 {(typeof window !== "undefined" && (window as any).__slideruleMarathonBudget?.maxTokens) || 12000}
            </span>
          )}
          {/* M7: 真实抽屉面板 (非 alert)。点击展开固定右侧面板，展示 policy/ledger/cost/superseded/frontier/M3 prompt 片段。默认用户语言不泄内部 token。 */}
          {IS_GITHUB_PAGES && (
            <button
              onClick={() => {
                // toggle real drawer (use data attr for test + simple fixed panel below)
                const el = document.getElementById("sliderule-audit-drawer");
                if (el) {
                  el.style.display = el.style.display === "none" ? "block" : "none";
                } else {
                  // create on demand (一次渲染真实面板)
                  const d = document.createElement("div");
                  d.id = "sliderule-audit-drawer";
                  d.style.cssText = "position:fixed;right:8px;top:48px;z-index:9999;max-width:420px;max-height:70vh;overflow:auto;background:#0f172a;color:#e2e8f0;padding:10px;border:1px solid #334155;border-radius:6px;font-size:10px;";
                  const policy = (state as any).autopilotPolicy || {};
                  const costs: any[] = (state as any).costLedger || [];
                  const supers = (state as any).supersededArtifactIds || [];
                  const ledgers = (state.decisionLedger || []).slice(-4);
                  d.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">SlideRule M7 真实审计抽屉 (close: 再次点审计)</div>
<div>Policy: ${JSON.stringify(policy)}</div>
<div>CostLedger (${costs.length}): ${JSON.stringify(costs.slice(-3))}</div>
<div>Superseded: ${supers.length} ids</div>
<div>Ledger (frontier/policy): ${JSON.stringify(ledgers)}</div>
<div style="opacity:0.7">M3 prompt/rationale 已在对话与 decisionLedger 落地（见上轮 assistant 或 raw state）。</div>`;
                  document.body.appendChild(d);
                  // auto hide after long view or click outside basic
                  setTimeout(() => { d.onclick = () => { d.style.display="none"; }; }, 10);
                }
              }}
              className="ml-2 rounded bg-slate-700 px-1 text-[8px] text-white"
              title="M7 真实抽屉：policy + costLedger + superseded + frontier ledger + M3 rationale。默认 UI 隐藏内部机制词。"
            >
              审计
            </button>
          )}
          <span className="font-mono text-[10px] text-slate-400">话题</span>
          <span
            className={`min-w-0 max-w-[min(34vw,300px)] truncate font-medium text-slate-800 sm:max-w-[min(38vw,420px)] ${
              !goal ? "text-slate-400" : ""
            }`}
            data-testid="sliderule-goal-display"
            title={goal}
          >
            {goal || "尚未设定话题"}
          </span>
          <span className="hidden h-3 w-px bg-slate-300 md:inline-block" aria-hidden />
          {/* 空会话时这些计数全为 0，纯噪音 —— 有推演活动后再出现。 */}
          {turnCount > 0 && (
            <>
              <InlineMetric label="可信" value={facts.trustedArtifactCount} />
              <InlineMetric label="缺口" value={facts.openGapCount} />
              <InlineMetric label="环" value={facts.driveLoopCount} />
              <InlineMetric label="调用" value={facts.capabilityRunCount} />
              {telemetry?.sourceCount != null && (
                <InlineMetric label="来源" value={telemetry.sourceCount} />
              )}
              {telemetry?.activeRoleCount != null && (
                <InlineMetric label="角色" value={telemetry.activeRoleCount} />
              )}
            </>
          )}
          <span className="hidden text-slate-400 sm:inline">
            阶段{" "}
            <span className="font-mono font-semibold text-slate-700">{facts.phaseLabel}</span>
          </span>
          {facts.dataReady && (
            <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
              dataReady
            </span>
          )}
          {turnCount > 0 && onViewModeChange && (
            <div
              className="flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 ring-1 ring-slate-200/80"
              data-testid="sliderule-viewmode-toggle"
            >
              {(["overview", "collaboration", "reasoning"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  disabled={isRunning}
                  onClick={() => onViewModeChange(mode)}
                  className={`rounded-full px-2 py-0.5 text-[9px] font-medium transition-colors ${
                    viewMode === mode
                      ? "bg-white text-slate-800 shadow-sm"
                      : "text-slate-500 hover:text-slate-700"
                  }`}
                  title={mode === "overview" ? "概览" : mode === "collaboration" ? "协作" : "思考链"}
                >
                  {mode === "overview" ? "概览" : mode === "collaboration" ? "协作" : "链"}
                </button>
              ))}
            </div>
          )}
        </div>
        <div
          className="flex shrink-0 items-center justify-end gap-2 py-1"
          data-testid="sliderule-header-actions"
        >
          {onOpenDeliverables && (
            <button
              type="button"
              onClick={onOpenDeliverables}
              data-testid="sliderule-deliverables-open"
              className={`${autopilotTheme.auditBtn} flex items-center gap-1`}
              title="交付物（报告 / 规格树 / 文档 / 提示词包 / 架构图 / 交接包）"
            >
              <Layers className="h-3.5 w-3.5" />
              交付物
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              data-testid="sliderule-settings-open"
              className={`${autopilotTheme.auditBtn} flex items-center justify-center`}
              title="设置（模型 / 推演偏好）"
              aria-label="设置"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
          {onResetSession && (
            <button
              type="button"
              onClick={onResetSession}
              disabled={isRunning}
              data-testid="sliderule-reset-session"
              className={autopilotTheme.auditBtn}
              title={isRunning ? "推演进行中，请稍后再重置" : "清空本轮对话与持久化状态，重新开始"}
            >
              重置会话
            </button>
          )}
          <a href="/sliderule/dev" className={autopilotTheme.devLink}>
            Dev
          </a>
        </div>
      </div>
    </header>
  );
}

function InlineMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="tabular-nums text-slate-600">
      <span className="text-slate-400">{label} </span>
      <span className="font-mono font-semibold text-slate-800">{value}</span>
    </span>
  );
}
