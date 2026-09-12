// @vitest-environment jsdom
/** Actual HTTP consumer + React effects + iframe attributes. A successful GET is
 * deliberately insufficient to open generated code: a click grants one ticket.
 * Exercise denial, late replies, revocation and unmount through the same path.
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import {
  isolatedPreviewUrl,
  type ProjectPreviewSnapshot,
  type ProjectPreviewTicket,
} from "../project-runtime/project-preview-client";

let root: Root;
let container: HTMLDivElement;
let snapshot: ProjectPreviewSnapshot;
let ticket: ProjectPreviewTicket;
let fetcher: ReturnType<typeof vi.fn>;

function ready(
  projectId = "project-one",
  revision = "revision-one"
): ProjectPreviewSnapshot {
  return {
    operationId: "operation-one",
    available: true,
    reason: null,
    descriptor: {
      kind: "project",
      projectId,
      runtimeId: "runtime-one",
      revision,
      status: "ready",
      entryUrl: null,
      expiresAt: null,
      capabilities: [],
    },
  };
}
async function render(
  projectId = "project-one",
  projectRevision = "revision-one"
) {
  await act(async () => {
    root.render(
      <SandboxPreviewSurface
        projectId={projectId}
        projectRevision={projectRevision}
        appTitle="任务管理"
      />
    );
  });
}
const frame = () => container.querySelector("iframe");
const openButton = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="project-preview-open"]'
  )!;
async function click(button = openButton()) {
  await act(async () => {
    button.click();
  });
}
async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
}
const posts = () =>
  fetcher.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  snapshot = ready();
  ticket = {
    entryUrl: "https://preview.example/entry?ticket=one-use",
    ticketExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    accessExpiresAt: new Date(Date.now() + 300_000).toISOString(),
  };
  fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
    Response.json(init?.method === "POST" ? ticket : snapshot)
  );
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

describe("authorized project preview", () => {
  it("development loopback remains isolated while production host cookies cannot cross preview ports", () => {
    expect(
      isolatedPreviewUrl(
        "http://runtime-one.localhost:3100/entry",
        "http://localhost:3000/"
      )
    ).toBe("http://runtime-one.localhost:3100/entry");
    expect(() =>
      isolatedPreviewUrl(
        "https://workbench.example:444/entry",
        "https://workbench.example/"
      )
    ).toThrow("独立来源要求");
    expect(() =>
      isolatedPreviewUrl(
        "http://localhost:3100/entry",
        "https://workbench.example/"
      )
    ).toThrow("独立来源要求");
  });
  it("reload and polling read status only; one click obtains one isolated iframe ticket", async () => {
    await render();
    expect(container.textContent).toContain("预览就绪");
    expect(frame()).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/sliderule/projects/project-one/preview",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        cache: "no-store",
      })
    );
    await poll();
    expect(posts()).toHaveLength(0);
    await click();
    expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe(
      "/api/sliderule/project-operations/operation-one/preview-ticket"
    );
    expect(frame()?.getAttribute("src")).toBe(ticket.entryUrl);
    expect(frame()?.hasAttribute("srcdoc")).toBe(false);
    expect(frame()?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame()?.getAttribute("sandbox")).not.toContain(
      "allow-top-navigation"
    );
    expect(frame()?.getAttribute("referrerpolicy")).toBe("no-referrer");
    await poll();
    expect(posts()).toHaveLength(1);
    ticket.entryUrl = "https://preview.example/entry?ticket=fresh";
    await click();
    expect(posts()).toHaveLength(2);
    expect(frame()?.getAttribute("src")).toBe(ticket.entryUrl);
    expect(
      fetcher.mock.calls.every(([url]) => !String(url).includes("/start"))
    ).toBe(true);
    expect(localStorage.getItem("project-one")).toBeNull();
  });

  it.each([
    ["failed", "应用运行失败"],
    ["expired", "运行环境已过期"],
    ["stopped", "应用已停止"],
    ["reconciling", "正在核对运行状态"],
  ] as const)(
    "%s remains a real unavailable state without requesting a ticket",
    async (status, label) => {
      snapshot.descriptor!.status = status;
      await render();
      expect(container.textContent).toContain(label);
      expect(openButton().disabled).toBe(true);
      expect(frame()).toBeNull();
      await click();
      expect(posts()).toHaveLength(0);
    }
  );

  it("missing private preview infrastructure never claims the ready runtime is openable", async () => {
    snapshot.available = false;
    snapshot.reason = "preview_gateway_not_configured";
    await render();
    expect(container.textContent).toContain("尚未提供可用的私有预览");
    expect(openButton().disabled).toBe(true);
    expect(frame()).toBeNull();
  });

  it("a missing project reference cannot fall through to another artifact or fetch an undefined project", async () => {
    await render("");
    expect(container.textContent).toContain("缺少工程引用");
    expect(fetcher).not.toHaveBeenCalled();
    expect(frame()).toBeNull();
  });

  it.each([401, 403, 404, 503])(
    "HTTP %s refuses preview and does not display unsafe provider errors",
    async status => {
      fetcher.mockResolvedValue(new Response("provider-secret", { status }));
      await render();
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
      expect(container.textContent).not.toContain("provider-secret");
      expect(openButton().disabled).toBe(true);
      expect(frame()).toBeNull();
      expect(posts()).toHaveLength(0);
    }
  );

  it.each([
    () => window.location.origin + "/generated-app",
    () => "http://preview.example/app",
    () => "javascript:alert(1)",
    () => "https://user:secret@preview.example/app",
  ])("refuses a ticket URL outside the isolated origin contract", async url => {
    ticket.entryUrl = url();
    await render();
    await click();
    expect(frame()).toBeNull();
    expect(container.textContent).toContain("独立来源要求");
    expect(container.textContent).not.toContain(ticket.entryUrl);
  });

  it("a stale source revision cannot open the previous running version", async () => {
    await render("project-one", "revision-new");
    expect(container.textContent).toContain("运行版本与当前工程不同");
    expect(openButton().disabled).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it("an unrelated project in the response cannot supply a preview", async () => {
    snapshot = ready("another-project");
    await render();
    expect(container.textContent).toContain("状态不完整");
    expect(frame()).toBeNull();
  });

  it("a new runtime or revoked authorization removes an already open iframe", async () => {
    await render();
    await click();
    expect(frame()).not.toBeNull();
    snapshot.descriptor!.runtimeId = "runtime-rebuilt";
    await poll();
    expect(frame()).toBeNull();
    await click();
    expect(frame()).not.toBeNull();
    snapshot.available = false;
    await poll();
    expect(frame()).toBeNull();
  });

  it("ticket exchange expiry does not unmount the iframe before the browser access deadline", async () => {
    await render();
    await click();
    const mounted = frame();
    expect(mounted).not.toBeNull();
    // No synthetic iframe load event is dispatched. The host owns a maximum
    // access deadline; only the relay can decide whether exchange succeeded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(frame()).toBe(mounted);
    expect(posts()).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(239_998);
    });
    expect(frame()).toBe(mounted);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(frame()).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("the browser access deadline removes the iframe without silently extending access", async () => {
    ticket.ticketExpiresAt = new Date(Date.now() + 500).toISOString();
    ticket.accessExpiresAt = new Date(Date.now() + 1000).toISOString();
    await render();
    await click();
    expect(frame()).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain("授权已过期");
    expect(posts()).toHaveLength(1);
  });

  it.each(["expired-ticket", "missing-access-expiry", "invalid-access-expiry", "access-before-ticket"])(
    "%s cannot mount an iframe even if the other deadline is in the future", async invalid => {
      if (invalid === "expired-ticket") ticket.ticketExpiresAt = new Date(Date.now() - 1).toISOString();
      if (invalid === "missing-access-expiry") delete (ticket as Partial<ProjectPreviewTicket>).accessExpiresAt;
      if (invalid === "invalid-access-expiry") ticket.accessExpiresAt = "invalid";
      if (invalid === "access-before-ticket") ticket.accessExpiresAt = new Date(Date.now() + 1000).toISOString();
      await render();
      await click();
      expect(frame()).toBeNull();
      expect(container.textContent).toContain("授权已过期");
    }
  );

  it("a late ticket from the previous project cannot mount after switching projects", async () => {
    let release!: (response: Response) => void;
    await render();
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          release = resolve;
        })
    );
    await click();
    snapshot = ready("project-two", "revision-two");
    await render("project-two", "revision-two");
    await act(async () => {
      release(Response.json(ticket));
    });
    expect(frame()).toBeNull();
    expect(container.querySelector("section")?.dataset.projectId).toBe(
      "project-two"
    );
    expect(posts()).toHaveLength(1);
  });

  it("unmount aborts observation without cancelling or touching the remote application", async () => {
    await render();
    const count = fetcher.mock.calls.length;
    await act(async () => root.render(null));
    await poll();
    expect(fetcher).toHaveBeenCalledTimes(count);
    expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(
      true
    );
  });
});
