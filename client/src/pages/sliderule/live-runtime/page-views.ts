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

export interface MonthCell {
  /** "YYYY-MM-DD" */
  dateKey: string;
  /** 当月内的日号（跨月补位格为相邻月日号） */
  day: number;
  /** 是否属于展示月（补位格淡显） */
  inMonth: boolean;
}

/** month 加减 n 个月（month 形如 "YYYY-MM"）。 */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/**
 * 月历网格：周一起始，整周对齐（首尾用相邻月补位），返回按周分组的格子。
 * 纯日期算术（UTC，无时区参与），确定性可测。
 */
export function buildMonthGrid(month: string): MonthCell[][] {
  const [y, m] = month.split("-").map(Number);
  const first = Date.UTC(y, m - 1, 1);
  // getUTCDay(): 0=周日 → 周一起始的偏移
  const leading = (new Date(first).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const totalCells = Math.ceil((leading + daysInMonth) / 7) * 7;

  const weeks: MonthCell[][] = [];
  let week: MonthCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const t = new Date(first + (i - leading) * 86400000);
    const cell: MonthCell = {
      dateKey: t.toISOString().slice(0, 10),
      day: t.getUTCDate(),
      inMonth: t.getUTCMonth() === m - 1 && t.getUTCFullYear() === y,
    };
    week.push(cell);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  return weeks;
}
