import {
  Globe,
  Terminal,
  FolderOpen,
  BookOpen,
  Search,
  Eye,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "@/i18n";
import type { RuntimeMode } from "@/lib/store";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export interface CockpitTool {
  id: string;
  labelZh: string;
  labelEn: string;
  icon: LucideIcon;
  requiresAdvancedRuntime: boolean;
}

export const COCKPIT_TOOLS: CockpitTool[] = [
  { id: "browser", labelZh: "浏览器能力", labelEn: "Browser", icon: Globe, requiresAdvancedRuntime: true },
  { id: "executor", labelZh: "代码执行器", labelEn: "Code Executor", icon: Terminal, requiresAdvancedRuntime: true },
  { id: "filesystem", labelZh: "文件系统", labelEn: "File System", icon: FolderOpen, requiresAdvancedRuntime: true },
  { id: "knowledge", labelZh: "知识检索", labelEn: "Knowledge", icon: BookOpen, requiresAdvancedRuntime: false },
  { id: "web", labelZh: "网络搜索", labelEn: "Web Search", icon: Search, requiresAdvancedRuntime: false },
  { id: "vision", labelZh: "视觉理解", labelEn: "Vision", icon: Eye, requiresAdvancedRuntime: false },
];

export interface LaunchCockpitGridProps {
  runtimeMode: RuntimeMode;
}

export function LaunchCockpitGrid({ runtimeMode }: LaunchCockpitGridProps) {
  const { locale } = useI18n();

  return (
    <div data-testid="launch-cockpit-grid">
      <h3
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--muted-foreground, #64748b)" }}
      >
        {t(locale, "能力驾驶舱 COCKPIT", "Capability Cockpit")}
      </h3>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3">
        {COCKPIT_TOOLS.map(tool => {
          const Icon = tool.icon;
          const isDisabled =
            tool.requiresAdvancedRuntime && runtimeMode !== "advanced";

          return (
            <div
              key={tool.id}
              className="flex items-center gap-2 rounded-lg border p-2 text-xs transition-colors"
              style={{
                borderColor: "var(--border, #e2e8f0)",
                backgroundColor: "var(--card, #ffffff)",
                opacity: isDisabled ? 0.5 : 1,
              }}
              data-testid={`cockpit-tool-${tool.id}`}
              data-disabled={isDisabled}
              aria-disabled={isDisabled}
            >
              <Icon
                size={16}
                style={{
                  color: isDisabled
                    ? "var(--muted-foreground, #64748b)"
                    : "var(--card-foreground, #0f172a)",
                }}
              />
              <span
                style={{
                  color: isDisabled
                    ? "var(--muted-foreground, #64748b)"
                    : "var(--card-foreground, #0f172a)",
                }}
              >
                {t(locale, tool.labelZh, tool.labelEn)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
