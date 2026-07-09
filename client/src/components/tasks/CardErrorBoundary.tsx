import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";
import { Component, type ReactNode } from "react";

/* ─── i18n helper ─── */

function t(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

/* ─── Props ─── */

interface CardErrorBoundaryProps {
  children: ReactNode;
  locale: string;
  cardName?: string;
}

interface CardErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/* ─── Component ─── */

/**
 * Compact error boundary for individual cards.
 * Shows a small inline error message instead of crashing the entire view.
 */
export class CardErrorBoundary extends Component<
  CardErrorBoundaryProps,
  CardErrorBoundaryState
> {
  constructor(props: CardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): CardErrorBoundaryState {
    return { hasError: true, error };
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { locale, cardName } = this.props;
      const label = cardName
        ? t(locale, `${cardName} 加载异常`, `${cardName} failed to load`)
        : t(locale, "卡片加载异常", "Card failed to load");

      return (
        <div
          className={cn(
            "bg-card text-card-foreground border rounded-lg p-4",
            "flex items-center gap-2 text-sm text-muted-foreground",
          )}
        >
          <AlertTriangle size={16} className="flex-shrink-0 text-amber-500" />
          <span>{label}</span>
        </div>
      );
    }

    return this.props.children;
  }
}
