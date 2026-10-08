export interface PreviewSelectionScope {
  projectId: string;
  runtimeId: string;
  revision: string;
}
export interface PreviewSourceLocation {
  path: string;
  line: number;
  column: number;
}

export function validSourcePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1024 &&
    !/[\\\x00-\x1f:]/.test(value) &&
    !value.startsWith("/") &&
    value.split("/").every(part => part !== "." && part !== ".." && part !== "")
  );
}

/**
 * 从工程动作的结构化细节里取出正在改的那份文件。
 *
 * 开场摘要是 `src/Home.tsx、src/api/tasks.ts`；命令 / 版本号不是 path。
 * 认 validSourcePath，不解析人话 label。
 */
export function sourcePathFromActionDetail(detail: string): string | null {
  const raw = String(detail || "").trim();
  if (!raw) return null;
  for (const part of raw.split(/[、,，\s]+/)) {
    let path = part.trim();
    if (path.includes("等") && /个文件$/.test(path)) {
      path = path.split("等")[0]?.trim() ?? "";
    }
    if (!validSourcePath(path)) continue;
    if (!path.includes("/") && !/\.[A-Za-z0-9]{1,8}$/.test(path)) continue;
    return path;
  }
  return null;
}

/** 预览里应用自己抛出来的错（shared/project-preview-selection.mjs 头注）。 */
export interface PreviewRuntimeError {
  kind: "uncaught_exception" | "unhandled_rejection";
  message: string;
  stack: string;
}

/** 页面那一侧是生成的应用，发来什么都不可信：形状不对就丢，长度再封一次。 */
export function previewRuntimeError(value: unknown): PreviewRuntimeError | null {
  const raw = value as Partial<PreviewRuntimeError> | null;
  if (
    !raw ||
    (raw.kind !== "uncaught_exception" && raw.kind !== "unhandled_rejection") ||
    typeof raw.message !== "string" ||
    !raw.message.trim() ||
    (raw.stack !== undefined && typeof raw.stack !== "string")
  )
    return null;
  return {
    kind: raw.kind,
    message: raw.message.slice(0, 500),
    stack: (raw.stack || "").slice(0, 2000),
  };
}

/** Sandpack's source/channel lifecycle, with explicit origin and revision fencing. */
export function connectPreviewSelection({
  frame,
  origin,
  scope,
  onSelection,
  onStatus,
  onRuntimeError,
}: {
  frame: HTMLIFrameElement;
  origin: string;
  scope: PreviewSelectionScope;
  onSelection: (location: PreviewSourceLocation) => void;
  onStatus: (status: "ready" | "missing-source") => void;
  onRuntimeError?: (error: PreviewRuntimeError) => void;
}) {
  const channelId = crypto.randomUUID();
  let enabled = false;
  let disposed = false;
  const send = () => {
    if (!frame.isConnected || disposed) return;
    frame.contentWindow?.postMessage(
      {
        type: "whybuddy:select:init",
        schemaVersion: 1,
        ...scope,
        channelId,
        enabled,
      },
      origin
    );
  };
  const receive = (event: MessageEvent) => {
    if (
      disposed ||
      event.source !== frame.contentWindow ||
      event.origin !== origin
    )
      return;
    const data = event.data;
    if (
      !data ||
      data.schemaVersion !== 1 ||
      data.channelId !== channelId ||
      data.projectId !== scope.projectId ||
      data.runtimeId !== scope.runtimeId ||
      data.revision !== scope.revision
    )
      return;
    if (data.type === "whybuddy:select:ready") {
      onStatus("ready");
      return;
    }
    if (data.type === "whybuddy:runtime:error") {
      // 不看 enabled：点选开没开，报错都要回来。
      const error = previewRuntimeError(data.error);
      if (error) onRuntimeError?.(error);
      return;
    }
    if (!enabled || data.type !== "whybuddy:select:element") return;
    if (data.location === null) {
      onStatus("missing-source");
      return;
    }
    const location = data.location;
    if (
      !validSourcePath(location?.path) ||
      !Number.isInteger(location.line) ||
      location.line < 1 ||
      location.line > 1_000_000 ||
      !Number.isInteger(location.column) ||
      location.column < 1 ||
      location.column > 1_000_000
    )
      return;
    onSelection({
      path: location.path,
      line: location.line,
      column: location.column,
    });
  };
  window.addEventListener("message", receive);
  frame.addEventListener("load", send);
  send();
  return {
    setEnabled(value: boolean) {
      enabled = value;
      send();
    },
    dispose() {
      enabled = false;
      send();
      disposed = true;
      window.removeEventListener("message", receive);
      frame.removeEventListener("load", send);
    },
  };
}
