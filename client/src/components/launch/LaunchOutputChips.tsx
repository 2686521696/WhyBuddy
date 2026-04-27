import { useI18n } from "@/i18n";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export interface OutputType {
  id: string;
  labelZh: string;
  labelEn: string;
  defaultSelected: boolean;
}

export const OUTPUT_TYPES: OutputType[] = [
  { id: "summary", labelZh: "结果摘要", labelEn: "Summary", defaultSelected: true },
  { id: "files", labelZh: "生成文件", labelEn: "Files", defaultSelected: true },
  { id: "logs", labelZh: "执行日志", labelEn: "Exec Logs", defaultSelected: false },
  { id: "screenshots", labelZh: "证据截图", labelEn: "Screenshots", defaultSelected: false },
  { id: "records", labelZh: "操作记录", labelEn: "Records", defaultSelected: false },
];

export interface LaunchOutputChipsProps {
  selectedTypes: Set<string>;
  onToggle: (id: string) => void;
}

export function LaunchOutputChips({
  selectedTypes,
  onToggle,
}: LaunchOutputChipsProps) {
  const { locale } = useI18n();

  return (
    <div data-testid="launch-output-chips">
      <h3
        className="mb-2 text-xs font-semibold uppercase tracking-wider"
        style={{ color: "var(--muted-foreground, #64748b)" }}
      >
        {t(locale, "输出与交付", "Output & Delivery")}
      </h3>
      <div className="flex flex-wrap gap-2">
        {OUTPUT_TYPES.map(outputType => {
          const isSelected = selectedTypes.has(outputType.id);
          return (
            <button
              key={outputType.id}
              type="button"
              onClick={() => onToggle(outputType.id)}
              className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
              style={{
                backgroundColor: isSelected
                  ? "var(--primary, #0f172a)"
                  : "var(--muted, #f1f5f9)",
                color: isSelected
                  ? "var(--primary-foreground, #ffffff)"
                  : "var(--muted-foreground, #64748b)",
              }}
              data-testid={`output-chip-${outputType.id}`}
              data-selected={isSelected}
            >
              {t(locale, outputType.labelZh, outputType.labelEn)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
