/**
 * 输入条 Cursor 三行形态（装在真链路上）。
 *
 * 对照：Cursor Composer 芯片行 / 胶囊+圆发送 / 状态行；
 * Void SidebarChat SelectedFiles → textarea → 底栏。
 * hintChips 必须真渲染——只写在 props 类型里会假绿。
 * 不许出现 git / Commit / main 这种本仓没有的东西。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("ComposerDock Cursor 三行形态", () => {
  it("停靠条是 24px 白胶囊，+ 是灰圆，发送在胶囊外的实心圆", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    const shell = dock.slice(
      dock.indexOf("sliderule-composer-dock") - 420,
      dock.indexOf("sliderule-composer-dock") + 80
    );
    expect(shell).toContain("rounded-[24px]");
    expect(shell).toContain("rounded-[12px]");
    expect(shell).toContain("bg-white");
    expect(shell).toContain("border-[#e5e7eb]");
    expect(shell).not.toContain("bg-[#f3f4f6]");
    expect(dock).not.toContain("sliderule-hero-glow");

    const plus = dock.slice(
      dock.indexOf("sliderule-composer-plus") - 420,
      dock.indexOf("sliderule-composer-plus")
    );
    expect(plus).toContain("rounded-full");
    expect(plus).toContain("bg-[#f4f4f5]");
    expect(plus).not.toContain("rounded-md");

    const send = dock.slice(
      dock.indexOf("sliderule-composer-send"),
      dock.indexOf("sliderule-composer-send") + 520
    );
    expect(send).toContain("pointer-events-auto");
    expect(send).toContain("rounded-full");
    expect(send).not.toContain("mb-0.5");
    // 发送圆和胶囊同一中线。变异 items-end / mb-0.5 会把圆顶上去或沉下去。
    expect(dock).toContain("flex w-full items-center gap-2");
    expect(dock).not.toContain("flex w-full items-end gap-2");
    expect(dock).toContain(">优化<");
    expect(dock).not.toContain("sliderule-hero-upload");
    expect(dock).not.toContain("order-first basis-full");
  });

  it("空态是 Cursor 卡片：字在上、发送在卡片里，没有粉紫光晕", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    expect(dock).toContain("grid-cols-[auto_auto_1fr_auto]");
    expect(dock).toContain("min-h-[72px]");
    expect(dock).toContain("shadow-[0_2px_8px_rgba(31,35,40,0.06)]");
    expect(dock).toContain("col-start-4 row-start-2");
    expect(dock).toContain("{refineButton}");
    expect(dock).toContain("{sendButton}");
    // 空态：优化和发送同一簇靠右，优化在前。变异把优化塞回 + 右侧 col-start-3 必红。
    const heroSend = dock.slice(
      dock.indexOf("col-start-4 row-start-2"),
      dock.indexOf("{hero ? null : sendButton}")
    );
    expect(heroSend.indexOf("{refineButton}")).toBeLessThan(
      heroSend.indexOf("{sendButton}")
    );
    /**
     * ⚠ 2026-08-24：这两条原本写作 `not.toContain("col-start-3 row-start-2")`，
     * 意图是"优化按钮不许塞回 + 右侧的 col3"。但它盯的是**字面的类名**，不是那个
     * 语义——设计系统选择器合法占用 col3 之后，这条就误报了（本仓纪律二：判据要
     * 盯语义，别盯某句话的字面）。
     * 改成直接钉"优化/发送那一簇在 col4"，并确认 col3 的占用者是设计系统而不是
     * 优化按钮。把 refineButton 挪回 col3，下面两条仍必红。
     */
    /*
     * ⚠ 2026-08-26：窗口从"往后数 400 字符"改成"数到 col4 为止"。
     *   col3 里多了一颗「/ 技能·连接器」提示钮之后，设计系统的埋点被挤到
     *   400 字符之外，这条就红了——而 col3 的**占用者**根本没变。
     *   数字窗口会随着这一格里多放任何东西而误报；钉到下一格的起点就不会。
     */
    const col3 = dock.slice(
      dock.indexOf("col-start-3 row-start-2"),
      dock.indexOf("col-start-4 row-start-2")
    );
    expect(col3).toContain("sliderule-composer-design-system");
    // 提示钮跟设计系统同占 col3（2026-08-26 用户："输入框中应该加入提醒"）
    // ⚠ 连引号一起钉：只写裸串的话改名成 `...-hint-GONE` 照样是子串，变异咬不住
    expect(col3).toContain('data-testid="sliderule-slash-hint"');
    expect(col3).not.toContain("{refineButton}");
    expect(dock).not.toContain("col-start-5 row-start-2");
    expect(dock).toContain("sliderule-composer-device");
    expect(dock).toContain("COMPOSER_DEVICE_OPTIONS");
    expect(dock).toContain("{hero ? null : sendButton}");
    expect(dock).not.toContain("sliderule-hero-glow");
    expect(dock).not.toContain("rgba(167,139,250");
    expect(dock).not.toContain('filter: "blur(10px)"');
    expect(dock).not.toContain("This PC");
    expect(dock).not.toContain("Microphone");
  });

  it("顶行真的渲染 hintChips，不是只在 props 里占位", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    expect(dock).toContain("sliderule-composer-actions");
    expect(dock).toContain("hintChips.slice");
    expect(dock).toContain("sliderule-composer-hint-chip");
    expect(dock).toContain("sliderule-composer-status-pill");
    // 反向：编 git 顶行必红
    expect(dock).not.toContain("Commit & Push");
    expect(dock).not.toContain("Changes +");
  });

  it("斜杠入口只留工具条那颗钮，不在输入框里再写一遍", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    // 正向：工具条钮还在，点下去走同一条 `/` 路径
    expect(dock).toContain('data-testid="sliderule-slash-hint"');
    expect(dock).toContain("技能 · 连接器");
    // 反向：08-26 下午用户圈了三处同一句话。框内 hint / 占位符尾巴加回去必红
    expect(dock).not.toContain("sliderule-composer-slash-hint");
    expect(dock).not.toContain("COMPOSER_SLASH_HINT");
    expect(dock).not.toContain("即可选择技能");
    expect(dock).not.toContain("挂技能或连接器");
  });

  it("底行是话题 + 成品/推演，不是 git 分支", () => {
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    expect(dock).toContain("topicLabel");
    expect(dock).toContain("surfaceLabel");
    expect(dock).toContain('hasApp ? "成品" : "推演"');
    expect(dock).toContain("AppWindow");
    expect(dock).not.toContain(">main<");
    expect(dock).not.toContain("This PC");
  });
});

describe("对话列接到输入条，不要横切分隔线", () => {
  it("footer 与会话同宽 720，没有 border-t", () => {
    const src = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const footer = src.slice(
      src.indexOf("sliderule-composer-footer"),
      src.indexOf("sliderule-composer-footer") + 520
    );
    expect(footer).toContain("max-w-[720px]");
    expect(footer).not.toContain("border-t");
  });

  it("闭环胶囊从 publishClosure 接入 ComposerDock", () => {
    const src = stripComments(
      readFileSync(new URL("../../SlideRule.tsx", import.meta.url), "utf8")
    );
    const call = src.slice(
      src.indexOf("<ComposerDock"),
      src.indexOf("<ComposerDock") + 900
    );
    expect(call).toContain("hintChips={composerHints}");
    expect(call).toContain("formatComposerClosurePill");
    expect(call).not.toContain("statusPill={null}");
    expect(call).not.toContain("闭环 ${");
  });

  it("应用/Web 开关接到 drive-full-stream 请求体，不是只画在输入条上", () => {
    const session = stripComments(
      readFileSync(
        new URL("../useSlideRuleSession.ts", import.meta.url),
        "utf8"
      )
    );
    // 范围卡接通档优先，没选才读作曲家 localStorage。
    // ⚠ 2026-08-30：不能再盯 `preferredDevice: loadPreferredDevice()` 整行——
    // 通电路径改成了 isWiredDevice(scopeChoice.device) ? … : loadPreferredDevice()，
    // 字面一变就假红；删掉 loadPreferredDevice 或不再写进 preferredDevice 才该红。
    expect(session).toContain("preferredDevice:");
    expect(session).toContain("loadPreferredDevice()");
    expect(session).toContain("isWiredDevice(scopeChoice.device)");
    const dock = stripComments(
      readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
    );
    const doSend = dock.slice(
      dock.indexOf("const doSend = React.useCallback"),
      dock.indexOf("const [installedSkills")
    );
    expect(doSend).toContain("setPreferredDevice(device)");
    expect(doSend.indexOf("setPreferredDevice(device)")).toBeLessThan(
      doSend.indexOf("sendMessage")
    );
    const driver = stripComments(
      readFileSync(
        new URL("../../../lib/sliderule-marathon-driver.ts", import.meta.url),
        "utf8"
      )
    );
    expect(driver).toContain(
      'preferredDevice: opts.preferredDevice ?? "desktop"'
    );
    expect(driver).toContain("/drive-full-stream");
    expect(driver).not.toContain("...(opts.preferredDevice");
  });
});
