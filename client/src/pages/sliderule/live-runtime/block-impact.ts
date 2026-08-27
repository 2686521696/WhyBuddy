/**
 * 刀 4：改这一块，谁跟着变（2026-08-27）。
 *
 * 这一刀是用户真正要的那件事，也是**唯一没有现成东西可抄**的一刀。
 * grok-build 是终端 UI + 编译期工具链，claw-code 是 CLI，两个仓都不做图
 * 可视化，也没有"谁依赖我"这类反查——本地 clone 之后逐条扫过确认的
 * （`command_graph.py` 名字唬人，34 行，只是把命令分三桶打印计数）。
 *
 * 唯一能抄的一点在 grok 的 `xai-computer-hub-core/src/registry.rs`：它维护
 * 一个 tool→sessions 正向 + (session,tool) 反向的双向索引。抄它三条纪律：
 *
 *   1. 每次改动返回**显式结果**，不静默 no-op
 *   2. 清理过程**计数**（判据能断言"清了 N 行"而不只是"清理跑过了"）
 *   3. 绑定掉光的记录**不删** —— 对应我们这儿：**没有绑定的块仍然是块**，
 *      要显示成「无影响」，不能从图上消失（风险台账 #05）
 *
 * ## 两类关系，**不能混成一条线**
 *
 * · **真联动**：改了这边，运行时那边真的跟着变
 *     - 页面跳转（`data-page-id`）
 *     - 工作流动作（`data-action` 同名 = 一处提交一处消费）
 *     - 素材共用（同一张图）
 * · **同源字段**：两块读同一个 `实体.字段`
 *     改数据模型时它们一起变；但改**这一块的文案**，另一块**不会**跟着变。
 *
 * 画成一样的线，用户会以为改一处自动同步了。所以两类必须分色分虚实。
 *
 * ⚠ 用户 2026-08-27 裁决**两类都常驻画**（我原本建议同源字段只在选中时点亮，
 *   理由是稠密图会糊）。按裁决实现；真机上要是糊得没法看，把实际线数和截图
 *   摆出来让用户判断，不自作主张收窄。
 *
 * ## ⚠ 不另写一套 HTML 解析
 *
 * 认块走 `page-blocks` 的 `listBlockElements`，读绑定走 DOM 的 `closest()`。
 * Python 那边 `scan_bindings` 用的是标签栈——CLAUDE.md 第四条点名的那口井
 * （同一份 HTML 两个结论）。这里的做法跟 `page-blocks.ts` 头注同款：
 * **只读属性，不重新判定**，作用域交给浏览器已经建好的那棵树。
 * 浏览器解析过的 DOM 比正则栈更接近真实渲染，两边不一致时以这边为准的是
 * "画布上画什么线"，不是"绑定合不合法"（后者仍归 Python 的闸管）。
 */

import { blockKey } from "./block-rects";
import { identityOf, listBlockElements } from "./page-blocks";

/** 开实体作用域的两个属性（同 Python 的 rows/record，2026-08-15 那条）。 */
const SCOPE_SELECTOR = "[data-rows],[data-record]";

/** 一块读到/用到的东西。 */
export interface BlockBindings {
  /** `blockKey(pageId, name)`——跨页唯一。 */
  key: string;
  pageId: string;
  name: string;
  /** `实体.字段`，去重排序。 */
  fields: string[];
  /** 这一块提交/触发的动作名。 */
  actions: string[];
  /** 这一块能跳去的页面 id。 */
  navTargets: string[];
  /** 这一块引用的图片地址。 */
  assets: string[];
}

function uniqSorted(xs: Iterable<string>): string[] {
  return [...new Set([...xs].filter(Boolean))].sort();
}

/**
 * 扫一页，得到每一块用到了什么。
 *
 * ⚠ 没有 DOMParser 的环境回空数组，不抛（同 `parseBlocksFromHtml`）。
 *   影响面是画布上的一层线，缺了就少几条线，不许拖垮画板（纪律七 fail-open）。
 */
export function scanBlockBindings(
  pageId: string,
  html: string | null | undefined
): BlockBindings[] {
  const text = html || "";
  if (!text || typeof DOMParser === "undefined") return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, "text/html");
  } catch {
    return [];
  }
  return listBlockElements(doc).map(el => scanOneBlock(pageId, el));
}

function scanOneBlock(pageId: string, host: HTMLElement): BlockBindings {
  const id = identityOf(host);
  const name = id?.name ?? "";
  const fields: string[] = [];
  const actions: string[] = [];
  const navTargets: string[] = [];
  const assets: string[] = [];

  /*
   * ⚠ 作用域**天然会往块外面找**，不需要额外兜底。
   *
   *   `scopeOf` 用的是 `Element.closest()`，它一路向上走到根，自然会走出
   *   块的边界。所以整页 `<section data-record="rx">` 包着好几块的写法
   *   （详情页那种）本来就算得出来。
   *
   *   第一版在这儿多写了一个 `outerScope` 兜底参数往下传——**它是死码**。
   *   发现的方式是变异测试：把它强行置 null，判据一条都没红。按第二条纪律
   *   这时候有两种可能（判据没用 / 代码冗余），查下来是后者，于是删掉。
   *   记在这里免得下一个人"补"回来。
   */
  for (const el of [host, ...Array.from(host.querySelectorAll("*"))]) {
    const a = (n: string) => el.getAttribute(n);

    const field = a("data-field");
    if (field) {
      const ent = scopeOf(el);
      fields.push(ent ? `${ent}.${field}` : field);
    }
    /* data-value / data-aggregate 直接带实体名，不靠作用域。 */
    for (const attr of ["data-value", "data-aggregate"]) {
      const v = a(attr);
      if (v) fields.push(v.includes(".") ? v : `${v}.*`);
    }
    /* 图表：实体 + 维度/度量。 */
    const chartEnt = a("data-entity");
    if (chartEnt) {
      for (const attr of ["data-dimension", "data-metric-field"]) {
        const f = a(attr);
        if (f) fields.push(`${chartEnt}.${f}`);
      }
      if (!a("data-dimension") && !a("data-metric-field")) {
        fields.push(`${chartEnt}.*`);
      }
    }

    const action = a("data-action");
    if (action) actions.push(action);

    const page = a("data-page-id");
    if (page) navTargets.push(page);

    if (el.tagName === "IMG") {
      const src = el.getAttribute("src");
      if (src) assets.push(src);
    }
  }

  return {
    key: blockKey(pageId, name),
    pageId,
    name,
    fields: uniqSorted(fields),
    actions: uniqSorted(actions),
    navTargets: uniqSorted(navTargets),
    assets: uniqSorted(assets),
  };
}

/**
 * 这个元素所处的实体作用域。找不到回 null。
 *
 * ⚠ `closest` 会走出块的边界，这是**有意的**：整页 `<section data-record>`
 *   包着好几块是合法写法（详情页）。别加"只在块内找"的限制——那会让详情页
 *   的每一块都变成「无影响」，而且不报错。
 */
function scopeOf(el: Element): string | null {
  const holder = el.closest?.(SCOPE_SELECTOR);
  if (!holder) return null;
  return (
    holder.getAttribute("data-rows") || holder.getAttribute("data-record") || null
  );
}

/** 影响线的两大类。**分色分虚实的依据。** */
export type ImpactEdgeKind =
  /** 真联动：页面跳转 */
  | "nav"
  /** 真联动：同一个工作流动作 */
  | "action"
  /** 真联动：同一张素材图 */
  | "asset"
  /** 仅同源：读同一个 实体.字段 */
  | "field";

/** 真联动的三类。判据和配色都拿它当唯一口径。 */
export const REAL_LINKAGE_KINDS: readonly ImpactEdgeKind[] = [
  "nav",
  "action",
  "asset",
];

export function isRealLinkage(kind: ImpactEdgeKind): boolean {
  return REAL_LINKAGE_KINDS.includes(kind);
}

export interface ImpactEdge {
  id: string;
  /** 块 key（nav 类的 `to` 是**页面 id**，见下面那条 ⚠）。 */
  from: string;
  to: string;
  kind: ImpactEdgeKind;
  /** 共用的那几样东西（字段名 / 动作名 / 图地址），给标签和悬停用。 */
  shared: string[];
}

/**
 * 造影响线。
 *
 * ## 边的形状
 *
 * · `nav`  —— 块 → **目标页**（页面级跳转，落在那一页的画板上）
 * · 其余   —— 块 ↔ 块，**无序对去重**：两块共用 3 个字段只画 1 条，
 *              共用了什么放在 `shared` 里
 *
 * ⚠ 无序对去重是这里唯一的"减线"手段，而且它不丢信息（共用项全在 shared
 *   里）。别再自作主张加别的裁剪——用户明确要**全画**。真机上糊了的话，
 *   把线数和截图摆给用户看，由他决定。
 *
 * ⚠ 一对块**可能同时有多类关系**（既共用素材又共用字段）。这时候两条边都
 *   画，因为它们语义不同（一条是真联动、一条只是同源）。合并成一条等于把
 *   "改了会跟着变"和"改了不会跟着变"说成同一件事。
 */
export function buildImpactEdges(all: readonly BlockBindings[]): ImpactEdge[] {
  const out: ImpactEdge[] = [];

  // nav：块 → 目标页
  for (const b of all) {
    for (const target of b.navTargets) {
      /* ⚠ 跳到自己这一页的不画：菜单里"当前页"那一项每块都有，画出来是
         几十条自环，纯噪声。 */
      if (target === b.pageId) continue;
      out.push({
        id: `impact:nav:${b.key}->${target}`,
        from: b.key,
        to: target,
        kind: "nav",
        shared: [target],
      });
    }
  }

  // 共用类：按 (类别, 共用项) 分组，组内两两连
  const groups: Record<Exclude<ImpactEdgeKind, "nav">, Map<string, string[]>> = {
    action: new Map(),
    asset: new Map(),
    field: new Map(),
  };
  for (const b of all) {
    for (const a of b.actions) push(groups.action, a, b.key);
    for (const a of b.assets) push(groups.asset, a, b.key);
    for (const f of b.fields) push(groups.field, f, b.key);
  }

  /* 无序对 → 共用了什么。同一对块同一类只留一条边。 */
  const pairShared = new Map<string, { kind: ImpactEdgeKind; shared: string[] }>();
  for (const kind of ["action", "asset", "field"] as const) {
    for (const [item, keys] of groups[kind]) {
      const uniq = [...new Set(keys)].sort();
      for (let i = 0; i < uniq.length; i += 1) {
        for (let j = i + 1; j < uniq.length; j += 1) {
          const id = `${kind}|${uniq[i]}|${uniq[j]}`;
          const hit = pairShared.get(id);
          if (hit) hit.shared.push(item);
          else pairShared.set(id, { kind, shared: [item] });
        }
      }
    }
  }
  for (const [id, v] of pairShared) {
    const [, from, to] = id.split("|");
    out.push({
      id: `impact:${id}`,
      from,
      to,
      kind: v.kind,
      shared: uniqSorted(v.shared),
    });
  }
  return out;
}

function push(map: Map<string, string[]>, k: string, v: string): void {
  const cur = map.get(k);
  if (cur) cur.push(v);
  else map.set(k, [v]);
}

/**
 * 选中一块时，受影响的块有哪些（反查）。
 *
 * ⚠ **孤岛块回空集，不是回 null**：没有绑定的块是「无影响」，不是「未计算」。
 *   这两件事在界面上必须能分开——真机基线 15 块里有 7 块挂不上绑定（纯视觉块），
 *   把它们显示成"算漏了"会让人以为功能坏了（风险台账 #05，也正是 grok
 *   registry.rs 那条"绑定掉光的记录不删"的同款）。
 */
export function impactedBy(
  edges: readonly ImpactEdge[],
  blockKeyOf: string
): { real: Set<string>; sameField: Set<string> } {
  const real = new Set<string>();
  const sameField = new Set<string>();
  for (const e of edges) {
    const other =
      e.from === blockKeyOf ? e.to : e.to === blockKeyOf ? e.from : null;
    if (other === null) continue;
    (isRealLinkage(e.kind) ? real : sameField).add(other);
  }
  return { real, sameField };
}
