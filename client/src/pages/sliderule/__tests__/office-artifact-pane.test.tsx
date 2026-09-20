// @vitest-environment jsdom
/**
 * 办公产物面：列表 + 幻灯片正文，不许渲染任务登录页。
 *
 * ⚠ 2026-09-20 真机右边是「创建管理员」。判据盯用户看见的字，
 *   不盯有没有 iframe。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OfficeArtifactPane } from "../project-runtime/OfficeArtifactPane";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("OfficeArtifactPane", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  it("抽出的幻灯片正文可见，登录页字样不许出现", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/artifacts") && !url.includes("/art-1")) {
          return new Response(
            JSON.stringify({
              files: [
                {
                  artifactId: "art-1",
                  path: "面团启动.pptx",
                  sha256: "a".repeat(64),
                  sizeBytes: 12,
                  downloadable: true,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response(
          JSON.stringify({
            kind: "slides",
            slides: [{ text: "面团启动会" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<OfficeArtifactPane projectId="proj-office" />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("面团启动.pptx");
    expect(container.textContent).toContain("面团启动会");
    expect(container.textContent).toContain("下载");
    expect(container.textContent).not.toContain("创建管理员");
    expect(container.textContent).not.toContain("登录");
    expect(container.querySelector('[data-testid="project-preview-frame"]')).toBeNull();
  });
});
