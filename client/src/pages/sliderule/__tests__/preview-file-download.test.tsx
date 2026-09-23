// @vitest-environment jsdom
/**
 * 预览下载是当前点名的那一份，不是底下一条文件名。
 *
 * ⚠ 2026-09-22 启动会把产物清单钉在预览底部。删掉「只跟 path 走」，
 *   或把文件名又画回页面上，本条变红。
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PreviewFileDownload } from "../project-runtime/PreviewFileDownload";

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const files = [
  {
    artifactId: "art-first",
    path: "甲.pptx",
    sha256: "a".repeat(64),
    sizeBytes: 10,
    downloadable: true,
  },
  {
    artifactId: "art-named",
    path: "notes/乙.docx",
    sha256: "b".repeat(64),
    sizeBytes: 20,
    downloadable: true,
  },
];

describe("PreviewFileDownload", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  async function render(path: string | null) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ files }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<PreviewFileDownload projectId="proj-1" path={path} />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("下的是点名的那一份，页面上不写文件名", async () => {
    await render("notes/乙.docx");
    const link = container!.querySelector(
      '[data-testid="preview-file-download"]'
    ) as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe(
      "/api/sliderule/projects/proj-1/artifacts/art-named"
    );
    expect(link!.getAttribute("download")).toBe("乙.docx");
    expect(link!.getAttribute("aria-label")).toBe("下载");
    expect(container!.textContent).not.toContain("乙.docx");
    expect(container!.textContent).not.toContain("甲.pptx");
    expect(container!.textContent).not.toContain("下载");
  });

  it("反向：没点名，或点名的文件不在产物里，就不画", async () => {
    await render(null);
    expect(
      container!.querySelector('[data-testid="preview-file-download"]')
    ).toBeNull();
    await act(async () => root!.unmount());
    root = undefined;
    container?.remove();
    await render("不存在.xlsx");
    expect(
      container!.querySelector('[data-testid="preview-file-download"]')
    ).toBeNull();
  });
});
