/**
 * Self-contained preview-side installer. The preview gateway injects trusted identity
 * and the exact workbench origin. Generated content can suggest source locations
 * only; the workbench validates them against authorized immutable source files.
 *
 * 运行时报错回到工作台（whybuddy:runtime:error）：照 stackblitz-labs/bolt.diy（MIT）预览报错 →「Ask Bolt」——
 * 未捕获异常、未处理的 Promise 拒绝，原话（封顶）发给工作台，用户一键交给 Agent 修。
 * ⚠ 2026-10-08：这个脚本排在 /src/main.tsx 后面加载、还要先过网关鉴权，首屏渲染就炸的那种错早于监听器。
 *   照 Sentry Loader 的「先排队、后回放」：模板 index.html 头里一小段内联脚本把早期报错攒在
 *   window.__whybuddyEarlyErrors，这里装好后补报。握手（init）之前的也先攒着，拿到 channelId 再发。
 * 整个函数被 toString() 注入页面，不许引用外层任何东西。
 */
export function installPreviewSelectionBridge(config) {
  if (
    window.parent === window ||
    !config ||
    !/^https?:\/\//.test(config.workbenchOrigin)
  )
    return () => {};
  let channelId = null;
  let enabled = false;
  const send = (type, extra = {}) =>
    window.parent.postMessage(
      {
        type,
        schemaVersion: 1,
        projectId: config.projectId,
        runtimeId: config.runtimeId,
        revision: config.revision,
        channelId,
        ...extra,
      },
      config.workbenchOrigin
    );
  const receive = event => {
    if (
      event.source !== window.parent ||
      event.origin !== config.workbenchOrigin
    )
      return;
    const data = event.data;
    if (
      !data ||
      data.type !== "whybuddy:select:init" ||
      data.schemaVersion !== 1 ||
      data.projectId !== config.projectId ||
      data.runtimeId !== config.runtimeId ||
      data.revision !== config.revision ||
      typeof data.channelId !== "string" ||
      data.channelId.length > 100 ||
      typeof data.enabled !== "boolean"
    )
      return;
    channelId = data.channelId;
    enabled = data.enabled;
    send("whybuddy:select:ready");
    flushErrors();
  };
  const select = event => {
    if (!enabled || !channelId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const target =
      event.target instanceof Element
        ? event.target.closest("[data-whybuddy-source]")
        : null;
    send("whybuddy:select:element", {
      location: target
        ? {
            path: target.getAttribute("data-whybuddy-source"),
            line: Number(target.getAttribute("data-whybuddy-line")),
            column: Number(target.getAttribute("data-whybuddy-column") || 1),
          }
        : null,
    });
  };
  const pendingErrors = [];
  const seenErrors = new Set();
  const flushErrors = () => {
    while (channelId && pendingErrors.length)
      send("whybuddy:runtime:error", { error: pendingErrors.shift() });
  };
  const reportError = (kind, message, stack) => {
    const text = String(message || "").slice(0, 500);
    const key = kind + "\n" + text;
    // 同一句只报一次、一页最多十条：渲染循环里反复抛的同一个错不刷屏。
    if (!text || seenErrors.has(key) || seenErrors.size >= 10) return;
    seenErrors.add(key);
    pendingErrors.push({ kind, message: text, stack: String(stack || "").slice(0, 2000) });
    flushErrors();
  };
  const onError = event => {
    // 捕获阶段的图片 / 脚本加载失败是普通 Event，不是 ErrorEvent——那是请求失败，不是代码异常。
    if (!(event instanceof ErrorEvent)) return;
    const error = event.error;
    reportError("uncaught_exception", (error && error.message) || event.message,
      (error && error.stack) || (event.filename ? event.filename + ":" + event.lineno + ":" + event.colno : ""));
  };
  const onRejection = event => {
    const reason = event.reason;
    reportError("unhandled_rejection", reason && reason.message ? reason.message : String(reason),
      reason && reason.stack);
  };
  const early = window.__whybuddyEarlyErrors;
  if (Array.isArray(early))
    for (const item of early.slice(0, 10))
      if (Array.isArray(item)) reportError(item[0], item[1], item[2]);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("message", receive);
  document.addEventListener("click", select, true);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("message", receive);
    document.removeEventListener("click", select, true);
  };
}
