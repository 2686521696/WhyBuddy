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
  projectRevision = "revision-one",
  revisionMode: "current" | "pinned" = "pinned"
) {
  await act(async () => {
    root.render(
      <SandboxPreviewSurface
        projectId={projectId}
        projectRevision={projectRevision}
        revisionMode={revisionMode}
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
    projectId: "project-one",
    operationId: "operation-one",
    runtimeId: "runtime-one",
    revision: "revision-one",
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
    expect(container.textContent).toContain("获取本次访问授权");
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
    ["provisioning", "正在准备运行环境"],
    ["installing", "正在安装依赖"],
    ["starting", "正在启动应用"],
    ["failed", "应用运行失败"],
    ["expired", "运行环境已过期"],
    ["stopped", "应用已停止"],
    ["reconciling", "正在核对运行状态"],
  ] as const)(
    "%s remains a real unavailable state without requesting a ticket",
    async (status, label) => {
      snapshot.descriptor!.status = status;
      snapshot.available = false;
      await render();
      expect(container.textContent).toContain(label);
      expect(container.textContent).not.toContain("当前环境尚未提供");
      expect(container.textContent).not.toContain("尚未配置");
      expect(openButton().disabled).toBe(true);
      expect(frame()).toBeNull();
      await click();
      expect(posts()).toHaveLength(0);
    }
  );

  it("missing private preview infrastructure never claims the ready runtime is openable", async () => {
    snapshot.available = false;
    snapshot.reason = "project_preview_gateway_not_configured";
    await render();
    expect(container.textContent).toContain("工程预览网关尚未配置");
    expect(openButton().disabled).toBe(true);
    expect(frame()).toBeNull();
  });

  it("explains an unstarted runtime without inventing missing infrastructure", async () => {
    snapshot = {
      operationId: null,
      descriptor: null,
      available: false,
      reason: "project_runtime_not_started",
    };
    await render();
    expect(container.textContent).toContain("工程还没有启动运行实例");
    expect(container.textContent).not.toContain("尚未配置");
    expect(container.textContent).not.toContain("当前环境尚未提供");
    expect(openButton().disabled).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it("uses the server's pending-runtime reason while the application is starting", async () => {
    snapshot.descriptor!.status = "starting";
    snapshot.available = false;
    snapshot.reason = "project_runtime_not_ready";
    await render();
    expect(container.textContent).toContain("等待启动完成");
    expect(container.textContent).not.toContain("尚未配置");
    expect(container.textContent).not.toContain("当前环境尚未提供");
    expect(openButton().disabled).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it.each(["unstarted", "starting"] as const)(
    "shows missing preview configuration before %s can be mistaken for preview readiness",
    async phase => {
      snapshot.available = false;
      snapshot.reason = "project_preview_not_configured";
      if (phase === "unstarted") {
        snapshot.operationId = null;
        snapshot.descriptor = null;
      } else {
        snapshot.descriptor!.status = "starting";
      }
      await render();
      expect(container.textContent).toContain(
        phase === "unstarted" ? "工程尚未启动" : "正在启动应用"
      );
      expect(container.textContent).toContain("尚未配置独立预览域名");
      expect(container.textContent).not.toContain("系统会在沙盒准备好后提供预览");
      expect(openButton().disabled).toBe(true);
      await click();
      expect(frame()).toBeNull();
      expect(posts()).toHaveLength(0);
    }
  );

  it("shows the rollout gate and its actionable reason when project mode is disabled", async () => {
    // ⚠ 2026-09-14 判据改了钉法：原来钉的是
    //   `[data-testid="project-preview-blocked-reason"]` 这个**元素**在。
    //   真机量出来那条告警条占 65px，而它说的话跟下面占位区一字不差——
    //   一屏 9% 的竖直空间花在说第二遍，所以预览没打开时不再画它。
    //   判据要钉的是**意图**「理由看得见、能照着做」，不是它挂在哪个盒子里。
    snapshot.available = false;
    snapshot.reason = "project_rollout_disabled";
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("WHYBUDDY_PROJECT_ROLLOUT=disabled");
    expect(text).toContain("开启工程 rollout");
    expect(openButton().disabled).toBe(true);
    // 反向：同一句话只许出现一次。把去重那一支改回去就红——这条才是这次改动的判据。
    expect(text.split("WHYBUDDY_PROJECT_ROLLOUT=disabled")).toHaveLength(2);
  });

  it("占位区说的是别的事时，告警条必须还在（去重不许去到一次都不剩）", async () => {
    // ⚠ 这条判据第一版写的是「预览打开着 + 有 blockedReason」——那个状态
    //   **在真机上不存在**：routes/project_preview.py 里 `reason = None if
    //   available else ...`，available 为真时 reason 必为空；而 available 为假时
    //   useProjectPreview 的 usable() 会把 ticket 丢掉，entryUrl 也就没了。
    //   照那个前提写的判据只能证明「我拼的输入满足我的条件」（§一之二）。
    //
    //   真正还留给告警条的那一支是 **mismatch**：钉住的版本和跑着的版本不一样时，
    //   占位区说的是「当前运行的是另一份源码版本」，跟 blockedReason 是两件事，
    //   这时候把告警条去掉就真丢信息了。
    snapshot.available = false;
    snapshot.reason = "project_preview_not_configured";
    snapshot.descriptor!.revision = "revision-two";
    await render("project-one", "revision-one", "pinned");
    const text = container.textContent ?? "";
    expect(text).toContain("当前运行的是另一份源码版本");
    const blocked = container.querySelector(
      '[data-testid="project-preview-blocked-reason"]'
    );
    expect(blocked, "占位区说的是别的事，理由必须还有地方说").not.toBeNull();
    expect(blocked?.textContent).toContain("尚未配置独立预览域名");
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

  it("a current session follows a healthy source update while its session projection is still old", async () => {
    await render("project-one", "revision-one", "current");
    await click();
    expect(frame()).not.toBeNull();
    snapshot.available = false;
    snapshot.descriptor!.status = "syncing";
    await poll();
    expect(frame()).toBeNull();
    expect(openButton().disabled).toBe(true);
    snapshot = ready("project-one", "revision-two");
    ticket.revision = "revision-two";
    ticket.entryUrl = "https://preview.example/entry?ticket=version-two";
    await poll();
    expect(container.textContent).toContain("预览就绪");
    expect(openButton().disabled).toBe(false);
    expect(posts()).toHaveLength(1);
    await click();
    expect(frame()?.getAttribute("src")).toBe(ticket.entryUrl);
    const mounted = frame();
    await render("project-one", "revision-two", "current");
    expect(frame()).toBe(mounted);
    expect(posts()).toHaveLength(2);
  });

  it("a pinned historical source never silently follows a newer healthy runtime", async () => {
    await render();
    await click();
    snapshot = ready("project-one", "revision-two");
    await poll();
    expect(frame()).toBeNull();
    expect(openButton().disabled).toBe(true);
    expect(container.textContent).toContain("运行版本与当前工程不同");
    await click();
    expect(posts()).toHaveLength(1);
  });

  it.each(["projectId", "runtimeId", "revision", "operationId"] as const)(
    "a ticket for a changed %s cannot mount against an older observed snapshot",
    async field => {
      await render("project-one", "revision-one", "current");
      ticket[field] = "changed";
      await click();
      expect(frame()).toBeNull();
      expect(container.textContent).toContain("授权与当前工程版本不一致");
    }
  );

  it("a late ticket cannot reopen the prior revision after the current runtime advances", async () => {
    await render("project-one", "revision-one", "current");
    let release!: (response: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          release = resolve;
        })
    );
    await click();
    snapshot = ready("project-one", "revision-two");
    await poll();
    await act(async () => {
      release(Response.json(ticket));
    });
    expect(frame()).toBeNull();
    expect(openButton().disabled).toBe(false);
    ticket.revision = "revision-two";
    await click();
    expect(frame()).not.toBeNull();
  });

  it("switching a current session to a pinned artifact immediately clears its iframe", async () => {
    snapshot = ready("project-one", "revision-two");
    ticket.revision = "revision-two";
    await render("project-one", "revision-one", "current");
    await click();
    expect(frame()).not.toBeNull();
    await render("project-one", "revision-one", "pinned");
    expect(frame()).toBeNull();
    expect(openButton().disabled).toBe(true);
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
    ticket.runtimeId = "runtime-rebuilt";
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(frame()).toBeNull();
    expect(container.textContent).toContain("授权已过期");
    expect(posts()).toHaveLength(1);
  });

  it.each([
    "expired-ticket",
    "missing-access-expiry",
    "invalid-access-expiry",
    "access-before-ticket",
  ])(
    "%s cannot mount an iframe even if the other deadline is in the future",
    async invalid => {
      if (invalid === "expired-ticket")
        ticket.ticketExpiresAt = new Date(Date.now() - 1).toISOString();
      if (invalid === "missing-access-expiry")
        delete (ticket as Partial<ProjectPreviewTicket>).accessExpiresAt;
      if (invalid === "invalid-access-expiry")
        ticket.accessExpiresAt = "invalid";
      if (invalid === "access-before-ticket")
        ticket.accessExpiresAt = new Date(Date.now() + 1000).toISOString();
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
