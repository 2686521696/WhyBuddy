/**
 * Docker Capability Bridge — Callback Dispatcher 单元测试（Task 8）
 *
 * 本测试覆盖 `createBlueprintExecutorCallbackDispatcher()` 的关键对外契约：
 *
 * - 8.1 Happy path：先 `awaitTerminal(jobId, 5000)` 再 `handleEvent(...)`
 *   → Promise resolve 且 event 匹配；waiter 完成后清理 timer，进程 event
 *   loop 不应被挂起。
 * - 8.1 Timeout：`awaitTerminal(jobId, 100)` 但永不 `handleEvent(...)`
 *   → Promise reject 且 `error.message === "callback timeout"`。
 * - 8.1 Log collection：`collectLogs(jobId, 50, 10240)` 订阅后
 *   `handleEvent({ type: "job.log_stream", jobId, data: "..." })`
 *   → `getLogs()` 返回对应行；`getDigest()` 返回非空 hex 字符串
 *   （SHA-256 over 脱敏字节链）。
 *
 * - 8.2 全程使用 `vi.useFakeTimers()` 控制超时触发，避免真实等待导致
 *   测试套件被拖到 100ms+ 的挂起时间；`vi.advanceTimersByTime(...)` 让
 *   setTimeout 在我们需要的点精确触发 timeout 分支。
 *
 * 测试风格：全部 example-based（需求 9.3 明确禁止 PBT）。
 *
 * 对应 `.kiro/specs/autopilot-capability-bridge-docker/`：
 * - requirements 2.6 / 3.2 / 3.6 / 9.2
 * - design §4.5（dispatcher 接口语义、log digest 覆盖完整脱敏字节流的不变式）
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EXECUTOR_CONTRACT_VERSION,
  type ExecutorEvent,
} from "../../../../shared/executor/contracts.js";

import { createBlueprintExecutorCallbackDispatcher } from "./callback-waiter.js";

/**
 * 构造一个满足 `ExecutorEvent` 必填字段的 fixture。
 *
 * `ExecutorEvent` 是 discriminated union 的超集：每次构造时只需保证
 * `version / eventId / missionId / jobId / executor / type / status /
 * occurredAt / message` 这些必填字段就位；可选字段（`data` / `log` /
 * `summary` / `artifacts` / `payload` 等）通过 `overrides` 按场景注入。
 *
 * 默认 `type` 为 `job.started`（非终态、非日志类），便于用例通过
 * overrides 切换到 `job.completed` / `job.failed` / `job.log_stream`。
 */
function makeEvent(overrides: Partial<ExecutorEvent> = {}): ExecutorEvent {
  return {
    version: EXECUTOR_CONTRACT_VERSION,
    eventId: "evt_default",
    missionId: "mission_default",
    jobId: "job_default",
    executor: "lobster",
    type: "job.started",
    status: "running",
    occurredAt: "2026-01-01T00:00:00.000Z",
    message: "default fixture message",
    ...overrides,
  };
}

describe("createBlueprintExecutorCallbackDispatcher — awaitTerminal 成功路径（Task 8.1 Happy path）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves the waiter with the matching job.completed event", async () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const promise = dispatcher.awaitTerminal("job_abc", 5000);

    const event = makeEvent({
      eventId: "evt_completed_1",
      jobId: "job_abc",
      type: "job.completed",
      status: "completed",
      message: "Docker analysis completed.",
      summary: "Docker analysis completed: 3 risks.",
    });

    dispatcher.handleEvent(event);

    // `await` 自身属于微任务，不依赖 fake timers；timer 已在 handleEvent 中
    // 被 clearTimeout 消费，无需 advance。
    await expect(promise).resolves.toBe(event);
  });

  it("resolves the waiter with the matching job.failed event", async () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const promise = dispatcher.awaitTerminal("job_def", 5000);

    const event = makeEvent({
      eventId: "evt_failed_1",
      jobId: "job_def",
      type: "job.failed",
      status: "failed",
      message: "Docker analysis failed.",
    });

    dispatcher.handleEvent(event);

    await expect(promise).resolves.toBe(event);
  });

  it("ignores terminal events whose jobId does not match and still times out", async () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const promise = dispatcher.awaitTerminal("job_abc", 5000);

    // 不相关 jobId 的终态事件不应 resolve waiter。
    dispatcher.handleEvent(
      makeEvent({
        eventId: "evt_unrelated",
        jobId: "unrelated_job",
        type: "job.completed",
        status: "completed",
      }),
    );

    // 推进到超时点，waiter 仍然挂起则被 timeout reject，证明上一条事件未错误 resolve。
    vi.advanceTimersByTime(5001);
    await expect(promise).rejects.toThrow("callback timeout");
  });
});

describe("createBlueprintExecutorCallbackDispatcher — awaitTerminal 超时路径（Task 8.1 Timeout + 8.2 Fake timers）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with 'callback timeout' after timeoutMs elapses without any terminal event", async () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const promise = dispatcher.awaitTerminal("job_timeout", 100);

    vi.advanceTimersByTime(100);

    await expect(promise).rejects.toThrow("callback timeout");
  });

  it("does not fire the timeout early before timeoutMs elapses", async () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const promise = dispatcher.awaitTerminal("job_not_yet", 200);

    // 推进不足的时间量，定时器不应触发，Promise 仍挂起。
    vi.advanceTimersByTime(199);

    // 用 `Promise.race` 判断 Promise 当前既未 resolve 也未 reject。
    const sentinel = Symbol("pending");
    const raceResult = await Promise.race([
      promise.then(
        () => "resolved" as const,
        () => "rejected" as const,
      ),
      Promise.resolve(sentinel),
    ]);
    expect(raceResult).toBe(sentinel);

    // 补齐剩余 1ms，timer 精确触发。
    vi.advanceTimersByTime(1);
    await expect(promise).rejects.toThrow("callback timeout");
  });
});

describe("createBlueprintExecutorCallbackDispatcher — collectLogs（Task 8.1 Log collection）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collects job.log_stream chunks and produces a non-empty SHA-256 hex digest", () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const collector = dispatcher.collectLogs("job_logs", 50, 10240);

    dispatcher.handleEvent(
      makeEvent({
        eventId: "evt_log_1",
        jobId: "job_logs",
        type: "job.log_stream",
        status: "running",
        stream: "stdout",
        data: "first line\n",
      }),
    );
    dispatcher.handleEvent(
      makeEvent({
        eventId: "evt_log_2",
        jobId: "job_logs",
        type: "job.log_stream",
        status: "running",
        stream: "stdout",
        data: "second line\n",
      }),
    );

    expect(collector.getLogs()).toEqual(["first line\n", "second line\n"]);

    const digest = collector.getDigest();
    expect(typeof digest).toBe("string");
    // SHA-256 hex 输出固定 64 字符，且仅包含 0-9a-f。
    expect(digest).toMatch(/^[0-9a-f]{64}$/);

    collector.dispose();
  });

  it("terminal job.completed event finalizes the digest for subsequent reads", async () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const waitPromise = dispatcher.awaitTerminal("job_done", 5000);
    const collector = dispatcher.collectLogs("job_done", 50, 10240);

    dispatcher.handleEvent(
      makeEvent({
        eventId: "evt_log_a",
        jobId: "job_done",
        type: "job.log_stream",
        status: "running",
        stream: "stdout",
        data: "hello\n",
      }),
    );
    dispatcher.handleEvent(
      makeEvent({
        eventId: "evt_log_b",
        jobId: "job_done",
        type: "job.log_stream",
        status: "running",
        stream: "stdout",
        data: "world\n",
      }),
    );
    dispatcher.handleEvent(
      makeEvent({
        eventId: "evt_terminal",
        jobId: "job_done",
        type: "job.completed",
        status: "completed",
        summary: "done",
      }),
    );

    await expect(waitPromise).resolves.toMatchObject({
      jobId: "job_done",
      type: "job.completed",
    });

    // 终态到达后，lines 应完整保留，digest 应已冻结为稳定的 hex 字符串。
    expect(collector.getLogs()).toEqual(["hello\n", "world\n"]);
    const digest = collector.getDigest();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    // 再次读取返回完全相同的 digest（证明已缓存 finalDigest，不再重算）。
    expect(collector.getDigest()).toBe(digest);

    collector.dispose();
  });

  it("dispose() releases lines while keeping a previously finalized digest readable", () => {
    const dispatcher = createBlueprintExecutorCallbackDispatcher();
    const collector = dispatcher.collectLogs("job_dispose", 50, 10240);

    dispatcher.handleEvent(
      makeEvent({
        eventId: "evt_dispose_1",
        jobId: "job_dispose",
        type: "job.log_stream",
        status: "running",
        stream: "stdout",
        data: "line-to-drop\n",
      }),
    );

    // 首次读取 digest 触发懒 finalize，之后 dispose 丢弃 lines。
    const digestBeforeDispose = collector.getDigest();
    expect(digestBeforeDispose).toMatch(/^[0-9a-f]{64}$/);

    collector.dispose();

    // 文档约定：dispose 后 getLogs 返回空快照，digest 仍可读。
    expect(collector.getLogs()).toEqual([]);
    expect(collector.getDigest()).toBe(digestBeforeDispose);
  });
});
