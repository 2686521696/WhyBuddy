/**
 * page-views — 页面范式（加厚 schema 二期）的纯函数层。
 *
 * kanban：列来自 statusField 的声明 options（一期 tone 直接给列头着色），
 *   声明外/空值的行进「未归类」列——如实呈现，不吞数据。
 * calendar：自建月历网格（不引 dayjs/antd Calendar——避免幻影依赖，
 *   且默认月份可以跟着数据走：显示行数最多的月份，而不是今天的空月份）。
 * 无 React 依赖，渲染组件消费结果。
 */

import type { RuntimeRow } from "./live-runtime";
import type { NormalizedFieldOption } from "./field-display";

// --- kanban -----------------------------------------------------------------

export interface KanbanColumn {
  /** 列 id = option id；未归类列固定 "__unassigned" */
  id: string;
  label: string;
  tone: NormalizedFieldOption["tone"];
  rows: RuntimeRow[];
}

export const KANBAN_UNASSIGNED = "__unassigned";

/**
 * 行按 statusField 值分进声明列；声明外取值/空值进「未归类」列
 * （仅在有此类行时出现）。列序 = options 声明序。
 */
export function groupRowsForKanban(
  rows: RuntimeRow[],
  statusFieldId: string,
  options: NormalizedFieldOption[]
): KanbanColumn[] {
  const columns: KanbanColumn[] = options.map(o => ({
    id: o.id,
    label: o.label,
    tone: o.tone,
    rows: [],
  }));
  const byId = new Map(columns.map(c => [c.id, c] as const));
  const unassigned: KanbanColumn = {
    id: KANBAN_UNASSIGNED,
    label: "未归类",
    tone: "default",
    rows: [],
  };
  for (const row of rows) {
    const v = String(row.values[statusFieldId] ?? "").trim();
    (byId.get(v) ?? unassigned).rows.push(row);
  }
  return unassigned.rows.length > 0 ? [...columns, unassigned] : columns;
}

// --- calendar ---------------------------------------------------------------

/** "YYYY-MM-DD" 才算有效日期键（date 输入控件的原生格式）。 */
export function dateKeyOf(value: unknown): string | null {
  const s = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Date → "YYYY-MM-DD"（与 dateKeyOf 同一种键）。
 *  用本地时区而不是 toISOString——后者按 UTC 切，东八区晚上的记录会被算到
 *  第二天，日历上的圆点就和列表对不上号。 */
export function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 行按日期键归组；无法解析日期的行不入历（表格视图仍可见）。 */
export function rowsByDateKey(
  rows: RuntimeRow[],
  dateFieldId: string
): Map<string, RuntimeRow[]> {
  const map = new Map<string, RuntimeRow[]>();
  for (const row of rows) {
    const key = dateKeyOf(row.values[dateFieldId]);
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

/**
 * 默认展示月份 = 行数最多的月份（"YYYY-MM"；并列取较早月）。
 * 没有可解析日期时返回 null——调用方回退当前月。
 */
export function dominantMonth(
  byDate: Map<string, RuntimeRow[]>
): string | null {
  const counts = new Map<string, number>();
  for (const [key, list] of byDate) {
    const month = key.slice(0, 7);
    counts.set(month, (counts.get(month) ?? 0) + list.length);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [month, count] of [...counts.entries()].sort()) {
    if (count > bestCount) {
      best = month;
      bestCount = count;
    }
  }
  return best;
}

// MonthCell / shiftMonth / buildMonthGrid 已删除（2026-07-29）。
// 它们是自建月历的三件套：算整周补位、算上下月。CalendarBoard 换成 antd
// Calendar 之后没有任何调用方——留着带测试的死函数比删掉更糟，它看起来还在
// 维护。月份加减现在走 dayjs（`value.add(1,"month")`），网格由 Calendar 自己
// 铺，星期起始日跟着 dayjs 的 locale 走，不再硬编码。
