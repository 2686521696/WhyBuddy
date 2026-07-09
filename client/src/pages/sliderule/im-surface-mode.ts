import type { TurnRouteSurfaceMode } from "./TurnRouteTimeline";

/**
 * Product page IM tier — default product (闭环执行时间线).
 * ?im=minimal 旧极简；?im=dev 工程完整路径。
 */
export function resolveImSurfaceMode(): TurnRouteSurfaceMode {
  if (typeof window === "undefined") return "product";
  const raw = new URLSearchParams(window.location.search).get("im");
  if (raw === "minimal" || raw === "bare") return "minimal";
  if (raw === "dev" || raw === "engineering") return "engineering";
  return "product";
}