// @vitest-environment jsdom
/** Exercise the mounted HTTP consumer: a restored record never starts work,
 * a click dispatches one revision-bound child, and old replies cannot turn a
 * different project/revision green. No hook or client implementation is mocked.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VerificationSnapshot } from "@shared/project-runtime.generated";
import { ProjectVerificationPanel } from "../project-runtime/ProjectVerificationPanel";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import type { ProjectVerificationView } from "../project-runtime/project-verification-client";

let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
let view: ProjectVerificationView;
let preview: any;
const EMPTY: ProjectVerificationView = {
  operationId: null,
  operationStatus: null,
  snapshot: null,
};
const props = {
  projectId: "project-one",
  revision: "revision-one",
  runtimeOperationId: "runtime-op-one",
  runtimeId: "runtime-one",
  ready: true,
};

function evidence(
  status: "running" | "passed" | "failed" | "blocked" | "cancelled" = "passed",
  effectiveStatus: VerificationSnapshot["effectiveStatus"] = status
): ProjectVerificationView {
  return {
    operationId: "verification-op-one",
    operationStatus: status === "running" ? "running" : "completed",
    snapshot: {
      effectiveStatus,
      deliveryEligible: false,
      verification: {
        verificationId: "verification-one",
        operationId: "verification-op-one",
        projectId: "project-one",
        runtimeOperationId: "runtime-op-one",
        runtimeId: "runtime-one",
        revision: "revision-one",
        treeHash: "tree-one",
        specRevision: null,
        planRef: "plan-one",
        suiteVersion: "react-vite-counter@1",
        status,
        createdAt: "2026-09-13T02:00:00Z",
        startedAt: "2026-09-13T02:00:00Z",
        completedAt: status === "running" ? null : "2026-09-13T02:00:10Z",
        assertions:
          status === "blocked"
            ? []
            : [
                { id: "heading_visible", status: "passed" },
                {
                  id: "counter_increment",
                  status: status === "failed" ? "failed" : "passed",
                },
              ],
        artifactRefs: [],
        errorCode:
          status === "blocked"
            ? "project_browser_not_configured"
            : status === "failed"
              ? "project_browser_assertion_failed"
              : null,
      },
    },
  };
}
const response = (data: unknown) => Response.json(data);
const start = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="project-verification-start"]'
  )!;
const status = () =>
  container.querySelector('[data-testid="project-verification-status"]')
    ?.textContent;
const posts = () =>
  fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
async function render(overrides: Partial<typeof props> = {}) {
  await act(async () =>
    root.render(<ProjectVerificationPanel {...props} {...overrides} />)
  );
}
async function click(button = start()) {
  await act(async () => button.click());
}
async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  view = { ...EMPTY };
  preview = {
    operationId: "runtime-op-one",
    available: true,
    reason: null,
    descriptor: {
      kind: "project",
      projectId: "project-one",
      runtimeId: "runtime-one",
      revision: "revision-one",
      status: "ready",
      expiresAt: null,
      capabilities: [],
    },
  };
  fetcher = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/preview")) return response(preview);
    if (url.endsWith("/verification")) return response(view);
    if (url.endsWith("/verify")) {
      view = {
        operationId: "verification-op-one",
        operationStatus: "queued",
        snapshot: null,
      };
      return response({ operationId: "verification-op-one", status: "queued" });
    }
    if (url.endsWith("/cancel")) {
      view = {
        operationId: "verification-op-one",
        operationStatus: "cancelling",
        snapshot: null,
      };
      return response({});
    }
    throw new Error(`Unexpected fixture request: ${init.method} ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("project browser verification consumer", () => {
  it("an explicit click starts one revision-bound check; polling displays the persisted result", async () => {
    await render();
    expect(status()).toBe("尚未检查");
    await poll();
    expect(posts()).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/sliderule/projects/project-one/verification",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        method: "GET",
      })
    );
    await click();
    await click();
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe(
      "/api/sliderule/project-operations/runtime-op-one/verify"
    );
    expect(JSON.parse(posts()[0][1].body)).toEqual({
      expectedRevision: "revision-one",
      idempotencyKey: expect.stringMatching(/^browser-check:/),
    });
    expect(status()).toBe("已排队");
    expect(start().disabled).toBe(true);
    view = evidence("running");
    await poll();
    expect(status()).toBe("检查中");
    view = evidence();
    await poll();
    expect(status()).toBe("页面检查通过");
    expect(container.textContent).toContain("首次点击更新计数：通过");
    expect(container.textContent).toContain(
      "业务功能、数据持久化和角色权限仍需另行验收"
    );
    expect(container.textContent).not.toContain("业务验收通过");
    expect(posts()).toHaveLength(1);
  });

  it("refresh restores evidence without dispatching another verification or touching runtime", async () => {
    view = evidence();
    await render();
    expect(status()).toBe("页面检查通过");
    await act(async () => root.render(null));
    await render();
    expect(status()).toBe("页面检查通过");
    expect(posts()).toHaveLength(0);
  });

  it.each([
    { ready: false },
    { runtimeOperationId: "" },
    { runtimeId: "" },
    { revision: "" },
  ])(
    "cannot check before a ready version-bound runtime exists: %j",
    async overrides => {
      await render(overrides);
      expect(start().disabled).toBe(true);
      await click();
      expect(posts()).toHaveLength(0);
    }
  );

  it("the shared preview surface exposes checks and follows current source authority", async () => {
    await act(async () =>
      root.render(
        <SandboxPreviewSurface
          projectId="project-one"
          projectRevision="old-session-projection"
          revisionMode="current"
        />
      )
    );
    expect(
      container.querySelector('[data-testid="project-verification-panel"]')
    ).not.toBeNull();
    expect(start().disabled).toBe(false);
    await click();
    expect(JSON.parse(posts()[0][1].body).expectedRevision).toBe(
      "revision-one"
    );
  });

  it("the same surface refuses checking a pinned historical revision on a newer runtime", async () => {
    await act(async () =>
      root.render(
        <SandboxPreviewSurface
          projectId="project-one"
          projectRevision="historical-revision"
          revisionMode="pinned"
        />
      )
    );
    expect(start().disabled).toBe(true);
    await click();
    expect(posts()).toHaveLength(0);
  });

  it("server stale projection cannot be presented as current success", async () => {
    view = evidence("passed", "stale");
    await render();
    expect(status()).toBe("旧版本记录，需重新检查");
    expect(container.textContent).not.toContain("页面检查通过");
    expect(container.textContent).toContain("查看旧版本检查记录");
  });

  it.each(["revision", "runtimeId", "runtimeOperationId"] as const)(
    "a changed %s hides an old passed record even if the server projection has not caught up",
    async field => {
      view = evidence();
      await render();
      expect(status()).toBe("页面检查通过");
      await render({ [field]: "changed" });
      expect(status()).toBe("旧版本记录，需重新检查");
      expect(container.textContent).not.toContain("页面检查通过");
    }
  );

  it("missing browser capability remains blocked and does not invent assertions", async () => {
    view = evidence("blocked");
    await render();
    expect(status()).toBe("缺少检查条件");
    expect(container.textContent).toContain("尚未配置浏览器检查");
    expect(container.querySelector("details")).toBeNull();
    expect(container.textContent).not.toContain("页面检查通过");
  });

  it("an assertion failure shows only executed assertions and controlled errors", async () => {
    view = evidence("failed");
    (view.snapshot!.verification.assertions![1] as any).detail =
      "provider-secret and signed URL";
    await render();
    expect(status()).toBe("页面检查失败");
    expect(container.textContent).toContain("首次点击更新计数：失败");
    expect(container.textContent).toContain("页面标题可见：通过");
    expect(container.textContent).not.toContain("计数初始状态正确");
    expect(container.textContent).not.toContain("provider-secret");
  });

  it.each([401, 403, 404, 503])(
    "HTTP %s clears previous success without displaying upstream text",
    async code => {
      view = evidence();
      await render();
      fetcher.mockResolvedValue(
        new Response("provider-secret", { status: code })
      );
      await poll();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).not.toContain("provider-secret");
      expect(status()).not.toBe("页面检查通过");
      expect(start().disabled).toBe(true);
    }
  );

  it.each([
    "wrong-project",
    "missing-record",
    "false-delivery",
    "inconsistent-status",
    "empty-success",
    "contradictory-assertion",
  ])("invalid %s response cannot be displayed as success", async invalid => {
    view = evidence();
    if (invalid === "wrong-project")
      view.snapshot!.verification.projectId = "other-project";
    if (invalid === "missing-record")
      delete (view.snapshot as any).verification;
    if (invalid === "false-delivery")
      (view.snapshot as any).deliveryEligible = true;
    if (invalid === "inconsistent-status")
      view.snapshot!.verification.status = "blocked";
    if (invalid === "empty-success")
      view.snapshot!.verification.assertions = [];
    if (invalid === "contradictory-assertion")
      view.snapshot!.verification.assertions![0].status = "failed";
    await render();
    expect(container.textContent).toContain("检查状态不完整");
    expect(status()).not.toBe("页面检查通过");
    expect(start().disabled).toBe(true);
  });

  it("a delayed project response cannot overwrite the newly selected project's state", async () => {
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        })
    );
    await render();
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    await render({ projectId: "project-two", revision: "revision-two" });
    expect(signal.aborted).toBe(true);
    expect(status()).toBe("尚未检查");
    await act(async () => resolve(response(evidence())));
    expect(status()).toBe("尚未检查");
    expect(container.textContent).not.toContain("页面检查通过");
  });

  it("a delayed start response cannot occupy or overwrite another project's controls", async () => {
    await render();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        })
    );
    await click();
    await click();
    expect(posts()).toHaveLength(1);
    expect(start().disabled).toBe(true);
    await render({ projectId: "project-two", revision: "revision-two" });
    await act(async () =>
      resolve(response({ operationId: "old-check", status: "queued" }))
    );
    expect(status()).toBe("尚未检查");
    expect(start().disabled).toBe(false);
  });

  it("a delayed pre-admission read cannot erase a queued child", async () => {
    await render();
    let resolve!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>(done => {
          resolve = done;
        })
    );
    await poll();
    await click();
    await act(async () => resolve(response(EMPTY)));
    expect(status()).toBe("已排队");
    expect(start().disabled).toBe(true);
    expect(posts()).toHaveLength(1);
  });

  it("an unknown admission result retries with the same idempotency key and preserves its error message", async () => {
    await render();
    fetcher.mockRejectedValueOnce(new Error("provider-secret"));
    await click();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "暂时无法连接工程检查服务"
    );
    expect(container.textContent).not.toContain("provider-secret");
    expect(start().disabled).toBe(false);
    const firstKey = JSON.parse(posts()[0][1].body).idempotencyKey;
    await click();
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(posts()[1][1].body).idempotencyKey).toBe(firstKey);
    expect(status()).toBe("已排队");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("an already accepted job recovered after an unknown POST result prevents a duplicate retry", async () => {
    await render();
    fetcher.mockImplementationOnce(async () => {
      view = {
        operationId: "verification-op-one",
        operationStatus: "queued",
        snapshot: null,
      };
      throw new Error("response lost");
    });
    await click();
    expect(status()).toBe("已排队");
    expect(start().disabled).toBe(true);
    await click();
    expect(posts()).toHaveLength(1);
  });

  it("an idempotent admission can return an already completed job and restores its evidence", async () => {
    await render();
    fetcher.mockImplementationOnce(async () => {
      view = evidence();
      return response({
        operationId: "verification-op-one",
        status: "completed",
      });
    });
    await click();
    expect(status()).toBe("页面检查通过");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("a later check started in another workbench is observed instead of remaining stuck on the previous receipt", async () => {
    await render();
    fetcher.mockImplementationOnce(async () => {
      view = evidence();
      view.operationId = "verification-op-two";
      view.snapshot!.verification.operationId = "verification-op-two";
      view.snapshot!.verification.verificationId = "verification-two";
      return response({
        operationId: "verification-op-one",
        status: "completed",
      });
    });
    await click();
    expect(status()).toBe("页面检查通过");
    expect(start().disabled).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it("cancel addresses the verification child and never the application runtime", async () => {
    view = evidence("running");
    await render();
    await click(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="project-verification-cancel"]'
      )!
    );
    expect(posts()[0][0]).toBe(
      "/api/sliderule/project-operations/verification-op-one/cancel"
    );
    expect(status()).toBe("正在停止检查");
    view = evidence("cancelled");
    view.operationStatus = "cancelled";
    await poll();
    expect(status()).toBe("检查已取消");
    expect(posts()).toHaveLength(1);
  });

  it("unmount aborts observation without sending cancellation or restarting work", async () => {
    view = evidence("running");
    await render();
    const count = fetcher.mock.calls.length;
    await act(async () => root.render(null));
    await poll();
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(posts()).toHaveLength(0);
  });
});
