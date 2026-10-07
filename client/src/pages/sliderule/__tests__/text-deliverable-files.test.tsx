// @vitest-environment jsdom
/**
 * 文本交付物（.md / .txt / .csv）在右栏能看、在切换条上有它、缩略图画得出来。
 *
 * ⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004174725-J5XFTG8673：模型交的是 Markdown。
 *   后端放开之后，前端各处原来各写各的 `/\.(pptx|docx|xlsx)$/`——project-computer-view 的过滤会把 .md 静默滤掉，
 *   右栏停在「还没有收回的文件」。走真 SandboxPreviewSurface + 真 PresentedOfficeFile，只把 HTTP 换成桩；
 *   文档正文是那一轮的原文（slide-rule-python/tests/fixtures/text_deliverable_weekly_meeting.json）。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SandboxPreviewSurface } from "../project-runtime/SandboxPreviewSurface";
import { OfficeThumbnail } from "../project-runtime/OfficeThumbnail";
import { officeFileTabs } from "../project-computer-view";
import {
  OFFICE_DELIVERABLE_EXTENSIONS,
  TEXT_DELIVERABLE_EXTENSIONS,
  deliverableKind,
  parseCsv,
} from "../project-runtime/deliverable-files";

const ROOT = resolve(__dirname, "../../../../..");
const FIXTURE = JSON.parse(
  readFileSync(resolve(ROOT, "slide-rule-python/tests/fixtures/text_deliverable_weekly_meeting.json"), "utf8")
) as { path: string; document: string };

vi.mock("@silurus/ooxml/xlsx", () => ({ XlsxViewer: class { load() { return Promise.resolve(); } destroy() {} } }));
vi.mock("@silurus/ooxml/pptx", () => ({ PptxViewer: class { load() { return Promise.resolve(); } fitPage() { return Promise.resolve(); } destroy() {} } }));
vi.mock("@silurus/ooxml/docx", () => ({ DocxScrollViewer: class { load() { return Promise.resolve(); } destroy() {} } }));

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // useInViewOnce：jsdom 没有 IntersectionObserver，当作一挂上就进了视口
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    private readonly cb: (entries: { isIntersecting: boolean }[]) => void;
    constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { this.cb = cb; }
    observe() { this.cb([{ isIntersecting: true }]); }
    disconnect() {}
    unobserve() {}
  };
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

const BODIES: Record<string, string> = {
  "art-md": FIXTURE.document,
  "art-csv": "门店,销售额\n朝阳,\"1,200\"\n海淀,980\n",
};

function stubFetch(files: { artifactId: string; path: string }[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split("?")[0];   // 预览取字节带 ?view=preview（xlsx 补存值）
      if (url.endsWith("/artifacts"))
        return new Response(JSON.stringify({ files: files.map(f => ({ ...f, sha256: "s", sizeBytes: 1 })) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      const hit = /\/artifacts\/(art-[a-z]+)$/.exec(url);
      if (hit) return new Response(new TextEncoder().encode(BODIES[hit[1]] ?? ""), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

async function render(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
}

const view = () => container?.querySelector<HTMLElement>('[data-testid="text-deliverable-view"]');

describe("右栏看文本交付物（真 SandboxPreviewSurface）", () => {
  it("收回的 Markdown 排成文档：标题是标题，不是 # 号原文", async () => {
    stubFetch([{ artifactId: "art-md", path: FIXTURE.path }]);
    await render(<SandboxPreviewSurface projectId="p1" revisionMode="current" deliverableKind="office-file" />);
    expect(view()?.dataset.textKind).toBe("markdown");
    expect(view()?.querySelector("h1")?.textContent).toBe("团队周会制度说明");
    expect(view()?.textContent).not.toContain("# 团队周会制度说明");
    expect(container?.textContent).not.toContain("还没有交出的文件");
  });

  it("Markdown 跟 CSV 并排收回：切换条上两份都在", async () => {
    stubFetch([
      { artifactId: "art-md", path: FIXTURE.path },
      { artifactId: "art-csv", path: "output/门店销售.csv" },
    ]);
    await render(<SandboxPreviewSurface projectId="p1" revisionMode="current" deliverableKind="office-file" />);
    const tabs = [...(container?.querySelectorAll('[data-testid="office-file-tab"]') ?? [])].map(t => t.textContent);
    expect(tabs).toEqual([FIXTURE.path, "门店销售.csv"]);
    expect(view()?.dataset.textKind).toBe("csv");                    // 宿主默认最后收回的那份
    expect(view()?.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(view()?.querySelector("tbody td:nth-child(2)")?.textContent).toBe("1,200");
  });

  it("用户文件里的 HTML 只是字：不渲染 <script> / <img onerror>", async () => {
    BODIES["art-md"] = '# 标题\n\n<img src=x onerror="alert(1)"><script>alert(2)</script>';
    stubFetch([{ artifactId: "art-md", path: "output/x.md" }]);
    await render(<SandboxPreviewSurface projectId="p1" revisionMode="current" deliverableKind="office-file" />);
    expect(view()?.querySelector("script, img")).toBeNull();
    BODIES["art-md"] = FIXTURE.document;
  });
});

describe("收尾那句话里才交出的文件", () => {
  it("这一轮说完（streaming → complete），右栏重取产物列表、显示刚交出的文件", async () => {
    // 真机顺序：最后一个工具是 file_write，文件在收尾那句话里被链接时才进产物库（Python _deliver_linked_text_files）。
    let delivered: { artifactId: string; path: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input).split("?")[0];   // 预览取字节带 ?view=preview（xlsx 补存值）
        if (url.endsWith("/artifacts"))
          return new Response(JSON.stringify({ files: delivered.map(f => ({ ...f, sha256: "s", sizeBytes: 1 })) }), {
            status: 200, headers: { "content-type": "application/json" },
          });
        if (/\/artifacts\/art-md$/.test(url)) return new Response(new TextEncoder().encode(FIXTURE.document), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
      })
    );
    const turn = (status: "streaming" | "complete") =>
      ({ id: "t1", user: "写周会制度", status, steps: [], routeFacts: {}, routeExpanded: false, routeLitCount: 0,
         assistant: "", assistantSource: "llm", main: null, actions: [] }) as never;
    const surface = (status: "streaming" | "complete") => (
      <SandboxPreviewSurface projectId="p1" revisionMode="current" deliverableKind="office-file" turns={[turn(status)]} />
    );
    await render(surface("streaming"));
    expect(view()).toBeFalsy();
    delivered = [{ artifactId: "art-md", path: FIXTURE.path }];
    await act(async () => root!.render(surface("complete")));
    for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); });
    expect(view()?.querySelector("h1")?.textContent).toBe("团队周会制度说明");
  });
});

describe("结果卡缩略图", () => {
  it("Markdown 不上 canvas，排出开头一段", async () => {
    stubFetch([{ artifactId: "art-md", path: FIXTURE.path }]);
    await render(<OfficeThumbnail projectId="p1" path={FIXTURE.path} artifactId="art-md" />);
    const thumb = container?.querySelector<HTMLElement>('[data-testid="turn-result-office-thumb"]');
    expect(thumb?.dataset.state).toBe("ok");
    expect(thumb?.querySelector("canvas")).toBeNull();
    expect(thumb?.querySelector("h1")?.textContent).toBe("团队周会制度说明");
  });
});

describe("deliverable-files", () => {
  it("后缀清单跟 Python deliverable_kind 是同一份（成对物）", () => {
    const py = readFileSync(resolve(ROOT, "slide-rule-python/services/deliverable_kind.py"), "utf8");
    const set = (name: string) => {
      const m = new RegExp(`^${name} = frozenset\\(\\{([^}]*)\\}\\)`, "m").exec(py);
      return [...(m?.[1] ?? "").matchAll(/"(\.[a-z]+)"/g)].map(x => x[1]).sort();
    };
    expect(set("OFFICE_EXTENSIONS")).toEqual([...OFFICE_DELIVERABLE_EXTENSIONS].sort());
    expect(set("TEXT_DELIVERABLE_EXTENSIONS")).toEqual([...TEXT_DELIVERABLE_EXTENSIONS].sort());
  });

  it("认后缀：交付物认得出，别的不认", () => {
    expect(deliverableKind("output/周会.MD")).toBe("markdown");
    expect(deliverableKind("deck.pptx")).toBe("pptx");
    expect(deliverableKind("a.mdx")).toBeNull();
    expect(deliverableKind(".md")).toBeNull();
    expect(officeFileTabs(["index.html", "a.md", "b.csv"], "b.csv", null).tabs.map(t => t.path)).toEqual(["a.md", "b.csv"]);
  });

  it("CSV：引号里的逗号、换行、转义引号都认", () => {
    const { rows } = parseCsv('名称,备注\n"A,B","第一行\n第二行"\n"说""好""",x\r\n');
    expect(rows).toEqual([["名称", "备注"], ["A,B", "第一行\n第二行"], ['说"好"', "x"]]);
  });
});
