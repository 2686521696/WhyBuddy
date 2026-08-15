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
 *     data-record="<entity>"      **单条记录作用域**；可带 data-record-id
 *     data-field="<fieldId>"      取**当前作用域**那条记录的字段
 *                                 （行内 = 当前行，data-record 内 = 那一条）
 *     data-head="<entity>" + data-col   表头按字段清单展开
 *     data-cell                   行内单元格模板，按字段清单展开
 *     data-value + data-aggregate 单值聚合（count / sum / avg / max / min）
 *     data-chart + data-entity + data-dimension + data-metric   图表
 *     data-action + data-entity   动作，点了发事件
 *
 * ⚠ 动作词表**每种语言只有一份**（2026-08-14 晚收拢）：前端就是本文件的
 *   ACTION_KINDS（block-registry 的 FreeformActionRef 直接引用 ActionKind 类型），
 *   Python 是 html_bindings.ACTION_KINDS（freeform_block 查它校验）。
 *   两份之间靠 test_html_bindings 的跨语言看门测试钉死——**词表分叉就是
 *   下一个对不齐的地方**，本仓在「手写 uses 声明 / 前端手抄区域词汇」上
 *   踩过两次。加词只改两处：本文件 + html_bindings.py，看门测试不改就红。
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
  // 单条记录作用域（只建作用域、不迭代）。照 petite-vue 的 v-scope：
  // 它跟 v-for 走同一个 createScopedContext，读字段的指令不关心作用域从哪来。
  "data-record", "data-record-id",
  // 表头 / 单元格模板
  "data-head", "data-col", "data-cell",
  // 取值
  "data-field", "data-value", "data-aggregate",
  // 图表
  "data-chart", "data-entity", "data-dimension", "data-metric", "data-metric-field",
  // 动作
  "data-action",
  // 运行时**写回**的三个：行 id、算好的 series、动作上锁的原因。
  // ⚠ 它们由解释器写、不由生成侧写，但消毒发生在解释之**前**也可能在之后
  //   （重新消毒一份已填好的 HTML），漏了它们等于点击丢行、图表丢数、锁丢因。
  "data-row-id", "data-series", "data-locked",
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

/**
 * 动作封闭词表。数组是运行时判定用的**唯一真相源**，类型从它派生——
 * 写成手抄 union 的话，加词只改类型不改数组，判定会把新词当垃圾拒掉。
 *
 * 总表由两个子表**组合**而成（2026-08-14 晚收拢）：之前总表和转移子表
 * 是两份重叠手写，改一处漏一处。现在每个词只出现一次。
 */
/** 记录三种（openRecord/editRecord 要当前行）。 */
export const RECORD_ACTION_KINDS = ["createRecord", "openRecord", "editRecord"] as const;

/** 转移三种：把行提交进审批流 / 通过 / 驳回。三个都要当前行、
 *  要实体真的挂了流程——流程实例是挂在具体那条记录上的（entityRef）。 */
export const WORKFLOW_ACTION_KINDS = [
  "submitWorkflow", "approveWorkflow", "rejectWorkflow",
] as const;

export const ACTION_KINDS = [...RECORD_ACTION_KINDS, ...WORKFLOW_ACTION_KINDS] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type WorkflowActionKind = (typeof WORKFLOW_ACTION_KINDS)[number];

/** 使用点判断"是不是转移词"统一走这里——别再手写三个 `===` 串。 */
export function isWorkflowActionKind(v: string): v is WorkflowActionKind {
  return (WORKFLOW_ACTION_KINDS as readonly string[]).includes(v);
}

export interface BindingActionEvent {
  kind: ActionKind;
  entityId: string;
  /** 行内动作带得出当前行 id；页头动作没有行，为 null */
  rowId: string | null;
}

/**
 * 角色上下文——权限那只手伸进页面的形状（2026-08-14 晚）。
 *
 * 模式照 CASL 的 ability：宿主按当前角色**派生一次**（rbac-preview 的
 * deriveHtmlActionGates），解释器填孔时逐点检查。无权的动作**禁用不隐藏**
 * ——版式一个像素不能动（打孔那步的纪律），且用户该知道这个动作存在、
 * 只是当前角色没权（锁原因写进 title，游标也能读到）。
 *
 * 不传 gates = 不设卡（跟 rbac-preview 一贯的语义：没声明就是公共的）。
 */
export interface ActionGates {
  /** 当前角色 id；null = 模型没声明角色，不设卡 */
  role?: string | null;
  /** 给人看的角色名（锁话术用） */
  roleLabel?: string;
  /**
   * entityId → 新建卡。语义与 rbac-preview 的 PageAccess.canCreate 同源：
   * 页面声明了 *:create 权限才有卡；granted=false 时锁。
   */
  createGate?: Record<string, { permission: string; granted: boolean }>;
  /**
   * 挂了审批流的实体（页面 workflowLinked 且有主实体）。undefined = 不校验
   * （宿主没算，别把没算当成没挂）；空数组 = 真的一个都没挂。
   */
  workflowEntities?: readonly string[];
}

export interface ApplyBindingsOptions {
  source: BindingSource;
  onAction?: (event: BindingActionEvent) => void;
  /** 行 id 从哪个字段取。缺省 "id"。 */
  rowIdField?: string;
  /** 角色上下文。不传 = 不设卡。 */
  gates?: ActionGates;
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
/**
 * 在一个**作用域元素**内部填充 `data-field`。
 *
 * ⚠ 抽出来是为了让「一行」和「一条记录」共用同一段逻辑——这条是照
 *   petite-vue 学的：它的 `v-scope` 和 `v-for` 都走同一个
 *   `createScopedContext(ctx, data)`（walk.ts:44 与 for.ts:105），
 *   而读字段的指令根本不关心作用域是循环建的还是 scope 建的。
 *
 *   我们原来把「作用域」和「迭代」焊死在 `data-rows` 一个词里，于是详情卡
 *   （只要作用域、不要循环）无路可走——真机上模型只能把 data-field 打在
 *   容器外面，然后被判据拦下、整页 bind 失败。
 */
function fillFields(
  scope: Element,
  record: Record<string, unknown>,
  fields: Array<{ id: string; name?: string; type?: string }>,
  entityId: string,
  problems: string[],
  filled: Record<string, number>
): void {
  scope.querySelectorAll<HTMLElement>("[data-field]").forEach((el) => {
    const fid = el.getAttribute("data-field") || "";
    const f = fieldOf(fields, fid);
    if (!f) {
      problems.push(`data-field="${fid}"：不是实体 ${entityId} 的字段`);
      return;
    }
    el.textContent = formatFieldText(record[fid], asFieldLike(f));
    filled.field += 1;
  });
}

export function applyBindings(
  root: Element,
  opts: ApplyBindingsOptions
): ApplyBindingsReport {
  const { source, onAction } = opts;
  const rowIdField = opts.rowIdField || "id";
  const filled: Record<string, number> = {
    rows: 0, record: 0, field: 0, head: 0, value: 0, chart: 0, action: 0, locked: 0,
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
      fillFields(tr, row, fields, entityId, problems, filled);
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

  // ── 单条记录作用域 ─────────────────────────────────────────────
  //
  // 照 petite-vue 的 `v-scope`：**只建作用域、不迭代**。详情卡、主从视图的
  // 右侧面板、编辑表单都是这个形状——真机（烘焙那趟 p1 右侧「多因子算法分析」
  // 面板）就是它，而此前词表里压根没有它的位置。
  //
  // ⚠ 跳过已经在 data-rows 里的：那些字段属于「当前行」，上面那轮已经填过。
  //   petite-vue 靠原型链让内层作用域覆盖外层，我们这里结构简单，
  //   直接按 closest 判归属就够——但**必须判**，否则行内字段会被这一轮
  //   拿"第一条记录"再覆盖一次，表格里每行都变成同一条数据。
  root.querySelectorAll<HTMLElement>("[data-record]").forEach((box) => {
    if (box.closest("[data-rows]")) return;
    const entityId = box.getAttribute("data-record") || "";
    const rows = source.rows[entityId];
    const fields = source.fields[entityId];
    if (!rows || !fields) {
      problems.push(`data-record="${entityId}"：模型里没有这个实体`);
      return;
    }
    // 指定了 id 就取那条，否则取第一条（预览态下"展示某一条"的合理默认）
    const wanted = box.getAttribute("data-record-id");
    const record =
      wanted != null
        ? rows.find((r) => String(r[rowIdField]) === wanted)
        : rows[0];
    if (!record) {
      problems.push(
        `data-record="${entityId}"${wanted != null ? ` data-record-id="${wanted}"` : ""}：取不到记录`
      );
      return;
    }
    fillFields(box, record, fields, entityId, problems, filled);
    // 作用域里的动作同样带得出"当前这条"——跟行内一个口径
    const rid = record[rowIdField];
    box.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
      el.setAttribute("data-row-id", rid == null ? "" : String(rid));
    });
    filled.record += 1;
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

  // ── 动作：点了发事件，且不发空事件；无权的锁住不隐藏 ─────────────
  const gates = opts.gates;
  root.querySelectorAll<HTMLElement>("[data-action]").forEach((el) => {
    const kind = el.getAttribute("data-action") as ActionKind;
    const entityId = el.getAttribute("data-entity") || "";
    if (!(ACTION_KINDS as readonly string[]).includes(kind)) {
      problems.push(`data-action="${kind}"：不在封闭词表里（${ACTION_KINDS.join("/")}）`);
      return;
    }
    // 可重复调用的纪律：上一轮的锁要先卸掉（切了角色再填一遍，
    // 有权了的按钮不能还挂着锁）。
    if (el.hasAttribute("data-locked")) {
      el.removeAttribute("data-locked");
      el.removeAttribute("aria-disabled");
      el.removeAttribute("title");
      el.style.opacity = "";
      el.style.cursor = "";
    }
    if (!source.rows[entityId]) {
      problems.push(`data-action 的 data-entity="${entityId}"：模型里没有这个实体`);
      return;
    }
    // 转移动作只许打在真的挂了审批流的实体上——没挂流程的实体上一个
    // 「提交审批」按钮点下去无处可去，那是打孔的问题，如实点名。
    if (
      isWorkflowActionKind(kind) &&
      gates?.workflowEntities &&
      !gates.workflowEntities.includes(entityId)
    ) {
      problems.push(
        `data-action="${kind}" entity=${entityId}：这个实体没有绑定审批流，转移动作无处可去`
      );
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
    // 权限卡（目前只有新建有卡，口径与老区块舞台的 canCreate 完全一致）。
    // 锁 = 禁用 + 原因，不隐藏：版式不动，用户知道动作存在、只是没权。
    const gate = kind === "createRecord" ? gates?.createGate?.[entityId] : null;
    if (gate && !gate.granted) {
      const who = gates?.roleLabel || gates?.role || "当前角色";
      const reason = `需要权限「${gate.permission}」，${who}未持有`;
      el.setAttribute("data-locked", reason);
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("title", reason);
      el.style.opacity = "0.45";
      el.style.cursor = "not-allowed";
      filled.locked += 1;
      return; // 不挂监听：锁住的按钮点了不该有任何事发生
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
