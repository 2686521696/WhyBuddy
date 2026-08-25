/**
 * 画布档右侧的**元素编辑器**（2026-08-25）。
 *
 * 用户裁决："在画布模式下，点击某一页里面的元素，它的右侧弹出一个编辑器，
 * 可以对页面中的元素进行编辑，而不是跳到页面里面"。
 *
 * ## 跟页面档的点选编辑是什么关系
 *
 * 两边是**同一件事的两种呈现**（用户原话："只是形式不一样"）。所以：
 *   · "什么算一个可编辑元素" —— 共用 ClickEditStage.closestEditable
 *   · "一次编辑到底改了什么" —— 共用 canvas-element-edit.applyElementOp
 * UI 有两套，语义只有一套。哪天改了编辑规则，两边一起变，不会分叉。
 *
 * ## 编辑落在源 HTML 上，不是画布里那份渲染文档
 *
 * 画布里的 iframe 注入过 Tailwind、跑过绑定运行时（表格行是 cloneNode 克隆
 * 出来的）。改那份等于改"给人看的那一版"，存回 pages_json 会把注入的东西
 * 一起存进去。所以这里拿的是 `page.html`（源），改完走既有的
 * `updateAppPage` 落库，再由宿主刷新 pageOverrides 让画板重渲。
 */

import React from "react";
import { Loader2, Trash2, Type, X } from "lucide-react";

import {
  applyElementOp,
  clampFontPx,
  MAX_FONT_PX,
  MIN_FONT_PX,
  type ElementOp,
} from "./canvas-element-edit";
import { resolveElementPath, type PathStep } from "./element-path";

export interface CanvasElementPanelProps {
  /** 选中的元素 */
  picked: { pageId: string; path: PathStep[]; tag: string; title: string };
  /** 这一页的**源** HTML */
  html: string;
  pageName: string;
  /** 应用一次编辑：回 true 表示落库成功。抛错由面板显示。 */
  onApply: (pageId: string, nextHtml: string) => Promise<void>;
  onClose: () => void;
}

/** 从源 HTML 里读出这个元素当前的样子，好把面板的初值填对。 */
function readCurrent(
  html: string,
  path: readonly PathStep[]
): {
  text: string;
  fontPx: number | null;
  bold: boolean;
  color: string;
} | null {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = resolveElementPath(doc.body, path) as HTMLElement | null;
    if (!el) return null;
    const fs = parseFloat(el.style.fontSize || "");
    return {
      text: (el.textContent || "").replace(/\s+/g, " ").trim(),
      fontPx: Number.isNaN(fs) ? null : fs,
      bold: /^(bold|[6-9]00)$/.test(el.style.fontWeight || ""),
      color: el.style.color || "",
    };
  } catch {
    return null;
  }
}

export function CanvasElementPanel({
  picked,
  html,
  pageName,
  onApply,
  onClose,
}: CanvasElementPanelProps): React.ReactElement {
  const current = React.useMemo(
    () => readCurrent(html, picked.path),
    [html, picked.path]
  );
  const [text, setText] = React.useState(current?.text ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // 换了元素/换了页面 → 输入框跟着回到那个元素的现值，别把上一个元素的草稿留着。
  React.useEffect(() => {
    setText(current?.text ?? "");
    setError(null);
  }, [current?.text, picked.pageId, picked.path]);

  const run = React.useCallback(
    async (op: ElementOp) => {
      setBusy(true);
      setError(null);
      try {
        const res = applyElementOp(html, picked.path, op);
        if (!res.ok) {
          /* ⚠ 定位不到就是失败，**不许**把原样 HTML 拿去落库当成功——
             那是"闸全绿但东西没变"。多半是页面已经被别处改过。 */
          setError("在这一页里定位不到这个元素了，刷新一下重新选");
          return;
        }
        await onApply(picked.pageId, res.html);
      } catch (e) {
        setError(e instanceof Error ? e.message : "保存失败");
      } finally {
        setBusy(false);
      }
    },
    [html, picked.path, picked.pageId, onApply]
  );

  const missing = !current;

  return (
    <aside
      className="flex h-full w-[248px] shrink-0 flex-col overflow-hidden rounded-md border border-[#e9edf2] bg-white"
      data-testid="sliderule-canvas-element-panel"
      data-page-id={picked.pageId}
      data-tag={picked.tag}
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[#f0f1f3] px-3 py-2">
        <Type className="h-3 w-3 shrink-0 text-stone-400" />
        <span className="truncate text-[12px] font-medium text-stone-700">
          {picked.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-0.5 text-stone-400 transition hover:bg-stone-100"
          aria-label="取消选中"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2.5">
        <p className="text-[11px] leading-4 text-stone-400">
          在「{pageName}」这一页 · &lt;{picked.tag}&gt;
        </p>

        {missing ? (
          /* ⚠ 画布里点得到、源 HTML 里找不到 —— 多半是运行时克隆出来的表格行。
             如实说清是哪一类，别只丢一句"出错了"。 */
          <p
            className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] leading-4 text-amber-700"
            data-testid="sliderule-canvas-element-missing"
          >
            这个元素在页面源码里没有对应项，多半是运行时按数据生成的（表格行
            之类）。这类内容要改数据或改模板，不能直接改这一格。
          </p>
        ) : (
          <>
            <label className="block">
              <span className="mb-1 block text-[11px] text-stone-500">
                文字
              </span>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={3}
                data-testid="sliderule-canvas-element-text"
                className="w-full resize-y rounded border border-stone-200 px-2 py-1 text-[12px] outline-none focus:border-[#1677ff]"
              />
              <button
                type="button"
                disabled={busy || text === current.text}
                onClick={() => run({ kind: "text", value: text })}
                data-testid="sliderule-canvas-element-apply-text"
                className="mt-1.5 flex w-full items-center justify-center gap-1 rounded bg-[#1677ff] px-2 py-1 text-[11px] text-white transition hover:bg-[#0958d9] disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                改这段文字
              </button>
            </label>

            <div>
              <span className="mb-1 block text-[11px] text-stone-500">
                字号
              </span>
              <div className="flex items-center gap-1">
                {[-2, +2].map(d => (
                  <button
                    key={d}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run({
                        kind: "fontSize",
                        px: clampFontPx((current.fontPx ?? 16) + d),
                      })
                    }
                    className="h-6 flex-1 rounded border border-stone-200 text-[12px] text-stone-600 transition hover:border-[#1677ff] hover:text-[#1677ff] disabled:opacity-40"
                  >
                    {d > 0 ? "A+" : "A-"}
                  </button>
                ))}
                <span className="min-w-[3.2rem] text-center font-mono text-[11px] text-stone-400">
                  {current.fontPx ? `${current.fontPx}px` : "默认"}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-stone-400">
                {MIN_FONT_PX}–{MAX_FONT_PX}px
              </p>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => run({ kind: "bold", on: !current.bold })}
                data-testid="sliderule-canvas-element-bold"
                className={`h-6 flex-1 rounded border text-[12px] font-bold transition disabled:opacity-40 ${
                  current.bold
                    ? "border-[#1677ff] bg-[#f0f6ff] text-[#1677ff]"
                    : "border-stone-200 text-stone-600 hover:border-[#1677ff]"
                }`}
              >
                B
              </button>
              <label className="flex h-6 flex-1 items-center gap-1 rounded border border-stone-200 px-1.5">
                <input
                  type="color"
                  value={
                    /^#[0-9a-f]{6}$/i.test(current.color)
                      ? current.color
                      : "#111111"
                  }
                  disabled={busy}
                  onChange={e => run({ kind: "color", value: e.target.value })}
                  className="h-4 w-5 cursor-pointer border-0 bg-transparent p-0"
                  aria-label="文字颜色"
                />
                <span className="truncate text-[11px] text-stone-500">
                  颜色
                </span>
              </label>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("确定删掉这个元素吗？")) {
                  run({ kind: "remove" });
                }
              }}
              data-testid="sliderule-canvas-element-remove"
              className="flex w-full items-center justify-center gap-1 rounded border border-rose-200 px-2 py-1 text-[11px] text-rose-600 transition hover:bg-rose-50 disabled:opacity-40"
            >
              <Trash2 className="h-3 w-3" />
              删掉这个元素
            </button>
          </>
        )}

        {error ? (
          <p
            className="rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-[11px] leading-4 text-rose-600"
            data-testid="sliderule-canvas-element-error"
          >
            {error}
          </p>
        ) : null}
      </div>

      <p className="shrink-0 border-t border-[#f0f1f3] px-3 py-2 text-[10px] leading-4 text-stone-400">
        改动会直接存进这一页（跟页面档的点选编辑同一条写回路径）。
      </p>
    </aside>
  );
}
