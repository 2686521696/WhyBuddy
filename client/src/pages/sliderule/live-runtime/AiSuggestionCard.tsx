/**
 * AiSuggestionCard — AI 建议卡（加厚 schema 三期"可解释输出"）。
 *
 * AI 能力不再直改数据：生成结果先落成建议卡——建议值 + 置信度色条 +
 * 生成依据，用户「确认并应用」才写回行字段，「忽略」即丢弃。
 * 置信度缺失时如实标注"未提供"（服务端解析不出结构化输出时的诚实
 * 降级），不造数字。灵感范本：GitHub Issue 自动分诊的建议确认面板。
 */

import { Button, Progress, Space, Tag } from "antd";
import { scoreColor } from "./field-display";

export function AiSuggestionCard({
  outputLabel,
  output,
  confidence,
  rationale,
  applying = false,
  onApply,
  onDismiss,
}: {
  /** 写回目标字段的展示名 */
  outputLabel: string;
  /** 建议值（能力产出本身） */
  output: string;
  /** 置信度 0-1；null = 服务端未能给出（如实标注，不造数字） */
  confidence: number | null;
  /** 生成依据（一句话）；null = 未提供 */
  rationale: string | null;
  applying?: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const percent = confidence === null ? null : Math.round(confidence * 100);
  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid #91caff",
        background: "#f0f7ff",
      }}
      data-testid="app-ai-suggestion"
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#262626" }}>
          AI 建议 · 写回「{outputLabel}」
        </span>
        <Tag color="processing" style={{ marginInlineEnd: 0 }}>
          待确认
        </Tag>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: "#262626",
          whiteSpace: "pre-wrap",
          maxHeight: 120,
          overflow: "auto",
        }}
        data-testid="app-ai-suggestion-output"
      >
        {output}
      </div>
      <div
        style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}
      >
        <span style={{ fontSize: 11, color: "#595959", flexShrink: 0 }}>
          置信度
        </span>
        {percent === null ? (
          <span
            style={{ fontSize: 11, color: "#bfbfbf" }}
            data-testid="app-ai-no-confidence"
          >
            未提供（模型未按结构化格式返回）
          </span>
        ) : (
          <>
            <Progress
              percent={percent}
              size="small"
              strokeColor={scoreColor(percent)}
              showInfo={false}
              style={{ maxWidth: 140, margin: 0 }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: scoreColor(percent),
              }}
              data-testid="app-ai-confidence"
            >
              {percent}%
            </span>
          </>
        )}
      </div>
      {rationale && (
        <div
          style={{ marginTop: 6, fontSize: 11, color: "#595959" }}
          data-testid="app-ai-rationale"
        >
          依据：{rationale}
        </div>
      )}
      <Space size="small" style={{ marginTop: 10 }}>
        <Button
          size="small"
          type="primary"
          loading={applying}
          onClick={onApply}
          data-testid="app-ai-apply"
        >
          确认并应用
        </Button>
        <Button size="small" onClick={onDismiss} data-testid="app-ai-dismiss">
          忽略
        </Button>
      </Space>
    </div>
  );
}
