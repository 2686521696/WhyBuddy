/**
 * Autopilot 驾驶舱右栏收敛 — `<AutopilotRightRail>`
 *
 * 对应 spec：
 * - Spec 1 `autopilot-cockpit-right-rail-convergence/`：scaffolding 与 props 契约
 * - Spec 2 `autopilot-right-rail-stage-panels/`：fabric 8 个 canonical 面板挂载
 * - Spec 3 `autopilot-advanced-workbench-inline/`：fabric 右栏接管
 * - Spec 4 `autopilot-right-rail-data-hook/`：`currentSubStage` 作为数据懒加载 gate
 * - Spec 5 `autopilot-step-driven-rail-navigation/`：Task 3 新增 scroll container + anchor +
 *   派生 scroll effect（尊重 `prefers-reduced-motion`）
 *
 * Spec 5 Task 3 的硬性约束：
 * - 不修改 `AutopilotRightRailProps` 契约（Spec 1 冻结）。
 * - 不修改 Spec 2 canonical 面板的 DOM 结构；`data-sub-stage-anchor` 加在 scaffolding 层
 *   `<section>` 外壳而非面板内部。
 * - 保留 `data-sub-stage-placeholder="${subStage}"` 与 `aria-current="step"` 现有断言
 *   （Spec 3 `fabric-dispatch.property.test.tsx` 依赖）。
 * - scroll 只作用于右栏内容 `scrollRef.current`，不触碰 `document.scrollingElement`。
 * - 首次挂载用 `behavior: "auto"`，之后尊重 `prefers-reduced-motion`。
 * - anchor 未找到时静默 no-op。
 *
 * Spec 5 后续任务（Task 4/5/6/9）会在本组件继续扩展：
 * - 键盘快捷键注册（`document.addEventListener("keydown", ...)`）
 * - Sticky toggle + sr-announcer + tab aria-current
 * - Viewport_Tier 三档渲染分支（drawer trigger / collapse toggle）
 */

import { useEffect, useRef, type FC } from "react";

import {
  readPrefersReducedMotion,
  resolveScrollBehavior,
  scrollAnchorIntoView,
} from "./hooks/use-right-rail-sub-stage-state";
import {
  AgentCrewFabricPanel,
  ArtifactMemoryPanel,
  EffectPreviewPanel,
  EngineeringHandoffPanel,
  PromptPackagePanel,
  RuntimeCapabilityPanel,
  SpecDocumentsPanel,
  SpecTreePanel,
} from "./panels";
import { resolveRailSubStage } from "./resolve-rail-sub-stage";
import {
  RAIL_SUB_STAGE_ORDER,
  type AutopilotRailSubStage,
  type AutopilotRightRailProps,
  type AutopilotTimelineStage,
} from "./types";

/**
 * 5 个顶层 timeline stage 的渲染顺序（只读）。
 */
const TIMELINE_STAGE_ORDER: readonly AutopilotTimelineStage[] = [
  "input",
  "clarification",
  "routeset",
  "selection",
  "fabric",
] as const;

/**
 * 5 个 timeline stage placeholder 的中英双语占位文案。
 */
const TIMELINE_STAGE_LABELS: Record<
  AutopilotTimelineStage,
  { "zh-CN": string; "en-US": string }
> = {
  input: { "zh-CN": "输入阶段", "en-US": "Input stage" },
  clarification: { "zh-CN": "澄清问答", "en-US": "Clarification" },
  routeset: { "zh-CN": "路线候选", "en-US": "Route set" },
  selection: { "zh-CN": "路线选择", "en-US": "Route selection" },
  fabric: {
    "zh-CN": "AgentCrewFabric 推演工作台",
    "en-US": "AgentCrewFabric workbench",
  },
};

/**
 * Anchor 属性名（Task 3 新增）。
 * 测试、组件、hook 共用同一常量，避免字符串漂移。
 */
export const RAIL_SUB_STAGE_ANCHOR_ATTR = "data-sub-stage-anchor" as const;

/**
 * `<aside>` 根节点的 aria-label 值。
 */
function resolveAriaLabel(locale: AutopilotRightRailProps["locale"]): string {
  return locale === "zh-CN"
    ? "Autopilot 右栏工作台"
    : "Autopilot right rail workbench";
}

/**
 * 渲染指定 sub-stage 对应的 canonical 面板。
 *
 * 抽离为独立函数以便主 JSX 保持扁平；面板的 props subset 仍由 Spec 2 的 `Pick` 契约决定。
 * 本函数不修改任何面板内部 DOM。
 */
function renderSubStagePanel(params: {
  subStage: AutopilotRailSubStage;
  jobId: string;
  job: AutopilotRightRailProps["job"];
  agentCrew: AutopilotRightRailProps["agentCrew"];
  capabilities: AutopilotRightRailProps["capabilities"];
  capabilityInvocations: AutopilotRightRailProps["capabilityInvocations"];
  capabilityEvidence: AutopilotRightRailProps["capabilityEvidence"];
  specTree: AutopilotRightRailProps["specTree"];
  selection: AutopilotRightRailProps["selection"];
  effectPreviews: AutopilotRightRailProps["effectPreviews"];
  locale: AutopilotRightRailProps["locale"];
}) {
  const { subStage, jobId, job, agentCrew, capabilities, capabilityInvocations, capabilityEvidence, specTree, selection, effectPreviews, locale } = params;

  if (subStage === "agent_crew_fabric") {
    return (
      <AgentCrewFabricPanel
        jobId={jobId}
        job={job}
        agentCrew={agentCrew}
        capabilities={capabilities}
        capabilityInvocations={capabilityInvocations}
        capabilityEvidence={capabilityEvidence}
        locale={locale}
      />
    );
  }
  if (subStage === "spec_tree") {
    return (
      <SpecTreePanel
        jobId={jobId}
        specTree={specTree}
        selection={selection}
        locale={locale}
      />
    );
  }
  if (subStage === "spec_documents") {
    return <SpecDocumentsPanel jobId={jobId} specTree={specTree} locale={locale} />;
  }
  if (subStage === "effect_preview") {
    return (
      <EffectPreviewPanel
        jobId={jobId}
        job={job}
        specTree={specTree}
        effectPreviews={effectPreviews}
        agentCrew={agentCrew}
        capabilityEvidence={capabilityEvidence}
        locale={locale}
      />
    );
  }
  if (subStage === "prompt_package") {
    return (
      <PromptPackagePanel
        jobId={jobId}
        specTree={specTree}
        effectPreviews={effectPreviews}
        locale={locale}
      />
    );
  }
  if (subStage === "runtime_capability") {
    return (
      <RuntimeCapabilityPanel
        jobId={jobId}
        specTree={specTree}
        capabilities={capabilities}
        capabilityInvocations={capabilityInvocations}
        capabilityEvidence={capabilityEvidence}
        agentCrew={agentCrew}
        locale={locale}
      />
    );
  }
  if (subStage === "engineering_handoff") {
    return <EngineeringHandoffPanel jobId={jobId} locale={locale} />;
  }
  if (subStage === "artifact_memory") {
    return <ArtifactMemoryPanel jobId={jobId} locale={locale} />;
  }
  // Exhaustive safety net for `AutopilotRailSubStage`. Reaching here implies a new
  // sub-stage was added without updating this switch.
  return subStage satisfies never;
}

export const AutopilotRightRail: FC<AutopilotRightRailProps> = (props) => {
  const {
    jobId,
    currentStage,
    currentSubStage: currentSubStageFromProps,
    job,
    selection,
    specTree,
    agentCrew,
    capabilities,
    capabilityInvocations,
    capabilityEvidence,
    effectPreviews,
    locale,
  } = props;

  // 本地 resolver 的结果；props 值优先，保证 Spec 4 / 5 的 URL / pin-state 覆盖链路无缝接管。
  const computedSubStage = resolveRailSubStage({
    currentStage,
    job,
    selection,
    specTree,
    agentCrew,
  });
  const activeSubStage: AutopilotRailSubStage | undefined =
    currentSubStageFromProps ?? computedSubStage;

  // -------------------------------------------------------------------------
  // Spec 5 Task 3 — 步骤驱动自动滚动
  // -------------------------------------------------------------------------
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstMountRef = useRef<boolean>(true);

  useEffect(() => {
    // 非 fabric 阶段 / activeSubStage 缺失 → 不触发任何滚动。
    if (currentStage !== "fabric" || !activeSubStage) {
      return;
    }
    const behavior = resolveScrollBehavior({
      isFirstMount: firstMountRef.current,
      prefersReducedMotion: readPrefersReducedMotion(),
    });
    scrollAnchorIntoView({
      container: scrollRef.current,
      anchorAttr: RAIL_SUB_STAGE_ANCHOR_ATTR,
      anchorValue: activeSubStage,
      behavior,
      block: "start",
    });
    // 首次执行后清除 first-mount flag，使后续切换可以走 smooth（除非用户偏好 reduce）。
    if (firstMountRef.current) {
      firstMountRef.current = false;
    }
  }, [currentStage, activeSubStage]);

  return (
    <aside
      role="complementary"
      aria-label={resolveAriaLabel(locale)}
      data-testid="autopilot-right-rail"
      data-autopilot-stage={currentStage}
      data-autopilot-sub-stage={activeSubStage ?? ""}
    >
      {TIMELINE_STAGE_ORDER.map((stage) => {
        const labels = TIMELINE_STAGE_LABELS[stage];
        const label = labels[locale] ?? labels["en-US"];
        const isFabric = stage === "fabric";
        const isActive = stage === currentStage;

        if (!isFabric || currentStage !== "fabric") {
          return (
            <div
              key={stage}
              data-stage-placeholder={stage}
              data-active={isActive ? "true" : "false"}
            >
              <div>{label}</div>
            </div>
          );
        }

        // fabric 分支：包裹 scroll container + 8 个 anchor <section>。
        return (
          <div
            key={stage}
            data-stage-placeholder={stage}
            data-active={isActive ? "true" : "false"}
          >
            <div>{label}</div>
            <div
              ref={scrollRef}
              data-testid="autopilot-right-rail-scroll-container"
              className="relative h-full overflow-y-auto"
            >
              {RAIL_SUB_STAGE_ORDER.map((subStage) => {
                const isCurrent = subStage === activeSubStage;
                return (
                  <section
                    key={subStage}
                    {...{ [RAIL_SUB_STAGE_ANCHOR_ATTR]: subStage }}
                    data-sub-stage-placeholder={subStage}
                    aria-current={isCurrent ? "step" : undefined}
                    aria-hidden={isCurrent ? undefined : true}
                    className="scroll-mt-4"
                  >
                    {isCurrent
                      ? renderSubStagePanel({
                          subStage,
                          jobId,
                          job,
                          agentCrew,
                          capabilities,
                          capabilityInvocations,
                          capabilityEvidence,
                          specTree,
                          selection,
                          effectPreviews,
                          locale,
                        })
                      : null}
                  </section>
                );
              })}
            </div>
          </div>
        );
      })}
    </aside>
  );
};

export default AutopilotRightRail;
