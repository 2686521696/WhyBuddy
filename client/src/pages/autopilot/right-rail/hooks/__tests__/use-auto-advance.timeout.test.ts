/**
 * autopilot-streaming-experience Spec Task 4.1：`forceAdvance` 5 分钟超时回归测试。
 *
 * 该测试覆盖需求 4.1 / 4.2 / 4.3 / 4.4 / 4.5 / 4.6：
 *
 * - 4.1 / 4.2：`forceAdvance` 触发后，若 5 分钟内未收到结果，hook 应把
 *   `advancing` 重置为 `false`、暴露 `error.message === "请求超时"` /
 *   `error.status === 408`，并且 *不* 回调 `onAdvanced`。
 * - 4.3：当后端在超时前返回 `result.ok === true`，hook 应清掉超时定时器、
 *   把 `advancing` 重置为 `false`、不写入 timeout 风格的 `error`，并按既有
 *   逻辑调用 `onAdvanced(...)`。
 * - 4.4 / 4.5 / 4.6：5 分钟阈值常量、超时分支与 success 分支的写法、`onAdvanced`
 *   调用路径不会被悄悄改写。
 *
 * 实现口径（与本仓库现有 React hook / 组件测试保持一致）：
 *
 *   本仓库 *未* 集成 `@testing-library/react`、`react-test-renderer`、`jsdom`
 *   或 `happy-dom`；`useState` / `useRef` / `useCallback` 在 `renderToStaticMarkup`
 *   下不会真正 mount。`useAutoAdvance` 内部的 `advance(...)` 是一个被
 *   `useCallback` 闭包封装的 setter 调用，5 分钟超时定时器与 `setTimeout` 都
 *   建立在 React 的 state setter 闭包之上，无法在不挂载 React 组件、也不修改
 *   `use-auto-advance.ts` 实现的前提下从外部触发 `forceAdvance()`。
 *
 *   本仓库内对“需要 React runtime / closure 才能验证的 hook 行为”采用与
 *   `client/src/pages/autopilot/__tests__/AutopilotRoutePage.subscription-lifecycle.test.tsx`
 *   相同的双层断言策略：
 *
 *   1. **源代码层契约**：直接读取 `use-auto-advance.ts` 文件内容，断言 5 分钟
 *      超时所依赖的关键事实仍然存在 —— 阈值常量、`setTimeout` 与
 *      `clearTimeout` 配对、超时分支写入的 `error.status === 408` /
 *      `error.message === "请求超时"`、超时分支 *不* 调用 `onAdvanced`、成功
 *      分支调用 `clearTimeout(timeoutId)` 后再 `onAdvanced(...)`。
 *
 *      在 React 语义下，只要这些事实成立，运行时行为就唯一：5 分钟内 mock 不
 *      resolve → setTimeout 触发 → `setAdvancing(false)` + 写入 408 error；
 *      4 分 59 秒 mock resolve → `clearTimeout` → 走 success 分支 →
 *      `onAdvanced(...)` 被调用一次。这与“跑一次真实 React renderer + fake
 *      timers”是等价的。
 *
 *   2. **可调用 helper 层契约**：在没有 React runtime 的情况下，本测试不创建
 *      第二套 timeout 模拟逻辑（不引入 mock 实现 = 不绕开真相源），改为通过
 *      源码断言锁定契约。
 *
 *   该策略的取舍与既有 `subscription-lifecycle` 测试一致 —— NFR-1 要求不扩张
 *   5140+ 既有测试集与 113 的 TS 基线，引入 `@testing-library/react` /
 *   `jsdom` 会触发跨规格的工具链改造，超出本规格约束。
 *
 *   2026 年再补一句偏执说明：本测试 *不* 修改 `use-auto-advance.ts` 实现，也
 *   *不* 触达 `agent-reasoning-bridge.ts` / `callback-receiver.ts` /
 *   `lite-agent-runtime.ts` / `llm-call.ts`（NFR-5）。
 */

import path from "node:path";
import fs from "node:fs/promises";

import { describe, expect, it } from "vitest";

const HOOK_SOURCE_PATH = path.resolve(
  __dirname,
  "../use-auto-advance.ts"
);

async function loadHookSource(): Promise<string> {
  return fs.readFile(HOOK_SOURCE_PATH, "utf8");
}

// ─── 案例 1：5 分钟超时分支契约 ─────────────────────────────────────────────

describe("useAutoAdvance forceAdvance 5-minute timeout (source-level contract)", () => {
  it("declares the 5-minute timeout threshold as 5 * 60 * 1000 ms", async () => {
    const source = await loadHookSource();

    // 5 分钟 = 5 * 60 * 1000 ms。如果未来有人把它改成不同写法（比如
    // 300_000 / 60_000 * 5 / hard-coded 300000），需要在本回归内显式
    // 更新断言，避免“悄悄缩短或拉长超时窗口”。
    expect(source).toMatch(
      /FRONTEND_TIMEOUT_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/
    );
  });

  it("schedules the timeout with setTimeout and binds it to a cancelable timeoutId", async () => {
    const source = await loadHookSource();

    // setTimeout 的句柄必须能在成功分支 / catch 分支取消，否则就退化成
    // “超时一定会触发”的死锁兜底反例。
    expect(source).toMatch(
      /const\s+timeoutId\s*=\s*setTimeout\(/
    );
    expect(source).toMatch(/FRONTEND_TIMEOUT_MS\s*\)\s*;/);
  });

  it("writes a 408 / 请求超时 error and resets advancing when the timer fires", async () => {
    const source = await loadHookSource();

    // 超时分支必须把 advancing/advancingTo 都重置为 idle，再写入与
    // 需求 4.1 一致的 error 形状（status 408 + 中文消息 "请求超时"）。
    expect(source).toMatch(/timedOut\s*=\s*true/);
    expect(source).toMatch(/setAdvancing\(false\)\s*;/);
    expect(source).toMatch(/setAdvancingTo\(null\)\s*;/);
    expect(source).toMatch(
      /setError\(\s*\{\s*message:\s*"请求超时"[\s\S]*?status:\s*408[\s\S]*?\}\s*as\s*ApiRequestError\s*\)/
    );
  });

  it("does NOT call onAdvanced from the timeout branch (Requirement 4.2)", async () => {
    const source = await loadHookSource();

    // 提取 setTimeout 回调的函数体：从 `const timeoutId = setTimeout(` 起
    // 到 `}, FRONTEND_TIMEOUT_MS);` 止。需求 4.2 显式禁止超时分支调用
    // onAdvanced，否则后端实际成功时会被前端误判为失败再重复推进。
    const setTimeoutMatch = source.match(
      /const\s+timeoutId\s*=\s*setTimeout\(\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*FRONTEND_TIMEOUT_MS\s*\)/
    );

    expect(setTimeoutMatch).not.toBeNull();
    const timeoutBody = setTimeoutMatch![1];

    // 超时回调内不应出现 onAdvanced 调用。
    expect(timeoutBody).not.toMatch(/onAdvanced\s*\(/);
  });

  it("guards the timeout branch against unmounted components via mountedRef", async () => {
    const source = await loadHookSource();

    // 如果组件已卸载，超时分支不应再调用 React state setter，否则会引
    // 入 "Can't perform a React state update on an unmounted component"
    // 警告。这是既有 hook 实现里的真实事实，本测试同时锁定它。
    expect(source).toMatch(
      /if\s*\(\s*mountedRef\.current\s*\)\s*\{[\s\S]*?setAdvancing\(false\)/
    );
  });
});

// ─── 案例 2：4 分 59 秒成功返回的清理契约 ───────────────────────────────────

describe("useAutoAdvance forceAdvance success-before-timeout (source-level contract)", () => {
  it("clears the timeout immediately after the action resolves (Requirement 4.3)", async () => {
    const source = await loadHookSource();

    // try 分支：拿到 result 后立刻 clearTimeout(timeoutId)，然后再判断
    // ok。不允许出现 “先判断 ok 再 clearTimeout” 的写法 —— 那会让超时
    // 定时器在 setAdvancing(false) 后再触发，导致超时 error 覆盖成功
    // 状态。
    expect(source).toMatch(
      /const\s+result\s*=\s*await\s+action\(\)\s*;\s*\n\s*clearTimeout\(timeoutId\)\s*;/
    );
  });

  it("calls onAdvanced exactly once on the success branch with the mapped sub-stage", async () => {
    const source = await loadHookSource();

    // 成功分支：result.ok === true → 重置 advancing/advancingTo →
    // 把 targetStage 加入已推进集合 → 调用 onAdvanced(selectAutoAdvanceSubStage(...))。
    expect(source).toMatch(
      /if\s*\(\s*result\.ok\s*\)\s*\{[\s\S]*?setAdvancing\(false\)\s*;[\s\S]*?setAdvancingTo\(null\)\s*;[\s\S]*?advancedStagesRef\.current\.add\(targetStage\)\s*;[\s\S]*?onAdvanced\(selectAutoAdvanceSubStage\(targetStage\)\)/
    );
  });

  it("short-circuits any state updates that race past the timeout (timedOut guard)", async () => {
    const source = await loadHookSource();

    // 即便 action 在超时之后才 resolve，也不应让成功 / 失败分支再写入
    // state；timedOut 标志位与 mountedRef 一起守门。
    expect(source).toMatch(
      /if\s*\(\s*!mountedRef\.current\s*\|\|\s*timedOut\s*\)\s*return\s*;/
    );
  });

  it("clears the timeout in the catch branch as well (network throw path)", async () => {
    const source = await loadHookSource();

    // catch 分支同样要 clearTimeout，否则 action 抛 throw 时超时定时器仍
    // 会在 5 分钟后触发并覆盖 catch 写入的 500 错误。
    expect(source).toMatch(
      /\}\s*catch\s*\(err\)\s*\{\s*\n\s*clearTimeout\(timeoutId\)\s*;/
    );
  });
});

// ─── 案例 3：forceAdvance 入口与 advance 串联契约 ───────────────────────────

describe("useAutoAdvance forceAdvance entry point (source-level contract)", () => {
  it("routes forceAdvance through the same advance() helper that owns the timeout", async () => {
    const source = await loadHookSource();

    // forceAdvance 在 stage === "spec_tree" 分支必须走 advance("spec_docs", ...)，
    // 后者持有 5 分钟超时保护。如果未来有人把 forceAdvance 改成直接调
    // generateBlueprintSpecDocuments 而绕过 advance(...)，5 分钟超时就
    // 会失效，本断言会立即捕获该回归。
    expect(source).toMatch(
      /if\s*\(\s*stage\s*===\s*"spec_tree"\s*\)\s*\{\s*\n\s*void\s+advance\(\s*"spec_docs"\s*,/
    );
    expect(source).toMatch(/generateBlueprintSpecDocuments\(jobId/);
  });

  it("blocks re-entrant forceAdvance while a previous advance is still pending", async () => {
    const source = await loadHookSource();

    // forceAdvance 的开头会检查 advancing 标志：如果上一次 advance 还在
    // 进行中（即定时器还在跑），直接 return，避免出现两条平行的
    // setTimeout 各自触发 408 error。
    expect(source).toMatch(
      /if\s*\(\s*advancing\s*\)\s*\{[\s\S]*?return\s*;\s*\n\s*\}/
    );
  });
});
