/**
 * Spec Docs 批量生成进度面板（SpecDocsProgressPanel）
 *
 * 本组件是 `.kiro/specs/spec-docs-generation-progress-feedback/` 任务 5.1 的
 * 落地点：
 * - 消费 `useBlueprintRealtimeStore.specDocsProgress` slice，展示批量 spec
 *   文档生成的实时进度。
 * - 当 `batchStatus === "idle"` 或 `dismissed === true` 时返回 null（不渲染）。
 * - 包含 CompletionCounter、NodeProgressList、StatusIndicator、ErrorTooltip、
 *   BatchSummaryLine 等子组件。
 * - 使用 `glass-panel` CSS 类保持与项目视觉一致。
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.2, 6.2, 6.3
 */

import { useState, type FC } from "react";
import {
  useBlueprintRealtimeStore,
  type SpecDocsNodeStatus,
  type SpecDocsNodeEntry,
  type SpecDocsBatchSummary,
} from "@/lib/blueprint-realtime-store";

// ---------------------------------------------------------------------------
// Exported utility: formatElapsedTime
// ---------------------------------------------------------------------------

/**
 * Format elapsed milliseconds into MM:SS or HH:MM:SS string.
 *
 * - When total time is under 60 minutes: returns `M:SS` or `MM:SS`
 * - When total time is 60 minutes or more: returns `H:MM:SS` or `HH:MM:SS`
 * - Minutes and seconds are always zero-padded to 2 digits.
 *
 * Validates: Requirements 3.5
 */
export function formatElapsedTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Completion counter showing progress status.
 * - During "running": shows "X/N 生成中"
 * - During "assembling": shows "生成完成 (装配中 X/N)"
 * - During "finished": shows "X/N 已完成"
 * Validates: Requirements 3.1
 */
const CompletionCounter: FC<{ processed: number; total: number; batchStatus: string; assembledCount: number }> = ({
  processed,
  total,
  batchStatus,
  assembledCount,
}) => {
  let label: string;
  let countDisplay: string;
  if (batchStatus === "finished") {
    countDisplay = `${processed}/${total}`;
    label = " 已完成";
  } else if (batchStatus === "assembling") {
    countDisplay = `${processed}/${total}`;
    label = ` 生成完成 (装配中 ${assembledCount}/${total})`;
  } else {
    countDisplay = `${processed}/${total}`;
    label = " 生成中";
  }
  return (
    <div className="completion-counter" style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span className="count" style={{ fontWeight: 600, fontFamily: "var(--font-mono, monospace)" }}>
        {countDisplay}
      </span>
      <span className="label" style={{ opacity: 0.7 }}>{label}</span>
    </div>
  );
};

/**
 * Status indicator icon based on node status.
 * - pending: dim circle
 * - processing: animated spinner (pulsing dot)
 * - completed: checkmark ✓
 * - assembled: double checkmark ✓✓
 * - failed: error icon ✗
 *
 * Validates: Requirements 3.2, 3.3, 3.4
 */
const StatusIndicator: FC<{ status: SpecDocsNodeStatus }> = ({ status }) => {
  switch (status) {
    case "pending":
      return (
        <span
          className="status-indicator status-pending"
          style={{ color: "var(--color-text-muted, #94a3b8)", fontSize: 14 }}
          aria-label="等待中"
        >
          ○
        </span>
      );
    case "processing":
      return (
        <span
          className="status-indicator status-processing"
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            borderRadius: "50%",
            border: "2px solid var(--color-accent, #3b82f6)",
            borderTopColor: "transparent",
            animation: "spec-docs-spin 0.8s linear infinite",
          }}
          aria-label="生成中"
        />
      );
    case "completed":
      return (
        <span
          className="status-indicator status-completed"
          style={{ color: "var(--color-success, #22c55e)", fontSize: 14, fontWeight: 700 }}
          aria-label="已完成"
        >
          ✓
        </span>
      );
    case "assembled":
      return (
        <span
          className="status-indicator status-assembled"
          style={{ color: "var(--color-success, #22c55e)", fontSize: 14, fontWeight: 700 }}
          aria-label="已装配"
        >
          ✓✓
        </span>
      );
    case "failed":
      return (
        <span
          className="status-indicator status-failed"
          style={{ color: "var(--color-error, #ef4444)", fontSize: 14, fontWeight: 700 }}
          aria-label="失败"
        >
          ✗
        </span>
      );
  }
};

/**
 * Error tooltip that shows truncated error summary (200 chars) on hover.
 * Validates: Requirements 3.4
 */
const ErrorTooltip: FC<{ message: string }> = ({ message }) => {
  const [visible, setVisible] = useState(false);
  const truncated = message.length > 200 ? message.slice(0, 200) + "…" : message;

  return (
    <span
      className="error-tooltip-trigger"
      style={{ position: "relative", cursor: "help", marginLeft: 4 }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      aria-describedby="error-tooltip"
    >
      <span style={{ fontSize: 12, color: "var(--color-error, #ef4444)" }}>ⓘ</span>
      {visible && (
        <span
          role="tooltip"
          id="error-tooltip"
          className="error-tooltip"
          style={{
            position: "absolute",
            bottom: "calc(100% + 4px)",
            left: 0,
            zIndex: 50,
            maxWidth: 300,
            padding: "6px 10px",
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.4,
            color: "#fff",
            backgroundColor: "rgba(30, 30, 30, 0.95)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {truncated}
        </span>
      )}
    </span>
  );
};

/**
 * Single node progress item with status-based styling.
 * Validates: Requirements 3.2, 3.3, 3.4, 3.6
 */
const NodeProgressItem: FC<{ node: SpecDocsNodeEntry }> = ({ node }) => (
  <li
    className={`node-item node-${node.status}`}
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "4px 0",
      opacity: node.status === "pending" ? 0.5 : 1,
      transition: "opacity 0.2s ease",
    }}
  >
    <StatusIndicator status={node.status} />
    <span
      className="node-title"
      style={{
        flex: 1,
        fontSize: 13,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {node.title || node.nodeId}
    </span>
    {node.status === "failed" && node.errorSummary && (
      <ErrorTooltip message={node.errorSummary.slice(0, 200)} />
    )}
  </li>
);

/**
 * Node progress list rendering nodes in nodeOrder order.
 * Validates: Requirements 3.6
 */
const NodeProgressList: FC<{
  nodeOrder: string[];
  nodes: Record<string, SpecDocsNodeEntry>;
}> = ({ nodeOrder, nodes }) => (
  <ul
    className="node-progress-list"
    style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 240, overflowY: "auto" }}
  >
    {nodeOrder.map((nodeId) => {
      const node = nodes[nodeId];
      if (!node) return null;
      return <NodeProgressItem key={nodeId} node={node} />;
    })}
  </ul>
);

/**
 * Batch summary line showing completed/failed counts and formatted elapsed time.
 * Validates: Requirements 3.5, 6.3
 */
const BatchSummaryLine: FC<{ summary: SpecDocsBatchSummary }> = ({ summary }) => {
  const formatted = formatElapsedTime(summary.elapsedMs);
  return (
    <div
      className="batch-summary"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        marginTop: 8,
        paddingTop: 8,
        borderTop: "1px solid rgba(148, 163, 184, 0.2)",
      }}
    >
      <span className="success" style={{ color: "var(--color-success, #22c55e)" }}>
        {summary.completedCount} 成功
      </span>
      {summary.failedCount > 0 && (
        <span className="failure" style={{ color: "var(--color-error, #ef4444)" }}>
          , {summary.failedCount} 失败
        </span>
      )}
      <span className="elapsed" style={{ opacity: 0.6 }}> · {formatted}</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Spec Docs Progress Panel — main exported component.
 *
 * - Returns null when `batchStatus === "idle"` OR `dismissed === true` (Req 3.7, 5.2)
 * - Shows dismiss button only when `batchStatus === "finished"` (Req 3.7)
 * - Displays CompletionCounter, NodeProgressList, and BatchSummaryLine
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.2, 6.2, 6.3
 */
export function SpecDocsProgressPanel(): JSX.Element | null {
  const progress = useBlueprintRealtimeStore((s) => s.specDocsProgress);
  const dismissProgress = useBlueprintRealtimeStore((s) => s.dismissSpecDocsProgress);

  // Guard: if store slice is not yet initialized (e.g. in tests with partial mocks), bail out
  if (!progress) return null;

  // Panel hidden when idle or explicitly dismissed (Req 3.7, 5.2)
  if (progress.batchStatus === "idle" || progress.dismissed) return null;

  return (
    <div
      className="spec-docs-progress-panel glass-panel"
      style={{
        padding: "12px 16px",
        borderRadius: 8,
        fontSize: 13,
      }}
    >
      {/* Spinner keyframe animation */}
      <style>{`
        @keyframes spec-docs-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div
        className="progress-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <CompletionCounter
          processed={progress.processedCount}
          total={progress.totalCount}
          batchStatus={progress.batchStatus}
          assembledCount={progress.assembledCount}
        />
        {progress.batchStatus === "finished" && (
          <button
            className="dismiss-btn"
            onClick={dismissProgress}
            aria-label="关闭进度面板"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: "2px 6px",
              borderRadius: 4,
              opacity: 0.6,
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.6"; }}
          >
            ✕
          </button>
        )}
      </div>

      <NodeProgressList nodeOrder={progress.nodeOrder} nodes={progress.nodes} />

      {progress.batchStatus === "finished" && progress.summary && (
        <BatchSummaryLine summary={progress.summary} />
      )}
    </div>
  );
}

export default SpecDocsProgressPanel;
