const BASE = "/api/sliderule";

export type OfficeArtifactMeta = {
  artifactId: string;
  path: string;
  sha256: string;
  sizeBytes: number;
  downloadable?: boolean;
};

export type OfficeArtifactPreview =
  | { kind: "slides"; slides: Array<{ text: string }> }
  | { kind: "document"; text: string }
  | { kind: "workbook"; sheetCount: number }
  | { kind: "pdf" }
  | { kind: null };

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

export function officeArtifactDownloadUrl(
  projectId: string,
  artifactId: string
): string {
  return `${BASE}/projects/${projectId}/artifacts/${artifactId}`;
}

export function officeArtifactPreviewUrl(
  projectId: string,
  artifactId: string
): string {
  return `${BASE}/projects/${projectId}/artifacts/${artifactId}/preview`;
}

export async function loadOfficeArtifactPreview(
  projectId: string,
  artifactId: string,
  signal?: AbortSignal
): Promise<OfficeArtifactPreview> {
  const response = await fetch(officeArtifactPreviewUrl(projectId, artifactId), {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return { kind: null };
  const type = response.headers.get("content-type") || "";
  if (type.includes("application/pdf")) return { kind: "pdf" };
  const body = (await response.json()) as OfficeArtifactPreview;
  return body && typeof body === "object" ? body : { kind: null };
}
