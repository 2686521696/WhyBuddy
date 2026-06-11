/** Shared GitHub URL helpers for orchestrator pick + server capability routing. */

const GITHUB_REPO_RE =
  /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i;

export function scanForGithubUrl(text: string): string | null {
  if (typeof text !== "string" || !text.length) return null;
  const m = text.match(GITHUB_REPO_RE);
  if (!m) return null;
  return m[0].replace(/\.git$/i, "");
}

export function extractGithubRepoSlug(url: string): string {
  const m = url.match(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/i);
  if (!m) return url;
  return `${m[1]}/${m[2].replace(/\.git$/i, "")}`;
}

export function findGithubUrlInTexts(...texts: Array<string | undefined | null>): string | null {
  for (const t of texts) {
    const url = scanForGithubUrl(String(t || ""));
    if (url) return url;
  }
  return null;
}