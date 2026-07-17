/**
 * E31 附件提取（前端侧）：图片/PDF 分路识别 + 服务端提取回执的诚实归一。
 * 网络层 mock——管线活体验证走 e2e（verify-e31-attachments.mjs）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  extractAttachmentRemote,
  isExtractableAttachment,
} from "../ComposerDock";

describe("isExtractableAttachment", () => {
  it("图片与 PDF 走服务端提取", () => {
    for (const name of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif", "f.pdf", "G.PDF"]) {
      expect(isExtractableAttachment(name)).toBe(true);
    }
  });

  it("文本类与未知类型不走服务端提取", () => {
    for (const name of ["a.txt", "b.md", "c.csv", "d.zip", "e.docx", "noext"]) {
      expect(isExtractableAttachment(name)).toBe(false);
    }
  });
});

describe("extractAttachmentRemote", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakeFile = (name: string) =>
    new File([new Uint8Array([1, 2, 3])], name);

  it("成功回执原样透传（ok + context）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(String(url)).toContain("/api/sliderule/attachments/extract?name=ui.png");
        return {
          ok: true,
          json: async () => ({ ok: true, kind: "image", context: "登录页原型", chars: 5 }),
        } as Response;
      })
    );
    const outcome = await extractAttachmentRemote(fakeFile("ui.png"));
    expect(outcome.ok).toBe(true);
    expect(outcome.context).toBe("登录页原型");
  });

  it("服务端 ok=false 如实带 detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: false, detail: "PDF 无可提取文本层（可能是扫描件）" }),
      })) as unknown as typeof fetch
    );
    const outcome = await extractAttachmentRemote(fakeFile("scan.pdf"));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("扫描件");
  });

  it("ok=true 但空 context 视为失败（不假装解析成功）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, context: "  " }),
      })) as unknown as typeof fetch
    );
    const outcome = await extractAttachmentRemote(fakeFile("a.png"));
    expect(outcome.ok).toBe(false);
  });

  it("HTTP 非 2xx 归一为失败", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 502 })) as unknown as typeof fetch
    );
    const outcome = await extractAttachmentRemote(fakeFile("a.png"));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("502");
  });

  it("网络异常归一为失败（不抛出）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }) as unknown as typeof fetch
    );
    const outcome = await extractAttachmentRemote(fakeFile("a.png"));
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("网络异常");
  });
});
