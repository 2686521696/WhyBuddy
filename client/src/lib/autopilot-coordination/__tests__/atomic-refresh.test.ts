import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAtomicRefresh } from "../AtomicRefreshMediator.js";

describe("AtomicRefreshMediator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs apply synchronously and reports success", () => {
    const events: string[] = [];

    events.push("before");
    const result = runAtomicRefresh(() => {
      events.push("apply");
    });
    events.push("after");

    expect(events).toEqual(["before", "apply", "after"]);
    expect(result.ok).toBe(true);
  });

  it.each(["replan", "inline_edit", "switch_active"] as const)(
    "reports success for %s refresh triggers",
    triggerSource => {
      const result = runAtomicRefresh(() => "done", { triggerSource });

      expect(result).toMatchObject({
        ok: true,
        value: "done",
        triggerSource,
      });
    }
  );

  it("reports a structured rollback diagnostic when apply throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const longMessage = "x".repeat(240);

    const result = runAtomicRefresh(
      () => {
        throw new Error(longMessage);
      },
      {
        triggerSource: "replan",
        failedStore: "jobStore",
      }
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe(longMessage);
    expect(error).toHaveBeenCalledWith("coordination.batch_rolled_back", {
      event: "coordination.batch_rolled_back",
      triggerSource: "replan",
      failedStore: "jobStore",
      errorMessage: longMessage.slice(0, 200),
    });
  });

  it("rejects async apply callbacks before exposing a partial refresh", () => {
    const result = runAtomicRefresh(() => Promise.resolve("late"), {
      triggerSource: "inline_edit",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe(
      "Atomic refresh apply must complete synchronously"
    );
  });

  it("commits an arbitrary batch of writes once without intermediate snapshots", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { minLength: 1, maxLength: 10 }),
        writes => {
          const state: string[] = [];
          const commits: string[][] = [];

          const result = runAtomicRefresh(
            () => {
              for (const write of writes) state.push(write);
              return state.length;
            },
            {
              triggerSource: "switch_active",
              onCommit: () => commits.push([...state]),
            }
          );

          expect(result.ok).toBe(true);
          expect(result.value).toBe(writes.length);
          expect(commits).toEqual([writes]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("reports failure when apply throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = runAtomicRefresh(() => {
      throw new Error("refresh failed");
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toBe("refresh failed");
  });
});
