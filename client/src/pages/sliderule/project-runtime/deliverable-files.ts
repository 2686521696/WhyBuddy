/**
 * 交付文件的类别：右栏查看器、结果卡缩略图、产物标签页都从这里认后缀。
 *
 * ⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004174725-J5XFTG8673：模型写了一份 Markdown，
 *   办公计划只认 .pptx / .docx / .xlsx，交付落回「做网页」，用户拿到一个点不开的沙盒路径。
 *   后端放开之后，前端各处原来各写各的 `/\.(pptx|docx|xlsx)$/`（project-computer-view 的 isOfficePath、
 *   PresentedOfficeFile 的 officeKind、OfficeThumbnail 的 endsWith）——漏一处，.md 进了库也在那一处被静默滤掉。
 *   所以收成这一份。
 *
 * ⚠ 成对物：Python `services/deliverable_kind.py` 的 OFFICE_EXTENSIONS / TEXT_DELIVERABLE_EXTENSIONS。
 *   判据 __tests__/deliverable-files.test.ts 直接读那份 Python 源码比对，改一边要改另一边。
 */

export const OFFICE_DELIVERABLE_EXTENSIONS = [".pptx", ".docx", ".xlsx"] as const;
export const TEXT_DELIVERABLE_EXTENSIONS = [".md", ".txt", ".csv"] as const;

export type OfficeDeliverableKind = "pptx" | "docx" | "xlsx";
export type TextDeliverableKind = "markdown" | "text" | "csv";
export type DeliverableKind = OfficeDeliverableKind | TextDeliverableKind;

const KIND_BY_EXTENSION: Record<string, DeliverableKind> = {
  ".pptx": "pptx",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".md": "markdown",
  ".txt": "text",
  ".csv": "csv",
};

/** 文件名的后缀（小写，带点）；跟 Python deliverable_suffix 一样，光一个「.md」不算。 */
function extensionOf(path: string): string {
  const name = String(path || "").replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

export function deliverableKind(path: string | null | undefined): DeliverableKind | null {
  return KIND_BY_EXTENSION[extensionOf(String(path || ""))] ?? null;
}

export function isDeliverablePath(path: string | null | undefined): boolean {
  return deliverableKind(path) !== null;
}

export function isTextDeliverableKind(kind: DeliverableKind | null): kind is TextDeliverableKind {
  return kind === "markdown" || kind === "text" || kind === "csv";
}

/** 文本交付物的字节 → 字符串。UTF-8，去掉 BOM（Python 端按 utf-8-sig 收的）。 */
export function decodeTextDeliverable(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/**
 * RFC 4180 的 CSV：引号里的逗号、换行、`""` 转义都认。只取前 maxRows 行、maxCols 列（预览，不是编辑器）。
 */
export function parseCsv(
  text: string,
  maxRows = 500,
  maxCols = 50
): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    if (row.length < maxCols) row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i += 1;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRow();
      if (rows.length > maxRows) break;
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (rows.length <= maxRows && (cell !== "" || row.length > 0)) pushRow();
  return { rows: rows.slice(0, maxRows), truncated: rows.length > maxRows };
}
