import { afterEach, describe, expect, it, vi } from "vitest";

import { createSonnerToastRenderer, createToastQueue } from "../ToastQueue.js";

describe("ToastQueue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps only one visible toast and preempts by priority", () => {
    const queue = createToastQueue();

    queue.enqueue({
      key: "info-1",
      level: "info",
      message: "first info",
    });
    expect(queue.peekVisible()?.key).toBe("info-1");

    queue.enqueue({
      key: "warn-1",
      level: "warn",
      message: "warning",
    });
    expect(queue.peekVisible()?.key).toBe("warn-1");
    expect(queue.getPending().map(item => item.key)).toEqual(["info-1"]);

    queue.enqueue({
      key: "error-1",
      level: "error",
      message: "boom",
    });
    expect(queue.peekVisible()?.key).toBe("error-1");
    expect(queue.getPending().map(item => item.key)).toEqual(["warn-1", "info-1"]);
  });

  it("merges toasts by key without keeping historical duplicates", () => {
    const queue = createToastQueue();

    queue.enqueue({
      key: "save",
      level: "info",
      message: "saved once",
    });
    queue.enqueue({
      key: "save",
      level: "info",
      message: "saved again",
    });

    expect(queue.peekVisible()).toMatchObject({
      key: "save",
      level: "info",
      message: "saved again",
    });
    expect(queue.getPending()).toEqual([]);
  });

  it("reveals the next toast after dismissing the visible one", () => {
    const queue = createToastQueue();

    queue.enqueue({
      key: "first",
      level: "warn",
      message: "first",
    });
    queue.enqueue({
      key: "second",
      level: "info",
      message: "second",
    });

    expect(queue.peekVisible()?.key).toBe("first");
    queue.dismissVisible();
    expect(queue.peekVisible()?.key).toBe("second");
    queue.dismissVisible();
    expect(queue.peekVisible()).toBeNull();
    expect(queue.getPending()).toEqual([]);
  });

  it("keeps queue, merge, and priority semantics under reduced motion", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true })),
    });
    const queue = createToastQueue();

    queue.enqueue({
      key: "same",
      level: "info",
      message: "first",
    });
    queue.enqueue({
      key: "same",
      level: "info",
      message: "latest",
    });
    queue.enqueue({
      key: "error",
      level: "error",
      message: "important",
    });

    expect(queue.peekVisible()).toMatchObject({
      key: "error",
      level: "error",
      message: "important",
    });
    expect(queue.getPending()).toEqual([
      expect.objectContaining({
        key: "same",
        level: "info",
        message: "latest",
      }),
    ]);
  });

  it("routes visible toast rendering through sonner level APIs and dismisses the previous id", () => {
    const api = vi.fn(() => "default-id") as unknown as {
      (message: string): string;
      info: ReturnType<typeof vi.fn>;
      warning: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
      dismiss: ReturnType<typeof vi.fn>;
    };
    api.info = vi.fn(() => "info-id");
    api.warning = vi.fn(() => "warn-id");
    api.error = vi.fn(() => "error-id");
    api.dismiss = vi.fn();
    const renderer = createSonnerToastRenderer(api);

    expect(renderer.show({
      key: "info",
      level: "info",
      message: "Information",
      enqueuedAt: 1,
    })).toBe("info-id");
    expect(renderer.show({
      key: "warn",
      level: "warn",
      message: "Warning",
      enqueuedAt: 2,
    })).toBe("warn-id");
    expect(renderer.show({
      key: "error",
      level: "error",
      message: "Error",
      enqueuedAt: 3,
    })).toBe("error-id");

    renderer.dismiss("info-id");

    expect(api.info).toHaveBeenCalledWith("Information");
    expect(api.warning).toHaveBeenCalledWith("Warning");
    expect(api.error).toHaveBeenCalledWith("Error");
    expect(api.dismiss).toHaveBeenCalledWith("info-id");
  });
});
