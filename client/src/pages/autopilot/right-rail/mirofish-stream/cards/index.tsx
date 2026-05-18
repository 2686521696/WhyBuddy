/**
 * autopilot-mirofish-card-diversity / Task 5.1 — 卡片分发与再导出层
 *
 * 本文件作为 cards/ 目录的统一入口，负责：
 * 1. 从各独立卡片文件再导出组件（供 MiroFishCardStream 使用）
 * 2. 保留 MiroFishCardShell 与 formatTimestampHHMMSS 导出（向后兼容）
 *
 * 各卡片的实际实现已拆分到独立文件：
 * - reasoning-card.tsx
 * - capability-card.tsx
 * - route-decision-card.tsx
 * - artifact-card.tsx
 * - node-completed-card.tsx
 * - system-note-card.tsx
 */

// ─── 独立卡片组件再导出 ─────────────────────────────────────────────────────

export { ReasoningCard } from "./reasoning-card";
export { CapabilityCard as CapabilityInvocationCard } from "./capability-card";
export { RouteDecisionCard } from "./route-decision-card";
export { ArtifactCard as ArtifactCreatedCard } from "./artifact-card";
export { NodeCompletedCard } from "./node-completed-card";
export { SystemNoteCard } from "./system-note-card";

// ─── 向后兼容导出 ────────────────────────────────────────────────────────────

export { MiroFishCardShell, formatTimestampHHMMSS } from "./card-shell";
