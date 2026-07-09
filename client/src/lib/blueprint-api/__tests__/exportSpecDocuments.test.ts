/**
 * `autopilot-spec-document-export` Task 4.2：exportSpecDocumentsToDownload 单测。
 *
 * - vi.fn() mock 全局 fetch 模拟成功 / 4xx / 网络错误
 * - 用 vi.stubGlobal 注入最小 document / URL stub（node 环境无 DOM）
 * - 不引入 jsdom / @testing-library/react，沿用项目惯例
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { exportSpecDocumentsToDownload } from "../exportSpecDocuments";

// ─── 共享 stub 工具 ──────────────────────────────────────────────────────

interface StubAnchor {
  href: string;
  download: string;
  style: { display: string };
  click: ReturnType<typeof vi.fn>;
  parentNode: { removeChild: ReturnType<typeof vi.fn> } | null;
}

function createStubAnchor(): StubAnchor {
  return {
    href: "",
    download: "",
    style: { display: "" },
    click: vi.fn(),
    parentNode: null,
  };
}

interface DomEnv {
  anchor: StubAnchor;
  appendChild: ReturnType<typeof vi.fn>;
  removeChild: ReturnType<typeof vi.fn>;
  createObjectURL: ReturnType<typeof vi.fn>;
  revokeObjectURL: ReturnType<typeof vi.fn>;
}

function setupDomEnv(): DomEnv {
  const anchor = createStubAnchor();
  const removeChild = vi.fn();
  const appendChild = vi.fn((node: StubAnchor) => {
    node.parentNode = { removeChild };
    return node;
  });

  const stubDocument = {
    createElement: vi.fn((tag: string) => {
      if (tag === "a") {
        return anchor;
      }
      // 测试不依赖其它 tag；如果触发说明实现新增了 createElement 调用
      throw new Error(`Unexpected createElement call: ${tag}`);
    }),
    body: {
      appendChild,
    },
  };

  const createObjectURL = vi.fn(() => "blob:fake-url");
  const revokeObjectURL = vi.fn();
  const stubURL = {
    createObjectURL,
    revokeObjectURL,
  };

  vi.stubGlobal("document", stubDocument);
  vi.stubGlobal("URL", stubURL);

  return {
    anchor,
    appendChild,
    removeChild,
    createObjectURL,
    revokeObjectURL,
  };
}

function makeOkResponse(body: string, contentDisposition?: string): Response {
  const headers = new Headers();
  headers.set("content-type", "application/zip");
  if (contentDisposition) {
    headers.set("content-disposition", contentDisposition);
  }
  return new Response(body, { status: 200, headers });
}

function makeErrorResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    statusText: status === 404 ? "Not Found" : "Server Error",
  });
}

// ─── 测试 ────────────────────────────────────────────────────────────────

describe("exportSpecDocumentsToDownload", () => {
  let dom: DomEnv;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    dom = setupDomEnv();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("成功路径：调用 fetch 并触发 a.click 下载", async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse(
        "ZIP-BYTES",
        'attachment; filename="my-feature-spec.zip"',
      ),
    );

    await exportSpecDocumentsToDownload({
      jobId: "job-1",
      granularity: "tree",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      "/api/blueprint/jobs/job-1/spec-documents/export?granularity=tree",
    );

    expect(dom.anchor.click).toHaveBeenCalledTimes(1);
    expect(dom.anchor.download).toBe("my-feature-spec.zip");
    expect(dom.anchor.href).toBe("blob:fake-url");
    expect(dom.appendChild).toHaveBeenCalledTimes(1);
    expect(dom.removeChild).toHaveBeenCalledTimes(1);
    expect(dom.revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });

  it("解析 Content-Disposition 拿到 filename；缺失时回退到 jobId-granularity.ext 形式", async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse("MARKDOWN")); // 无 content-disposition

    await exportSpecDocumentsToDownload({
      jobId: "job-1",
      granularity: "single",
      nodeId: "node-a",
      type: "requirements",
    });

    expect(dom.anchor.download).toBe("job-1-single.md");
  });

  it("RFC 5987 filename* 优先于 ASCII fallback", async () => {
    // 后端发了两段：filename="ascii-fallback.zip"; filename*=UTF-8''...
    fetchMock.mockResolvedValueOnce(
      makeOkResponse(
        "ZIP",
        `attachment; filename="ascii_fallback.zip"; filename*=UTF-8''${encodeURIComponent("项目主航道.zip")}`,
      ),
    );

    await exportSpecDocumentsToDownload({
      jobId: "job-1",
      granularity: "tree",
    });

    expect(dom.anchor.download).toBe("项目主航道.zip");
  });

  it("仅有 RFC 5987 字段时也能解析", async () => {
    fetchMock.mockResolvedValueOnce(
      makeOkResponse(
        "ZIP",
        `attachment; filename*=UTF-8''${encodeURIComponent("纯中文.zip")}`,
      ),
    );

    await exportSpecDocumentsToDownload({
      jobId: "job-1",
      granularity: "tree",
    });

    expect(dom.anchor.download).toBe("纯中文.zip");
  });

  it("拼 URL 时按 granularity / nodeId / type 加 query", async () => {
    fetchMock.mockResolvedValueOnce(makeOkResponse("X"));

    await exportSpecDocumentsToDownload({
      jobId: "j 2", // 含空格，验证 encodeURIComponent
      granularity: "single",
      nodeId: "node-1",
      type: "design",
    });

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/blueprint/jobs/j%202/spec-documents/export?");
    expect(url).toContain("granularity=single");
    expect(url).toContain("nodeId=node-1");
    expect(url).toContain("type=design");
  });

  it("非 2xx 响应抛 Error，含 status 与 body 摘要", async () => {
    fetchMock.mockResolvedValueOnce(
      makeErrorResponse(404, JSON.stringify({ error: "blueprint job not found" })),
    );

    await expect(
      exportSpecDocumentsToDownload({
        jobId: "missing",
        granularity: "tree",
      }),
    ).rejects.toThrow(/HTTP 404/);

    // 失败路径下不应触发 a.click
    expect(dom.anchor.click).not.toHaveBeenCalled();
  });

  it("fetch 抛网络错误时透传错误", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    await expect(
      exportSpecDocumentsToDownload({
        jobId: "j1",
        granularity: "tree",
      }),
    ).rejects.toThrow(/network down/);

    expect(dom.anchor.click).not.toHaveBeenCalled();
  });
});
