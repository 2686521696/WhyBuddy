/**
 * 用户气泡里能看见的部分。附件的解析正文只给模型，不给气泡。
 *
 * ⚠ 2026-09-24 真机：图片解析 3072 字整段贴进灰色气泡，用户以为上传坏了。
 *   Trae 的气泡只有那句任务，文件是输入框里的卡片。发出去的 userText
 *   仍带着【附件内容】，模型才读得到图；这里只决定画什么。
 */

export type VisibleUserMessage = {
  prompt: string;
  files: string[];
};

function remember(files: string[], name: string) {
  const trimmed = name.trim();
  if (trimmed && !files.includes(trimmed)) files.push(trimmed);
}

/** 从已发出的 userText 拆出任务句和文件名。解析正文、工作区路径都不进气泡。 */
export function visibleUserMessage(raw: string): VisibleUserMessage {
  const files: string[] = [];
  const prompt: string[] = [];
  let hiding = false;
  for (const line of String(raw || "").split("\n")) {
    const listed = line.match(/^\[附件:\s*(.*)\]\s*$/);
    if (listed) {
      hiding = false;
      for (const name of listed[1].split(",")) remember(files, name);
      continue;
    }
    if (/^\[工作区文件 /.test(line)) {
      hiding = false;
      continue;
    }
    const extracted = line.match(/^【附件内容 · (.+)】\s*$/);
    if (extracted) {
      hiding = true;
      remember(files, extracted[1]);
      continue;
    }
    const failed = line.match(/^【附件 (.+?)】/);
    if (failed) {
      hiding = false;
      remember(files, failed[1]);
      continue;
    }
    if (hiding) continue;
    prompt.push(line);
  }
  return { prompt: prompt.join("\n").trim(), files };
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** 发出去之后还能当缩略图点开的，只有这几种图片。 */
export function isPreviewableImageName(name: string): boolean {
  const ext = String(name || "").split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXT.has(ext);
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 输入框里文件卡的第二行。照 Trae：类型和大小，不报「已解析多少字」。
 * 解析还在跑才写「解析中…」；失败写「解析失败」。
 */
export function attachmentStatusLine(att: {
  name: string;
  size: number;
  extractStatus?: "pending" | "ready" | "failed";
}): string {
  if (att.extractStatus === "pending") return "解析中…";
  if (att.extractStatus === "failed") return "解析失败";
  const ext = att.name.includes(".")
    ? att.name.split(".").pop()!.toUpperCase()
    : "FILE";
  return `${ext} · ${formatFileSize(att.size)}`;
}
