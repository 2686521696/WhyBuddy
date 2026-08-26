/**
 * 控制面的**开放式**提问必须能回答。
 *
 * 2026-08-27 评审逮到的死胡同：`ask_user` 允许不带 options（模型不给就是
 * `[]`），而输入框被 `Boolean(pendingAsk)` 一律禁掉、卡片上只有一句问题
 * ——没有任何回答入口，只能点「稍后再说」跑掉。
 *
 * 正反一对：
 *   · 没有选项 → 不许挡打字（否则就是死胡同）
 *   · 有选项   → 仍然挡（Enter 另发一条会把这次停泊冲掉，跟范围卡同理）
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { askBlocksTyping, isComposerSendBlocked } from "../ComposerDock";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

const DOCK = stripComments(
  readFileSync(new URL("../ComposerDock.tsx", import.meta.url), "utf8")
);

describe("askBlocksTyping", () => {
  it("开放式提问（没有选项）不挡打字", () => {
    expect(askBlocksTyping({ options: [] })).toBe(false);
    expect(askBlocksTyping({})).toBe(false);
  });

  it("给了选项就仍然挡（那时该点按钮，不该另发一条）", () => {
    expect(askBlocksTyping({ options: ["主管", "HR"] })).toBe(true);
  });

  it("没有提问时当然不挡", () => {
    expect(askBlocksTyping(null)).toBe(false);
    expect(askBlocksTyping(undefined)).toBe(false);
  });
});

describe("发送闸", () => {
  const base = {
    isRunning: false,
    input: "主管审批",
    attachments: [] as Array<{ extractStatus?: "pending" | "ready" | "failed" }>,
  };

  it("开放式提问时打字能发出去", () => {
    expect(
      isComposerSendBlocked({
        ...base,
        askOpen: askBlocksTyping({ options: [] }),
      })
    ).toBe(false);
  });

  it("反向：有选项时仍然发不出去", () => {
    expect(
      isComposerSendBlocked({
        ...base,
        askOpen: askBlocksTyping({ options: ["主管", "HR"] }),
      })
    ).toBe(true);
  });

  it("反向：范围卡照旧一律挡（这次只放开提问那一种）", () => {
    expect(isComposerSendBlocked({ ...base, scopeCardOpen: true })).toBe(true);
  });
});

describe("输入框和卡片本身", () => {
  it("textarea 的 disabled 走 askBlocksTyping，不是裸 Boolean(pendingAsk)", () => {
    /* ⚠ 这条钉的是**接线**：判定函数写对了但输入框还照旧裸判，死胡同原样还在
       （本仓第三条：写对了 ≠ 接上了）。 */
    expect(DOCK).toContain(
      "disabled={Boolean(pendingScope) || askBlocksTyping(pendingAsk)}"
    );
    expect(DOCK).not.toContain(
      "disabled={Boolean(pendingScope) || Boolean(pendingAsk)}"
    );
  });

  it("没有选项时卡片要明说怎么答", () => {
    expect(DOCK).toContain('data-testid="sliderule-control-ask-typehint"');
    expect(DOCK).toContain("直接在下面的输入框里回答");
  });
});
