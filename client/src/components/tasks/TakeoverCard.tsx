import { cn } from "@/lib/utils";
import type { MissionOperatorActionType } from "@shared/mission/contracts";
import { AlertTriangle, MessageSquare } from "lucide-react";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Props ─── */

export interface TakeoverCardProps {
  title: string;                       // i18n: "接管/证据" / "Takeover/Evidence"
  hasPendingDecision: boolean;
  decisionPrompt: string | null;
  decisionPresets: Array<{ id: string; label: string }>;
  decisionNote: string;
  onSetDecisionNote: (note: string) => void;
  onLaunchDecision: (presetId: string) => Promise<void>;
  onSubmitOperatorAction: (payload: {
    action: MissionOperatorActionType;
    reason?: string;
  }) => Promise<void>;
  operatorActionLoading: boolean;
  takeoverSummary: string | null;      // from autopilot takeover parsing
  locale: string;
}

/* ─── Component ─── */

export function TakeoverCard({
  title,
  hasPendingDecision,
  decisionPrompt,
  decisionPresets,
  decisionNote,
  onSetDecisionNote,
  onLaunchDecision,
  operatorActionLoading,
  takeoverSummary,
  locale,
}: TakeoverCardProps): React.ReactElement {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground border rounded-lg p-4",
        "flex flex-col gap-3",
      )}
    >
      {/* Card title */}
      <h4 className="text-sm font-semibold">{title}</h4>

      {hasPendingDecision ? (
        <PendingDecisionView
          decisionPrompt={decisionPrompt}
          decisionPresets={decisionPresets}
          decisionNote={decisionNote}
          onSetDecisionNote={onSetDecisionNote}
          onLaunchDecision={onLaunchDecision}
          operatorActionLoading={operatorActionLoading}
          locale={locale}
        />
      ) : (
        <EmptyStateView
          takeoverSummary={takeoverSummary}
          locale={locale}
        />
      )}
    </div>
  );
}

/* ─── Pending Decision Sub-view ─── */

interface PendingDecisionViewProps {
  decisionPrompt: string | null;
  decisionPresets: Array<{ id: string; label: string }>;
  decisionNote: string;
  onSetDecisionNote: (note: string) => void;
  onLaunchDecision: (presetId: string) => Promise<void>;
  operatorActionLoading: boolean;
  locale: string;
}

function PendingDecisionView({
  decisionPrompt,
  decisionPresets,
  decisionNote,
  onSetDecisionNote,
  onLaunchDecision,
  operatorActionLoading,
  locale,
}: PendingDecisionViewProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {/* Decision prompt */}
      {decisionPrompt && (
        <div className="flex items-start gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md p-3">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-500" />
          <span>{decisionPrompt}</span>
        </div>
      )}

      {/* Decision option buttons */}
      {decisionPresets.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {decisionPresets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={operatorActionLoading}
              onClick={() => onLaunchDecision(preset.id)}
              className={cn(
                "inline-flex items-center px-3 py-1.5 rounded-md text-sm font-medium",
                "bg-primary text-primary-foreground",
                "hover:bg-primary/90 transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {/* Note input textarea */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-muted-foreground flex items-center gap-1">
          <MessageSquare size={12} />
          {t(locale, "备注", "Note")}
        </label>
        <textarea
          value={decisionNote}
          onChange={(e) => onSetDecisionNote(e.target.value)}
          placeholder={t(locale, "输入备注信息...", "Enter a note...")}
          disabled={operatorActionLoading}
          rows={2}
          className={cn(
            "w-full rounded-md border bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            "resize-none",
          )}
        />
      </div>
    </div>
  );
}

/* ─── Empty State Sub-view ─── */

interface EmptyStateViewProps {
  takeoverSummary: string | null;
  locale: string;
}

function EmptyStateView({
  takeoverSummary,
  locale,
}: EmptyStateViewProps): React.ReactElement {
  if (takeoverSummary) {
    return (
      <p className="text-sm text-muted-foreground py-1">
        {takeoverSummary}
      </p>
    );
  }

  return (
    <p className="text-sm text-muted-foreground py-2">
      {t(locale, "当前无需接管", "No takeover needed")}
    </p>
  );
}
