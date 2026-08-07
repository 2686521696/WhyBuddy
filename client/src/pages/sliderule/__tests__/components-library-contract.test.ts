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
    expect(pageSource).toContain('React.useState("workbench")');
    expect(pageSource).toContain("block.pageKinds");
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

  it("keeps progress indicators named and allows browser zoom", () => {
    expect(registrySource).toContain(
      "aria-label={`${item.label}相对排名进度`}"
    );
    expect(htmlSource).not.toContain("maximum-scale");
  });
});
