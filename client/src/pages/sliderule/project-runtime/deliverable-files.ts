/**
 * 交付文件的类别：右栏查看器、结果卡缩略图、产物标签页都从这里认后缀。
 *
 * ⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004174725-J5XFTG8673：模型写了一份 Markdown，
 *   办公计划只认 .pptx / .docx / .xlsx，交付落回「做网页」，用户拿到一个点不开的沙盒路径。
 *   后端放开之后，前端各处原来各写各的 `/\.(pptx|docx|xlsx)$/`（project-computer-view 的 isOfficePath、
 *   PresentedOfficeFile 的 officeKind、OfficeThumbnail 的 endsWith）——漏一处，.md 进了库也在那一处被静默滤掉。
 *   所以收成这一份。
 *
 * ⚠ 2026-10-07 真机 r85 sr-20261007155747-HMKAPNJ7WK（@data-visualization-discipline 四店趋势图）：图片交付物
 *   （deliverable_kind.IMAGE_DELIVERABLE_EXTENSIONS）进了产物库，这里不认就会在右栏 / 缩略图被静默滤掉——同一份清单加上。
 *
 * ⚠ 成对物：Python `services/deliverable_kind.py` 的 OFFICE_EXTENSIONS / TEXT_DELIVERABLE_EXTENSIONS / IMAGE_DELIVERABLE_EXTENSIONS。
 *   判据 __tests__/deliverable-files.test.ts 直接读那份 Python 源码比对，改一边要改另一边。
 */

export const OFFICE_DELIVERABLE_EXTENSIONS = [".pptx", ".docx", ".xlsx"] as const;
export const TEXT_DELIVERABLE_EXTENSIONS = [".md", ".txt", ".csv"] as const;
export const IMAGE_DELIVERABLE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp"] as const;

export type OfficeDeliverableKind = "pptx" | "docx" | "xlsx";
export type TextDeliverableKind = "markdown" | "text" | "csv";
export type ImageDeliverableKind = "image";
export type DeliverableKind = OfficeDeliverableKind | TextDeliverableKind | ImageDeliverableKind;

const KIND_BY_EXTENSION: Record<string, DeliverableKind> = {
  ".pptx": "pptx",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".md": "markdown",
  ".txt": "text",
  ".csv": "csv",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
};

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
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

export function isImageDeliverableKind(kind: DeliverableKind | null): kind is ImageDeliverableKind {
  return kind === "image";
}

/** 图片交付物的媒体类型（拼 Blob 用）；不是图片返回空串。 */
export function imageMimeOf(path: string | null | undefined): string {
  return IMAGE_MIME[extensionOf(String(path || ""))] ?? "";
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

/**
 * 一轮收回了几份文件时，哪一份是「主交付」：结果卡封面和右栏默认打开的都是它（两处同一个口径）。
 * 有办公文件或图片就取其中最后收回的；只有文本才取最后一份文本。
 *
 * ⚠ 2026-10-07 真机 r88 sr-20261007165549-YHYGJNAB8A（@data-visualization-discipline 四店趋势图）：收回三份——
 *   两张图表 PNG 和一份 store-sales-h1-check.txt 核验说明。原来两处都取「最后收回的」，模型最后写的是核验说明，
 *   结果卡封面和右栏默认打开的都成了一段文字，主交付的图表要用户自己点标签才看得到。
 */
export function pickMainDeliverable<T>(items: readonly T[], pathOf: (item: T) => string): T | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const kind = deliverableKind(pathOf(items[i]));
    if (kind && !isTextDeliverableKind(kind)) return items[i];
  }
  return items.length ? items[items.length - 1] : null;
}
