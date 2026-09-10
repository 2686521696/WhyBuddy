/**
 * 范围卡从「闸」变成「回执」之后，三处让路规则没跟着改。
 *
 * ⚠ 2026-09-10 浏览器那条路上量到的一整串（本仓 §四：只改一半必然静默失效）。
 *   服务端同一回合里 `control_scope_card` 紧接 `control_handoff_factory`——
 *   卡是回执（`gate: false`），推演已经自己点着了，而**没有人清掉这张回执**：
 *   确认键在 isRunning 时置灰，用户也没有理由去点「不对再说」。
 *
 *   于是三条「卡在 = 用户还没拿主意」的规则全部变成**永久**成立：
 *
 *     ① 假设卡悬浮层 `!pendingScope && …`   → 假设卡永远不渲染
 *     ② 回执自己画在假设卡上面              → 渲染了也被盖住
 *     ③ `overlayBlocksQueueFlush`           → 「继续画页面」永远发不出去
 *
 *   真机代价：工厂 hold 在 spec-assumptions，实测干等 584 秒；
 *   钟停在 2:done、页面 0 份，用户对着「推演中」一个能点的东西都没有。
 *
 * 判据分两层：纯函数一层，**call site 一层**。只测纯函数的话，把
 * `scopeCardIsGate(...)` 换回 `Boolean(...)` 照样全绿——那正是这一串的病根。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { scopeCardIsGate } from "../scope-card-gate";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/** 剥掉注释再 grep：这一串的说明文字里就带着 `!pendingScope`。 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("回执不是闸", () => {
  it("gate 缺省 / true 是闸，false 是回执", () => {
    expect(scopeCardIsGate({ gate: true })).toBe(true);
    expect(scopeCardIsGate({})).toBe(true);
    expect(scopeCardIsGate({ gate: false })).toBe(false);
  });

  it("没有卡就没有闸", () => {
    expect(scopeCardIsGate(null)).toBe(false);
    expect(scopeCardIsGate(undefined)).toBe(false);
  });

  it("跟 scopeCardBlocksComposer 是两个问题，别合并", async () => {
    const { scopeCardBlocksComposer } = await import("../scope-card-gate");
    // 回执**也要**锁作曲家（见该函数头注的 2026-09-09 事故），
    // 但它**不是**闸。两个答案必须能不一样。
    expect(scopeCardBlocksComposer({ gate: false })).toBe(true);
    expect(scopeCardIsGate({ gate: false })).toBe(false);
  });
});

describe("三处 call site 都得问这个问题", () => {
  const composer = stripComments(read("../ComposerDock.tsx"));
  const session = stripComments(read("../useSlideRuleSession.ts"));

  it("① 假设卡悬浮层让的是闸，不是回执", () => {
    expect(composer).toMatch(/\{!scopeCardIsGate\(pendingScope\)\s*&&/);
    expect(composer).not.toMatch(/\{!pendingScope\s*&&\s*\n?\s*!pendingAsk/);
  });

  it("② 回执在假设卡出场时让位（不许画在它上面）", () => {
    expect(composer).toMatch(/scopeReceiptYields/);
    expect(composer).toMatch(
      /pendingScope && onConfirmScope && onReviseScope && !scopeReceiptYields/
    );
  });

  it("③ 排队 flush 挡的是闸，不是回执", () => {
    expect(session).toMatch(
      /overlayBlocksQueueFlush\s*=\s*\(\)\s*=>\s*\n?\s*scopeCardIsGate\(pendingScopeRef\.current\)/
    );
    expect(session).not.toMatch(
      /overlayBlocksQueueFlush\s*=\s*\(\)\s*=>\s*\n?\s*Boolean\(pendingScopeRef\.current/
    );
  });
});
