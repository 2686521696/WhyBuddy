/**
 * BlueprintWallEmptyState - 蓝图墙面流程图空态 overlay（纯 React 组件）。
 *
 * 当没有活动蓝图作业（`job` 为 null/undefined，deriver 产出零节点）时，墙面图
 * 画布**不挂载** FlowGraph，由本组件渲染一块「干净的空图状态」：浅色画布上居中的
 * 短文案，明确表达「当前无进行中的蓝图作业」，**不**落任何 mission-first 兜底数据
 * （无终端日志、无截图、无任务摘要、无臆造节点/边）。
 *
 * 设计要点（对应 design「## Error Handling」第 1 条 +「### BlueprintWallProcessGraphHud」
 * 的「render empty state when `job` is absent」+ Req 4.2 / 10.6）：
 *  - **干净空态，无 mission 兜底**（Req 4.2）：本组件只渲染本地化的占位文案，**不**消费
 *    任何 store / 网络 / mission-first 沙箱状态，也不渲染上一作业的残留内容。空态由
 *    deriver 的 job 隔离保证（无 job → 零节点 → 空图），本组件只是其视觉收尾。
 *  - **`reason` 仅用于视觉/可测语义**：deriver 的 `emptyReason`（`"no-job"` /
 *    `"no-blueprint-data"`）透传为稳定 `data-empty-reason` 属性，供测试断言空态来源；
 *    文案对两种 reason 一致克制，不臆造区别叙事。
 *  - **纯函数组件**：无 hook、无副作用、确定性输出，可被 `react-dom/server`
 *    `renderToStaticMarkup` 直接渲染（Task 6.3 空态测试），无需渲染重型 FlowGraph。
 *  - **本地化**：支持 `zh-CN`（默认）与 `en-US` 两套标题 / 提示文案。
 *
 * 作用域护栏（Req 3.7 / 4.4 / 4.5）：本组件**不得** import `useSandboxStore` /
 * `SandboxMonitor` / `MissionWallTaskPanel`，也不读取任何 mission-first 数据源。
 */

import type { AppLocale } from "@/lib/locale";

import type { BlueprintWallProcessData } from "./blueprint-wall-process-data";

// ─── Component props ─────────────────────────────────────────────────────────

export interface BlueprintWallEmptyStateProps {
  /**
   * deriver 的空态原因（`Wall_Process_Data.emptyReason`）。
   *
   * `"no-job"`：无活动蓝图作业（Req 4.2 主场景）。
   * `"no-blueprint-data"`：有 job 但尚无蓝图数据（此时通常仍有阶段主干节点，故 HUD
   *   一般不进空态，仅作语义完备透传）。
   * 缺省（`undefined`）按 `"no-job"` 语义处理。
   */
  reason?: BlueprintWallProcessData["emptyReason"];
  /** 本地化语言；缺省回退 `DEFAULT_EMPTY_LOCALE`（zh-CN）。 */
  locale?: AppLocale;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** 空态缺省 locale（与 deriver 的 `locale ?? "zh-CN"` 口径一致）。 */
const DEFAULT_EMPTY_LOCALE: AppLocale = "zh-CN";

/** 空态主标题（本地化）。 */
const EMPTY_TITLE: Record<AppLocale, string> = {
  "zh-CN": "蓝图流程图",
  "en-US": "Blueprint process graph",
};

/** 空态提示副文案（本地化，明确「无活动作业」语义，Req 4.2）。 */
const EMPTY_HINT: Record<AppLocale, string> = {
  "zh-CN": "暂无进行中的蓝图作业",
  "en-US": "No active blueprint job",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** 解析空态实际使用的 locale（缺省回退 zh-CN）。 */
function resolveLocale(locale: AppLocale | undefined): AppLocale {
  return locale ?? DEFAULT_EMPTY_LOCALE;
}

/** 解析空态原因的稳定 data 属性值（缺省按 no-job 处理）。 */
function resolveReason(
  reason: BlueprintWallProcessData["emptyReason"]
): "no-job" | "no-blueprint-data" {
  return reason === "no-blueprint-data" ? "no-blueprint-data" : "no-job";
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  // 空态是纯视觉兜底，不拦截墙面图指针事件（与其它 overlay 口径一致）。
  pointerEvents: "none",
  textAlign: "center",
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Noto Sans SC', sans-serif",
};

const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  letterSpacing: 0.5,
  color: "rgba(71,85,105,0.92)",
};

const hintStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: 0.3,
  color: "rgba(148,163,184,0.92)",
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * 蓝图墙面流程图空态 overlay。
 *
 * 渲染稳定可测的 DOM：根节点带 `data-wall-empty-state` 与 `data-empty-reason`
 * （`no-job` | `no-blueprint-data`）。纯函数、无副作用、确定性输出。
 */
export function BlueprintWallEmptyState({
  reason,
  locale,
}: BlueprintWallEmptyStateProps): React.ReactElement {
  const activeLocale = resolveLocale(locale);
  const resolvedReason = resolveReason(reason);

  return (
    <div
      data-wall-empty-state
      data-empty-reason={resolvedReason}
      style={containerStyle}
    >
      <span data-empty-title style={titleStyle}>
        {EMPTY_TITLE[activeLocale]}
      </span>
      <span data-empty-hint style={hintStyle}>
        {EMPTY_HINT[activeLocale]}
      </span>
    </div>
  );
}
