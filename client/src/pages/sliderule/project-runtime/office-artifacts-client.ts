import { useEffect, useState } from "react";

const BASE = "/api/sliderule";

export type OfficeArtifactMeta = {
  artifactId: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  downloadable?: boolean;
};

export async function listOfficeArtifacts(
  projectId: string,
  signal?: AbortSignal
): Promise<OfficeArtifactMeta[]> {
  const response = await fetch(`${BASE}/projects/${projectId}/artifacts`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { files?: OfficeArtifactMeta[] };
  return Array.isArray(body.files) ? body.files : [];
}

/** 已经收回的办公文件。读不到当没有（fail-closed），不编一份预览。 */
export function useOfficeArtifacts(
  projectId: string | null | undefined,
  refreshKey?: unknown
): OfficeArtifactMeta[] {
  const [items, setItems] = useState<OfficeArtifactMeta[]>([]);
  useEffect(() => {
    const id = String(projectId || "").trim();
    if (!id) {
      setItems([]);
      return;
    }
    const ac = new AbortController();
    void listOfficeArtifacts(id, ac.signal)
      .then(next => {
        if (!ac.signal.aborted) setItems(next);
      })
      .catch(() => {
        if (!ac.signal.aborted) setItems([]);
      });
    return () => ac.abort();
  }, [projectId, refreshKey]);
  return items;
}

/** 产物库有没有办公文件。读不到当没有（fail-closed）。 */
export function useOfficeArtifactPresent(
  projectId: string | null | undefined,
  refreshKey?: unknown
): boolean {
  const [present, setPresent] = useState(false);
  useEffect(() => {
    const id = String(projectId || "").trim();
    if (!id) {
      setPresent(false);
      return;
    }
    const ac = new AbortController();
    void listOfficeArtifacts(id, ac.signal)
      .then(items => {
        if (!ac.signal.aborted) setPresent(items.length > 0);
      })
      .catch(() => {
        if (!ac.signal.aborted) setPresent(false);
      });
    return () => ac.abort();
  }, [projectId, refreshKey]);
  return present;
}

export function officeArtifactDownloadUrl(
  projectId: string,
  artifactId: string
): string {
  return `${BASE}/projects/${projectId}/artifacts/${artifactId}`;
}
