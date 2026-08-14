/**
 * HTML 绑定解释器 —— 把第 6.5 步打进 HTML 的 data-* 孔填成真数据。
 *
 * ## 它在链路的哪一头
 *
 *     3    spec 每一页 → HTML          只有版式，一个数字都不写
 *     6    汇合 → 五系统模型            实体/字段/角色/权限/节点在此定死
 *     6.5  给 HTML 打 data-* 绑定孔     services/html_bindings.py
 *     ——— 到这里，页面上有孔但没人填 ———
 *     **本文件**：运行时按孔取数、填进去
 *
 * 用用户那个比喻：HTML 是木偶，五系统模型是那双手，`data-*` 是木偶身上让线
 * 穿过去的孔。**本文件是穿线的那一下。** 没有它，前六步的产物在产品里
 * 仍然是一张静态图。
 *
 * ## 为什么是纯函数，不是组件
 *
 * 判据要能机械跑。做成 React 组件就只能靠渲染快照测，而今天在「造个代理去
 * 替代看一眼」上栽了四次。这里把解释逻辑做成对一棵已有 DOM 的纯操作，
 * jsdom 里直接断言节点和文本——**改一个字段就能断言多一列**，这正是 G2 组
 * 验过的那条判据（`experiments/visual-first/g2_render_test.mjs`）。
 *
 * 宿主安全（Shadow DOM 隔离 + DOMPurify）由挂载它的那一层负责，不在这里，
 * 理由是那两件事各自有各自的判据，混在一个函数里两边都测不干净。
 *
 * ## 词汇表照 docs/绑定契约草案-v1.md，一个字不自创
 *
 *     data-rows="<entity>"        逐行容器；可带 data-sort / data-order / data-limit
 *     data-field="<fieldId>"      取**当前行**的字段
 *     data-head="<entity>" + data-col   表头按字段清单展开
 *     data-cell                   行内单元格模板，按字段清单展开
 *     data-value + data-aggregate 单值聚合（count / sum / avg / max / min）
 *     data-chart + data-entity + data-dimension + data-metric   图表
 *     data-action + data-entity   动作，点了发事件
 *
 * ⚠ 动作那三种 kind（createRecord / openRecord / editRecord）跟
 *   freeform_block.ActionRef 一字不差。两处表达同一件事，**词表分叉就是下一个
 *   对不齐的地方**——本仓在「手写 uses 声明 / 前端手抄区域词汇」上踩过两次。
 */

import { formatFieldText, EMPTY_TEXT } from "./field-text";

export const HTML_BINDING_RUNTIME_VERSION = "html-binding-runtime-v1";

/**
 * 这套词汇里**所有**属性名。消毒那一层要照它放行，别处不许手抄第二份。
 *
 * ## 为什么必须是单一来源
 *
 * 宿主消毒用的是 `ALLOW_DATA_ATTR: false` + 显式白名单（理由见
 * bound-html-surface.tsx）——也就是说**没列进白名单的 data-* 会被静默删掉**。
 * 删掉之后页面照常渲染、消毒器照常报成功、解释器 problems 也是空的
 * （没有孔就没有错误的孔），**那个能力整条无声消失**。
 *
 * 这正是本仓数到第九次的形状。而它最常见的成因是**同一份清单被抄了两遍**：
 * 「区块 uses 声明」与实际渲染不符 316 个、前端手抄的区域词汇与目录漂移——
 * 都是这么来的。所以词表只有这一份，消毒那边 import 它。
 */
export const BINDING_ATTRS = [
  // 逐行容器与它的取数参数
  "data-rows", "data-sort", "data-order", "data-limit", "data-fields",
  // 表头 / 单元格模板
  "data-head", "data-col", "data-cell",
  // 取值
  "data-field", "data-value", "data-aggregate",
  // 图表
  "data-chart", "data-entity", "data-dimension", "data-metric", "data-metric-field",
  // 动作
  "data-action",
  // 运行时**写回**的两个：行 id 与算好的 series。
  // ⚠ 它们由解释器写、不由生成侧写，但消毒发生在解释之**前**也可能在之后
  //   （重新消毒一份已填好的 HTML），漏了它们等于点击丢行、图表丢数。
  "data-row-id", "data-series",
] as const;

/** 一行数据。键是 fieldId。 */
export type BindingRow = Record<string, unknown>;

export interface BindingField {
  id: string;
  name?: string;
  /** 缺省当 "string"（模型里字段类型可以不写，读侧不该因此炸） */
  type?: string;
  /** money / percent / progress / score / mask…（见 field-display 的 FieldFormat） */
  format?: string;
  /**
   * enum 声明取值。
   *
   * ⚠ 键是 **id**，不是 value。头一版写的是 `{ value, label }`，而
   * `formatFieldText` 读的是 `o.id`——两边对不上的后果不是报错，是
   * **enum 恒显内部 id**（`music_member` 这种漏到界面上，线上截图逮到过）。
   * 页面照常渲染、解释器 problems 是空的、消毒器照常成功，没有一处会红。
   *
   * 当时那行注释写着"与 field-text 的 FieldLike 对齐"，而它并没有对齐——
   * 注释声称的对齐必须由类型或转换函数**兑现**，见下面的 asFieldLike。
   */
  options?: Array<{ id: string; label?: string }>;
}

/**
 * BindingField → field-text 要的 FieldLike。**真转一次，不是类型断言。**
 *
 * 断言只会让编译器闭嘴，字段形状该对不上还是对不上（上面那条 options 就是
 * 这么漏的）。这里补齐 FieldLike 要求的三处：type 缺省、label 缺省回落 id、
 * tone 缺省 default。
 */
function asFieldLike(f: BindingField) {
  return {
    type: f.type || "string",
    format: f.format as FieldLikeFormat,
    options: f.options?.map((o) => ({
      id: o.id,
      label: o.label ?? o.id,
      tone: "default" as const,
    })),
  };
}

type FieldLikeFormat = NonNullable<
  Parameters<typeof formatFieldText>[1]
>["format"];

export interface BindingSource {
  /** entityId → 行数组 */
  rows: Record<string, BindingRow[]>;
  /** entityId → 字段定义（顺序即列序） */
  fields: Record<string, BindingField[]>;
}

export type ActionKind = "createRecord" | "openRecord" | "editRecord";

export interface BindingActionEvent {
  kind: ActionKind;
  entityId: string;
  /** 行内动作带得出当前行 id；页头动作没有行，为 null */
  rowId: string | null;
}

export interface ApplyBindingsOptions {
  source: BindingSource;
  onAction?: (event: BindingActionEvent) => void;
  /** 行 id 从哪个字段取。缺省 "id"。 */
  rowIdField?: string;
}

export interface ApplyBindingsReport {
  version: string;
  /** 各类孔各填了多少个 */
  filled: Record<string, number>;
  /** 填不了的孔（引用了不存在的实体/字段等），每条都说清是哪儿 */
  problems: string[];
}

const ROW_TPL = "__slideruleRowTpl";
const HEAD_TPL = "__slideruleHeadTpl";

interface TemplateCache {
  [ROW_TPL]?: Element;
  [HEAD_TPL]?: Element;
}

/** 排序：只按字段值比大小，认不出就保持原序（不排比乱排好）。 */
function sortRows(rows: BindingRow[], sortBy: string, order: string): BindingRow[] {
  if (!sortBy) return rows;
  const dir = order.toLowerCase() === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = a[sortBy];
    const y = b[sortBy];
    if (x == null && y == null) return 0;
    if (x == null) return 1;   // 空值恒沉底，不受升降序影响——空不是"最小"，是"没有"
    if (y == null) return -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * dir;
    return String(x).localeCompare(String(y), "zh") * dir;
  });
}

function clampLimit(raw: string | null): number | null {
  // ⚠ 不能写 Number(raw)：raw 为 null 时 Number(null) === 0，
  //   于是「没写 limit」会被解释成「只要 0 行」。这个坑本仓踩过一次。
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(Math.floor(n), 200);
}

function aggregate(kind: string, rows: BindingRow[], fieldId: string): string {
  if (kind === "count") return String(rows.length);
  const nums = rows
    .map((r) => Number(r[fieldId]))
    .filter((n) => Number.isFinite(n));
  // 空数据不显 0 —— 0 是个真值，拿它冒充"没有"是在撒谎。
  // 这条跟 ✦3「sum 空数据显 —」同一口径（SQL / pandas 语义）。
  if (!nums.length) return EMPTY_TEXT;
  switch (kind) {
    case "sum": return String(nums.reduce((a, b) => a + b, 0));
    case "avg": return String(Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100);
    case "max": return String(Math.max(...nums));
    case "min": return String(Math.min(...nums));
    default: return EMPTY_TEXT;
  }
}

function fieldOf(fields: BindingField[] | undefined, id: string): BindingField | undefined {
  return (fields || []).find((f) => f.id === id);
}

/**
 * 把一棵 DOM 上的 data-* 孔填成真数据。**就地修改 root**，返回填充报告。
 *
 * 可重复调用：模板在首次调用时被缓存到节点上，之后每次都从模板重建，
 * 所以「改一份 JSON 再调一次」能得到正确结果，而不是在上一次的产物上叠加。
 * 这正是「只迭代业务逻辑模型就能无限迭代」那句话在运行时的落点。
 */
export function applyBindings(
  root: Element,
  opts: ApplyBindingsOptions
): ApplyBindingsReport {
  const { source, onAction } = opts;
  const rowIdField = opts.rowIdField || "id";
  const filled: Record<string, number> = {
    rows: 0, field: 0, head: 0, value: 0, chart: 0, action: 0,
  };
  const problems: string[] = [];

  // ── 表头：按字段清单展开 ────────────────────────────────────────
  root.querySelectorAll<HTMLElement>("[data-head]").forEach((head) => {
    const entityId = head.getAttribute("data-head") || "";
    const fields = source.fields[entityId];
    if (!fields) {
      problems.push(`data-head="${entityId}"：模型里没有这个实体`);
      return;
    }
    const cache = head as unknown as TemplateCache;
    // ⚠ 父节点必须**从活 DOM 上现查**，不能从缓存的模板上取。
    //   缓存的是 cloneNode 出来的**游离节点**，它的 parentElement 恒为 null——
    //   第二次调用时走缓存分支就会直接 return，表现是「改了字段清单，列不跟」，
    //   而这正是 G2 那条判据要验的东西。一次都不报错，只是不动。
    const live = head.querySelector("[data-col]");
    if (!cache[HEAD_TPL]) {
      if (!live) {
        problems.push(`data-head="${entityId}"：里面没有 [data-col] 列模板`);
        return;
      }
      cache[HEAD_TPL] = live.cloneNode(true) as Element;
    }
    const parent = live?.parentElement || head.querySelector("tr");
    if (!parent) return;
    parent.innerHTML = "";
    fields.forEach((f) => {
      const th = cache[HEAD_TPL]!.cloneNode(true) as HTMLElement;
      th.textContent = f.name || f.id;
      parent.appendChild(th);
    });
    filled.head += fields.length;
  });

  // ── 逐行容器 ───────────────────────────────────────────────────
  root.querySelectorAll<HTMLElement>("[data-rows]").forEach((box) => {
    const entityId = box.getAttribute("data-rows") || "";
    const all = source.rows[entityId];
    if (!all) {
      problems.push(`data-rows="${entityId}"：模型里没有这个实体`);
      return;
    }
    const fields = source.fields[entityId] || [];
    const cache = box as unknown as TemplateCache;
    let rowTpl = cache[ROW_TPL];
    if (!rowTpl) {
      const first = box.querySelector("tr") || box.firstElementChild;
      if (!first) {
        problems.push(`data-rows="${entityId}"：容器里没有行模板`);
        return;
      }
      cache[ROW_TPL] = first.cloneNode(true) as Element;
      rowTpl = cache[ROW_TPL];
    }

    let rows = sortRows(
      all,
      box.getAttribute("data-sort") || "",
      box.getAttribute("data-order") || "asc"
    );
    const limit = clampLimit(box.getAttribute("data-limit"));
    if (limit != null) rows = rows.slice(0, limit);

    box.innerHTML = "";
    rows.forEach((row) => {
      const tr = rowTpl!.cloneNode(true) as HTMLElement;
      // 单元格模板：按字段清单展开（G2 验过的那条——加字段自动多列）
      const cellAnchor = tr.querySelector("[data-cell]");
      if (cellAnchor && fields.length) {
        const parent = cellAnchor.parentElement;
        if (parent) {
          const cellTpl = cellAnchor.cloneNode(true) as HTMLElement;
          // 操作列那类**不带 data-cell 的兄弟节点**要保住，并且留在最后
          const rest = Array.from(parent.children).filter(
            (c) => !c.hasAttribute("data-cell")
          );
          parent.innerHTML = "";
          fields.forEach((f) => {
            const cell = cellTpl.cloneNode(true) as HTMLElement;
            cell.textContent = formatFieldText(row[f.id], asFieldLike(f));
            parent.appendChild(cell);
          });
          rest.forEach((c) => parent.appendChild(c));
        }
      }
      // 行内 data-field：作用域是**这一行**
      tr.querySelectorAll<HTMLElement>("[data-field]").forEach((el) => {
        const fid = el.getAttribute("data-field") || "";
        const f = fieldOf(fields, fid);
        if (!f) {
          problems.push(`data-field="${fid}"：不是实体 ${entityId} 的字段`);
          return;
        }
        el.textContent = formatFieldText(row[fid], asFieldLike(f));
        filled.field += 1;
      });
      // 行内动作带得出当前行 —— 取不到 rowId 就发空事件是静默失败，
      // actionRef 那轮补运行时判据时点过名，这里同样不许发生
      const rid = row[rowIdField];
      tr.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
        el.setAttribute("data-row-id", rid == null ? "" : String(rid));
      });
      box.appendChild(tr);
    });
    filled.rows += rows.length;
  });

  // ── 单值聚合 ───────────────────────────────────────────────────
  root.querySelectorAll<HTMLElement>("[data-value]").forEach((el) => {
    const entityId = el.getAttribute("data-value") || "";
    const rows = source.rows[entityId];
    if (!rows) {
      problems.push(`data-value="${entityId}"：模型里没有这个实体`);
      return;
    }
    const kind = (el.getAttribute("data-aggregate") || "count").toLowerCase();
    el.textContent = aggregate(kind, rows, el.getAttribute("data-field") || "");
    filled.value += 1;
  });

  // ── 图表：本文件只把数据算出来挂上，**不画** ────────────────────
  // 画交给 ECharts 那一层。理由是画图有自己的一堆判据（配色/空态/grain），
  // 混进来这个函数就测不干净了。
  root.querySelectorAll<HTMLElement>("[data-chart]").forEach((el) => {
    const entityId = el.getAttribute("data-entity") || "";
    const rows = source.rows[entityId];
    if (!rows) {
      problems.push(`data-chart 的 data-entity="${entityId}"：模型里没有这个实体`);
      return;
    }
    const dim = el.getAttribute("data-dimension") || "";
    const metric = (el.getAttribute("data-metric") || "count").toLowerCase();
    const buckets = new Map<string, BindingRow[]>();
    rows.forEach((r) => {
      const key = r[dim] == null ? EMPTY_TEXT : String(r[dim]);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    });
    const series = Array.from(buckets.entries()).map(([name, bucket]) => ({
      name,
      value: aggregate(metric, bucket, el.getAttribute("data-metric-field") || ""),
    }));
    el.setAttribute("data-series", JSON.stringify(series));
    filled.chart += 1;
  });

  // ── 动作：点了发事件，且不发空事件 ──────────────────────────────
  root.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    const kind = el.getAttribute("data-action") as ActionKind;
    const entityId = el.getAttribute("data-entity") || "";
    if (kind !== "createRecord" && kind !== "openRecord" && kind !== "editRecord") {
      problems.push(`data-action="${kind}"：不在封闭词表里（createRecord/openRecord/editRecord）`);
      return;
    }
    if (!source.rows[entityId]) {
      problems.push(`data-action 的 data-entity="${entityId}"：模型里没有这个实体`);
      return;
    }
    // 行内动作必须带得出行 id。带不出还挂监听，点下去就是一个空事件——
    // 页面开出一个空详情，看着像"点了没反应"。宁可如实报问题。
    const raw = el.getAttribute("data-row-id");
    const needsRow = kind !== "createRecord";
    if (needsRow && (raw == null || raw === "")) {
      problems.push(`data-action="${kind}" entity=${entityId}：取不到行 id，不挂监听`);
      return;
    }
    el.setAttribute("role", "button");
    // 键盘可达：axe 会报但没人跑 axe，所以这里直接给上
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
    if (onAction) {
      el.addEventListener("click", () =>
        onAction({ kind, entityId, rowId: needsRow ? raw : null })
      );
    }
    filled.action += 1;
  });

  return { version: HTML_BINDING_RUNTIME_VERSION, filled, problems };
}

/**
 * 整页至少要有一个数据源，否则渲染出来还是死的静态页。
 *
 * ⚠ 这条**不能靠 applyBindings 的 problems 判**：一份一个孔都没打的 HTML
 * 走完 applyBindings，problems 是空的、filled 全 0，**看起来完美通过**。
 * 「没有绑定就没有错误的绑定」——今天在这个形状上栽了五次，所以单列一条。
 */
export function hasAnyDataSource(root: Element): boolean {
  return Boolean(root.querySelector("[data-rows], [data-value], [data-chart]"));
}
