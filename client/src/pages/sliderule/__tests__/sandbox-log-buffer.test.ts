/**
 * 沙箱命令行滚动缓冲：抄 grok `BgTaskState` 那六条，一条配一条反向。
 *
 * 抄的标准答案：grok-build
 *   `xai-grok-pager/src/app/agent.rs::BgTaskState`（set_stdout / append_stdout）
 *   `xai-grok-pager/src/app/acp_handler/background.rs::route_bg_task_stdout`
 *
 * 这六条里有两条是**事故记录**，不是设计偏好——反向判据钉的就是它们：
 *   · 空块不许覆盖：`// Don't overwrite with empty stdout (shell clears buffer on completion)`
 *   · truncated 黏性：`once true, it stays true (the rolling buffer can't "un-truncate")`
 */
import { describe, expect, it } from "vitest";
import {
  SANDBOX_LOG_MAX_CHARS,
  appendSandboxLog,
  emptySandboxLog,
  replaceSandboxLog,
  sandboxLogStatus,
} from "../project-runtime/sandbox-log-buffer";

describe("追加：分隔符与行数缓存", () => {
  it("正向：非空缓冲追加时补一个换行（抄 append_stdout）", () => {
    let s = appendSandboxLog(emptySandboxLog(), "npm install");
    s = appendSandboxLog(s, "added 214 packages");
    expect(s.text).toBe("npm install\nadded 214 packages");
    expect(s.lineCount).toBe(2);
  });

  it("正向：第一段前面不许凭空多一个换行", () => {
    expect(appendSandboxLog(emptySandboxLog(), "first").text).toBe("first");
  });

  it("行数是缓存出来的，跟真实行数一致（grok 留它是为了不每帧重扫）", () => {
    const s = appendSandboxLog(emptySandboxLog(), "a\nb\nc");
    expect(s.lineCount).toBe(3);
    expect(s.lineCount).toBe(s.text.split("\n").length);
  });
});

describe("空块不许覆盖（grok 的事故记录）", () => {
  it("反向：命令结束时 shell 清缓冲，空块不许把已收到的输出抹掉", () => {
    const before = appendSandboxLog(emptySandboxLog(), "build ok");
    const after = appendSandboxLog(before, "");
    expect(after.text).toBe("build ok");
    expect(after).toBe(before); // 什么都没变时连对象都不换，省一次重渲染
  });

  it("反向：replace 那条路同样不许被空串清空", () => {
    const before = replaceSandboxLog(emptySandboxLog(), "build ok");
    expect(replaceSandboxLog(before, "").text).toBe("build ok");
  });

  it("正向：空块仍然可以推进游标和黏性标记", () => {
    const before = appendSandboxLog(emptySandboxLog(), "x");
    const after = appendSandboxLog(before, "", { seq: 9, truncated: true });
    expect(after.text).toBe("x");
    expect(after.seq).toBe(9);
    expect(after.truncated).toBe(true);
  });
});

describe("truncated 是黏的", () => {
  it("反向：置上之后，后面的干净块不许把它抹回 false", () => {
    let s = appendSandboxLog(emptySandboxLog(), "head", { truncated: true });
    expect(s.truncated).toBe(true);
    s = appendSandboxLog(s, "more");
    expect(s.truncated).toBe(true); // 变异：把黏性去掉 → 这里变 false
    s = replaceSandboxLog(s, "whole");
    expect(s.truncated).toBe(true);
  });

  it("正向：从来没裁过就不许自己亮起来", () => {
    const s = appendSandboxLog(appendSandboxLog(emptySandboxLog(), "a"), "b");
    expect(s.truncated).toBe(false);
  });
});

describe("滚动缓冲：截头保尾", () => {
  const long = (n: number) => "x".repeat(n);

  it("正向：超上限保的是**尾巴**——终端看的是最新几行，不是开头", () => {
    let s = appendSandboxLog(emptySandboxLog(), long(SANDBOX_LOG_MAX_CHARS));
    s = appendSandboxLog(s, "TAIL-MARKER");
    expect(s.text.endsWith("TAIL-MARKER")).toBe(true);
    expect(s.text.length).toBeLessThanOrEqual(SANDBOX_LOG_MAX_CHARS);
    expect(s.truncated).toBe(true);
  });

  it("反向：没超上限的一个字都不许裁", () => {
    const body = long(SANDBOX_LOG_MAX_CHARS - 10);
    const s = appendSandboxLog(emptySandboxLog(), body);
    expect(s.text).toBe(body);
    expect(s.truncated).toBe(false);
  });

  it("replace 超限同样截头保尾并置位", () => {
    const s = replaceSandboxLog(emptySandboxLog(), long(SANDBOX_LOG_MAX_CHARS + 500) + "END");
    expect(s.text.endsWith("END")).toBe(true);
    expect(s.text.length).toBeLessThanOrEqual(SANDBOX_LOG_MAX_CHARS);
    expect(s.truncated).toBe(true);
  });

  it("⚠ 不许切断代理对——切出半个字符会渲染成 \\ufffd", () => {
    // grok 那边防的是 UTF-8 字节边界（Rust 切片）；JS 是 UTF-16，
    // 同一个病换了形状：切在代理对中间。
    const emoji = "\u{1F642}"; // 两个 code unit
    // ⚠ 夹具必须让裁切点**真的落在代理对中间**，否则这条判据是假的：
    //   纯 emoji 串时 cut = len - MAX 永远落在高位代理上，切不断，
    //   把防护删掉照样绿（2026-09-14 变异时逮到）。
    //   尾部补**奇数个** ASCII，cut 的奇偶翻过来，正好落在低位代理上。
    const text = emoji.repeat(150_000) + "Z";
    const cut = text.length - SANDBOX_LOG_MAX_CHARS;
    const at = text.charCodeAt(cut);
    expect(at >= 0xdc00 && at <= 0xdfff).toBe(true); // 夹具自检：确实切在半个字符上

    const s = replaceSandboxLog(emptySandboxLog(), text);
    expect(s.text.length).toBeLessThanOrEqual(SANDBOX_LOG_MAX_CHARS);
    const first = s.text.charCodeAt(0);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
    expect(s.text.endsWith("Z")).toBe(true);
    expect([...s.text.slice(0, -1)].every(ch => ch === emoji)).toBe(true);
  });
});

describe("游标只许前进", () => {
  it("反向：迟到的小 seq 不许把游标拽回去（会导致重复拉同一段）", () => {
    let s = appendSandboxLog(emptySandboxLog(), "a", { seq: 10 });
    s = appendSandboxLog(s, "b", { seq: 3 });
    expect(s.seq).toBe(10);
  });
});

describe("状态三态：exit 0 才算成功", () => {
  it("正向", () => {
    expect(sandboxLogStatus("running")).toBe("running");
    expect(sandboxLogStatus("queued")).toBe("running");
    expect(sandboxLogStatus("completed", 0)).toBe("done");
  });

  it("反向：非零退出是失败，不是完成", () => {
    expect(sandboxLogStatus("completed", 1)).toBe("failed");
    expect(sandboxLogStatus("completed", 137)).toBe("failed");
    expect(sandboxLogStatus("failed")).toBe("failed");
    expect(sandboxLogStatus("cancelled")).toBe("failed");
  });

  it("反向：终态但拿不到退出码，不许默认成功（§7 闭环 fail-closed）", () => {
    expect(sandboxLogStatus("completed")).toBe("failed");
    expect(sandboxLogStatus("completed", null)).toBe("failed");
    expect(sandboxLogStatus("completed", undefined)).toBe("failed");
  });
});

describe("通电：真的接在面板和会话链路上（§3）", () => {
  it("面板订阅了日志，且 operationId 一路串到了行上", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (p: string) =>
      fs.readFileSync(path.resolve(process.cwd(), p), "utf8");

    const panel = read("client/src/pages/sliderule/ProjectComputerPanel.tsx");
    expect(panel).toMatch(/useSandboxLog\(/);
    expect(panel).toMatch(/<SandboxConsole[\s/>]/);

    // 服务端一直在发 operationId，前端此前全程丢掉——这三处缺一处就订阅不到。
    const session = read("client/src/pages/sliderule/useSlideRuleSession.ts");
    expect(session).toContain("operationId: event.operationId");
    const activity = read("client/src/pages/sliderule/project-activity.ts");
    expect(activity).toContain("open.operationId = operationId");
    const hook = read("client/src/pages/sliderule/project-runtime/useSandboxLog.ts");
    expect(hook).toContain("/events?afterSeq=");
    expect(hook).toContain("runtime.log");
  });
});
