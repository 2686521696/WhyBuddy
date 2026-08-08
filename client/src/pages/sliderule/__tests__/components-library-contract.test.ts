import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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

  it("区域清单不许两边分叉 —— Python 语法里有的，这边必须摆得出来", () => {
    // 2026-08-08 第二轮。用户指出我们那套区域名是我编的，让我照
    // ant-design/pro-blocks 的 29 个真实页面改。改完新增了 headerExtra /
    // headerContent / tabs / footerBar 四个区域。
    //
    // 危险就在这里：区域语法在 Python（模型照它产出），排版表在 TS。语法里
    // 新增一个、排版表忘了加，表现是**模型规规矩矩填了这个区域，页面上却
    // 什么都不显示**——不报错、不警告，就是没了。这种 bug 只能靠肉眼比对
    // 两个文件发现。
    //
    // 所以直接读 Python 源码对账。
    const archetypeSource = readFileSync(
      new URL(
        "../../../../../slide-rule-python/services/page_archetypes.py",
        import.meta.url
      ),
      "utf8"
    );
    // 只取区域定义里的 key（`"key": "main",`），不要 propsSchema 之类的噪音
    const pyRegions = new Set(
      [...archetypeSource.matchAll(/^\s+"key":\s*"(\w+)",$/gm)].map(m => m[1])
    );
    expect(pyRegions.size, "没从 page_archetypes.py 里读出区域").toBeGreaterThan(5);

    const code = stripComments(pageSource);
    const tsRegions = new Set(
      [...code.matchAll(/\{ key: "(\w+)", label: "[^"]+", weight:/g)].map(m => m[1])
    );
    const missing = [...pyRegions].filter(k => !tsRegions.has(k));
    expect(
      missing,
      `Python 语法里有这些区域、REGION_LAYOUT 里没有 —— 模型填了会静静地丢掉：${missing.join(
        "、"
      )}`
    ).toEqual([]);

    // 反向：排版表里多出来的区域是死代码，模型永远不会产出它
    const extra = [...tsRegions].filter(k => !pyRegions.has(k));
    expect(extra, `REGION_LAYOUT 里这些区域在 Python 语法里不存在：${extra.join("、")}`).toEqual(
      []
    );

    // band 是这一侧的排版决定，但每个区域都必须有一个 —— 漏了 band 的区域
    // 会从所有分带里掉出去，同样是静静消失。
    const withBand = (code.match(/\{ key: "\w+", label: "[^"]+", weight: "\w+", band: "\w+" \}/g) ?? [])
      .length;
    expect(withBand, "每个 REGION_LAYOUT 条目都要有 band").toBe(tsRegions.size);
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
