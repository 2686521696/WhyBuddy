/** Put the original file on the session. The exec sandbox copies it later. */

export type SessionUploadResult = {
  name: string;
  path: string;
};

export function sessionUploadUrl(sessionId: string, name: string): string {
  return (
    `/api/sliderule/sessions/${encodeURIComponent(sessionId)}` +
    `/uploads?name=${encodeURIComponent(name)}`
  );
}

export async function uploadSessionFile(
  sessionId: string,
  file: File
): Promise<SessionUploadResult> {
  const response = await fetch(sessionUploadUrl(sessionId, file.name), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = (await response.json()) as SessionUploadResult;
  if (!body?.path) throw new Error("upload_missing_path");
  return body;
}

/** Fact appended to the user message. Not a substitute for the bytes. */
export function workspaceUploadNote(
  placed: SessionUploadResult[],
  failed: string[]
): string {
  const lines = [
    ...placed.map(item => `[工作区文件 ${item.path}]`),
    ...failed.map(name => `【附件 ${name}】没有放进工作区。`),
  ];
  return lines.join("\n");
}
