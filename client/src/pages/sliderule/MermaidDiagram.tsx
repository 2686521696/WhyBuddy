/**
 * MermaidDiagram — thin wrapper around the mermaid library.
 *
 * Renders any Mermaid DSL string into an inline SVG. Falls back to a
 * <pre> code block when mermaid is unavailable or the diagram fails to parse.
 * Used by DataModelScreen and WorkflowScreen.
 */

import React, { useEffect, useRef, useState } from "react";

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

let mermaidReady = false;

async function ensureMermaid() {
  if (mermaidReady) return;
  const m = await import("mermaid");
  m.default.initialize({
    startOnLoad: false,
    theme: "base",
    themeVariables: {
      primaryColor: "#f1f5f9",
      primaryTextColor: "#1e293b",
      primaryBorderColor: "#cbd5e1",
      lineColor: "#94a3b8",
      background: "#ffffff",
      fontSize: "13px",
    },
    flowchart: { curve: "basis", htmlLabels: true },
    er: { useMaxWidth: true },
    securityLevel: "loose",
  });
  mermaidReady = true;
}

let _idCounter = 0;
function nextId() {
  return `mermaid-${++_idCounter}`;
}

export function MermaidDiagram({ chart, className = "" }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const idRef = useRef(nextId());

  useEffect(() => {
    if (!chart?.trim()) return;
    setError(null);
    setRendered(false);

    let cancelled = false;
    ensureMermaid()
      .then(async () => {
        if (cancelled) return;
        const { default: mermaid } = await import("mermaid");
        try {
          const { svg } = await mermaid.render(idRef.current, chart.trim());
          if (cancelled || !containerRef.current) return;
          containerRef.current.innerHTML = svg;
          // Let the SVG fill its container width
          const svgEl = containerRef.current.querySelector("svg");
          if (svgEl) {
            svgEl.style.maxWidth = "100%";
            svgEl.style.height = "auto";
          }
          setRendered(true);
        } catch (e: any) {
          if (!cancelled) setError(String(e?.message || e));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e?.message || e));
      });

    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className={`overflow-auto rounded-lg bg-[#F5F1EA] p-3 ${className}`}>
        <pre className="text-xs text-stone-500 whitespace-pre-wrap">{chart}</pre>
        <div className="mt-2 text-xs text-red-400">{error}</div>
      </div>
    );
  }

  if (!chart?.trim()) {
    return (
      <div className={`flex items-center justify-center text-xs text-stone-400 ${className}`}>
        暂无图表数据
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-auto [&_svg]:mx-auto ${rendered ? "" : "animate-pulse bg-[#F0EDE5] rounded-lg"} ${className}`}
    />
  );
}
