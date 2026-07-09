/**
 * MermaidBlock — 将 mermaid 代码块渲染为 SVG 图表。
 *
 * 四态渲染：
 * 1. streaming — 代码块尚未闭合，展示 CodeBlock + 流式光标
 * 2. loading  — 正在加载 mermaid 库或渲染中，展示骨架占位
 * 3. rendered — SVG 渲染成功，展示内联图表
 * 4. error    — 解析失败，展示错误横幅 + CodeBlock 回退
 */

import { type FC, useEffect, useRef, useState } from "react";

import { useTheme } from "@/contexts/ThemeContext";

import { CodeBlock } from "./CodeBlock";
import { MermaidFullscreenOverlay } from "./MermaidFullscreenOverlay";
import { renderMermaidDiagram } from "./mermaid-loader";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MermaidBlockProps {
  /** Raw mermaid diagram source (content between fences). */
  code: string;
  /** Whether this block is still being streamed (not yet closed). */
  isStreaming?: boolean;
  /** Whether the code block fence has been closed. */
  closed?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const MermaidBlock: FC<MermaidBlockProps> = ({
  code,
  isStreaming,
  closed,
}) => {
  const { theme } = useTheme();
  const [state, setState] = useState<
    "streaming" | "loading" | "rendered" | "error"
  >(() => (isStreaming || !closed ? "streaming" : "loading"));
  const [svgHtml, setSvgHtml] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const renderIdRef = useRef(0);

  useEffect(() => {
    // If still streaming or not closed, stay in streaming state
    if (isStreaming || !closed) {
      setState("streaming");
      return;
    }

    // Handle empty or whitespace-only code blocks
    if (!code.trim()) {
      setErrorMsg("Empty diagram");
      setState("error");
      return;
    }

    // Attempt render
    let cancelled = false;
    const currentRender = ++renderIdRef.current;

    setState("loading");

    renderMermaidDiagram(code, theme).then(
      (svg) => {
        if (cancelled || currentRender !== renderIdRef.current) return;
        setSvgHtml(svg);
        setState("rendered");
      },
      (err) => {
        if (cancelled || currentRender !== renderIdRef.current) return;
        setErrorMsg(err instanceof Error ? err.message : String(err));
        setState("error");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [code, isStreaming, closed, theme]);

  // -------------------------------------------------------------------------
  // Streaming state — show raw code with streaming indicator
  // -------------------------------------------------------------------------
  if (state === "streaming") {
    return <CodeBlock code={code} language="mermaid" isStreaming={isStreaming} />;
  }

  // -------------------------------------------------------------------------
  // Loading state — skeleton placeholder
  // -------------------------------------------------------------------------
  if (state === "loading") {
    return (
      <div
        data-testid="mermaid-loading"
        className="my-2 flex h-40 items-center justify-center rounded border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="flex flex-col items-center gap-2 text-sm text-slate-400">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
          <span>Rendering diagram…</span>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state — error banner + CodeBlock fallback
  // -------------------------------------------------------------------------
  if (state === "error") {
    return (
      <div data-testid="mermaid-error" className="my-2">
        <div className="mb-1 rounded-t border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          Diagram rendering failed: {errorMsg}
        </div>
        <CodeBlock code={code} language="mermaid" />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Rendered state — inline SVG
  // -------------------------------------------------------------------------
  return (
    <>
      <div
        data-testid="mermaid-diagram"
        className="my-2 overflow-x-auto rounded border border-slate-200 bg-white p-3 cursor-pointer hover:border-slate-400 transition-colors dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-500"
        dangerouslySetInnerHTML={{ __html: svgHtml }}
        onClick={() => setFullscreenOpen(true)}
        title="点击全屏查看"
      />
      <MermaidFullscreenOverlay
        open={fullscreenOpen}
        onClose={() => setFullscreenOpen(false)}
        svgHtml={svgHtml}
      />
    </>
  );
};

export default MermaidBlock;
