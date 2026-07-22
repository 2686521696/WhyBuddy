/**
 * 体验区块渲染表（二阶段骨架）。
 *
 * 目录定义在 experience_block_catalog.json；这里仅登记可信的 React 渲染
 * 边界。第三阶段会把现有 stats/charts/rankings/feeds/table 的真实内容接进
 * 这些边界。本阶段不读取 page.blocks 改写旧页面，确保视觉零变化。
 */
import React from "react";

import catalogJson from "@experience-blocks";

export interface ExperienceBlockCatalogEntry {
  type: string;
  description: string;
  rendererKey: string;
  propsSchema: Record<string, unknown>;
  dataKinds: string[];
  allowedSlots: string[];
  events: string[];
}

export interface ExperienceBlockInstance {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  binding?: Record<string, unknown>;
  _fromLegacy?: boolean;
  _legacyStat?: unknown;
  _legacyChart?: unknown;
  _legacyRanking?: unknown;
  _legacyFeed?: unknown;
}

export interface ExperienceBlockRendererProps {
  block: ExperienceBlockInstance;
  children?: React.ReactNode;
  /** Step 5：区块事件触发动作时的回调（actionId, eventData）。 */
  onAction?: (actionId: string, eventData?: Record<string, unknown>) => void;
}

export type ExperienceBlockRenderer =
  React.ComponentType<ExperienceBlockRendererProps>;

interface ExperienceBlockCatalogFile {
  version: number;
  allowedSlots: string[];
  dataKinds: string[];
  eventTypes: string[];
  blocks: ExperienceBlockCatalogEntry[];
}

export const EXPERIENCE_BLOCK_CATALOG =
  catalogJson as unknown as ExperienceBlockCatalogFile;

// 本阶段先把现有页面内容包进可信边界；真实区块内容在第三阶段接入。
const ExistingContentAdapter: ExperienceBlockRenderer = ({
  block,
  children,
}) =>
  children !== undefined && children !== null ? (
    <>{children}</>
  ) : (
    <div
      data-testid="pending-experience-block"
      className="rounded border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500"
    >
      区块已登记，内容将在下一阶段接入：{block.type}
    </div>
  );

export const EXPERIENCE_BLOCK_RENDERERS: Readonly<
  Record<string, ExperienceBlockRenderer>
> = Object.freeze({
  "metric-grid": ExistingContentAdapter,
  "trend-chart": ExistingContentAdapter,
  "ranked-list": ExistingContentAdapter,
  "activity-feed": ExistingContentAdapter,
  "data-table": ExistingContentAdapter,
  // Step 6: QuickActionPanel (action-only, no data binding) and FilterBar (global filter)
  "quick-action-panel": ExistingContentAdapter,
  "filter-bar": ExistingContentAdapter,
});

export function experienceBlockEntry(
  type: string
): ExperienceBlockCatalogEntry | undefined {
  return EXPERIENCE_BLOCK_CATALOG.blocks.find(entry => entry.type === type);
}

/** 未知 type 或漏登记 renderer 时明确报不支持，不能白屏或假装成功。 */
export function ExperienceBlockBoundary({
  block,
  children,
  onAction,
}: ExperienceBlockRendererProps) {
  const entry = experienceBlockEntry(block.type);
  const Renderer = entry
    ? EXPERIENCE_BLOCK_RENDERERS[entry.rendererKey]
    : undefined;
  if (!entry || !Renderer) {
    return (
      <div
        role="alert"
        data-testid="unsupported-experience-block"
        className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      >
        暂不支持此区块：{block.type || "未声明类型"}
      </div>
    );
  }
  return <Renderer block={block} onAction={onAction}>{children}</Renderer>;
}
