/**
 * 后续建议：**整行、贴着结果、不截断**；终端：按行首标记上色。
 *
 * ## 病（2026-09-14，对照 Manus 两张截图）
 *
 * 上一版把模型的下一步塞进输入条上方的 hint chip 行。对照 Manus 才看明白
 * 位置和形态都不对：
 *
 *   · 位置：建议是关于「刚做出来的这个东西」的，混进输入条的通用提示里
 *     跟「路线对比一下」长得一样，读起来像装饰。
 *   · 形态：pill 塞不下整句，「联调 check/build/test，确保 synchronized」
 *     被截成「联调 check/build/test，确…」，等于没说。
 *
 * 这份判据钉的就是那两条：整行不截断、两个 surface 各管各的。
 */
import { describe, expect, it } from "vitest";
import { deriveNextStepChips } from "../next-step-chips";
import { deriveComposerHintChips } from "../derive-composer-hints";
import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";

const state = (over: Partial<V5SessionState> = {}) => over as V5SessionState;

/** 真机 `sr-20260914051427` 那两条，原样——它们正是被 pill 截断过的。 */
const REAL = [
  { id: "1", status: "pending", content: "联调 check/build/test，确保 synchronized" },
  { id: "2", status: "pending", content: "申请 project_verify 并核对验收断言" },
];

describe("整行：把话说完", () => {
  it("正向：真机那条 24 字的待办不许再被截断", () => {
    const [first] = deriveNextStepChips(state({ controlTodo: REAL }));
    expect(first).toBe("联调 check/build/test，确保 synchronized");
    expect(first.endsWith("…")).toBe(false);
  });

  it("反向：上限仍在——脱缰的超长待办不许把版面撑坏", () => {
    const [only] = deriveNextStepChips(state({
      controlTodo: [{ status: "pending", content: "补".repeat(300) }],
    }));
    expect(only.length).toBeLessThanOrEqual(80);
    expect(only.endsWith("…")).toBe(true);
  });
});

describe("两个 surface 各管各的", () => {
  it("反向：输入条退回通用提示，不再被下一步顶替", () => {
    // 有待办时输入条**照旧**是通用词——建议归结果卡下面那几行。
    const chips = deriveComposerHintChips(state({ controlTodo: REAL }));
    expect(chips).toContain("路线对比一下");
    expect(chips.join("|")).not.toContain("联调 check/build/test");
  });
});

describe("通电（§3）", () => {
  it("建议行挂在结果卡下面，且只挂最新一轮", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/SlideRule.tsx"), "utf8");
    expect(src).toMatch(/<NextStepSuggestions[\s\n]/);
    // 历史轮次的「下一步」早过期了，不许每轮都挂一组。
    const block = src.slice(src.indexOf("<NextStepSuggestions"));
    expect(src.slice(0, src.indexOf("<NextStepSuggestions"))).toContain("ctx.latestTurnId");
    expect(block.slice(0, 400)).toContain("sliderule:fill-prompt");
  });

  it("点击走的是真实存在的事件——`fill-prompt` 有监听者", async () => {
    // ⚠ 第一版我发的是 `sliderule:prefill-prompt`，全仓**没有任何监听者**，
    //   点了静静地什么都不发生。判据钉住事件名两头对上。
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dock = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/sliderule/ComposerDock.tsx"), "utf8");
    expect(dock).toContain('window.addEventListener("sliderule:fill-prompt"');
  });
});

describe("终端配色：按行首标记，不猜语义", () => {
  it("正向/反向：好消息里含 vulnerabilities 也不许被判成错误", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(process.cwd(), "client/src/pages/sliderule/ProjectComputerPanel.tsx"), "utf8");
    // 判据盯**实现方式**：必须是行首锚定的正则，不是关键词包含。
    expect(src).toMatch(/\^\(ERR\|ERROR\|FAIL\|FATAL\)/);
    expect(src).toMatch(/\^\(WARN\|WARNING\)/);
    // 反向：不许出现「含有某词就算错」的写法
    expect(src).not.toMatch(/includes\(["']error["']\)/i);
  });
});
