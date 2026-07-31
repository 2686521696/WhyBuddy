/**
 * 体验区块的取数纯函数（2026-07-28）。
 *
 * 五个区块（MetricGrid / TrendChart / RankedList / ActivityFeed / DataTable）
 * 的 binding 在 experience_block_catalog.json 里有完整契约，Python 门禁
 * (_validate_block_binding) 已经校验过实体存在、字段类型、枚举取值、数值范围。
 * 这里做的是**运行时取数**，并且不单方面信任上游——门禁校验的是"模型声明"，
 * 运行时拿到的是"用户真实写进去的行"，两者可能对不上（字段被后续迭代改名、
 * 行里那个字段是空的），所以每个函数都自己再判一次，判不了就返回空，
 * 由渲染器出诚实空态，不猜、不崩。
 *
 * 抽成纯函数是为了能单测——本仓库没有 jsdom，渲染层只能测静态 HTML，
 * 分桶/排序/补零这些真正容易错的逻辑必须在这一层锁死。
 */

import type { RuntimeRow } from "./live-runtime";
import { dateKeyOf } from "./page-views";

// ── 聚合（MetricGrid）────────────────────────────────────────────────

/** binding.aggregate 的合法形态：count | sum:<fieldId> | avg:<fieldId>。 */
export interface AggregateSpec {
  kind: "count" | "sum" | "avg";
  fieldId?: string;
}

/** 解析聚合表达式。非法/空 → count（与门禁的默认一致，不抛）。 */
export function parseAggregate(raw: unknown): AggregateSpec {
  const s = String(raw ?? "").trim();
  if (!s || s === "count") return { kind: "count" };
  const [prefix, ...rest] = s.split(":");
  const fieldId = rest.join(":").trim();
  if ((prefix === "sum" || prefix === "avg") && fieldId)
    return { kind: prefix, fieldId };
  return { kind: "count" };
}

/**
 * 算一个聚合值。
 *
 * avg 的分母是**该字段有有效数值的行数**，不是总行数——字段没填的行不该
 * 把平均值拉低。一条有效行都没有时返回 null（不是 0）：0 是"算出来是零"，
 * null 是"算不出来"，两者在界面上必须显示成不同的东西。
 */
export function computeAggregate(
  rows: RuntimeRow[],
  spec: AggregateSpec
): number | null {
  if (spec.kind === "count") return rows.length;
  if (!spec.fieldId) return null;
  let sum = 0;
  let n = 0;
  for (const row of rows) {
    const v = Number(row.values?.[spec.fieldId]);
    if (!Number.isFinite(v)) continue;
    sum += v;
    n += 1;
  }
  if (n === 0) return null;
  return spec.kind === "sum" ? sum : sum / n;
}

// ── 时间分桶（TrendChart）────────────────────────────────────────────

export type TimeGrain = "day" | "week" | "month";

/** 桶上限：三年按天会产出上千个类目，图挤成一团、还拖慢渲染。超了就退到更粗的粒度。 */
export const MAX_TREND_BUCKETS = 60;

/**
 * 把 "YYYY-MM-DD" 归到所属桶的起始日。
 *
 * 两个容易错的点：
 * 1. **本地时区**——用 new Date("YYYY-MM-DD") 会按 UTC 解析，东八区会整体
 *    偏一天。这里手工拆字符串构造本地 Date，不经过 UTC。
 * 2. **周从周一起**（ISO-8601，也是中文习惯）。JS 的 getDay() 周日是 0，
 *    直接减会把周日归到下一周，必须先把 0 映射成 7。
 */
export function bucketKeyOf(dateKey: string, grain: TimeGrain): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  if (grain === "month") return `${y}-${String(m).padStart(2, "0")}`;
  if (grain === "day") return dateKey;
  const local = new Date(y, m - 1, d);
  const dow = local.getDay() === 0 ? 7 : local.getDay();
  local.setDate(local.getDate() - (dow - 1));
  return fmtLocal(local);
}

function fmtLocal(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 桶序列：从 first 到 last 逐桶推进（含两端）。用于补零。 */
export function enumerateBuckets(
  first: string,
  last: string,
  grain: TimeGrain
): string[] {
  const out: string[] = [];
  if (grain === "month") {
    let [y, m] = first.split("-").map(Number);
    const [ly, lm] = last.split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      if (out.length > 1000) break; // 防脏数据（1970/2999）把内存跑爆
    }
    return out;
  }
  const step = grain === "week" ? 7 : 1;
  const [fy, fm, fd] = first.split("-").map(Number);
  const cur = new Date(fy, fm - 1, fd);
  for (let i = 0; i <= 1000; i++) {
    const key = fmtLocal(cur);
    out.push(key);
    if (key >= last) break;
    cur.setDate(cur.getDate() + step);
  }
  return out;
}

export interface TrendSeries {
  categories: string[];
  values: number[];
  /** 实际使用的粒度——桶太多时会自动变粗，渲染层要把这个如实标出来。 */
  grain: TimeGrain;
  /** 因为超上限而自动变粗了吗 */
  coarsened: boolean;
}

/**
 * 按时间粒度聚合出趋势序列。
 *
 * **缺失的桶补零**，这是与现有 groupRowsForChart 最关键的区别：那个函数只把
 * 出现过的取值当类目，中间没数据的日子直接不存在，折线会跨过空档连起来——
 * 视觉上等于说"这几天有值且在平滑变化"，是撒谎。补零之后空档如实显示为 0。
 *
 * 桶数超过 MAX_TREND_BUCKETS 时自动退到更粗的粒度（day→week→month），
 * 退到**刚好放得下**的那一档为止，不一步跳到最粗（白丢一档细节）。
 * month 之后没有更粗的了（binding 枚举只有 day/week/month），此时允许超过
 * 上限——上限是偏好不是硬约束。另一条路是只留最近 60 个桶，但那会悄悄丢掉
 * 最早那段历史，用户看不出来；宁可挤一点也要如实。
 */
export function buildTrendSeries(
  rows: RuntimeRow[],
  timeFieldId: string,
  grain: TimeGrain,
  aggregate: AggregateSpec = { kind: "count" }
): TrendSeries | null {
  const dated: Array<{ key: string; row: RuntimeRow }> = [];
  for (const row of rows) {
    const key = dateKeyOf(row.values?.[timeFieldId]);
    if (key) dated.push({ key, row });
  }
  if (dated.length === 0) return null;

  const ORDER: TimeGrain[] = ["day", "week", "month"];
  let idx = Math.max(0, ORDER.indexOf(grain));
  let coarsened = false;
  for (;;) {
    const g = ORDER[idx];
    const byBucket = new Map<string, RuntimeRow[]>();
    for (const { key, row } of dated) {
      const b = bucketKeyOf(key, g);
      const list = byBucket.get(b) ?? [];
      list.push(row);
      byBucket.set(b, list);
    }
    const keys = [...byBucket.keys()].sort();
    const cats = enumerateBuckets(keys[0], keys[keys.length - 1], g);
    if (cats.length <= MAX_TREND_BUCKETS || idx >= ORDER.length - 1) {
      return {
        categories: cats,
        values: cats.map(c => computeAggregate(byBucket.get(c) ?? [], aggregate) ?? 0),
        grain: g,
        coarsened,
      };
    }
    idx += 1;
    coarsened = true;
  }
}

// ── 排行（RankedList）────────────────────────────────────────────────

export interface RankedItem {
  row: RuntimeRow;
  label: string;
  value: number;
}

/**
 * 按数值字段取 top-N。
 *
 * 没有该字段有效值的行**整条排除**——排行榜里出现一个值为空的条目，用户
 * 无法判断它是 0 还是没填，而这两件事在业务上完全不同。
 */
export function buildRankedRows(
  rows: RuntimeRow[],
  sortFieldId: string,
  labelFieldId: string | undefined,
  order: "asc" | "desc",
  limit: number
): RankedItem[] {
  const items: RankedItem[] = [];
  for (const row of rows) {
    const v = Number(row.values?.[sortFieldId]);
    if (!Number.isFinite(v)) continue;
    const rawLabel = labelFieldId
      ? row.values?.[labelFieldId]
      : Object.values(row.values ?? {})[0];
    items.push({
      row,
      label: String(rawLabel ?? row.id),
      value: v,
    });
  }
  items.sort((a, b) => (order === "asc" ? a.value - b.value : b.value - a.value));
  const n = Number.isFinite(limit) ? Math.min(20, Math.max(3, limit)) : 5;
  return items.slice(0, n);
}

// ── 动态流（ActivityFeed）────────────────────────────────────────────

export interface FeedItem {
  row: RuntimeRow;
  dateKey: string;
  title: string;
  level?: string;
}

/**
 * 按时间倒序取动态。无法解析日期的行不入流——动态流的语义就是"按时间排"，
 * 一条没有时间的记录放在任何位置都是错的，不如不显示（它在表格视图里仍在）。
 */
export function buildFeedRows(
  rows: RuntimeRow[],
  timeFieldId: string,
  levelFieldId: string | undefined,
  limit = 8
): FeedItem[] {
  const items: FeedItem[] = [];
  for (const row of rows) {
    const dateKey = dateKeyOf(row.values?.[timeFieldId]);
    if (!dateKey) continue;
    items.push({
      row,
      dateKey,
      title: String(Object.values(row.values ?? {})[0] ?? row.id),
      level: levelFieldId
        ? String(row.values?.[levelFieldId] ?? "").trim() || undefined
        : undefined,
    });
  }
  items.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  return items.slice(0, Math.max(1, limit));
}
