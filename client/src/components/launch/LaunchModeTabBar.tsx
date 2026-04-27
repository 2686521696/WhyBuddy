import { Zap, Target, Layers, Search, Settings2, type LucideIcon } from "lucide-react";

import { useI18n } from "@/i18n";
import type { LaunchRouteCandidateId } from "@/lib/launch-router";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export type LaunchMode = "quick" | "standard" | "deep" | "research" | "custom";

export interface LaunchModeConfig {
  id: LaunchMode;
  labelZh: string;
  labelEn: string;
  icon: LucideIcon;
  routeMapping: LaunchRouteCandidateId | null;
  showAdvancedSections: boolean;
}

export const LAUNCH_MODES: LaunchModeConfig[] = [
  {
    id: "quick",
    labelZh: "快速模式",
    labelEn: "Quick",
    icon: Zap,
    routeMapping: "fast-route",
    showAdvancedSections: false,
  },
  {
    id: "standard",
    labelZh: "标准模式",
    labelEn: "Standard",
    icon: Target,
    routeMapping: "standard-route",
    showAdvancedSections: true,
  },
  {
    id: "deep",
    labelZh: "深度模式",
    labelEn: "Deep",
    icon: Layers,
    routeMapping: "deep-route",
    showAdvancedSections: true,
  },
  {
    id: "research",
    labelZh: "研究模式",
    labelEn: "Research",
    icon: Search,
    routeMapping: "deep-route",
    showAdvancedSections: true,
  },
  {
    id: "custom",
    labelZh: "自定义模式",
    labelEn: "Custom",
    icon: Settings2,
    routeMapping: null,
    showAdvancedSections: true,
  },
];

export interface LaunchModeTabBarProps {
  mode: LaunchMode;
  onModeChange: (mode: LaunchMode) => void;
}

export function LaunchModeTabBar({ mode, onModeChange }: LaunchModeTabBarProps) {
  const { locale } = useI18n();

  return (
    <div
      role="tablist"
      aria-label={t(locale, "任务模式", "Task mode")}
      className="flex gap-1 overflow-x-auto px-4 py-2 border-b"
      style={{ borderColor: "var(--border, #e2e8f0)" }}
      data-testid="launch-mode-tabbar"
    >
      {LAUNCH_MODES.map(modeConfig => {
        const Icon = modeConfig.icon;
        const isSelected = modeConfig.id === mode;
        return (
          <button
            key={modeConfig.id}
            role="tab"
            aria-selected={isSelected}
            onClick={() => onModeChange(modeConfig.id)}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors whitespace-nowrap"
            style={{
              backgroundColor: isSelected
                ? "var(--primary, #0f172a)"
                : "var(--muted, #f1f5f9)",
              color: isSelected
                ? "var(--primary-foreground, #ffffff)"
                : "var(--muted-foreground, #64748b)",
            }}
            data-testid={`launch-mode-tab-${modeConfig.id}`}
          >
            <Icon size={14} />
            {t(locale, modeConfig.labelZh, modeConfig.labelEn)}
          </button>
        );
      })}
    </div>
  );
}
