import { describe, expect, it, vi } from "vitest";

import { BlueprintEventName } from "../../../shared/blueprint/events.js";
import type {
  BlueprintGenerationEvent,
  BlueprintGenerationJob,
} from "../../../shared/blueprint/index.js";
import { createMemoryBlueprintJobStore } from "../blueprint.js";

import {
  BlueprintEventBusInvalidEventTypeError,
  createBlueprintEventBus,
} from "./event-bus.js";

/**
 * `createBlueprintEventBus` 的 co-located 单测。
 *
 * 覆盖：
 * 1. 非 `BlueprintEventName` 的字面量被拒绝（运行期 guard）；
 * 2. `emit` 按 "先写 jobStore 再 fan-out" 顺序；
 * 3. 订阅者抛错不阻塞其它订阅者；
 * 4. 事件目标 job 不存在时，仍然 fan-out 给订阅者，但不落盘；
 * 5. `unsubscribe` 后不再收到事件。
 *
 * 所有断言都是 example-based。
 */

function makeJob(id: string): BlueprintGenerationJob {
  return {
    id,
    request: {},
    status: "pending",
    stage: "input",
    version: "v1",
    createdAt: "2026-05-07T00:00:00.000Z",
    updatedAt: "2026-05-07T00:00:00.000Z",
    artifacts: [],
    events: [],
  };
}

function makeEvent(
  overrides: Partial<BlueprintGenerationEvent> = {}
): BlueprintGenerationEvent {
  return {
    id: overrides.id ?? "evt-1",
    jobId: overrides.jobId ?? "job-1",
    type: overrides.type ?? BlueprintEventName.JobCreated,
    family: overrides.family ?? "job",
    stage: overrides.stage ?? "input",
    status: overrides.status ?? "pending",
    message: overrides.message ?? "fixture event",
    occurredAt: overrides.occurredAt ?? "2026-05-07T01:00:00.000Z",
    ...overrides,
  };
}

describe("createBlueprintEventBus", () => {
  it("拒绝 BlueprintEventName 枚举之外的事件名", () => {
    const jobStore = createMemoryBlueprintJobStore([makeJob("job-1")]);
    const bus = createBlueprintEventBus(jobStore);

    const invalid = makeEvent({
      type: "blueprint.unknown" as unknown as BlueprintGenerationEvent["type"],
    });

    expect(() => bus.emit(invalid)).toThrowError(
      BlueprintEventBusInvalidEventTypeError
    );
  });

  it("emit 先写入 jobStore.events，再 fan-out 给订阅者", () => {
    const job = makeJob("job-1");
    const jobStore = createMemoryBlueprintJobStore([job]);
    const bus = createBlueprintEventBus(jobStore);

    const sawEventsAtFanOutTime: number[] = [];
    bus.subscribe(() => {
      sawEventsAtFanOutTime.push(jobStore.get("job-1")?.events.length ?? -1);
    });

    bus.emit(makeEvent({ id: "evt-1" }));

    expect(jobStore.get("job-1")?.events).toHaveLength(1);
    expect(sawEventsAtFanOutTime).toEqual([1]);
  });

  it("订阅者异常不阻塞其它订阅者，并通过 logger 记录", () => {
    const jobStore = createMemoryBlueprintJobStore([makeJob("job-1")]);
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const bus = createBlueprintEventBus(jobStore, logger);

    const received: string[] = [];
    bus.subscribe(() => {
      throw new Error("listener-1 boom");
    });
    bus.subscribe(event => {
      received.push(event.id);
    });

    bus.emit(makeEvent({ id: "evt-a" }));

    expect(received).toEqual(["evt-a"]);
    expect(logger.error).toHaveBeenCalledWith(
      "blueprint event bus listener threw",
      expect.objectContaining({ eventId: "evt-a" })
    );
  });

  it("目标 job 不存在时，不落盘但仍然 fan-out", () => {
    const jobStore = createMemoryBlueprintJobStore();
    const bus = createBlueprintEventBus(jobStore);

    const received: string[] = [];
    bus.subscribe(event => {
      received.push(event.id);
    });

    bus.emit(makeEvent({ id: "orphan" }));

    expect(received).toEqual(["orphan"]);
    expect(jobStore.list()).toEqual([]);
  });

  it("unsubscribe 后不再收到事件", () => {
    const jobStore = createMemoryBlueprintJobStore([makeJob("job-1")]);
    const bus = createBlueprintEventBus(jobStore);

    const received: string[] = [];
    const unsubscribe = bus.subscribe(event => {
      received.push(event.id);
    });

    bus.emit(makeEvent({ id: "first" }));
    unsubscribe();
    bus.emit(makeEvent({ id: "second" }));

    expect(received).toEqual(["first"]);
    expect(jobStore.get("job-1")?.events).toHaveLength(2);
  });
});
