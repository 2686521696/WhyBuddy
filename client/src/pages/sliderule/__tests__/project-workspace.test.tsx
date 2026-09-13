// @vitest-environment jsdom
/** Real mounted workspace and HTTP consumers: a draft is not a committed version. */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkspacePanel } from "../project-runtime/ProjectWorkspacePanel";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { ProjectEvidenceImages } from "../project-runtime/ProjectEvidenceImages";
import { ProjectDataPanel } from "../project-runtime/ProjectDataPanel";
import { connectPreviewSelection } from "../project-runtime/preview-selection-bridge";
import { installPreviewSelectionBridge } from "@shared/project-preview-selection.mjs";
import type { VerificationRecord } from "@shared/project-runtime.generated";

let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
let source: any;
let contents: Record<string, string>;
let commandResult: any;
let commandStatus: number;
const props = {
  projectId: "p1",
  revisionMode: "current" as const,
  tab: "source" as const,
  selection: null,
  onChanged: vi.fn(),
};
const response = (body: unknown, status = 200) =>
  Response.json(body, { status });
const flush = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};
async function render(overrides = {}) {
  await act(async () =>
    root.render(<ProjectWorkspacePanel {...props} {...overrides} />)
  );
  await flush();
}
const buttons = (text: string) =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].filter(
    button => button.textContent?.trim() === text
  );
const button = (text: string) => {
  const found = buttons(text)[0];
  expect(found, text).toBeTruthy();
  return found;
};
async function click(text: string) {
  await act(async () => button(text).click());
  await flush();
}
const editor = () => container.querySelector<HTMLTextAreaElement>("textarea")!;
async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    )!.set!.call(editor(), value);
    editor().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const posts = () =>
  fetcher.mock.calls.filter(([, init]) => init?.method === "POST");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  source = {
    projectId: "p1",
    revision: "r1",
    currentRevision: "r1",
    files: [{ path: "src/main.tsx", sha256: "hash1", sizeBytes: 14 }],
  };
  contents = { "src/main.tsx": "first\nsecond\nthird" };
  commandResult = {
    projectId: "p1",
    revision: "r2",
    operationId: null,
    status: "completed",
  };
  commandStatus = 200;
  fetcher = vi.fn(async (path: string, init?: RequestInit) => {
    const url = new URL(path, "http://localhost");
    if (url.pathname.endsWith("/preview"))
      return response({
        operationId: null,
        descriptor: null,
        available: false,
        reason: null,
      });
    if (url.pathname.endsWith("/verification"))
      return response({
        operationId: null,
        operationStatus: null,
        snapshot: null,
      });
    if (url.pathname.endsWith("/source/file"))
      return response({
        projectId: source.projectId,
        revision: source.revision,
        path: url.searchParams.get("path"),
        sha256: source.files[0].sha256,
        content: contents[url.searchParams.get("path")!],
      });
    if (url.pathname.endsWith("/source")) return response(source);
    if (url.pathname.endsWith("/revisions"))
      return response({
        projectId: "p1",
        currentRevision: "r1",
        nextCursor: null,
        revisions: [
          {
            revision: "r1",
            parentRevision: "r0",
            treeHash: "tree1",
            templateVersion: "react@1",
            createdAt: "2026-09-13",
          },
          {
            revision: "r0",
            parentRevision: null,
            treeHash: "tree0",
            templateVersion: "react@1",
            createdAt: "2026-09-12",
          },
        ],
      });
    if (url.pathname.endsWith("/fork"))
      return response({ projectId: "p2", sessionId: "s2", revision: "r-new" });
    if (url.pathname.endsWith("/export"))
      return new Response(new Uint8Array([80, 75, 3, 4]), {
        headers: { "Content-Type": "application/zip" },
      });
    if (init?.method === "POST") return response(commandResult, commandStatus);
    throw new Error("Unexpected fixture route: " + url.pathname);
  });
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:fixture"),
      revokeObjectURL: vi.fn(),
    })
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("source and history through real HTTP consumers", () => {
  it.each(["versions", "empty", "failed"])(
    "shows pending history separately from its %s result",
    async outcome => {
      const original = fetcher.getMockImplementation()!;
      let resolveHistory!: (value: Response) => void;
      const pending = new Promise<Response>(resolve => {
        resolveHistory = resolve;
      });
      fetcher.mockImplementation(async (...args) =>
        new URL(String(args[0]), "http://localhost").pathname.endsWith(
          "/revisions"
        )
          ? pending
          : original(...args)
      );
      await render({ tab: "history" });
      // The separate source index has already loaded. History still needs its
      // own pending state, and an unresolved request is never an empty result.
      expect(container.textContent).toContain("源码版本 r1");
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "正在读取版本记录"
      );
      expect(container.textContent).not.toContain("暂无已保存的源码版本");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      await act(async () =>
        resolveHistory(
          outcome === "failed"
            ? response({ detail: "unavailable" }, 503)
            : outcome === "empty"
              ? response({
                  projectId: "p1",
                  currentRevision: "r1",
                  revisions: [],
                  nextCursor: null,
                })
              : await original("/api/sliderule/projects/p1/revisions")
        )
      );
      await flush();
      expect(container.textContent).not.toContain("正在读取版本记录");
      if (outcome === "failed") {
        expect(
          container.querySelector('[role="alert"]')?.textContent
        ).toContain("版本记录读取失败");
        expect(container.textContent).not.toContain("暂无已保存的源码版本");
        fetcher.mockImplementation(original);
        await click("读取最新版");
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(buttons("恢复此版本")).toHaveLength(2);
      } else if (outcome === "empty") {
        expect(container.textContent).toContain("暂无已保存的源码版本");
        expect(container.querySelector('[role="alert"]')).toBeNull();
      } else expect(buttons("恢复此版本")).toHaveLength(2);
      expect(posts()).toHaveLength(0);
    }
  );

  it("rejects malformed preview capabilities before any component uses them", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (...args) =>
      String(args[0]).endsWith("/preview")
        ? response({
            operationId: "runtime-parent",
            available: true,
            reason: null,
            descriptor: {
              kind: "project",
              projectId: "p1",
              runtimeId: "runtime1",
              revision: "r1",
              status: "ready",
              capabilities: "not-an-array",
            },
          })
        : original(...args)
    );
    await act(async () =>
      root.render(
        <SandboxPreviewSurface projectId="p1" revisionMode="current" />
      )
    );
    expect(container.textContent).toContain("工程预览状态不完整");
    expect(posts()).toHaveLength(0);
  });
  it("stops the parent runtime through its API and waits for authoritative stopped state", async () => {
    let stopped = false;
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (...args) => {
      if (String(args[0]).endsWith("/preview"))
        return response({
          operationId: "runtime-parent",
          available: true,
          reason: null,
          descriptor: {
            kind: "project",
            projectId: "p1",
            runtimeId: "runtime1",
            revision: "r1",
            status: stopped ? "stopped" : "ready",
          },
        });
      return original(...args);
    });
    await act(async () =>
      root.render(
        <SandboxPreviewSurface projectId="p1" revisionMode="current" />
      )
    );
    await click("停止应用");
    expect(posts()[0][0]).toBe(
      "/api/sliderule/project-operations/runtime-parent/cancel"
    );
    expect(container.textContent).not.toContain("应用已停止");
    stopped = true;
    await click("更新状态");
    expect(container.textContent).toContain("应用已停止");
  });
  it("opens the same source workspace from the shared preview without starting runtime", async () => {
    await act(async () =>
      root.render(
        <SandboxPreviewSurface projectId="p1" revisionMode="current" />
      )
    );
    expect(
      fetcher.mock.calls.some(([url]) => String(url).endsWith("/source"))
    ).toBe(false);
    await click("源码");
    expect(editor().value).toBe(contents["src/main.tsx"]);
    expect(posts()).toHaveLength(0);
  });
  it("saves an actual draft with revision and file hash then observes server source", async () => {
    await render();
    await edit("changed");
    expect(button("保存源码").disabled).toBe(false);
    await click("保存源码");
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({
      expectedRevision: "r1",
      changes: [
        { path: "src/main.tsx", expectedSha256: "hash1", content: "changed" },
      ],
    });
    expect(String(posts()[0][0]).endsWith("/projects/p1/source/patch")).toBe(
      true
    );
    expect(props.onChanged).toHaveBeenCalled();
  });
  it("preserves conflicting draft and requires explicit merge against freshly read source", async () => {
    await render();
    await edit("my change");
    commandStatus = 409;
    commandResult = { detail: "revision_conflict" };
    await click("保存源码");
    expect(editor().value).toBe("my change");
    expect(button("保存源码").disabled).toBe(true);
    source = {
      ...source,
      revision: "r2",
      currentRevision: "r2",
      files: [{ ...source.files[0], sha256: "hash2" }],
    };
    contents["src/main.tsx"] = "their change";
    await click("读取最新版");
    expect(editor().value).toBe("my change");
    expect(container.textContent).toContain("their change");
    expect(button("保存源码").disabled).toBe(true);
    await click("已核对差异，以最新版为保存基础");
    commandStatus = 200;
    commandResult = {
      projectId: "p1",
      revision: "r3",
      operationId: null,
      status: "completed",
    };
    await click("保存源码");
    expect(JSON.parse(posts()[1][1].body)).toMatchObject({
      expectedRevision: "r2",
      changes: [{ expectedSha256: "hash2", content: "my change" }],
    });
  });
  it("preserves an unknown submission idempotency key on retry", async () => {
    await render();
    await edit("draft");
    const original = fetcher.getMockImplementation()!;
    let failed = false;
    fetcher.mockImplementation(async (...args) => {
      if (args[1]?.method === "POST" && !failed) {
        failed = true;
        throw new TypeError("offline");
      }
      return original(...args);
    });
    await click("保存源码");
    expect(editor().value).toBe("draft");
    await click("保存源码");
    const [first, second] = posts().map(([, init]) => JSON.parse(init.body));
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });
  it("shows queued patch as pending and polls the actual child before confirming", async () => {
    await render();
    await edit("draft");
    commandResult = {
      projectId: "p1",
      revision: null,
      operationId: "child",
      status: "queued",
    };
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (...args) =>
      String(args[0]).endsWith("/project-operations/child")
        ? response({
            operation: {
              operationId: "child",
              projectId: "p1",
              status: "completed",
            },
          })
        : original(...args)
    );
    await click("保存源码");
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).endsWith("/project-operations/child")
      )
    ).toBe(true);
    expect(container.textContent).toContain("源码版本已保存");
  });
  it("rejects a wrong project file response and never enables source writes", async () => {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (...args) =>
      String(args[0]).includes("/source/file?")
        ? response({
            projectId: "other",
            revision: "r1",
            path: "src/main.tsx",
            sha256: "hash",
            content: "foreign",
          })
        : original(...args)
    );
    await render();
    expect(editor()).toBeNull();
    expect(container.textContent).not.toContain("foreign");
    expect(posts()).toHaveLength(0);
  });
  it("never leaks an old project draft after project switch", async () => {
    await render();
    await edit("private old draft");
    source = { ...source, projectId: "p2" };
    contents["src/main.tsx"] = "new project";
    await render({ projectId: "p2" });
    expect(editor().value).toBe("new project");
    expect(container.textContent).not.toContain("private old draft");
  });
  it("restores only after explicit confirmation and binds current revision", async () => {
    await render({ tab: "history" });
    await act(async () => buttons("恢复此版本")[1].click());
    expect(posts()).toHaveLength(0);
    await click("确认恢复源码");
    expect(JSON.parse(posts()[0][1].body)).toMatchObject({
      expectedRevision: "r1",
      targetRevision: "r0",
    });
  });
  it("explains restart-only changes without discarding the draft", async () => {
    await render();
    await edit("config change");
    commandStatus = 409;
    commandResult = { detail: "project_live_patch_requires_restart" };
    await click("保存源码");
    expect(editor().value).toBe("config change");
    expect(container.textContent).toContain("请先停止应用");
  });
  it("exports through credentials and links a distinct fork session", async () => {
    await render();
    await click("导出源码");
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(
      fetcher.mock.calls.find(([url]) => String(url).includes("/export?"))![1]
    ).toMatchObject({ credentials: "include", cache: "no-store" });
    await click("复刻工程");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "/agent-loop/sliderule"
    );
    const activated = vi.fn();
    window.addEventListener("sliderule:active-session-changed", activated);
    container
      .querySelector("a")!
      .addEventListener("click", event => event.preventDefault(), {
        once: true,
      });
    await act(async () =>
      container
        .querySelector("a")!
        .dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        )
    );
    expect(localStorage.getItem("sliderule:active-session-id")).toBe("s2");
    expect(activated).toHaveBeenCalled();
    window.removeEventListener("sliderule:active-session-changed", activated);
    expect(container.textContent).toContain("新会话批准后才能运行");
  });
  it("maps a selected source line into the actual editor only for matching revision", async () => {
    await render({
      selection: {
        path: "src/main.tsx",
        line: 2,
        column: 1,
        revision: "r1",
        selectionId: "one",
      },
    });
    expect(editor().selectionStart).toBe(6);
    expect(
      editor().value.slice(editor().selectionStart, editor().selectionEnd)
    ).toBe("second");
  });
});

describe("preview selection channels", () => {
  it("accepts only the expected window, origin, channel and all three identities", () => {
    const iframe = document.createElement("iframe");
    container.append(iframe);
    const send = vi.spyOn(iframe.contentWindow!, "postMessage");
    const selected = vi.fn();
    const status = vi.fn();
    const connection = connectPreviewSelection({
      frame: iframe,
      origin: "https://preview.example",
      scope: { projectId: "p1", runtimeId: "runtime1", revision: "r1" },
      onSelection: selected,
      onStatus: status,
    });
    connection.setEnabled(true);
    const init: any = send.mock.calls[0][0];
    const data = {
      ...init,
      type: "whybuddy:select:element",
      location: { path: "src/main.tsx", line: 2, column: 1 },
    };
    const emit = (
      payload = data,
      origin = "https://preview.example",
      source: Window | null = iframe.contentWindow
    ) =>
      window.dispatchEvent(
        new MessageEvent("message", { data: payload, origin, source })
      );
    emit(data, "https://evil.example");
    emit(data, "https://preview.example", window);
    for (const field of [
      "projectId",
      "runtimeId",
      "revision",
      "channelId",
      "schemaVersion",
    ])
      emit({ ...data, [field]: "wrong" });
    for (const path of [
      "../private",
      "/etc/passwd",
      "C:/file",
      "src\\main.tsx",
    ])
      emit({ ...data, location: { ...data.location, path } });
    expect(selected).not.toHaveBeenCalled();
    emit();
    expect(selected).toHaveBeenCalledExactlyOnceWith(data.location);
    connection.setEnabled(false);
    emit();
    expect(selected).toHaveBeenCalledTimes(1);
    connection.dispose();
    emit();
    expect(selected).toHaveBeenCalledTimes(1);
    expect(
      send.mock.calls.every(
        call => String(call[1]) === "https://preview.example"
      )
    ).toBe(true);
  });
  it("provides explicit missing mapping status and never treats arbitrary messages as commands", () => {
    const iframe = document.createElement("iframe");
    container.append(iframe);
    const send = vi.spyOn(iframe.contentWindow!, "postMessage");
    const status = vi.fn();
    const selected = vi.fn();
    const connection = connectPreviewSelection({
      frame: iframe,
      origin: "https://preview.example",
      scope: { projectId: "p1", runtimeId: "runtime1", revision: "r1" },
      onSelection: selected,
      onStatus: status,
    });
    connection.setEnabled(true);
    const init: any = send.mock.calls[0][0];
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        origin: "https://preview.example",
        data: { ...init, type: "whybuddy:select:element", location: null },
      })
    );
    expect(status).toHaveBeenCalledWith("missing-source");
    expect(selected).not.toHaveBeenCalled();
    connection.dispose();
  });
  it("keeps the injected browser runtime self contained and does nothing in a top level frame", () => {
    const clean = installPreviewSelectionBridge({
      workbenchOrigin: "https://workbench.example",
      projectId: "p1",
      runtimeId: "runtime1",
      revision: "r1",
    });
    expect(typeof clean).toBe("function");
    clean();
  });
  it("executes the injected runtime in a child realm and rejects spoofed parent authorization", () => {
    const iframe = document.createElement("iframe");
    container.append(iframe);
    const dom = { window };
    const child = iframe.contentWindow!;
    child.document.body.innerHTML =
      '<button data-whybuddy-source="src/main.tsx" data-whybuddy-line="5" data-whybuddy-column="3">Choose</button>';
    const posted = vi
      .spyOn(dom.window, "postMessage")
      .mockImplementation(() => {});
    const config = {
      workbenchOrigin: "https://workbench.example",
      projectId: "p1",
      runtimeId: "runtime1",
      revision: "r1",
    };
    const cleanup = (child as any).eval(
      `(${installPreviewSelectionBridge.toString()})(${JSON.stringify(config)})`
    );
    const init = {
      type: "whybuddy:select:init",
      schemaVersion: 1,
      projectId: "p1",
      runtimeId: "runtime1",
      revision: "r1",
      channelId: "channel",
      enabled: true,
    };
    const emit = (
      data = init,
      origin = config.workbenchOrigin,
      source: any = dom.window
    ) =>
      child.dispatchEvent(
        new (child as any).MessageEvent("message", { data, origin, source })
      );
    emit(init, "https://evil.example");
    emit(init, config.workbenchOrigin, child);
    for (const field of ["projectId", "runtimeId", "revision", "schemaVersion"])
      emit({ ...init, [field]: "wrong" });
    expect(posted).not.toHaveBeenCalled();
    emit();
    child.document.querySelector("button")!.click();
    expect(posted.mock.calls.map(call => call[0])).toEqual([
      {
        type: "whybuddy:select:ready",
        schemaVersion: 1,
        projectId: "p1",
        runtimeId: "runtime1",
        revision: "r1",
        channelId: "channel",
      },
      {
        type: "whybuddy:select:element",
        schemaVersion: 1,
        projectId: "p1",
        runtimeId: "runtime1",
        revision: "r1",
        channelId: "channel",
        location: { path: "src/main.tsx", line: 5, column: 3 },
      },
    ]);
    cleanup();
    child.document.querySelector("button")!.click();
    expect(posted).toHaveBeenCalledTimes(2);
    iframe.remove();
  });
});

describe("PNG evidence consumer", () => {
  const record = {
    projectId: "p1",
    revision: "r1",
    verificationId: "v1",
    artifactRefs: [
      {
        artifactId: "a1",
        sha256: "hash",
        mediaType: "image/png",
        sizeBytes: 9,
        label: "raw page label",
      },
    ],
  } as VerificationRecord;
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  async function images(stale = false) {
    await act(async () =>
      root.render(<ProjectEvidenceImages record={record} stale={stale} />)
    );
  }
  it("loads authenticated PNG on click and revokes it on close", async () => {
    fetcher.mockResolvedValue(
      new Response(png, { headers: { "Content-Type": "image/png" } })
    );
    await images();
    expect(fetcher).not.toHaveBeenCalled();
    await click("查看截图 1");
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/sliderule/project-verifications/v1/artifacts/a1"
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: "include",
      cache: "no-store",
    });
    expect(container.querySelector("img")?.src).toBe("blob:fixture");
    await click("关闭截图");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture");
    expect(container.querySelector("img")).toBeNull();
  });
  it.each(["text/html", "image/svg+xml"])(
    "refuses executable %s content",
    async mime => {
      fetcher.mockResolvedValue(
        new Response("<script>secret</script>", {
          headers: { "Content-Type": mime },
        })
      );
      await images();
      await click("查看截图 1");
      expect(URL.createObjectURL).not.toHaveBeenCalled();
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).not.toContain("secret");
    }
  );
  it("rejects fake PNG bytes and labels historical screenshots truthfully", async () => {
    fetcher.mockResolvedValue(
      new Response("not a png", { headers: { "Content-Type": "image/png" } })
    );
    await images(true);
    await click("查看旧版本截图 1");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(container.textContent).toContain("截图内容不完整");
  });
  it("does not display raw transport errors in the screenshot panel", async () => {
    fetcher.mockRejectedValue(new Error("untrusted transport detail"));
    await images();
    await click("查看截图 1");
    expect(container.textContent).toContain("暂时无法读取截图");
    expect(container.textContent).not.toContain("untrusted transport detail");
  });
});

describe("application data backup ownership and restore", () => {
  const backup = (version: number, projectId = "p1") => ({
    backupId: `backup-${version}`,
    projectId,
    version,
    parentBackupId: version > 1 ? `backup-${version - 1}` : null,
    sha256: "a".repeat(64),
    sizeBytes: 4096,
    sourceRevision: "source-r1",
    dataSchemaVersion: 1,
    createdAt: "2026-09-13T00:00:00Z",
  });
  const snapshot = {
    backup: backup(2),
    backups: [backup(2), backup(1)],
    checkpointIntervalSeconds: 30,
    recoveryPolicy: "last-checkpoint",
  };
  async function data(stopped = true, projectId = "p1") {
    await act(async () =>
      root.render(
        <ProjectDataPanel projectId={projectId} runtimeStopped={stopped} />
      )
    );
    await flush();
  }
  it.each(["backups", "empty", "failed"])(
    "shows pending data independently of the %s result",
    async outcome => {
      let resolveData!: (value: Response) => void;
      const pending = new Promise<Response>(resolve => {
        resolveData = resolve;
      });
      fetcher.mockReturnValue(pending);
      await data();
      expect(container.querySelector('[role="status"]')?.textContent).toContain(
        "正在读取数据备份"
      );
      expect(
        container
          .querySelector('[data-testid="project-data-panel"]')
          ?.getAttribute("aria-busy")
      ).toBe("true");
      expect(container.textContent).not.toContain("尚无已保存的数据备份");
      expect(container.querySelector('[role="alert"]')).toBeNull();
      await act(async () =>
        resolveData(
          outcome === "failed"
            ? response({ detail: "unavailable" }, 503)
            : response(
                outcome === "empty"
                  ? { ...snapshot, backup: null, backups: [] }
                  : snapshot
              )
        )
      );
      await flush();
      expect(container.textContent).not.toContain("正在读取数据备份");
      expect(
        container
          .querySelector('[data-testid="project-data-panel"]')
          ?.getAttribute("aria-busy")
      ).toBe("false");
      if (outcome === "failed") {
        expect(
          container.querySelector('[role="alert"]')?.textContent
        ).toContain("工程服务尚未启用或暂时不可用");
        expect(container.textContent).not.toContain("尚无已保存的数据备份");
        fetcher.mockResolvedValue(response(snapshot));
        await click("更新备份列表");
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(buttons("恢复这份数据")).toHaveLength(2);
      } else if (outcome === "empty") {
        expect(container.textContent).toContain("尚无已保存的数据备份");
        expect(container.querySelector('[role="alert"]')).toBeNull();
      } else expect(buttons("恢复这份数据")).toHaveLength(2);
      expect(posts()).toHaveLength(0);
    }
  );

  it("displays the actual checkpoint policy and requires stopped runtime plus explicit confirmation", async () => {
    fetcher.mockImplementation(async (_path, init) =>
      response(init?.method === "POST" ? { backup: backup(3) } : snapshot)
    );
    await data(false);
    expect(container.textContent).toContain("每 30 秒");
    expect(buttons("恢复这份数据").every(item => item.disabled)).toBe(true);
    expect(posts()).toHaveLength(0);
    await data(true);
    await act(async () => buttons("恢复这份数据")[1].click());
    expect(posts()).toHaveLength(0);
    await click("确认恢复数据");
    expect(JSON.parse(posts()[0][1].body)).toEqual({
      backupId: "backup-1",
      expectedVersion: 2,
    });
    expect(container.textContent).toContain("工程源码保持当前版本");
  });
  it("refuses foreign backup metadata", async () => {
    fetcher.mockResolvedValue(
      response({ ...snapshot, backup: backup(2, "other") })
    );
    await data();
    expect(container.textContent).toContain("数据备份记录不完整");
    expect(buttons("恢复这份数据")).toHaveLength(0);
  });
  it("keeps data conflict truthful instead of claiming a successful restore", async () => {
    fetcher.mockImplementation(async (_path, init) =>
      response(
        init?.method === "POST"
          ? { detail: "project_application_version_conflict" }
          : snapshot,
        init?.method === "POST" ? 409 : 200
      )
    );
    await data();
    await act(async () => buttons("恢复这份数据")[1].click());
    await click("确认恢复数据");
    expect(container.textContent).toContain("数据版本或运行状态已变化");
    expect(container.textContent).not.toContain("数据已恢复为新的备份版本");
  });
  it("reports no saved backup without implying the source archive saves business data", async () => {
    fetcher.mockResolvedValue(
      response({ ...snapshot, backup: null, backups: [] })
    );
    await data();
    expect(container.textContent).toContain("尚无已保存的数据备份");
    expect(posts()).toHaveLength(0);
  });
});
