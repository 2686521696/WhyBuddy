import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  executeRealWebSearch,
  parseBingCnHtml,
} from "../core/web-search-provider.js";

function htmlFetchResponse(html: string) {
  return {
    ok: true,
    headers: new Headers({ "content-type": "text/html" }),
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return {
              done: false,
              value: new TextEncoder().encode(html),
            };
          },
          cancel: async () => {},
        };
      },
    },
  };
}

describe("executeRealWebSearch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.stubEnv("WEB_SEARCH_CN_ENABLED", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns mock fallback results when fetch fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error"),
    );

    const result = await executeRealWebSearch({
      query: "test query",
      options: { topK: 3 },
    });

    expect(result.query).toBe("test query");
    expect(result.mode).toBe("mock");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("parses Bing CN HTML first when no API key is set", async () => {
    vi.stubEnv("WEB_SEARCH_API_KEY", "");

    const mockHtml = `
      <html><body>
        <li class="b_algo">
          <h2><a href="https://zhuanlan.zhihu.com/p/123">RBAC 权限模型指南</a></h2>
          <div class="b_caption"><p>基于角色的访问控制模型介绍。</p></div>
        </li>
        <li class="b_algo">
          <h2><a href="https://blog.csdn.net/article/1">CSDN RBAC 文章</a></h2>
          <div class="b_caption"><p>企业权限系统设计实践。</p></div>
        </li>
      </body></html>
    `;

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      htmlFetchResponse(mockHtml)
    );

    const result = await executeRealWebSearch({
      query: "RBAC 权限",
      options: { topK: 5 },
    });

    expect(result.mode).toBe("hybrid");
    expect(result.results.length).toBe(2);
    expect(result.results[0].source).toBe("bing-cn");
    expect(result.results[0].url).toBe("https://zhuanlan.zhihu.com/p/123");
    expect(result.results[0].title).toBe("RBAC 权限模型指南");
    expect(result.results[0].snippet).toBe("基于角色的访问控制模型介绍。");
  });

  it("falls back to DuckDuckGo when Bing CN returns no parseable results", async () => {
    vi.stubEnv("WEB_SEARCH_API_KEY", "");

    const mockHtml = `
      <html>
        <body>
          <div class="results">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=abc">
              Example Page One
            </a>
            <a class="result__snippet">This is the first result snippet about testing.</a>
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2&rut=def">
              Example Page Two
            </a>
            <a class="result__snippet">Second result snippet with more details.</a>
          </div>
        </body>
      </html>
    `;

    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(htmlFetchResponse("<html><body>No bing hits</body></html>"))
      .mockResolvedValueOnce(htmlFetchResponse(mockHtml));

    const result = await executeRealWebSearch({
      query: "example test",
      options: { topK: 5 },
    });

    expect(result.query).toBe("example test");
    expect(result.mode).toBe("hybrid");
    expect(result.results.length).toBe(2);
    expect(result.results[0].title).toBe("Example Page One");
    expect(result.results[0].url).toBe("https://example.com/page1");
    expect(result.results[0].snippet).toBe(
      "This is the first result snippet about testing.",
    );
    expect(result.results[0].source).toBe("duckduckgo");
    expect(result.results[1].title).toBe("Example Page Two");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("uses SerpAPI when WEB_SEARCH_API_KEY is set", async () => {
    vi.stubEnv("WEB_SEARCH_API_KEY", "test-api-key-123");

    const mockApiResponse = {
      organic_results: [
        {
          title: "API Result One",
          link: "https://api-result.com/one",
          snippet: "First API search result.",
        },
        {
          title: "API Result Two",
          link: "https://api-result.com/two",
          snippet: "Second API search result.",
        },
      ],
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
      headers: new Headers({ "content-type": "application/json" }),
    });

    const result = await executeRealWebSearch({
      query: "api search test",
      options: { topK: 3 },
    });

    expect(result.query).toBe("api search test");
    expect(result.mode).toBe("hybrid");
    expect(result.results.length).toBe(2);
    expect(result.results[0].title).toBe("API Result One");
    expect(result.results[0].url).toBe("https://api-result.com/one");
    expect(result.results[0].source).toBe("serpapi");

    // Verify the fetch was called with the API key
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(fetchCall).toContain("api_key=test-api-key-123");
    expect(fetchCall).toContain("q=api+search+test");
  });

  it("falls back to mock when Bing CN and DuckDuckGo return no parseable results", async () => {
    vi.stubEnv("WEB_SEARCH_API_KEY", "");

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      htmlFetchResponse("<html><body>No results</body></html>")
    );

    const result = await executeRealWebSearch({
      query: "obscure query with no results",
    });

    expect(result.query).toBe("obscure query with no results");
    expect(result.mode).toBe("mock");
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("parseBingCnHtml strips entities from captions", () => {
    const parsed = parseBingCnHtml(
      `<h2><a href="https://example.cn/a">标题</a></h2>
       <div class="b_caption"><p>2025年&amp;ensp;&#0183;&ensp;摘要文本</p></div>`,
      3
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].source).toBe("bing-cn");
    expect(parsed[0].snippet).toContain("摘要文本");
  });

  it("respects topK parameter", async () => {
    vi.stubEnv("WEB_SEARCH_API_KEY", "key");

    const mockApiResponse = {
      organic_results: [
        { title: "R1", link: "https://r1.com", snippet: "s1" },
        { title: "R2", link: "https://r2.com", snippet: "s2" },
        { title: "R3", link: "https://r3.com", snippet: "s3" },
        { title: "R4", link: "https://r4.com", snippet: "s4" },
      ],
    };

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
      headers: new Headers({ "content-type": "application/json" }),
    });

    const result = await executeRealWebSearch({
      query: "topk test",
      options: { topK: 2 },
    });

    expect(result.results.length).toBe(2);
  });
});
