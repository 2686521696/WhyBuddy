/**
 * WhyBuddy — 产品视图（/whybuddy）· 纯对话形态
 *
 * 每一轮：用户气泡 → 助手整段行文(打字机) → 极淡脚注。
 * Runtime 经 useWhyBuddySession + intakeMessage；本文件仅表现层。
 * 工程驾驶舱见 /whybuddy/dev。
 */

import React, { useEffect, useState } from "react";
import { useWhyBuddySession } from "./whybuddy/useWhyBuddySession";
import { projectConclusionBadge } from "./whybuddy/conclusion-badge";
import { autopilotTheme } from "./whybuddy/autopilot-theme";
import type { ActionTrace, LiveAction } from "@shared/blueprint/capability-process-labels";
import type { UiTurn } from "./whybuddy/types";

const HINT_CHIPS = [
  "路线对比一下",
  "澄清权限边界",
  "分析安全风险",
  "拆解成 SPEC Tree",
  "生成可行性报告",
  "效果预览",
];

function TypewriterText({ text, active }: { text: string; active: boolean }) {
  const [shown, setShown] = useState(active ? 0 : text.length);

  useEffect(() => {
    if (!active) {
      setShown(text.length);
      return;
    }
    setShown(0);
    const step = Math.max(2, Math.ceil(text.length / 400));
    const id = window.setInterval(() => {
      setShown((prev) => {
        if (prev >= text.length) {
          window.clearInterval(id);
          return text.length;
        }
        return Math.min(text.length, prev + step);
      });
    }, 24);
    return () => window.clearInterval(id);
  }, [text, active]);

  return (
    <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">{text.slice(0, shown)}</div>
  );
}

function ActionTraceRow({ traces, sessionId }: { traces: ActionTrace[]; sessionId: string }) {
  if (traces.length === 0) return null;
  const href = `/whybuddy/dev?session=${encodeURIComponent(sessionId)}`;
  const text = traces.map((t) => t.label).join(" · ");
  return (
    <a href={href} className={autopilotTheme.actionTrace}>
      ⚡ {text}
    </a>
  );
}

function LiveActionIndicator({ liveAction }: { liveAction: LiveAction }) {
  return (
    <div
      className={
        liveAction.external ? autopilotTheme.liveActionExternal : autopilotTheme.liveActionThink
      }
    >
      {!liveAction.external && (
        <span className="mr-2 inline-flex gap-1 align-middle">
          <span className="size-1.5 animate-pulse rounded-full bg-slate-400" />
          <span className="size-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:120ms]" />
          <span className="size-1.5 animate-pulse rounded-full bg-slate-400 [animation-delay:240ms]" />
        </span>
      )}
      {liveAction.label}
    </div>
  );
}

function TurnFootnote({
  turn,
  sessionId,
  onChallenge,
}: {
  turn: UiTurn;
  sessionId: string;
  onChallenge: (artifactId: string) => void;
}) {
  const parts: React.ReactNode[] = [];

  parts.push(
    <a
      key="evidence"
      href={`/whybuddy/dev?session=${encodeURIComponent(sessionId)}`}
      className="text-slate-500 hover:text-slate-700 hover:underline"
    >
      证据链
    </a>
  );

  if (turn.main) {
    parts.push(
      <button
        key="challenge"
        type="button"
        onClick={() => onChallenge(turn.main!.artifactId)}
        className="text-slate-500 hover:text-slate-700 hover:underline"
      >
        质疑这轮结论
      </button>
    );
    parts.push(
      <span key="source" className="text-slate-400">
        {turn.main.realLlm ? "真实推演" : "规则推演"}
      </span>
    );
  }

  if (turn.assistantSource === "fallback") {
    parts.push(
      <span
        key="fallback"
        className="text-slate-400"
        title="叙述服务暂不可用，本条为系统模板回复（产物与结论状态不受影响）"
      >
        模板回复
      </span>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-slate-300">·</span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

export default function WhyBuddy() {
  const {
    goal,
    uiTurns,
    input,
    setInput,
    isRunning,
    liveAction,
    sessionState,
    sendMessage,
    challengeTurn,
  } = useWhyBuddySession({
    sessionId: "whybuddy-main-proto",
    documentTitle: "WhyBuddy",
  });

  const badge = projectConclusionBadge(sessionState);
  const latestTurnId = uiTurns.length > 0 ? uiTurns[uiTurns.length - 1].id : null;

  return (
    <div className={autopilotTheme.page}>
      <header className={autopilotTheme.header}>
        <div className="min-w-0 flex-1">
          <div className={autopilotTheme.label}>我的想法</div>
          <div className={autopilotTheme.goal}>{goal}</div>
        </div>
        <div className="flex items-center gap-3 pl-4">
          <div
            data-testid="whybuddy-conclusion-badge"
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${badge.className}`}
          >
            {badge.label}
          </div>
          <a href="/whybuddy/dev" className={autopilotTheme.devLink} title="打开工程驾驶舱">
            Dev
          </a>
        </div>
      </header>

      <main className={autopilotTheme.main}>
        <div className="mx-auto max-w-2xl space-y-8">
          {uiTurns.length === 0 && !isRunning && (
            <div className={autopilotTheme.emptyState}>
              描述你的想法，WhyBuddy 会推演结论并告诉你能否信任。
              <div className={autopilotTheme.emptyHint}>
                例如：「分析权限方案风险并生成可行性报告」
              </div>
            </div>
          )}

          {uiTurns.map((turn) => (
            <div key={turn.id} className="space-y-2">
              <div className="flex justify-end">
                <div className={autopilotTheme.userBubble}>{turn.user}</div>
              </div>
              <div className="pl-1">
                <ActionTraceRow
                  traces={turn.actions}
                  sessionId={sessionState.sessionId || "whybuddy-main-proto"}
                />
                <TypewriterText text={turn.assistant} active={turn.id === latestTurnId} />
                <TurnFootnote
                  turn={turn}
                  sessionId={sessionState.sessionId || "whybuddy-main-proto"}
                  onChallenge={challengeTurn}
                />
              </div>
            </div>
          ))}

          {isRunning && liveAction && (
            <div className="pl-1">
              <LiveActionIndicator liveAction={liveAction} />
            </div>
          )}
        </div>
      </main>

      <footer className={autopilotTheme.footer}>
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isRunning && sendMessage()}
            placeholder="继续补充想法，或质疑上一轮结论…"
            disabled={isRunning}
            className={autopilotTheme.input}
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={isRunning || !input.trim()}
            className={autopilotTheme.sendBtn}
          >
            发送
          </button>
        </div>
        <div className="mx-auto mt-2 flex max-w-2xl flex-wrap gap-1.5">
          {HINT_CHIPS.map((hint) => (
            <button
              key={hint}
              type="button"
              disabled={isRunning}
              onClick={() => setInput(hint)}
              className={autopilotTheme.hintChip}
            >
              {hint}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}