/**
 * 推演中补的话：排队、可撤、合成一条。
 *
 * 真机实测的老形态（2026-08-27）：推演中点发送，输入框清空、**整页搜不到这
 * 句话**、几分钟后它自己发出去。机制是通的，人是懵的。而且旧写法是覆盖——
 * 连补两句，第一句被悄悄顶掉。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  enqueueTurn,
  mergeQueuedTurns,
  removeQueued,
} from "../midrun-queue";

describe("enqueueTurn", () => {
  it("累积，不覆盖", () => {
    const a = enqueueTurn([], "登录页改成工号");
    const b = enqueueTurn(a, "预约列表加改期按钮");
    expect(b).toEqual(["登录页改成工号", "预约列表加改期按钮"]);
  });

  it("反向：空白不入队（点了发送但没打字）", () => {
    expect(enqueueTurn([], "   ")).toEqual([]);
    expect(enqueueTurn(["x"], "")).toEqual(["x"]);
  });

  it("反向：跟上一条一模一样不重复入队（连点两下发送）", () => {
    expect(enqueueTurn(["改成工号"], "改成工号")).toEqual(["改成工号"]);
    // 但隔了一条之后再说同样的话是有效的（用户在强调）
    expect(enqueueTurn(["改成工号", "别的"], "改成工号")).toEqual([
      "改成工号",
      "别的",
      "改成工号",
    ]);
  });

  it("不改原数组（React state 必须换引用才重渲染）", () => {
    const src = ["a"];
    const out = enqueueTurn(src, "b");
    expect(src).toEqual(["a"]);
    expect(out).not.toBe(src);
  });
});

describe("removeQueued", () => {
  it("撤掉指定那条", () => {
    expect(removeQueued(["a", "b", "c"], 1)).toEqual(["a", "c"]);
  });

  it("反向：越界/脏下标原样返回，不抛", () => {
    expect(removeQueued(["a"], 5)).toEqual(["a"]);
    expect(removeQueued(["a"], -1)).toEqual(["a"]);
    expect(removeQueued(["a"], 1.5 as number)).toEqual(["a"]);
  });
});

describe("mergeQueuedTurns", () => {
  it("合成一条，不是逐条各发一轮", () => {
    expect(mergeQueuedTurns(["登录页改工号", "加改期按钮"])).toBe(
      "登录页改工号\n加改期按钮"
    );
  });

  it("反向：空队列合成空串（调用方据此不发）", () => {
    expect(mergeQueuedTurns([])).toBe("");
    expect(mergeQueuedTurns(["  ", ""])).toBe("");
  });
});

describe("接线（三段都得接上）", () => {
  const read = (rel: string) =>
    readFileSync(new URL(rel, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
  const SESSION = read("../useSlideRuleSession.ts");
  const DOCK = read("../ComposerDock.tsx");
  const PAGE = read("../../SlideRule.tsx");

  it("hook：入队用 enqueueTurn（累积），flush 用 mergeQueuedTurns（合成一条）", () => {
    expect(SESSION).toContain("enqueueTurn(queuedTurnRef.current, text)");
    expect(SESSION).toContain("mergeQueuedTurns(queuedTurnRef.current)");
    /* ⚠ 反向：老写法是**覆盖**，连补两句第一句被悄悄顶掉。
       这行回来 = 第二次无声丢失。 */
    expect(SESSION).not.toContain("queuedTurnRef.current = text;");
  });

  it("hook：队列导出去了，否则永远画不出来", () => {
    expect(SESSION).toContain("queuedTurns,");
    expect(SESSION).toContain("removeQueuedTurn,");
  });

  it("重置会话必须清队列（遗留的补充会劫持后来无关的一发）", () => {
    expect(SESSION).toContain("queuedTurnRef.current = [];");
  });

  it("输入条：画出来并且撤得掉", () => {
    expect(DOCK).toContain('data-testid="sliderule-queued-turns"');
    expect(DOCK).toContain('data-testid="sliderule-queued-remove"');
    expect(DOCK).toContain("本轮结束后发出");
  });

  it("页面：真的把队列传给了输入条（不传 = 组件永远收到空数组）", () => {
    expect(PAGE).toContain("queuedTurns={queuedTurns}");
    expect(PAGE).toContain("onRemoveQueued={removeQueuedTurn}");
  });
});
