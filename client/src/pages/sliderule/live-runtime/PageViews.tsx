/**
 * PageViews — 页面范式（加厚 schema 二期）的视图骨架组件。
 *
 * KanbanBoard：statusField 的声明 options → 看板列（tone 给列头着色），
 *   卡片点击进详情；「未归类」列承载声明外/空值行（如实呈现）。
 * CalendarBoard：自建月历（page-views 纯函数），默认展示行数最多的月份；
 *   事件条按 colorBy 的 option tone 着色点。
 * 两者只负责展示与点击回调——数据变更仍走工作台的新建/详情通道。
 */

import React from "react";
import { Button, Card, Empty, Tag } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import type { AppFormFieldSchema } from "./app-runtime-schema";
import type { RuntimeRow } from "./live-runtime";
import { FieldValue } from "./FieldValue";
import { toneToTagColor, type FieldTone } from "./field-display";
import {
  buildMonthGrid,
  dominantMonth,
  groupRowsForKanban,
  rowsByDateKey,
  shiftMonth,
} from "./page-views";

const INK = { label: "#595959", value: "#262626", faint: "#bfbfbf" };

/** tone → 事件点/列顶条颜色（与 antd 状态色一致）。 */
const TONE_COLORS: Record<FieldTone, string> = {
  success: "#52c41a",
  processing: "#1677ff",
  warning: "#faad14",
  danger: "#ff4d4f",
  default: "#8c8c8c",
};

export function KanbanBoard({
  rows,
  statusField,
  cardFields,
  onOpenRow,
}: {
  rows: RuntimeRow[];
  /** 看板列字段（enum，带一期归一化 options） */
  statusField: AppFormFieldSchema;
  /** 卡片正文字段（statusField 之外的前几列） */
  cardFields: AppFormFieldSchema[];
  onOpenRow: (row: RuntimeRow) => void;
}) {
  const columns = groupRowsForKanban(
    rows,
    statusField.id,
    statusField.options ?? []
  );
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        overflowX: "auto",
      }}
      data-testid="app-runtime-kanban"
    >
      {columns.map(col => (
        <div
          key={col.id}
          style={{
            flex: "1 0 0",
            minWidth: 170,
            background: "#fafafa",
            borderRadius: 8,
            borderTop: `3px solid ${TONE_COLORS[col.tone]}`,
            padding: "8px 8px 10px",
          }}
          data-testid={`app-kanban-col-${col.id}`}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <Tag
              color={toneToTagColor(col.tone)}
              style={{ marginInlineEnd: 0 }}
            >
              {col.label}
            </Tag>
            <span style={{ fontSize: 11, color: INK.faint }}>
              {col.rows.length}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {col.rows.length === 0 ? (
              <div
                style={{
                  fontSize: 11,
                  color: INK.faint,
                  textAlign: "center",
                  padding: "10px 0",
                }}
              >
                暂无
              </div>
            ) : (
              col.rows.map(row => {
                const [titleField, ...restFields] = cardFields;
                return (
                  <Card
                    key={row.id}
                    size="small"
                    hoverable
                    onClick={() => onOpenRow(row)}
                    styles={{ body: { padding: "8px 10px" } }}
                    data-testid={`app-kanban-card-${row.id}`}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: INK.value,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {titleField ? (
                        <FieldValue
                          field={titleField}
                          value={row.values[titleField.id]}
                        />
                      ) : (
                        row.id
                      )}
                    </div>
                    {restFields.slice(0, 2).map(f => (
                      <div
                        key={f.id}
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: INK.label,
                          display: "flex",
                          gap: 6,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ color: INK.faint }}>{f.label}</span>
                        <FieldValue field={f} value={row.values[f.id]} />
                      </div>
                    ))}
                  </Card>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

export function CalendarBoard({
  rows,
  dateFieldId,
  colorByField,
  titleFieldId,
  onOpenRow,
}: {
  rows: RuntimeRow[];
  dateFieldId: string;
  /** 事件着色字段（enum，带 options；未声明时事件点用中性色） */
  colorByField?: AppFormFieldSchema;
  /** 事件条标题字段 id（通常是首列） */
  titleFieldId?: string;
  onOpenRow: (row: RuntimeRow) => void;
}) {
  const byDate = React.useMemo(
    () => rowsByDateKey(rows, dateFieldId),
    [rows, dateFieldId]
  );
  const dataMonth = dominantMonth(byDate);
  const [month, setMonth] = React.useState<string>(
    () => dataMonth ?? new Date().toISOString().slice(0, 7)
  );
  // 数据月变化（如首条排期写入）时跳到数据所在月
  const lastDataMonth = React.useRef(dataMonth);
  React.useEffect(() => {
    if (dataMonth && dataMonth !== lastDataMonth.current) {
      lastDataMonth.current = dataMonth;
      setMonth(dataMonth);
    }
  }, [dataMonth]);

  const weeks = buildMonthGrid(month);
  const dotColor = (row: RuntimeRow): string => {
    if (!colorByField?.options) return TONE_COLORS.default;
    const v = String(row.values[colorByField.id] ?? "");
    const option = colorByField.options.find(o => o.id === v);
    return TONE_COLORS[option?.tone ?? "default"];
  };

  return (
    <div data-testid="app-runtime-calendar">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Button
          size="small"
          type="text"
          icon={<LeftOutlined />}
          onClick={() => setMonth(m => shiftMonth(m, -1))}
          data-testid="app-calendar-prev"
        />
        <span
          style={{ fontSize: 13, fontWeight: 600, color: INK.value }}
          data-testid="app-calendar-month"
        >
          {month.replace("-", " 年 ")} 月
        </span>
        <Button
          size="small"
          type="text"
          icon={<RightOutlined />}
          onClick={() => setMonth(m => shiftMonth(m, 1))}
          data-testid="app-calendar-next"
        />
        {dataMonth && dataMonth !== month && (
          <Button size="small" type="link" onClick={() => setMonth(dataMonth)}>
            回到数据月
          </Button>
        )}
        <span style={{ fontSize: 11, color: INK.faint }}>
          共 {[...byDate.values()].reduce((n, list) => n + list.length, 0)}{" "}
          条排期
        </span>
      </div>
      {byDate.size === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无带日期的数据 — 点「新建」写入后自动入历"
          style={{ margin: "8px 0" }}
        />
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderLeft: "1px solid #f0f0f0",
          borderTop: "1px solid #f0f0f0",
        }}
      >
        {WEEKDAY_LABELS.map(w => (
          <div
            key={w}
            style={{
              padding: "4px 6px",
              fontSize: 11,
              color: INK.label,
              background: "#fafafa",
              borderRight: "1px solid #f0f0f0",
              borderBottom: "1px solid #f0f0f0",
              textAlign: "center",
            }}
          >
            周{w}
          </div>
        ))}
        {weeks.flat().map(cell => {
          const events = byDate.get(cell.dateKey) ?? [];
          return (
            <div
              key={cell.dateKey}
              style={{
                minHeight: 74,
                padding: "3px 5px",
                borderRight: "1px solid #f0f0f0",
                borderBottom: "1px solid #f0f0f0",
                background: cell.inMonth ? "#fff" : "#fcfcfc",
              }}
              data-testid={`app-calendar-cell-${cell.dateKey}`}
            >
              <div
                style={{
                  fontSize: 11,
                  color: cell.inMonth ? INK.label : INK.faint,
                }}
              >
                {cell.day}
              </div>
              {events.slice(0, 3).map(row => (
                <div
                  key={row.id}
                  onClick={() => onOpenRow(row)}
                  style={{
                    marginTop: 2,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 11,
                    color: INK.value,
                    cursor: "pointer",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                  data-testid={`app-calendar-event-${row.id}`}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: dotColor(row),
                    }}
                  />
                  <span
                    style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {String(
                      (titleFieldId && row.values[titleFieldId]) || row.id
                    )}
                  </span>
                </div>
              ))}
              {events.length > 3 && (
                <div style={{ marginTop: 2, fontSize: 10, color: INK.faint }}>
                  +{events.length - 3} 更多
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
