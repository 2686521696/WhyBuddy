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

    // 三个筛选轴的挂载点
    expect(code).toContain("components-page-kind-switch");
    expect(code).toContain("components-device-switch");
    expect(code).toContain("components-slot-filters");
    // 早先那版按"区块分区"筛的开关已经删掉，别再回来
    expect(code).not.toContain("components-section-switch");
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

  it("uses the application-center gradient metadata overlay", () => {
    expect(pageSource).toContain("bg-gradient-to-t from-black/70 via-black/35 to-transparent");
    expect(pageSource).toContain('position: "relative"');
  });

  it("keeps progress indicators named and allows browser zoom", () => {
    expect(registrySource).toContain(
      "aria-label={`${item.label}相对排名进度`}"
    );
    expect(htmlSource).not.toContain("maximum-scale");
  });
});
