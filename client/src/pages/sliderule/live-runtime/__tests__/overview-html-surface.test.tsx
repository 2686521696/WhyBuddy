// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
// jsdom 环境下 import.meta.url 是 http:// 不是 file://，readFileSync 用不了；
// ?raw 是 Vite 自带的原文导入，跟测试环境无关。
import screenSrc from "../AppRuntimeScreen.tsx?raw";
import surfaceSrc from "../OverviewHtmlSurface.tsx?raw";
import {
  computeFactText,
  mountOverviewInto,
  sanitizeOverviewHtml,
} from "../OverviewHtmlSurface";
import type { OverviewFactSpec } from "../app-runtime-schema";
import type { RuntimeRow } from "../live-runtime";

/**
 * 首页总览 HTML 载体的渲染端（2026-08-12）。
 *
 * 这一层守两件事，其它都是版式：
 *
 *   ① **数字不能编** —— HTML 里一个数字都没有，只有 data-fact 占位，
 *      值由 computeFactText 从真实行现算。原型实测过放开会怎样：LLM 自己算的
 *      「处理中工单」是 0，而同一页的环图从同一份数据算出 5。
 *
 *   ② **消毒** —— 这段 HTML 是 LLM 产出的不可信内容。生成侧已经拒了一遍
 *      script/外链，这里再过 DOMPurify：快照恢复、历史产物不重跑生成侧，
 *      这条路必须自己站得住（跟 FREEFORM_MAX_DEPTH 两侧同值一个道理）。
 */

const rows = (values: Array<Record<string, unknown>>): RuntimeRow[] =>
  values.map((v, i) => ({ id: `r${i}`, values: v }) as RuntimeRow);

const fact = (over: Partial<OverviewFactSpec> = {}): OverviewFactSpec => ({
  id: "f",
  label: "指标",
  entityRef: "e",
  aggregate: "count",
  ...over,
});

describe("① 数字从真实行现算", () => {
  it("count 数行数", () => {
    expect(computeFactText(fact(), { e: rows([{}, {}, {}]) })).toBe("3");
  });

  it("avg 带上字段声明的单位", () => {
    const f = fact({ aggregate: "avg:rate", format: "percent" });
    expect(computeFactText(f, { e: rows([{ rate: 40 }, { rate: 60 }]) })).toBe("50%");
  });

  it("money / score 跟表格是同一套写法", () => {
    expect(
      computeFactText(fact({ aggregate: "sum:amt", format: "money" }), {
        e: rows([{ amt: 1200 }, { amt: 800 }]),
      })
    ).toBe("¥2,000.00");
    expect(
      computeFactText(fact({ aggregate: "avg:s", format: "score" }), {
        e: rows([{ s: 70 }, { s: 80 }])
      })
    ).toBe("75 分");
  });

  it("一行合法数值都没有时显「—」，不拿 0 冒充", () => {
    // SQL 的 SUM over 空集是 NULL、pandas 的 min_count=1 是 NaN —— 用户分不清
    // "真的是 0" 和 "根本没数据"，所以不能显 0。跟 computeDataRefText 同一条。
    expect(computeFactText(fact({ aggregate: "sum:x" }), { e: rows([{}, {}]) })).toBe("—");
  });

  it("实体查不到时显「—」，不回落任何假值", () => {
    expect(computeFactText(fact(), {})).toBe("—");
    expect(computeFactText(fact(), undefined)).toBe("—");
  });
});

describe("② 消毒", () => {
  it("脚本、事件属性、伪协议一律不留", () => {
    const dirty = `<div>ok<script>alert(1)</script><img src=x onerror="alert(1)">
      <a href="javascript:alert(1)">点我</a></div>`;
    const clean = sanitizeOverviewHtml(dirty);
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("onerror");
    expect(clean).not.toContain("javascript:");
    expect(clean, "正文被连坐删掉了").toContain("ok");
  });

  it("表单控件不留 —— 这一层是纯展示，点了没反应比没有更糟", () => {
    const clean = sanitizeOverviewHtml(
      `<div><form><input value="x"><button>提交</button></form></div>`
    );
    expect(clean).not.toContain("<input");
    expect(clean).not.toContain("<button");
    expect(clean).not.toContain("<form");
  });

  it("占位契约必须活着 —— 它们被删掉的话整页没有数字", () => {
    const clean = sanitizeOverviewHtml(
      `<div><span data-fact="a"></span><div data-chart="c" style="height:200px"></div></div>`
    );
    expect(clean, "data-fact 被消毒掉了").toContain('data-fact="a"');
    expect(clean, "data-chart 被消毒掉了").toContain('data-chart="c"');
    expect(clean, "高度没了 —— 图表容器会塌成 0").toContain("height:200px");
  });

  it("版式要素保留：style 块、表格、内联 svg", () => {
    const clean = sanitizeOverviewHtml(
      `<div><style>.a{color:red}</style><table><tr><td>x</td></tr></table>
       <svg viewBox="0 0 24 24"><path d="M0 0h24"/></svg></div>`
    );
    expect(clean).toContain("<style");
    expect(clean).toContain("<td");
    expect(clean).toContain("<svg");
    expect(clean).toContain('d="M0 0h24"');
  });
});

describe("③ 接线", () => {
  const screen = screenSrc;

  it("HTML 载体优先于受限树 —— 两者同时只会有一个", () => {
    const i = screen.indexOf("const renderFreeformOverview");
    expect(i, "锚点要重找").toBeGreaterThan(-1);
    const body = screen.slice(i, i + 1400);
    expect(body, "没接 HTML 载体，开关打开也看不到东西").toContain(
      "page?.freeformOverviewHtml?.html"
    );
    // 顺序：先看 HTML，再落回受限树
    expect(body.indexOf("freeformOverviewHtml")).toBeLessThan(
      body.indexOf("if (!page?.freeformOverview) return null;")
    );
  });

  it("数据变了数字要跟着变 —— 事实是活的，不是渲染一次就定死", () => {
    const src = surfaceSrc;
    const i = src.indexOf("React.useEffect(");
    const body = src.slice(i, i + 1200);
    expect(body, "entityRows 不在依赖里 —— 写入第一条真实记录后数字不会更新").toContain(
      "entityRows"
    );
  });
});

describe("④ 影子根：CSS 关在里面", () => {
  const facts = [fact({ id: "a", aggregate: "count", entityRef: "e" })];

  it("样式挂进影子根，不落到宿主文档", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: "open" });
    mountOverviewInto(
      shadow,
      `<style>body{display:none}</style><div><span data-fact="a"></span></div>`,
      facts,
      { e: rows([{}, {}]) }
    );
    // 影子里有它，宿主文档里没有 —— 这就是隔离本身
    expect(shadow.querySelector("style")).not.toBeNull();
    expect(
      document.body.querySelector(":scope > style"),
      "LLM 的 CSS 漏到宿主文档了 —— body{display:none} 能把整个应用弄没"
    ).toBeNull();
    // 顺带确认事实真的被填上了
    expect(shadow.querySelector("[data-fact]")?.textContent).toBe("2");
    host.remove();
  });

  it("认不出的占位填「—」，不编数", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    mountOverviewInto(shadow, `<span data-fact="unknown"></span>`, facts, {});
    expect(shadow.querySelector("[data-fact]")?.textContent).toBe("—");
  });

  it("图表占位被收集出来交给 React 挂 ECharts", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const hosts = mountOverviewInto(
      shadow,
      `<div data-chart="c1" style="height:260px"></div><div data-chart="c2"></div>`,
      facts,
      {}
    );
    expect(hosts.map(h => h.id)).toEqual(["c1", "c2"]);
  });
});
