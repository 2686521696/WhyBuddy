import { describe, expect, it } from "vitest";

import { buildGithubRepoApiUrl, parseGithubUrl } from "./url-parser.js";

describe("parseGithubUrl", () => {
  it("parses canonical owner/repo form", () => {
    expect(parseGithubUrl("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("strips the .git suffix", () => {
    expect(parseGithubUrl("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("ignores tail path segments like /tree/main", () => {
    expect(
      parseGithubUrl("https://github.com/owner/repo/tree/main"),
    ).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns null for system entry points like /orgs/foo", () => {
    expect(parseGithubUrl("https://github.com/orgs/foo")).toBeNull();
    expect(parseGithubUrl("https://github.com/marketplace/bar")).toBeNull();
    expect(parseGithubUrl("https://github.com/features/baz")).toBeNull();
  });

  it("returns null for malformed or non-github URLs", () => {
    expect(parseGithubUrl("not a url")).toBeNull();
    expect(parseGithubUrl("https://example.com/owner/repo")).toBeNull();
    expect(parseGithubUrl("")).toBeNull();
  });

  it("returns null when the path lacks a repo segment", () => {
    expect(parseGithubUrl("https://github.com/owner")).toBeNull();
    expect(parseGithubUrl("https://github.com/")).toBeNull();
  });

  it("accepts www.github.com host", () => {
    expect(parseGithubUrl("https://www.github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("does not enforce scheme (policy layer owns https)", () => {
    expect(parseGithubUrl("http://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });
});

describe("buildGithubRepoApiUrl", () => {
  it("builds the default api.github.com URL", () => {
    expect(
      buildGithubRepoApiUrl({ owner: "a", repo: "b" }),
    ).toBe("https://api.github.com/repos/a/b");
  });

  it("URL-encodes owner and repo segments", () => {
    expect(
      buildGithubRepoApiUrl({ owner: "node.js", repo: "server core" }),
    ).toBe("https://api.github.com/repos/node.js/server%20core");
  });

  it("honours a custom apiBase and strips trailing slash", () => {
    expect(
      buildGithubRepoApiUrl(
        { owner: "a", repo: "b" },
        { apiBase: "https://enterprise.example/api/v3/" },
      ),
    ).toBe("https://enterprise.example/api/v3/repos/a/b");
  });
});
