import { History } from "lucide-react";

import type { AppLocale } from "@/lib/locale";

interface HistoryEntryPointProps {
  jobId: string | null;
  locale?: AppLocale;
  familyCount?: number;
  staleCount?: number;
  staticPreview?: boolean;
  disabled?: boolean;
  search?: string;
  navigate?: (nextSearch: string) => void;
  onOpen?: (jobId: string) => void;
  lastSocketEvent?: unknown;
  lastReplanSuccess?: unknown;
}

export function withHistorySearchParam(search: string, open: boolean): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (open) {
    params.set("history", "1");
  } else {
    params.delete("history");
  }
  const next = params.toString();
  return next ? `?${next}` : "";
}

function defaultNavigate(nextSearch: string): void {
  if (typeof window === "undefined") return;
  const nextUrl = `${window.location.pathname}${nextSearch}${window.location.hash}`;
  window.history.pushState(null, "", nextUrl);
}

export function HistoryEntryPoint({
  jobId,
  locale = "en-US",
  familyCount = 0,
  staleCount = 0,
  staticPreview = false,
  disabled = false,
  search = "",
  navigate = defaultNavigate,
  onOpen,
}: HistoryEntryPointProps) {
  const canOpen = Boolean(jobId) && !disabled && !staticPreview;
  const copy =
    locale === "zh-CN"
      ? {
          ariaLabel: "打开版本历史",
          title: staticPreview ? "静态预览不支持版本历史。" : "历史",
          label: "历史",
          stale: `${staleCount} 个过期`,
          staticPreview: "静态预览",
        }
      : {
          ariaLabel: "Open version history",
          title: staticPreview
            ? "Static preview does not support version history."
            : "History",
          label: "History",
          stale: `${staleCount} stale`,
          staticPreview: "Static preview",
        };
  const handleOpen = () => {
    if (!jobId || !canOpen) return;
    onOpen?.(jobId);
    navigate(withHistorySearchParam(search, true));
  };

  return (
    <button
      type="button"
      data-testid="autopilot-history-entry"
      data-history-entry="true"
      data-version-history-entry-point="true"
      data-static-preview={staticPreview}
      data-openable={canOpen}
      aria-label={copy.ariaLabel}
      aria-disabled={!canOpen}
      disabled={!canOpen}
      title={copy.title}
      className="inline-flex items-center gap-2 border border-[#d1d5db] bg-white px-3 py-2 text-sm font-medium text-[#111827]"
      onClick={handleOpen}
    >
      <History aria-hidden="true" className="h-4 w-4" />
      <span>{copy.label}</span>
      <span className="text-xs text-[#4b5563]">{familyCount}</span>
      {staleCount > 0 ? (
        <span className="text-xs font-semibold text-[#b45309]">{copy.stale}</span>
      ) : null}
      {staticPreview ? (
        <span className="text-xs text-[#4b5563]">{copy.staticPreview}</span>
      ) : null}
    </button>
  );
}
