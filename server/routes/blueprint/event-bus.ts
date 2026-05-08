/**
 * `createBlueprintEventBus`：蓝图栈统一事件总线实现。
 *
 * 核心约束（对应 `.kiro/specs/autopilot-blueprint-refactor-split`）：
 * - 需求 5.1：事件名必须来自 `BlueprintEventName` 常量，不允许裸字符串。
 * - 需求 5.2：事件目录只在 `shared/blueprint/events.ts` 单一来源。
 * - 需求 5.3：Artifact Replay 只从本总线消费。
 * - 需求 3.1 / 3.5：事件发出后必须立刻对 `jobStore.listEvents(jobId)` 可见，
 *   即 `emit -> jobStore.save(updatedJob)` 顺序写入、同步可观察。
 *
 * 行为：
 * 1. `emit` 先运行事件名校验（非 `BlueprintEventName` 枚举直接抛错）；
 * 2. 如果 `jobStore.get(event.jobId)` 存在，把事件 append 到 `job.events` 并调用 `jobStore.save(updatedJob)`；
 * 3. 同步通知所有订阅者（订阅者抛出异常不会阻塞其它订阅者，但会通过 logger 记录）；
 * 4. 事件写入 `jobStore` 与通知订阅者之间严格顺序：先写 store，再 fan-out。
 */

import type {
  BlueprintGenerationEvent,
  BlueprintGenerationEventType,
} from "../../../shared/blueprint/index.js";
import { BlueprintEventName } from "../../../shared/blueprint/events.js";
import type { BlueprintJobStore } from "../blueprint.js";

import type {
  BlueprintEventBus,
  BlueprintLogger,
} from "./context.js";

/**
 * `BlueprintEventName` 常量所允许的全部事件字符串。
 *
 * 通过 `new Set(Object.values(BlueprintEventName))` 在模块加载时固化一次；
 * 不随运行期变化，避免每次 `emit` 都重算。
 */
const ALLOWED_EVENT_TYPES: ReadonlySet<BlueprintGenerationEventType> = new Set(
  Object.values(BlueprintEventName) as BlueprintGenerationEventType[]
);

export class BlueprintEventBusInvalidEventTypeError extends Error {
  readonly actualType: string;

  constructor(actualType: string) {
    super(
      `Blueprint event type "${actualType}" is not declared in BlueprintEventName. ` +
        `Add it to shared/blueprint/events.ts or use an existing constant.`
    );
    this.name = "BlueprintEventBusInvalidEventTypeError";
    this.actualType = actualType;
  }
}

/**
 * 创建事件总线。
 *
 * @param jobStore 落盘存储；事件将被 append 到 `job.events` 并 `save`。
 * @param logger 可选 logger，仅用于订阅者抛错时记录；默认静默。
 */
export function createBlueprintEventBus(
  jobStore: BlueprintJobStore,
  logger?: BlueprintLogger
): BlueprintEventBus {
  const listeners = new Set<(event: BlueprintGenerationEvent) => void>();

  function persistToJobStore(event: BlueprintGenerationEvent): void {
    const job = jobStore.get(event.jobId);
    if (!job) return;
    const updated = {
      ...job,
      events: [...job.events, event],
      updatedAt: event.occurredAt || job.updatedAt,
    };
    jobStore.save(updated);
  }

  function fanOut(event: BlueprintGenerationEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger?.error("blueprint event bus listener threw", {
          eventId: event.id,
          eventType: event.type,
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : { message: String(error) },
        });
      }
    }
  }

  return {
    emit(event) {
      if (!ALLOWED_EVENT_TYPES.has(event.type)) {
        throw new BlueprintEventBusInvalidEventTypeError(event.type);
      }
      persistToJobStore(event);
      fanOut(event);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
