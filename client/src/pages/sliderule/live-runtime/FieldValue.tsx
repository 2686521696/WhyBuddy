/**
 * FieldValue — 字段值的语义化渲染（加厚 schema 一期）。
 *
 * 表格单元格与详情抽屉共用：enum 声明取值 → tone 徽标；format →
 * 金额千分位 / 百分比 / 进度条 / 评估分 / 星级 / 脱敏。声明之外的值
 * 如实显示原文（不猜、不隐藏）——值不在 options 里就渲染纯文本，
 * 非数值挂了数字格式也渲染原文。
 */

import React from "react";
import { Progress, Rate, Tag } from "antd";

// 懒加载：静态引 antd-mobile 会让 node 环境的测试在收集期炸掉。
const LazyPhoneProgress = React.lazy(() => import("./phone-mobile/PhoneProgress"));
import type { AppFormFieldSchema } from "./app-runtime-schema";
import {
  clampNumber,
  formatMoney,
  formatPercent,
  maskValue,
  scoreColor,
  toneToTagColor,
} from "./field-display";

export function FieldValue({
  field,
  value,
  phone = false,
}: {
  field: Pick<AppFormFieldSchema, "type" | "options" | "format">;
  value: unknown;
  /** 手机档：进度条换 antd-mobile ProgressBar（antd Progress 是桌面组件，
   *  它的 minWidth 90 在窄屏列表里会把整行撑开）。其余类型跨设备一致。 */
  phone?: boolean;
}) {
  if (value === undefined || value === null || value === "") {
    return <span style={{ color: "#bbb" }}>—</span>;
  }
  const text = String(value);

  // enum 声明取值 → tone 徽标；未声明的值如实纯文本
  if (field.options && field.options.length > 0) {
    const option = field.options.find(o => o.id === text);
    if (option) {
      return (
        <Tag color={toneToTagColor(option.tone)} style={{ marginInlineEnd: 0 }}>
          {option.label}
        </Tag>
      );
    }
    return <>{text}</>;
  }

  switch (field.format) {
    case "money": {
      const money = formatMoney(value);
      return money ? (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{money}</span>
      ) : (
        <>{text}</>
      );
    }
    case "percent": {
      const percent = formatPercent(value);
      return percent ? (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{percent}</span>
      ) : (
        <>{text}</>
      );
    }
    case "progress": {
      const n = clampNumber(value, 0, 100);
      if (n === null) return <>{text}</>;
      return phone ? (
        <React.Suspense fallback={<span>{text}</span>}>
          <LazyPhoneProgress percent={n} />
        </React.Suspense>
      ) : (
        <Progress
          percent={n}
          size="small"
          style={{ minWidth: 90, maxWidth: 140, margin: 0 }}
        />
      );
    }
    case "score": {
      const n = clampNumber(value, 0, 100);
      return n === null ? (
        <>{text}</>
      ) : (
        <span
          style={{
            color: scoreColor(n),
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {n} 分
        </span>
      );
    }
    case "rating": {
      const n = clampNumber(value, 0, 5);
      return n === null ? (
        <>{text}</>
      ) : (
        <Rate disabled allowHalf value={n} style={{ fontSize: 13 }} />
      );
    }
    case "masked":
      return (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {maskValue(value)}
        </span>
      );
    default:
      return <>{text}</>;
  }
}
