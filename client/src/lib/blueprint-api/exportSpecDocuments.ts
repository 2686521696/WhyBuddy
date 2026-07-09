/**
 * `autopilot-spec-document-export` Task 4.1：前端 SPEC 文档导出 API helper。
 *
 * 调用后端 `GET /api/blueprint/jobs/:jobId/spec-documents/export`，把响应
 * 当作 Blob 直接触发浏览器下载（`URL.createObjectURL` + 临时 `<a download>`）。
 *
 * - 永不抛进 React 树外；调用方应在 try/catch 里把错误归一为 inline UI 状态
 * - 不依赖 jsdom / @testing-library/react；测试期通过 `vi.mock` global fetch
 *   + 局部 patch `document.createElement` 与 `URL.createObjectURL` 验证调用顺序
 *
 * Req: 2.2, 3.3
 */

export type SpecExportGranularity = "single" | "node" | "tree";

export interface ExportSpecDocumentsArgs {
  /** 蓝图 job 的 UUID。 */
  jobId: string;
  /** 导出颗粒度。 */
  granularity: SpecExportGranularity;
  /** 单文档 / 节点级必填。 */
  nodeId?: string;
  /** 单文档必填。 */
  type?: "requirements" | "design" | "tasks";
  /** 可选，便于调用方用 AbortController 取消下载。 */
  signal?: AbortSignal;
}

/**
 * 调用导出 API 并触发浏览器下载。失败时抛 Error（含描述性 message）。
 *
 * 实施细节：
 * - 拼 query string；缺字段由后端 400 拒绝
 * - `await fetch(url, { signal })`；非 2xx 抛 Error，message 含 status + body 摘要
 * - `await response.blob()` + `URL.createObjectURL(blob)` + 临时 `<a>` 触发下载
 * - 紧接着 `URL.revokeObjectURL` 清理；finally 中移除临时 `<a>`
 */
export async function exportSpecDocumentsToDownload(
  args: ExportSpecDocumentsArgs,
): Promise<void> {
  const params = new URLSearchParams();
  params.set("granularity", args.granularity);
  if (args.nodeId) params.set("nodeId", args.nodeId);
  if (args.type) params.set("type", args.type);

  const url = `/api/blueprint/jobs/${encodeURIComponent(args.jobId)}/spec-documents/export?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    signal: args.signal,
  });

  if (!response.ok) {
    let bodySnippet = "";
    try {
      bodySnippet = (await response.text()).slice(0, 200);
    } catch {
      bodySnippet = "<unreadable response body>";
    }
    throw new Error(
      `Export failed: HTTP ${response.status} ${response.statusText}. ${bodySnippet}`,
    );
  }

  const filename = parseFilenameFromContentDisposition(
    response.headers.get("content-disposition"),
    args,
  );
  const blob = await response.blob();
  triggerBlobDownload(blob, filename);
}

/**
 * 解析 `Content-Disposition` 头取出 filename。失败时回退到 `<jobId>-<granularity>.<ext>`
 * 格式（granularity = single → md，其它 → zip）。
 *
 * 优先级：
 * 1. RFC 5987 编码字段 `filename*=UTF-8''<percent-encoded>`（Chrome / Firefox /
 *    Safari / Edge 现代浏览器优先消费此字段，支持中文 / emoji / 任意非 ASCII）
 * 2. ASCII fallback 字段 `filename="<ascii>"`（老浏览器与脚本工具回落使用）
 * 3. 客户端默认 `<jobId>-<granularity>.<ext>`
 *
 * 本仓库后端 `formatContentDisposition` 同时输出两个字段，因此 modern
 * fetch 能拿到正确中文文件名；只有当后端 / 反向代理裁剪 `filename*` 时
 * 才会退回到 ASCII fallback。
 */
function parseFilenameFromContentDisposition(
  disposition: string | null,
  args: ExportSpecDocumentsArgs,
): string {
  if (disposition) {
    // 1. RFC 5987：filename*=UTF-8''<percent-encoded>
    const utf8Match = /filename\*=UTF-8''([^;\r\n"]+)/i.exec(disposition);
    if (utf8Match && utf8Match[1].length > 0) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        // 编码异常（理论上不会，因后端用 encodeURIComponent 输出）
        // 落到 ASCII fallback 兜底
      }
    }
    // 2. ASCII fallback：filename="<ascii>"
    const asciiMatch = /filename="([^"]+)"/.exec(disposition);
    if (asciiMatch && asciiMatch[1].length > 0) {
      return asciiMatch[1];
    }
  }
  const ext = args.granularity === "single" ? "md" : "zip";
  return `${args.jobId}-${args.granularity}.${ext}`;
}

/**
 * 触发浏览器下载。
 *
 * 通过临时 `<a>` 元素 + `URL.createObjectURL`，下载完成后立即
 * `URL.revokeObjectURL` + `removeChild`，避免内存泄漏与 DOM 残留。
 */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  try {
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    if (anchor.parentNode) {
      anchor.parentNode.removeChild(anchor);
    }
    URL.revokeObjectURL(url);
  }
}
