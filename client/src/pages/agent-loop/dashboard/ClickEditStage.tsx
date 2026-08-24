/**
 * 点选编辑舞台（2026-08-24）——应用中心只读预览里的"点一下改一下"。
 *
 * 前身是 `client/public/click-edit.html`：独立小工具，验证"点选编辑接真实
 * pages_json 能不能走通"（真机 E2E 过：真登录、真选中、真保存、真落库）。
 * 这里是把它收进正式 UI 的那一半，渲染管线换成跟只读预览**同一条**
 * （html-app-surface 的 sanitize + Tailwind 注入），不再自己另起一套。
 *
 * ## 存库时不能把"渲染用"的文档整份存回去 —— 这是设计的核心约束
 *
 * 画布里看到的 iframe 文档被注入了 Tailwind CDN script、铺满/对比度覆盖层
 * （见 html-app-surface.buildDocument）——那是**给人看的**，存回
 * `pages_json` 会：①下次 HtmlAppSurface 渲染时再注入一遍，脚本标签越攒越多；
 * ②`sanitizeAppHtml` 下次消毒会把我们自己注入的 `<script>` 摘掉但摘不干净
 * 残留的配色/覆盖 `<style>`，两边分叉。
 *
 * 做法：body 之外一律不碰。存库时单独把**原始** HTML（不经 Tailwind 注入的
 * `stripFrameNavigatingHrefs(sanitizeAppHtml(...))`）重跑一遍拿到"干净壳"，
 * 只用画布里编辑过的 `<body>` 去换那份干净壳的 `<body>`。两者的 body 在没有
 * 编辑动作时逐字节相同（`buildDocument` 第一步就是这同一对函数，且 Tailwind
 * Play 只往 head 塞样式、不改 body 结构/属性——这条断言没有测试钉，
 * 全靠这两处调用的是同一份函数保证，改动其中一处务必回来看这条注释）。
 */

import React from "react";

import {
  buildDocument,
  sanitizeAppHtml,
  stripFrameNavigatingHrefs,
  markSrcdocGeneration,
} from "@/pages/sliderule/live-runtime/html-app-surface";
import { BINDING_ATTRS } from "@/pages/sliderule/live-runtime/html-binding-runtime";
import { useScaleToFit, specPageViewport } from "@/pages/sliderule/live-runtime/canvas-scale";
import { updateAppPage } from "./app-store-client";
import { Undo2, Save, Trash2, Bold as BoldIcon, X } from "lucide-react";

const BLOCK_TAGS = new Set([
  "BUTTON", "A", "TD", "TH", "LI", "LABEL",
  "H1", "H2", "H3", "H4", "H5", "H6", "SPAN", "P",
]);

/** 选中策略跟 click-edit.html 一致：语义 data-* 优先，退化到块级标签。 */
function closestEditable(start: Element | null): HTMLElement | null {
  let cur: Element | null = start;
  while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML") {
    for (const attr of BINDING_ATTRS) {
      if (cur.hasAttribute(attr)) return cur as HTMLElement;
    }
    cur = cur.parentElement;
  }
  cur = start;
  while (cur && cur.tagName !== "BODY" && cur.tagName !== "HTML") {
    if (BLOCK_TAGS.has(cur.tagName)) return cur as HTMLElement;
    cur = cur.parentElement;
  }
  return null;
}

export function labelOfEditable(el: HTMLElement): string {
  for (const attr of BINDING_ATTRS) {
    if (el.hasAttribute(attr)) return `${attr}="${el.getAttribute(attr)}"`;
  }
  const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 18);
  return text ? `<${el.tagName.toLowerCase()}> ${text}` : `<${el.tagName.toLowerCase()}>`;
}

/**
 * 存库前把编辑过的 body 换回干净壳。纯函数，单测钉着。
 * 找不到 `<body>` 就返回 null——**不许**编一份出来，宁可保存失败让用户重试。
 */
export function spliceEditedBody(originalHtml: string, editedBodyOuterHtml: string): string | null {
  const clean = stripFrameNavigatingHrefs(sanitizeAppHtml(originalHtml));
  if (!clean || !/<body[^>]*>[\s\S]*<\/body>/i.test(clean)) return null;
  return clean.replace(/<body[^>]*>[\s\S]*<\/body>/i, () => editedBodyOuterHtml);
}

interface Selection {
  el: HTMLElement;
  rect: { left: number; top: number; width: number; height: number };
}

export interface ClickEditStageProps {
  appId: string;
  pageId: string;
  html: string;
  device?: "desktop" | "phone";
  /** 存成功后把最终 HTML 报给宿主，好更新本地缓存（details[key].specPages）。 */
  onSaved?: (pageId: string, html: string) => void;
  /** 有没有未保存的改动——宿主切页/关弹窗前拿它决定要不要拦一下。 */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
}

/**
 * ⚠ 按 `${appId}:${pageId}` 当 React key 挂载（AppsWorkbench 那边保证）：
 * 切页 = 整个组件重新挂载，内部状态（选中/撤销栈/脏标记）不用手动重置。
 */
export function ClickEditStage({
  appId,
  pageId,
  html,
  device,
  onSaved,
  onDirtyChange,
  className = "",
}: ClickEditStageProps): React.ReactElement {
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const rawBaseRef = React.useRef(html); // 最近一次落库成功的原始 HTML（存库时的换壳底）
  const undoStackRef = React.useRef<string[]>([]); // body outerHTML 快照
  const [selected, setSelected] = React.useState<Selection | null>(null);
  const [dirty, setDirty] = React.useState(false);
  const [canUndo, setCanUndo] = React.useState(false);
  const [status, setStatus] = React.useState<
    { kind: "idle" } | { kind: "saving" } | { kind: "ok"; text: string } | { kind: "err"; text: string }
  >({ kind: "idle" });

  const viewport = specPageViewport(device);
  const fillPhone = device === "phone";
  const { ref: fitRef, scale } = useScaleToFit(viewport.w, viewport.h, "contain");

  const markDirty = React.useCallback(() => {
    setDirty(true);
    onDirtyChange?.(true);
  }, [onDirtyChange]);

  const pushUndoSnapshot = React.useCallback(() => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    const stack = undoStackRef.current;
    stack.push(body.outerHTML);
    if (stack.length > 25) stack.shift();
    setCanUndo(true);
  }, []);

  // 挂文档：同源 iframe（不加 sandbox），跟只读预览同一份 buildDocument——
  // 画出来的样子要跟预览一致，编辑才不会"看着改对了，退出预览又不一样"。
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const raw = buildDocument(rawBaseRef.current, fillPhone);
    if (!raw) return;
    const token = `ce${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const doc = markSrcdocGeneration(raw, token);
    let disposed = false;
    let wired = false;

    const onLoad = () => {
      if (disposed || wired) return;
      const d = frame.contentDocument;
      if (!d || !d.body) return;
      if (d.documentElement.getAttribute("data-sr-frame") !== token) return;
      if (!d.body.childNodes.length && !d.head?.childNodes.length) return;
      wired = true;

      d.addEventListener(
        "click",
        ev => {
          const target = ev.target as Element | null;
          if (!target) return;
          ev.preventDefault();
          ev.stopPropagation();
          const found = closestEditable(target);
          if (!found) {
            setSelected(null);
            return;
          }
          const r = found.getBoundingClientRect();
          setSelected({ el: found, rect: { left: r.left, top: r.top, width: r.width, height: r.height } });
        },
        true
      );
    };
    frame.addEventListener("load", onLoad);
    frame.srcdoc = doc;
    onLoad();
    return () => {
      disposed = true;
      frame.removeEventListener("load", onLoad);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 只挂一次——切页靠外层换 key 重新挂载整个组件，见上面的类头注释

  // 选中框跟着缩放系数走（scale 变了但没重新点选时，浮层位置要跟上）。
  React.useEffect(() => {
    if (!selected) return;
    const r = selected.el.getBoundingClientRect();
    setSelected(prev =>
      prev ? { ...prev, rect: { left: r.left, top: r.top, width: r.width, height: r.height } } : prev
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  const reselect = React.useCallback(() => {
    setSelected(prev => {
      if (!prev) return prev;
      const r = prev.el.getBoundingClientRect();
      return { ...prev, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    });
  }, []);

  const handleEditText = () => {
    if (!selected) return;
    pushUndoSnapshot();
    const el = selected.el;
    el.contentEditable = "true";
    el.focus();
    const onBlur = () => {
      el.contentEditable = "false";
      el.removeEventListener("blur", onBlur);
      markDirty();
      reselect();
    };
    el.addEventListener("blur", onBlur);
  };

  const handleBold = () => {
    if (!selected) return;
    pushUndoSnapshot();
    const el = selected.el;
    const cur = frameRef.current?.contentWindow?.getComputedStyle(el).fontWeight ?? "400";
    const isBold = parseInt(cur, 10) >= 600;
    el.style.fontWeight = isBold ? "400" : "700";
    markDirty();
  };

  const handleColor = (value: string) => {
    if (!selected) return;
    pushUndoSnapshot();
    selected.el.style.color = value;
    markDirty();
  };

  const handleDelete = () => {
    if (!selected) return;
    pushUndoSnapshot();
    selected.el.remove();
    setSelected(null);
    markDirty();
  };

  const handleUndo = () => {
    const stack = undoStackRef.current;
    const snapshot = stack.pop();
    setCanUndo(stack.length > 0);
    const d = frameRef.current?.contentDocument;
    if (!snapshot || !d?.body) return;
    const wrap = d.createElement("html");
    wrap.innerHTML = snapshot;
    const newBody = wrap.querySelector("body");
    if (newBody) d.documentElement.replaceChild(newBody, d.body);
    setSelected(null);
    markDirty();
  };

  const handleSave = async () => {
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    setStatus({ kind: "saving" });
    const finalHtml = spliceEditedBody(rawBaseRef.current, body.outerHTML);
    if (!finalHtml) {
      setStatus({ kind: "err", text: "生成保存内容失败（页面结构异常），请重试或联系维护者" });
      return;
    }
    const res = await updateAppPage(appId, pageId, finalHtml);
    if (!res.ok) {
      setStatus({ kind: "err", text: res.error });
      return;
    }
    rawBaseRef.current = finalHtml;
    setDirty(false);
    onDirtyChange?.(false);
    setStatus({ kind: "ok", text: `已保存 · ${res.bytes.toLocaleString("zh-CN")} 字节` });
    onSaved?.(pageId, finalHtml);
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col gap-2 ${className}`} data-testid="click-edit-stage">
      <div className="flex shrink-0 items-center gap-2 px-0.5 text-[11px] leading-4 text-stone-500">
        <span className="font-mono tabular-nums">
          {viewport.w}×{viewport.h} · {Math.round(scale * 100)}%
        </span>
        <span aria-hidden>·</span>
        <span data-testid="click-edit-hint">点页面里的文字或按钮就能改；改完记得点右侧保存</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {status.kind === "ok" && (
            <span className="text-emerald-600" data-testid="click-edit-status-ok">
              {status.text}
            </span>
          )}
          {status.kind === "err" && (
            <span className="text-red-600" data-testid="click-edit-status-err">
              {status.text}
            </span>
          )}
          {dirty && status.kind !== "err" && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700" data-testid="click-edit-dirty">
              有未保存的修改
            </span>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-stone-600 transition hover:bg-stone-100 disabled:opacity-40"
            disabled={!canUndo}
            onClick={handleUndo}
            data-testid="click-edit-undo"
          >
            <Undo2 size={13} /> 撤销
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded bg-[#5b6cff] px-2.5 py-1 font-semibold text-white transition hover:bg-[#4a5aef] disabled:opacity-40"
            disabled={!dirty || status.kind === "saving"}
            onClick={() => void handleSave()}
            data-testid="click-edit-save"
          >
            <Save size={13} /> {status.kind === "saving" ? "保存中…" : "保存修改"}
          </button>
        </div>
      </div>

      <div
        ref={fitRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[#eef0f4]"
        data-testid="click-edit-canvas"
        onClick={e => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        <div
          style={{
            width: viewport.w * scale,
            height: viewport.h * scale,
            position: "relative",
            overflow: "hidden",
            borderRadius: 5,
            boxShadow: "0 8px 32px rgba(60,50,30,0.18)",
            background: "#fff",
          }}
        >
          <div
            style={{
              width: viewport.w,
              height: viewport.h,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <iframe
              ref={frameRef}
              title="点选编辑画布"
              referrerPolicy="no-referrer"
              style={{ width: viewport.w, height: viewport.h, border: 0, background: "#fff" }}
              data-testid="click-edit-frame"
            />
          </div>
        </div>

        {selected && (
          <div
            className="pointer-events-none absolute z-10 rounded outline outline-2 outline-[#5b6cff]"
            style={{
              left: selected.rect.left,
              top: selected.rect.top,
              width: selected.rect.width,
              height: selected.rect.height,
            }}
            data-testid="click-edit-outline"
          />
        )}
        {selected && (
          <div
            className="absolute z-20 flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2 py-1.5 shadow-lg"
            style={{
              left: Math.max(4, selected.rect.left),
              top: Math.max(4, selected.rect.top - 42),
            }}
            data-testid="click-edit-toolbar"
            onClick={e => e.stopPropagation()}
          >
            <span className="max-w-[220px] truncate px-1 text-[11px] text-stone-400">
              {labelOfEditable(selected.el)}
            </span>
            <button
              type="button"
              className="rounded p-1 text-stone-600 hover:bg-stone-100"
              title="改文字"
              onClick={handleEditText}
              data-testid="click-edit-text"
            >
              文字
            </button>
            <button
              type="button"
              className="rounded p-1 text-stone-600 hover:bg-stone-100"
              title="加粗/取消加粗"
              onClick={handleBold}
              data-testid="click-edit-bold"
            >
              <BoldIcon size={13} />
            </button>
            <label className="rounded p-1 text-stone-600 hover:bg-stone-100" title="文字颜色">
              <input
                type="color"
                className="h-3.5 w-3.5 cursor-pointer align-middle"
                onChange={e => handleColor(e.target.value)}
                data-testid="click-edit-color"
              />
            </label>
            <button
              type="button"
              className="rounded p-1 text-red-500 hover:bg-red-50"
              title="删除这个元素"
              onClick={handleDelete}
              data-testid="click-edit-delete"
            >
              <Trash2 size={13} />
            </button>
            <button
              type="button"
              className="rounded p-1 text-stone-400 hover:bg-stone-100"
              title="取消选中"
              onClick={() => setSelected(null)}
              data-testid="click-edit-deselect"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
