import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeRealWebSearch } from "../core/web-search-provider.js";

describe("executeRealWebSearch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
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

  it("parses DuckDuckGo HTML results when no API key is set", async () => {
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

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
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
                value: new TextEncoder().encode(mockHtml),
              };
            },
            cancel: async () => {},
          };
        },
      },
    });

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

  it("falls back to mock when DuckDuckGo returns no parseable results", async () => {
    vi.stubEnv("WEB_SEARCH_API_KEY", "");

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
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
                value: new TextEncoder().encode("<html><body>No results</body></html>"),
              };
            },
            cancel: async () => {},
          };
        },
      },
    });

    const result = await executeRealWebSearch({
      query: "obscure query with no results",
    });

    // Should fall back to mock results since no real results were parsed
    expect(result.query).toBe("obscure query with no results");
    expect(result.mode).toBe("mock");
    expect(result.results.length).toBeGreaterThan(0);
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
