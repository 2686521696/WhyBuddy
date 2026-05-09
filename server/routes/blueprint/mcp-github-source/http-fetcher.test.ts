import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  MockAgent,
  setGlobalDispatcher,
  getGlobalDispatcher,
  type Dispatcher,
} from "undici";

import {
  McpGithubFetcherError,
  createDefaultBlueprintHttpFetcher,
} from "./http-fetcher.js";

describe("createDefaultBlueprintHttpFetcher", () => {
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeEach(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterEach(async () => {
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
  });

  it("returns status / headers / body / finalUrl on a 200 response", async () => {
    mockAgent
      .get("https://api.github.com")
      .intercept({ path: "/repos/example/dashboard", method: "GET" })
      .reply(
        200,
        '{"name":"dashboard","full_name":"example/dashboard"}',
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            etag: 'W/"abc123"',
          },
        },
      );

    const fetcher = createDefaultBlueprintHttpFetcher({
      maxResponseBodyBytes: 1_048_576,
      defaultTimeoutMs: 5_000,
    });
    const response = await fetcher.fetch(
      "https://api.github.com/repos/example/dashboard",
    );
    expect(response.status).toBe(200);
    expect(response.body).toBe(
      '{"name":"dashboard","full_name":"example/dashboard"}',
    );
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers.etag).toBe('W/"abc123"');
    expect(response.finalUrl).toBe(
      "https://api.github.com/repos/example/dashboard",
    );
  });

  it("throws McpGithubFetcherError({ kind: 'body_too_large' }) when the body exceeds the ceiling", async () => {
    const big = "x".repeat(2048);
    mockAgent
      .get("https://api.github.com")
      .intercept({ path: "/repos/example/big", method: "GET" })
      .reply(200, big, {
        headers: { "content-type": "text/plain" },
      });

    const fetcher = createDefaultBlueprintHttpFetcher({
      maxResponseBodyBytes: 512,
      defaultTimeoutMs: 5_000,
    });
    await expect(
      fetcher.fetch("https://api.github.com/repos/example/big"),
    ).rejects.toMatchObject({
      name: "McpGithubFetcherError",
      kind: "body_too_large",
    });
  });

  it("throws McpGithubFetcherError({ kind: 'timeout' }) when the upstream delays past timeoutMs", async () => {
    mockAgent
      .get("https://api.github.com")
      .intercept({ path: "/repos/example/slow", method: "GET" })
      // 200ms server delay; fetcher timeout is 50ms → aborts first
      .reply(200, '{"ok":true}', {
        headers: { "content-type": "application/json" },
      })
      .delay(200);

    const fetcher = createDefaultBlueprintHttpFetcher({
      maxResponseBodyBytes: 1_048_576,
      defaultTimeoutMs: 5_000,
    });
    await expect(
      fetcher.fetch("https://api.github.com/repos/example/slow", {
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({
      name: "McpGithubFetcherError",
      kind: "timeout",
    });
  });

  it("throws McpGithubFetcherError({ kind: 'invalid_url' }) for http:// URLs before dispatching", async () => {
    const fetcher = createDefaultBlueprintHttpFetcher({
      maxResponseBodyBytes: 1_048_576,
      defaultTimeoutMs: 5_000,
    });
    await expect(
      fetcher.fetch("http://api.github.com/repos/example/dashboard"),
    ).rejects.toBeInstanceOf(McpGithubFetcherError);
    await expect(
      fetcher.fetch("http://api.github.com/repos/example/dashboard"),
    ).rejects.toMatchObject({ kind: "invalid_url" });
  });

  it("throws McpGithubFetcherError({ kind: 'non_2xx' }) for 404 / 500 responses", async () => {
    mockAgent
      .get("https://api.github.com")
      .intercept({ path: "/repos/example/missing", method: "GET" })
      .reply(404, '{"message":"Not Found"}', {
        headers: { "content-type": "application/json" },
      });

    const fetcher = createDefaultBlueprintHttpFetcher({
      maxResponseBodyBytes: 1_048_576,
      defaultTimeoutMs: 5_000,
    });
    await expect(
      fetcher.fetch("https://api.github.com/repos/example/missing"),
    ).rejects.toMatchObject({
      name: "McpGithubFetcherError",
      kind: "non_2xx",
    });
  });

  it("throws McpGithubFetcherError({ kind: 'invalid_url' }) for entirely malformed input", async () => {
    const fetcher = createDefaultBlueprintHttpFetcher({
      maxResponseBodyBytes: 1_048_576,
      defaultTimeoutMs: 5_000,
    });
    await expect(fetcher.fetch("not a url")).rejects.toMatchObject({
      name: "McpGithubFetcherError",
      kind: "invalid_url",
    });
  });
});
