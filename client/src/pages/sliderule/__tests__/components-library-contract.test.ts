import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(rel, import.meta.url), "utf8");

const pageSource = readFileSync(
  new URL("../ComponentsLibraryPage.tsx", import.meta.url),
  "utf8"
);
const registrySource = readFileSync(
  new URL("../live-runtime/block-registry.tsx", import.meta.url),
  "utf8"
);
const htmlSource = readFileSync(
  new URL("../../../../index.html", import.meta.url),
  "utf8"
);
const catalog = JSON.parse(
  readFileSync(
    new URL("../../../../../slide-rule-python/services/data/experience_block_catalog.json", import.meta.url),
    "utf8"
  )
) as { blocks: Array<{ type: string; pageKinds?: string[] }> };


/**
 * 剥掉注释再断言。
 *
 * 这个文件里的断言都是对源码做字符串匹配的，而这一页的注释**大量在解释
 * "为什么不用某个东西"**（"不是 antd Input.Search"、"原来用的是
 * Tag.CheckableTag"…）。不剥注释的话 `toContain("Input.Search")` 会匹配到
 * 那句解释、`not.toContain` 会被那句解释绊倒——两个方向都会给出假结论。
 *
 * 2026-08-07 实测踩到：三条 toContain 靠匹配注释假绿了好几天。
 *
 * 先去块注释（JSX 的 {/* … *\/} 是多行的，按行过滤剥不掉），再去行注释。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");
}

describe("components library UI contract", () => {
  it("外壳跟应用中心用同一套控件，而不是 antd 的成品控件", () => {
    // 2026-08-07 重写。原来这条叫「uses Ant Design controls」，断言
    // Input.Search / Tag.CheckableTag / @ant-design/icons 都在。但页面在
    // 「顶部与应用中心对齐」那轮已经全换掉了：
    //
    //   antd Input.Search    → 自绘 input（后者自带搜索按钮和另一套高度/边框）
    //   Tag.CheckableTag     → 普通 button（前者要一串 !important 去压 margin/padding）
    //   @ant-design/icons    → lucide（与 AppsWorkbench 同源，线宽字重才对得上）
    //
    // 而这三个词**仍然留在注释里**（注释写的正是"为什么不用它们"），于是
    // toContain 照样通过——**断言在匹配注释，不是在匹配代码**，是假绿。
    // 只有 @ant-design/icons 那条真红了，在 main 上红了好几天没人发现。
    //
    // 所以这里两件事一起做：断言改成"现在真实的样子"，并且先剥注释再断言。
    const code = stripComments(pageSource);

    // 保留的 antd：卡片外壳与空态。这两个没有"跟应用中心对齐"的需求。
    expect(code).toContain("<Card");
    expect(code).toContain("<Empty");

    // 换掉的：控件与图标都跟 AppsWorkbench 同源
    expect(code).toContain('from "lucide-react"');
    expect(code).not.toContain("@ant-design/icons");
    expect(code).not.toContain("Input.Search");
    expect(code).not.toContain("Tag.CheckableTag");

    // 筛选条的挂载点。2026-08-08 从"三行常驻 chip"改成 Polaris 的 Filters
    // 模型（每个维度一个下拉 + 已选的才以 pill 占位），所以钉的东西也换了：
    // 原来钉三个轴各自的 testid，现在钉那一条筛选条 + pill 机制。
    expect(code).toContain("components-filters");
    expect(code).toContain("filter-clear-all");
    expect(code).toContain("filter-pill-");
    // 档位切换仍在（它只在区块档出现，是 extra 槽里的东西）
    expect(code).toContain("components-device-switch");
    // 早先那版按"区块分区"筛的开关已经删掉，别再回来
    expect(code).not.toContain("components-section-switch");
    // 三行常驻 chip 不许回来——那正是"承载不住"的病根
    expect(code).not.toContain("components-slot-filters");
    expect(code).not.toContain("components-page-kind-switch");
  });

  it("filters blocks directly by the six page kinds from the shared catalog", () => {
    const legalKinds = new Set([
      "workbench",
      "kanban",
      "calendar",
      "wizard",
      "dashboard",
      "monitor",
    ]);
    // 默认**不筛**（2026-08-08 改）。
    //
    // 原来这里钉的是 `React.useState("workbench")`。那个默认值配上"范式那栏
    // 没有『全部』选项"，造出两个真 bug：
    //   ① 点「清空」把每个维度都置成 "all"，而没有区块的 pageKinds 含 "all"
    //      → 页面变成「没有匹配的区块」，16 个一个都不剩；
    //   ② 这一档永远在筛，档位标着 16、进去最多只看得见 13，没有任何一个
    //      状态能看到全部。
    // device / slot 本来就都默认 "all"，此前只有这一维是例外。
    expect(pageSource).toContain('React.useState("all")');
    expect(pageSource).toContain("block.pageKinds");
    // 「全部」这一项必须在场，而且 pageKindBlocks 必须认它。少任何一半，
    // 「清空」就又会把用户清进一个选不回来的空集。
    expect(pageSource).toContain('{ value: "all", label: "全部", count: blocks.length }');
    expect(pageSource).toContain('pageKind === "all"');
    for (const block of catalog.blocks) {
      expect(block.pageKinds?.length, block.type).toBeGreaterThan(0);
      expect(block.pageKinds?.every(kind => legalKinds.has(kind)), block.type).toBe(true);
    }
  });

  it("keeps one explicit desktop/mobile preview switch and the real phone renderer", () => {
    expect(pageSource).toContain('data-testid="components-device-switch"');
    expect(pageSource).toContain('setDevice("desktop")');
    expect(pageSource).toContain('setDevice("phone")');
    expect(pageSource).toContain("<LazyPhoneExperienceBlock");
  });

  it("手机档只列真有手机实现的区块——不留「桌面降级」这个中间态", () => {
    // 2026-08-07 用户裁决：「手机端就是手机端，桌面端就是桌面端。弄一个手机端
    // 桌面降级，这没意思的，把它去掉吧。」
    //
    // 此前没有手机实现的区块照样出现在手机档里，拿桌面渲染器塞进 380px 机身、
    // 挂一个橙色「手机档 · 桌面降级」角标。现在改成**不进这个档的列表**。
    //
    // 反向断言放在这里而不是靠人记：这类"中间态"很容易在下一次加区块时被
    // 顺手加回来——多写一个 else 分支就复活了。
    // 只看代码，不看注释——上面那段说明里必然提到这个词。
    // （同样的坑在 test_fork_session.py 里踩过一次。）
    const code = stripComments(pageSource);
    expect(code).not.toContain("手机档 · 桌面降级");
    expect(code).not.toContain("phoneFallback");
    // 判据本身要在：手机档的列表按它过滤，「全部」档也按它决定出一张还是两张
    expect(pageSource).toContain("function hasPhoneImplementation");
    expect(pageSource).toContain("blocks.filter(hasPhoneImplementation)");
    expect(pageSource).toContain("hasPhoneImplementation(block)");
  });

  it("底部元信息不铺整条遮罩，每条自带底衬保证可读", () => {
    // 这条钉的是**结果**（内容不被遮住、元信息读得清），不是某一版实现。
    //
    // 演进：
    //   ① 原来是照搬应用中心的整条深色渐变（bg-gradient-to-t from-black/70），
    //      那套是给应用截图设计的；这一页盖的是活组件，遮罩本身就是要挡掉的。
    //   ② 用户要求去掉遮罩后，我按字面做了一版"纯文字阴影 + 浮层"，实测不能用
    //      ——MetricGrid 盖住「1,648」、RankedList 盖住第 4/5 名、DataTable 盖住
    //      末行。糊住它的不是背景色，是另一层字。
    //   ③ 我改成把元信息推进正常流（不再浮），可读了但卡片高出一截。
    //   ④ 用户最终版（b6fb19f）比前两个都好：**元信息仍是浮层，但每条各自带一个
    //      bg-black/30 小药丸 + 白字**。内容照样铺满，元信息压在任何底色上都读
    //      得清，又不需要整条遮罩。档位角标也并进了这一行。
    //
    // 所以这里只禁"整条遮罩"，并要求"每条自带底衬"，不再规定浮不浮。
    const code = stripComments(pageSource);
    expect(code).not.toContain("bg-gradient-to-t");
    // 白字必须有底衬托着——只有白字没底衬，压在浅色组件上等于隐形
    expect(code).toMatch(/bg-black\/\d+/);
    expect(code).toMatch(/text-white/);
    expect(code).toContain("textShadow");
    expect(code).toContain('position: "relative"');
  });

  it("渲染区四边不留白——组件铺满整张卡", () => {
    // 上下 padding 一并去掉（2026-08-07）。原来 paddingBottom: 64 是给渐变
    // 遮罩让位的，遮罩没了这个留白也就没有理由了。
    const code = stripComments(pageSource);
    expect(code).not.toContain("paddingBottom: 64");
    expect(code).toContain('<div className="w-full">{rendered}</div>');
  });

  it("「AI 组装」的标签和动作必须一起跟着档位走 —— 只改标签就是骗人", () => {
    // 2026-08-08 用户点出这条链路上有**两次组装，方向不同**：
    //
    //   看基础组件/区块 → 组装区块：从素材里挑，定义一个新区块（产物是契约）
    //   看模板         → 组装模板：从现有区块里挑，摆进页面（产物是数据）
    //
    // 这条钉的是两者绑死：标签写着「组装区块」、点下去却跑五阶段页面装配，
    // 那是界面在撒谎，而且**看不出来**——两条路都会弹出一个像模像样的浮层。
    //
    // 这个坑这个项目踩过一次（surface 参数加了、23 个调用点一个没改，界面上
    // 完全看不出），所以这次两端都断言。
    const code = stripComments(pageSource);
    expect(code).toContain('"AI 组装模板"');
    expect(code).toContain('"AI 组装区块"');
    // 动作分叉必须与标签分叉用同一个判据
    expect(code).toContain(
      'onClick={() => void (mode === "presets" ? runAssemble() : runProposeBlocks())}'
    );
    // 组装区块走的是提议接口，不是页面装配接口
    expect(code).toContain("/api/sliderule/components/propose-blocks");
    // 提案面板要如实说它是契约草案，不能让人以为点一下区块就有了
    expect(code).toContain("契约草案 · 渲染器仍需实现");
  });

  it("区域词汇只有一份 —— 排版表必须从共享目录派生，不许再手抄", () => {
    // 2026-08-08 第三轮。上一轮这里是一条**对账**用例：Python 一份区域语法、
    // TS 手抄一份，用例负责在漏抄时报错。那是创可贴——两份还是两份。
    //
    // 同一天真机爆的那个 bug（进「区块」档点「清空」，16 个区块一个都不剩）
    // 根子是同一类：范式那栏的选项由 PAGE_KINDS 直接铺出、没有「全部」，而
    // 「清空」把每维置成 "all"。同一个概念在两处各写一份，取值迟早对不上，
    // 用例只能事后抓，抓不住的那次就是线上 bug。
    //
    // 所以这轮把区域收进共享目录（Python 走 schema_legal，这边走 vite 的
    // @experience-blocks），TS 侧改成派生。这条用例随之从"对账"变成"钉住
    // 派生这件事本身"——只要还有人把它改回字面量数组，这条就红。
    const code = stripComments(pageSource);
    expect(
      code,
      "REGION_LAYOUT 不再从目录派生了？那就又有第二份了"
    ).toContain("pageRegions");
    expect(code).toContain("REGION_LAYOUT: { key: string; label: string; band: RegionBand }[] =");
    // 不许出现手写的区域字面量（旧形状：{ key: "main", label: "主体区", ... }）
    const literals = code.match(/\{ key: "\w+", label: "[^"]+", (weight|band):/g) ?? [];
    expect(literals, `又出现了手写的区域条目：${literals.join(" ")}`).toEqual([]);

    // 目录里确实有这两张表，且区域都带 band —— 派生的源头得是全的
    const catalogRaw = JSON.parse(
      readFileSync(
        new URL(
          "../../../../../slide-rule-python/services/data/experience_block_catalog.json",
          import.meta.url
        ),
        "utf8"
      )
    ) as {
      pageRegions: Record<string, { label: string; band: string; evidence: string }>;
      pageArchetypes: Record<string, { regions: { key: string; weight: string }[] }>;
      pageRegionBands: string[];
    };
    const bands = new Set(catalogRaw.pageRegionBands);
    for (const [key, meta] of Object.entries(catalogRaw.pageRegions)) {
      expect(meta.label, `${key} 缺 label`).toBeTruthy();
      expect(bands.has(meta.band), `${key} 的 band「${meta.band}」不在取值域里`).toBe(true);
      // 出处是这轮定下的纪律：加区域之前先去 pro-blocks 那 29 页里找真实用例
      expect(meta.evidence, `${key} 没写出处 —— 没有出处的区域就是拍脑袋定的`).toBeTruthy();
    }
    // 范式引用的区域必须都在目录里
    for (const [ak, arch] of Object.entries(catalogRaw.pageArchetypes)) {
      for (const r of arch.regions) {
        expect(
          Object.hasOwn(catalogRaw.pageRegions, r.key),
          `范式 ${ak} 用了目录里没有的区域「${r.key}」`
        ).toBe(true);
      }
    }
  });

  it("底部操作条必须在滚动区外面 —— 不然它就只是页尾的一行按钮", () => {
    // 出处是 pro-blocks 的 FooterToolbar（FormAdvancedForm / ListTableList）。
    // 它的全部价值在于**不随内容滚**：长表单把提交按钮放在表单末尾，用户得
    // 滚到底才看得见它，也看不见自己错在哪。放进滚动容器里就等于没做。
    const code = stripComments(pageSource);
    // 这一页有两个滚动容器（提案面板一个、装配页一个），要的是 footer 之前
    // 最近的那一个。
    const footerGuard = code.indexOf("{footerRegions.length > 0 && (");
    const scrollArea = code.lastIndexOf(
      'className="min-h-0 flex-1 overflow-auto',
      footerGuard
    );
    expect(footerGuard, "没找到底部操作条").toBeGreaterThan(0);
    expect(scrollArea, "没找到滚动区").toBeGreaterThan(0);

    // 判据是**同级**：两者都是那个 flex-col 容器的直接子节点。footer 要是被
    // 塞进滚动容器里，它的缩进会更深。
    const lines = code.split("\n");
    const lineOf = (i: number) => code.slice(0, i).split("\n").length - 1;
    const indent = (n: number) => lines[n].length - lines[n].trimStart().length;
    expect(
      indent(lineOf(footerGuard)),
      "底部操作条与滚动区不同级 —— 缩进更深就是被塞进滚动容器里了，那它就只是页尾的一行按钮"
    ).toBe(indent(lineOf(scrollArea)));
    // 而且它得声明自己不参与伸缩，否则内容一多就被挤没
    expect(code).toContain('className="shrink-0 border-t border-slate-200 bg-white px-4 py-2"');
  });

  it("装配预览必须喂 pageActions —— 不喂，QuickActionPanel 直接渲染成空气", () => {
    // 2026-08-08 实测抓到的：QuickActionPanelRenderer 第一行就是
    //   if ((pageActions ?? []).length === 0) return null;
    // 按钮来源是宿主给的 pageActions，而装配预览从来没传过。于是任何被装进
    // 页面的 QuickActionPanel 都是空气——不报错、不占位、什么都没有。
    //
    // 一直没被发现，是因为它总跟别的区块挤在同一个区里，看不出少了谁。这次
    // footerBar 把它单独放进底部那条带，整条带是空的，才露馅。
    //
    // 这条同时钉两端：渲染器那个 return null 的判断还在（它对真实应用是对的），
    // 且预览确实把 pageActions 传了下去。
    expect(
      stripComments(registrySource),
      "QuickActionPanel 不再靠 pageActions 取按钮了？这条断言要跟着改"
    ).toContain("if ((pageActions ?? []).length === 0) return null;");
    expect(
      stripComments(pageSource),
      "装配预览没给 pageActions —— QuickActionPanel 会渲染成空气"
    ).toContain("pageActions={previewActions}");
  });

  it("keeps progress indicators named and allows browser zoom", () => {
    expect(registrySource).toContain(
      "aria-label={`${item.label}相对排名进度`}"
    );
    expect(htmlSource).not.toContain("maximum-scale");
  });
});

/**
 * 基础组件目录的四个来源（2026-08-08）。
 *
 * ## 这一批是怎么来的
 *
 * 用户问「基础组件能不能再上一个量级」。数完四个库：
 *
 *     antd（桌面）        库里 78，目录收了 67  ← 基本到顶
 *     antd-mobile（手机）  库里 83，目录收了 72  ← 也基本到顶
 *     pro-components      库里 118，目录收了 1   ← **下一个量级在这**
 *     amis-ui             库里 120，与 antd 重的 88，真新的只有 26
 *
 * 139 → 217。补的是 ProComponents 65 条、自定义 7 条、antd-mobile 内联选择器
 * 6 条。同时把 `source` 这一栏加进契约——ECharts 一直不是 antd 组件，此前
 * 没有任何一栏能把这件事说出来。
 *
 * 逐条能不能渲染由 dev 台子看（/base-catalog.html，217 条 0 失败）；
 * 这里钉的是**结构上不会悄悄退化**的那几条。
 */
describe("基础组件目录 · 四个来源", () => {
  const catalogSrc = read("../base-components/base-catalog.tsx");
  const proSrc = read("../base-components/base-catalog-pro.tsx");
  const customSrc = read("../base-components/base-catalog-custom.tsx");

  it("四个来源的条目都汇进了总表 —— 建了文件没接进去等于白建", () => {
    const assembled = catalogSrc.slice(
      catalogSrc.indexOf("export const BASE_COMPONENTS"),
      catalogSrc.indexOf("];", catalogSrc.indexOf("export const BASE_COMPONENTS"))
    );
    for (const part of [
      "PC_BASE_COMPONENTS",
      "MOBILE_BASE_COMPONENTS",
      "PRO_BASE_COMPONENTS",
      "CUSTOM_BASE_COMPONENTS",
    ]) {
      expect(assembled, `${part} 没汇进总表`).toContain(part);
    }
  });

  it("前两档的 source 由所在文件补默认值，且**条目自己写的优先**", () => {
    // 这条顺序很要害：`{ source: "antd", ...c }` 才是"默认值"，
    // `{ ...c, source: "antd" }` 是"强制覆盖"——后者会把 ECharts 和
    // StatisticCard 重新盖回 antd，而它们本来就不是。
    expect(catalogSrc).toContain('...PC_BASE_COMPONENTS.map(c => ({ source: "antd" as const, ...c }))');
    expect(catalogSrc).toContain(
      '...MOBILE_BASE_COMPONENTS.map(c => ({ source: "antd-mobile" as const, ...c }))'
    );
  });

  it("ECharts 归自定义档 —— 它一直不是 antd 组件，只是以前没地方说", () => {
    const i = catalogSrc.indexOf('name: "ECharts"');
    expect(i).toBeGreaterThan(-1);
    expect(catalogSrc.slice(i, i + 260)).toContain('source: "custom"');
  });

  it("ProComponents 那一档每条都标了来源 —— 漏一条它就被当成 antd", () => {
    const entries = (proSrc.match(/^ {4}name: "/gm) ?? []).length;
    const sourced = (proSrc.match(/source: "pro-components"/g) ?? []).length;
    // formItem() 与 ProField.* 两个样板各带一处 source，对象字面量条目各带一处
    expect(sourced, "有对象字面量条目没标 source").toBeGreaterThanOrEqual(entries);
  });

  it("**ProLayout / FooterToolbar 必须留着 transform** —— 去掉整页会被它们盖住", () => {
    // 这两个组件内部大量 position:fixed。fixed 相对视口定位，父级
    // `overflow:hidden` 关不住它——第一版 ProLayout 的侧边栏铺满了整个目录页，
    // 另外 216 条全被压在下面，而错误边界全绿（布局逃逸不是异常）。
    //
    // transform 一加，这个元素就成了 fixed 后代的包含块（CSS Transforms
    // 规范），它们才老实待在格子里。删掉这一行不会报错，只会白屏——所以钉住。
    for (const name of ["ProLayout", "FooterToolbar"]) {
      const i = proSrc.indexOf(`name: "${name}"`);
      expect(i, `${name} 没了？`).toBeGreaterThan(-1);
      expect(
        proSrc.slice(i, i + 1400),
        `${name} 的 transform 包含块没了 —— 它内部的 fixed 会盖住整页`
      ).toContain("translateZ(0)");
    }
  });

  it("自定义档的重库走懒加载 —— 一页两百多个示例，不能开页就下一个编辑器", () => {
    expect(customSrc, "CodeMirror 变成静态 import 了").not.toMatch(
      /^import CodeMirror from/m
    );
    expect(customSrc).toContain("React.lazy");
    expect(customSrc).toContain('import("@uiw/react-codemirror")');
  });

  it("自定义档不引新依赖 —— 这一批的前提就是「把装着没用的挖出来」", () => {
    // 只允许出现已经在 package.json 里的那几个。新增依赖不是不行，但那是
    // 一个要单独决策的动作，不该混在"补目录"里悄悄发生。
    const dyn = [...customSrc.matchAll(/import\("([^"]+)"\)/g)].map(m => m[1]);
    const allowed = new Set([
      "@uiw/react-codemirror",
      "@uiw/codemirror-theme-github",
      "@codemirror/lang-javascript",
      "@codemirror/lang-json",
      "@codemirror/lang-sql",
      "@codemirror/lang-markdown",
      "react-markdown",
      "remark-gfm",
      "xlsx",
    ]);
    const unexpected = dyn.filter(d => !allowed.has(d));
    expect(unexpected, `自定义档引了新依赖：${unexpected.join(", ")}`).toEqual([]);
  });
});

/**
 * 基础组件墙的筛选：**用到的维度必须都在依赖数组里**（2026-08-08）。
 *
 * 用户截图报「筛选无效」：pill 上明明写着「来源: Ant Design」，列表纹丝不动。
 * 原因是加「来源」那一栏时只加了 filter 体里的一行判断，**忘了 useMemo 的
 * 依赖数组**——memo 一直命中旧结果，筛选看着像没接上。
 *
 * 这个形状这个项目已经是第三次了：
 *
 *     漏传 prop     六个区块在真实运行时是死壳（②阶段复盘）
 *     漏读通道      TagFilterRow / SearchBox 的补丁被 reducer 吞掉
 *     漏依赖        就是这次
 *
 * 共同点都是「加一样东西要改两处，漏了不报错」。所以这条**不钉那四个名字**
 * ——钉死名字的话，将来加第五个维度照样漏，用例照样绿。它从 filter 体里把
 * 用到的变量抠出来，跟依赖数组现算现比。
 */
describe("基础组件墙的筛选维度不许漏依赖", () => {
  const src = read("../ComponentsLibraryPage.tsx");

  it("filter 体里用到的每个维度，依赖数组里都得有", () => {
    const start = src.indexOf("  const shown = React.useMemo(");
    expect(start, "基础组件墙的 shown memo 不见了？").toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("\n  );", start));

    // 墙自己的筛选 prop（从函数签名读，不手抄）
    const sigStart = src.indexOf("function BaseComponentWall({");
    const sig = src.slice(sigStart, src.indexOf("}) {", sigStart));
    const dims = [...sig.matchAll(/^ {2}(\w+),$/gm)].map(m => m[1]);
    expect(dims.length, "墙的筛选维度没读出来").toBeGreaterThan(2);

    // 依赖数组 = memo 的最后一行 [...]
    const deps = block.slice(block.lastIndexOf("["), block.lastIndexOf("]") + 1);
    // filter 体 = 依赖数组之前的部分
    const body = block.slice(0, block.lastIndexOf("["));

    const used = dims.filter(d => new RegExp(`\\b${d}\\b`).test(body));
    const missing = used.filter(d => !new RegExp(`\\b${d}\\b`).test(deps));
    expect(
      missing,
      `筛选用到了 ${missing.join(", ")} 但依赖数组里没有 —— ` +
        "表现是那一栏点了列表纹丝不动（memo 命中旧结果），不报错。"
    ).toEqual([]);
  });

  it("「来源」这一维真的接到了墙上 —— 只加筛选条不接墙等于装饰", () => {
    expect(src, "筛选条上没有来源这一维").toContain('key: "source"');
    expect(src, "墙没收到 source").toContain("source={baseSource}");
    expect(src, "墙没按 source 筛").toContain(
      'if (source !== "all" && c.source !== source) return false;'
    );
  });
});
