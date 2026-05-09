/**
 * MCP GitHub capability bridge — URL parser and REST API URL builder.
 *
 * Pure module. No HTTP client imports, no `undici`, no module-level `fetch()`.
 *
 * Responsibility split:
 * - {@link parseGithubUrl} normalises a user-provided GitHub URL into
 *   `{owner, repo}`. Scheme-level validation (https requirement, allow-list)
 *   is intentionally delegated to the policy layer to avoid coupling.
 * - {@link buildGithubRepoApiUrl} constructs the REST API endpoint the HTTP
 *   path will GET; owner / repo are URL-encoded defensively.
 */

/**
 * System-entry path segments that must not be treated as an `owner` name.
 * Design §4.4 lists `orgs`, `marketplace`, `features` as the V1 baseline.
 */
const SYSTEM_OWNER_BLACKLIST: ReadonlySet<string> = new Set([
  "orgs",
  "marketplace",
  "features",
]);

const ALLOWED_GITHUB_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "www.github.com",
]);

/**
 * Parse a user-provided GitHub repository URL into `{owner, repo}`.
 *
 * Rules (design §4.4):
 * 1. `new URL(raw)` must succeed.
 * 2. Host must be `github.com` or `www.github.com`.
 * 3. Path must have at least two non-empty segments (`[owner, repo, ...]`).
 * 4. `.git` suffix on `repo` is stripped.
 * 5. `owner` must not appear in {@link SYSTEM_OWNER_BLACKLIST}.
 * 6. Any rule violation → return `null`.
 *
 * Scheme validation is intentionally **not** enforced here; the policy layer
 * handles that uniformly for both user-supplied URLs and bridge-derived
 * REST URLs.
 */
export function parseGithubUrl(
  raw: string,
): { owner: string; repo: string } | null {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!ALLOWED_GITHUB_HOSTS.has(parsed.host.toLowerCase())) {
    return null;
  }
  const segments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    return null;
  }
  const owner = segments[0];
  if (SYSTEM_OWNER_BLACKLIST.has(owner.toLowerCase())) {
    return null;
  }
  const rawRepo = segments[1];
  const repo = rawRepo.endsWith(".git")
    ? rawRepo.slice(0, -".git".length)
    : rawRepo;
  if (repo.length === 0) {
    return null;
  }
  return { owner, repo };
}

/**
 * Construct the REST API URL for `GET /repos/{owner}/{repo}`.
 *
 * `apiBase` defaults to `https://api.github.com`; callers pass
 * `policy.allowedHttpOrigins[0]` when they want the policy-aligned base.
 * Owner / repo are `encodeURIComponent`-escaped defensively — GitHub owner
 * and repo names are typically plain slugs, but names like `node.js` do
 * contain `.`, and future schemes may be stricter.
 */
export function buildGithubRepoApiUrl(
  ownerRepo: { owner: string; repo: string },
  options: { apiBase?: string } = {},
): string {
  const base = options.apiBase ?? "https://api.github.com";
  const normalizedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${normalizedBase}/repos/${encodeURIComponent(ownerRepo.owner)}/${encodeURIComponent(ownerRepo.repo)}`;
}
