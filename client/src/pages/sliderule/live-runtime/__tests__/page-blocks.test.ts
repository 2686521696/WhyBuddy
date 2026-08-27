// @vitest-environment jsdom
/**
 * 块身份读侧的判据（2026-08-27）。
 *
 * 划块在 Python，读在这边。所以这里最重要的两条不是"读得对"，是：
 *   · 词表**跨语言一致**（本仓踩过 scan_bindings 与 querySelectorAll 分叉那口井）
 *   · 不属于任何块的元素回 null，**不就近兜底**
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BLOCK_ATTRS,
  BLOCK_KINDS,
  BLOCK_KIND_ATTR,
  BLOCK_MARK_ATTR,
  KIND_LABEL_CN,
  blockIdentity,
  closestBlock,
  listBlocks,
} from "../page-blocks";

function dom(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

const CARD =
  `<div ${BLOCK_MARK_ATTR}="表格:待指派工单" ${BLOCK_KIND_ATTR}="table">` +
  '<h3 id="t">待指派工单</h3><table><tbody><tr><td id="cell">A-1</td></tr></tbody></table></div>';

describe("从元素找到它所属的块", () => {
  it("块里深处的元素也能找回这一块", () => {
    const root = dom(CARD);
    const id = blockIdentity(root.querySelector("#cell"));
    expect(id).toEqual({
      name: "表格:待指派工单",
      kind: "table",
      label: "待指派工单",
      kindLabel: "表格",
    });
  });

  it("反向：不在任何块里的元素回 null，不许就近兜底", () => {
    const root = dom(`<aside data-shell="aside"><a id="nav">菜单</a></aside>${CARD}`);
    expect(closestBlock(root.querySelector("#nav"))).toBeNull();
    expect(blockIdentity(root.querySelector("#nav"))).toBeNull();
  });

  it("块类型只读属性，不在 JS 里重判一遍", () => {
    // 一个装着 <table> 但被后端标成 card 的块：前端必须报 card。
    // 重判的话这里会报 table——那正是两边分叉的起点。
    const root = dom(
      `<div ${BLOCK_MARK_ATTR}="卡片:混的" ${BLOCK_KIND_ATTR}="card"><table id="x"></table></div>`,
    );
    expect(blockIdentity(root.querySelector("#x"))?.kind).toBe("card");
  });

  it("词表外的类型退回 card，而不是把脏值原样端出去", () => {
    const root = dom(`<div ${BLOCK_MARK_ATTR}="卡片:怪的" ${BLOCK_KIND_ATTR}="妖怪"><b id="x">x</b></div>`);
    expect(blockIdentity(root.querySelector("#x"))?.kind).toBe("card");
  });
});

describe("列出一页有哪几块", () => {
  it("按文档顺序，且只列最外层", () => {
    const root = dom(
      `<div ${BLOCK_MARK_ATTR}="指标:收入" ${BLOCK_KIND_ATTR}="metric">1</div>` +
        `<div ${BLOCK_MARK_ATTR}="卡片:外层" ${BLOCK_KIND_ATTR}="card">` +
        `<div ${BLOCK_MARK_ATTR}="卡片:里层" ${BLOCK_KIND_ATTR}="card">x</div></div>`,
    );
    expect(listBlocks(root).map((b) => b.name)).toEqual(["指标:收入", "卡片:外层"]);
  });
});

describe("跨语言词表", () => {
  /**
   * ⚠ 这条不是形式主义。本仓的 `data-*` 白名单、动作词表都因为"两边各抄一份"
   *   分叉过；块类型一分叉，画布上这一块的名字就跟后端要改的那一块对不上，
   *   而且不会有任何报错。
   */
  function pythonSource(): string {
    const rel = "slide-rule-python/services/page_blocks.py";
    const found = [rel, `../${rel}`]
      .map((c) => resolve(process.cwd(), c))
      .find((c) => existsSync(c));
    expect(found, "找不到 page_blocks.py").toBeTruthy();
    return readFileSync(found as string, "utf8");
  }

  it("BLOCK_KINDS 跟 Python 一字不差、顺序也一样", () => {
    const src = pythonSource();
    const body = src.slice(src.indexOf("BLOCK_KINDS: Tuple[str, ...] = ("));
    const py = Array.from(body.slice(0, body.indexOf(")")).matchAll(/"([a-z]+)"/g)).map(
      (m) => m[1],
    );
    expect(py).toEqual([...BLOCK_KINDS]);
  });

  it("KIND_LABEL_CN 跟 Python 一字不差", () => {
    const src = pythonSource();
    const body = src.slice(src.indexOf("KIND_LABEL_CN: Dict[str, str] = {"));
    const py = Object.fromEntries(
      Array.from(body.slice(0, body.indexOf("}")).matchAll(/"([a-z]+)":\s*"([^"]+)"/g)).map(
        (m) => [m[1], m[2]],
      ),
    );
    expect(py).toEqual(KIND_LABEL_CN);
  });

  it("属性名跟 Python 的常量一致", () => {
    const src = pythonSource();
    expect(src).toContain(`BLOCK_MARK_ATTR = "${BLOCK_MARK_ATTR}"`);
    expect(src).toContain(`BLOCK_KIND_ATTR = "${BLOCK_KIND_ATTR}"`);
    expect([...BLOCK_ATTRS]).toEqual([BLOCK_MARK_ATTR, BLOCK_KIND_ATTR]);
  });
});
