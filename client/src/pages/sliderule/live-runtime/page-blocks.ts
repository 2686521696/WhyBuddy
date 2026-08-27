/**
 * 块身份的**读侧**（2026-08-27）。
 *
 * 一页交付页是若干块拼出来的：指标卡、图表、表格、表单、列表……
 * 划块和起名在 Python 那边（`services/page_blocks.py`，抄 grok-build
 * `xai-grok-config/src/managed_text/` 的 item 寻址），随 HTML 一起送到前端，
 * 落在开标签的 `data-block` / `data-block-kind` 上。
 *
 * ## ⚠ 这里**只读，不判**
 *
 * CLAUDE.md 第四条那口井：`scan_bindings` 用标签栈、JS 用 `querySelectorAll`，
 * 同一份 HTML 两个结论。所以块的类型（`data-block-kind`）一律**读属性**，
 * 不在 JS 里按 `<table>`/`<img>` 再判一遍——判两遍就会分叉，而且分叉的那天
 * 不会有任何报错，只是画布上这一块的名字跟后端改的那一块对不上。
 *
 * ## ⚠ 属性得先活着穿过消毒
 *
 * 两份 DOMPurify 白名单都要放行 `BLOCK_ATTRS`（跟 `data-shell`、
 * `data-page-id` 一个待遇）。漏了不会报错——块标被静默剥掉，画布上一块都
 * 认不出来，而 HTML 看着完全正常。判据在两边的 surface 测试里各钉一条。
 */

export const BLOCK_MARK_ATTR = "data-block";
export const BLOCK_KIND_ATTR = "data-block-kind";

/** 给两份消毒白名单 import 的那一份——**不手抄**（照 BINDING_ATTRS 的先例）。 */
export const BLOCK_ATTRS: readonly string[] = [BLOCK_MARK_ATTR, BLOCK_KIND_ATTR];

/** 跟 Python `BLOCK_KINDS` 一字不差。跨语言看门测试钉着。 */
export const BLOCK_KINDS = [
  "chart",
  "table",
  "form",
  "detail",
  "metric",
  "list",
  "media",
  "card",
] as const;

export type BlockKind = (typeof BLOCK_KINDS)[number];

/** 跟 Python `KIND_LABEL_CN` 一字不差。 */
export const KIND_LABEL_CN: Record<BlockKind, string> = {
  chart: "图表",
  table: "表格",
  form: "表单",
  detail: "详情",
  metric: "指标",
  list: "列表",
  media: "图文",
  card: "卡片",
};

export interface BlockIdentity {
  /** 页内唯一的可寻址名字，形如 `表格:待指派工单`。后端按它切块改写。 */
  name: string;
  kind: BlockKind;
  /** 名字里冒号后面那半，给人看的。 */
  label: string;
  kindLabel: string;
}

function normalizeKind(raw: string | null): BlockKind {
  return (BLOCK_KINDS as readonly string[]).includes(raw ?? "")
    ? (raw as BlockKind)
    : "card";
}

function identityOf(el: Element): BlockIdentity | null {
  const name = el.getAttribute(BLOCK_MARK_ATTR);
  if (!name) return null;
  const kind = normalizeKind(el.getAttribute(BLOCK_KIND_ATTR));
  const colon = name.indexOf(":");
  return {
    name,
    kind,
    label: colon >= 0 ? name.slice(colon + 1) : name,
    kindLabel: KIND_LABEL_CN[kind],
  };
}

/**
 * 从任意元素往上找它所属的那一块。找不到回 null。
 *
 * ⚠ **不许"就近找一个"兜底**（element-path 里那条同款纪律）：不在任何块里
 *   的元素就是不在——壳里的菜单、面包屑本来就没有块身份。随便挂一个上去，
 *   用户点菜单会以为自己选中了正文里的某一块。
 */
export function closestBlock(el: Element | null): HTMLElement | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur.hasAttribute?.(BLOCK_MARK_ATTR)) return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

/** 这个元素所属那一块的身份。不属于任何块时回 null。 */
export function blockIdentity(el: Element | null): BlockIdentity | null {
  const host = closestBlock(el);
  return host ? identityOf(host) : null;
}

/**
 * 一页上的所有块，文档顺序。
 *
 * ⚠ 嵌套的块直接跳过：Python 那边保证块互不嵌套，真出现了说明这份 HTML
 *   被人手改过（或者消毒把外层剥了），这时候宁可少列一块，也不能把同一段
 *   内容算成两块——数出来的块数会跟后端对不上。
 */
export function listBlocks(root: ParentNode | null): BlockIdentity[] {
  if (!root) return [];
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(`[${BLOCK_MARK_ATTR}]`));
  const out: BlockIdentity[] = [];
  const seen = new Set<string>();
  for (const el of nodes) {
    if (el.parentElement && closestBlock(el.parentElement)) continue;
    const id = identityOf(el);
    if (!id || seen.has(id.name)) continue;
    seen.add(id.name);
    out.push(id);
  }
  return out;
}
