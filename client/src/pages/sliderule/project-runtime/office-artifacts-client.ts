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

/**
 * 产物库里最新收回的那份办公文件（按收回顺序，后者更新）。读不到当没有（fail-closed）。
 * 结果卡的缩略图画这一份——与右栏宿主默认呈现的是同一份（hostPreviewChoice 取最后收回的）。
 */
export function useLatestOfficeArtifact(
  projectId: string | null | undefined,
  refreshKey?: unknown
): OfficeArtifactMeta | null {
  const items = useOfficeArtifacts(projectId, refreshKey);
  return items.length ? items[items.length - 1] : null;
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

/**
 * ⚠ 成对物：Python `project_office_artifacts.office_artifact_download_url`
 * 拼的是同一个地址，写进命令回执给模型交付用（2026-09-25：模型曾把
 * `sandbox:/home/user/…` 当下载链接给用户）。改一边要改另一边。
 */
export function officeArtifactDownloadUrl(
  projectId: string,
  artifactId: string
): string {
  return `${BASE}/projects/${projectId}/artifacts/${artifactId}`;
}


/** 一份办公文件先后收回过的版本（新的在前）。见 Python ProjectOfficeArtifactStore.versions。 */
export type OfficeArtifactVersion = {
  sha256: string;
  sizeBytes: number;
  capturedAt: string;
  number: number;
  current: boolean;
};

export async function listOfficeVersions(
  projectId: string,
  artifactId: string,
  signal?: AbortSignal
): Promise<OfficeArtifactVersion[]> {
  const response = await fetch(`${BASE}/projects/${projectId}/artifacts/${artifactId}/versions`, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { versions?: OfficeArtifactVersion[] };
  return Array.isArray(body.versions) ? body.versions : [];
}

export function officeVersionDownloadUrl(projectId: string, artifactId: string, sha256: string): string {
  return `${BASE}/projects/${projectId}/artifacts/${artifactId}/versions/${sha256}`;
}

/**
 * 给**画**的那一份（右栏预览、卡片缩略图），不是给下载的：`?view=preview`。
 *
 * ⚠ 2026-10-07 真机 r55 / r56（报销 Excel 追问）：openpyxl 改过的表，公式的存值全空；@silurus/ooxml 只认存值，
 *   右栏和缩略图一整列空白，Excel 打开却是对的（会重算）。宿主在这份字节里按公式补上存值
 *   （Python deliverable_kind.xlsx_preview_bytes）；下载链接照旧是原件。
 */
export function officePreviewUrl(downloadUrl: string): string {
  return `${downloadUrl}${downloadUrl.includes("?") ? "&" : "?"}view=preview`;
}

export async function restoreOfficeVersion(projectId: string, artifactId: string, sha256: string): Promise<boolean> {
  const response = await fetch(
    `${BASE}/projects/${projectId}/artifacts/${artifactId}/versions/${sha256}/restore`,
    { method: "POST", credentials: "include", cache: "no-store" }
  );
  return response.ok;
}

/** 这份文件的版本列表；sha 变了（追问改写、恢复旧版）就重取。 */
export function useOfficeVersions(
  projectId: string | null | undefined,
  artifactId: string | null | undefined,
  refreshKey?: unknown
): OfficeArtifactVersion[] {
  const [items, setItems] = useState<OfficeArtifactVersion[]>([]);
  useEffect(() => {
    const pid = String(projectId || "").trim();
    const aid = String(artifactId || "").trim();
    if (!pid || !aid) {
      setItems([]);
      return;
    }
    const ac = new AbortController();
    void listOfficeVersions(pid, aid, ac.signal)
      .then(next => {
        if (!ac.signal.aborted) setItems(next);
      })
      .catch(() => {
        if (!ac.signal.aborted) setItems([]);
      });
    return () => ac.abort();
  }, [projectId, artifactId, refreshKey]);
  return items;
}
