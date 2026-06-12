import React, { useEffect, useRef } from "react";
import type { LiveAction } from "@shared/blueprint/capability-process-labels";
import { autopilotTheme } from "./autopilot-theme";
import { TurnRouteTimeline } from "./TurnRouteTimeline";
import type { TurnRouteFacts } from "@shared/blueprint/whybuddy-turn-route";
import type { TurnStep } from "./types";
import type { ActionTrace } from "@shared/blueprint/capability-process-labels";

/**
 * 右上透明浮层 — 完整 V5.1 架构树时间线（INTAKE / ORCH / C_* / ↩ 回边）。
 * 与画布左下 console、右下 minimap 互补，不重复 console 流。
 */
export function ArchitectureProcessPanel({
  liveAction,
  latestTurn,
  sessionId,
  isRunning,
  onRetryCapability,
  onToggleRoute,
}: {
  liveAction: LiveAction | null;
  latestTurn?: {
    id: string;
    routeFacts: TurnRouteFacts;
    steps: TurnStep[];
    actions: ActionTrace[];
    status: "streaming" | "complete";
    routeLitCount: number;
    routeExpanded: boolean;
  } | null;
  sessionId: string;
  isRunning: boolean;
  onRetryCapability?: (params: {
    loopTurnId: string;
    capabilityId: import("@shared/blueprint/contracts").V5CapabilityId;
    roleId: string;
    runIndex: number;
  }) => void;
  onToggleRoute?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const streaming = latestTurn?.status === "streaming";

  const scrollSignature = latestTurn
    ? (() => {
        const last = latestTurn.steps[latestTurn.steps.length - 1];
        const lastBody =
          last && "text" in last
            ? last.text.length
            : last && "label" in last
            ? last.label.length
            : last && "message" in last
            ? last.message.length
            : 0;
        return [
          latestTurn.id,
          latestTurn.routeLitCount,
          latestTurn.steps.length,
          latestTurn.actions.length,
          latestTurn.status,
          last?.id ?? "",
          lastBody,
          liveAction?.label ?? "",
        ].join("|");
      })()
    : "";

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      atBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [latestTurn?.id]);

  useEffect(() => {
    if (!latestTurn) return;
    if (!streaming && !atBottomRef.current) return;
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
      atBottomRef.current = true;
    });
  }, [scrollSignature, streaming, latestTurn]);

  if (!latestTurn) {
    return null;
  }

  return (
    <div
      ref={scrollRef}
      className={`${autopilotTheme.immersionHudRight} ${autopilotTheme.overlayTransparent} max-h-[min(78vh,720px)] overflow-y-auto`}
      data-testid="whybuddy-arch-process-panel"
      aria-label="架构树节拍"
    >
      {liveAction && streaming && (
        <p
          className={`m-0 mb-2 px-1 text-xs ${
            liveAction.external ? "text-violet-600" : "text-slate-600"
          }`}
        >
          {!liveAction.external && (
            <span className="mr-1.5 inline-flex gap-0.5 align-middle">
              <span className="size-1 animate-pulse rounded-full bg-slate-400" />
              <span className="size-1 animate-pulse rounded-full bg-slate-400 [animation-delay:100ms]" />
            </span>
          )}
          {liveAction.label}
        </p>
      )}

      <TurnRouteTimeline
        facts={latestTurn.routeFacts}
        steps={latestTurn.steps}
        actions={latestTurn.actions}
        sessionId={sessionId}
        expanded={streaming || latestTurn.routeExpanded}
        onToggle={onToggleRoute ?? (() => {})}
        litCount={latestTurn.routeLitCount}
        streaming={streaming}
        liveAction={streaming ? liveAction : null}
        surfaceMode="product"
        immersionOverlay
        retrying={isRunning}
        onRetryCapability={onRetryCapability}
      />
      <div ref={bottomRef} className="h-px shrink-0" aria-hidden />
    </div>
  );
}