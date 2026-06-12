import React from "react";
import { autopilotTheme } from "./autopilot-theme";

const DEFAULT_HINT_CHIPS = [
  "路线对比一下",
  "澄清权限边界",
  "分析安全风险",
  "生成可行性报告",
];

export function ComposerDock({
  input,
  setInput,
  sendMessage,
  isRunning,
  goal,
  latestUserText,
  hintChips,
}: {
  input: string;
  setInput: (v: string) => void;
  sendMessage: () => void;
  isRunning: boolean;
  goal: string;
  latestUserText?: string;
  hintChips?: string[];
}) {
  const chips = hintChips?.length ? hintChips : DEFAULT_HINT_CHIPS;
  return (
    <div className="pointer-events-none flex w-full max-w-2xl flex-col items-center gap-2">
      {latestUserText && (
        <div className="pointer-events-auto max-w-full rounded-full border border-white/70 bg-white/80 px-4 py-1.5 text-center text-[11px] text-slate-500 shadow-sm backdrop-blur-md">
          本轮 · {latestUserText.slice(0, 72)}
          {latestUserText.length > 72 ? "…" : ""}
        </div>
      )}
      <div
        className={`pointer-events-auto w-full ${autopilotTheme.composerDock}`}
        data-testid="whybuddy-composer-dock"
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !isRunning && sendMessage()}
            placeholder={
              goal
                ? "继续补充想法，或质疑图上节点…"
                : "描述你想推演的问题…"
            }
            disabled={isRunning}
            className={autopilotTheme.input}
            data-testid="whybuddy-composer-input"
          />
          <button
            type="button"
            onClick={sendMessage}
            disabled={isRunning || !input.trim()}
            className={autopilotTheme.sendBtn}
          >
            {isRunning ? "推演中" : "发送"}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          {chips.map((hint) => (
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
      </div>
    </div>
  );
}