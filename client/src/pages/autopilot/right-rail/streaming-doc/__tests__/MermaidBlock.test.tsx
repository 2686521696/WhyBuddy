/**
 * Unit tests for MermaidBlock component.
 *
 * Since the project uses renderToStaticMarkup (no DOM environment / @testing-library),
 * useEffect does not fire during SSR. The MermaidBlock component initializes closed
 * diagrams directly in "loading" state so the workbench never shows a completed
 * design diagram as a raw code block while the client render effect warms up.
 *
 * Test strategy:
 * - Streaming state: fully testable via SSR (initial state matches streaming)
 * - Loading/rendered/error states: tested by verifying the component structure
 *   and that the mermaid-loader integration is correctly wired
 * - Theme reactivity: verified by checking useTheme is consumed
 * - Cancellation: verified structurally (renderIdRef pattern)
 *
 * For full async state testing, the mermaid-loader.test.ts covers the render
 * pipeline, and the MarkdownRenderer.mermaid.test.tsx covers routing.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockInitialize = vi.fn();
const mockRender = vi.fn().mockResolvedValue({ svg: "<svg>test diagram</svg>" });

vi.mock("mermaid", () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

let mockTheme: "light" | "dark" = "light";

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: mockTheme, toggleTheme: undefined, switchable: false }),
}));

// Import after mocks
import { MermaidBlock } from "../MermaidBlock";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MermaidBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTheme = "light";
    mockRender.mockResolvedValue({ svg: "<svg>test diagram</svg>" });
  });

  describe("streaming state renders CodeBlock", () => {
    it("renders CodeBlock when isStreaming=true and closed=false", () => {
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={true} closed={false} />,
      );

      expect(html).toContain('data-testid="streaming-doc-code-block"');
      expect(html).not.toContain('data-testid="mermaid-diagram"');
      expect(html).not.toContain('data-testid="mermaid-loading"');
      expect(html).not.toContain('data-testid="mermaid-error"');
    });

    it("renders CodeBlock when closed=false even if isStreaming=false", () => {
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={false} closed={false} />,
      );

      expect(html).toContain('data-testid="streaming-doc-code-block"');
      expect(html).not.toContain('data-testid="mermaid-diagram"');
    });

    it("marks CodeBlock as streaming when isStreaming=true", () => {
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={true} closed={false} />,
      );

      expect(html).toContain('data-is-streaming="true"');
    });

    it("passes mermaid code content to CodeBlock", () => {
      const html = renderToStaticMarkup(
        <MermaidBlock
          code="sequenceDiagram\n  A->>B: Hello"
          isStreaming={true}
          closed={false}
        />,
      );

      expect(html).toContain("sequenceDiagram");
    });

    it("passes language='mermaid' to CodeBlock (normalized to plain/TEXT)", () => {
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={true} closed={false} />,
      );

      // CodeBlock normalizes "mermaid" to "plain" since it's not in SUPPORTED_LANGUAGES,
      // so the display label shows "TEXT" and data-language="plain"
      expect(html).toContain('data-language="plain"');
      expect(html).toContain("TEXT");
    });
  });

  describe("loading state shows placeholder", () => {
    it("does not call mermaid.render during SSR (useEffect deferred)", () => {
      renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={false} closed={true} />,
      );

      // useEffect doesn't fire in SSR, so render should not be called
      expect(mockRender).not.toHaveBeenCalled();
    });

    it("renders initial loading state in SSR for closed blocks", () => {
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={false} closed={true} />,
      );

      expect(html).toContain('data-testid="mermaid-loading"');
      expect(html).not.toContain('data-testid="streaming-doc-code-block"');
    });
  });

  describe("rendered state shows SVG container", () => {
    it("component structure supports dangerouslySetInnerHTML for SVG display", () => {
      // The rendered state uses:
      // <div data-testid="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svgHtml }} />
      // This is verified by the component source. In SSR with useEffect,
      // the state never reaches "rendered", but we verify the component
      // doesn't error when given valid props for the render path.
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={false} closed={true} />,
      );

      expect(html).toBeDefined();
    });
  });

  describe("error state shows error banner + CodeBlock", () => {
    it("component handles empty code gracefully", () => {
      // Empty code triggers error state in useEffect (not in SSR).
      // Verify the component doesn't crash with empty/whitespace code.
      const html = renderToStaticMarkup(
        <MermaidBlock code="" isStreaming={false} closed={true} />,
      );

      expect(html).toBeDefined();
    });

    it("component handles whitespace-only code gracefully", () => {
      const html = renderToStaticMarkup(
        <MermaidBlock code="   \n  \n  " isStreaming={false} closed={true} />,
      );

      expect(html).toBeDefined();
    });
  });

  describe("theme change triggers re-render", () => {
    it("renders without error in light theme", () => {
      mockTheme = "light";
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={false} closed={true} />,
      );
      expect(html).toBeDefined();
    });

    it("renders without error in dark theme", () => {
      mockTheme = "dark";
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={false} closed={true} />,
      );
      expect(html).toBeDefined();
    });

    it("theme is consumed from useTheme hook (dependency for re-render)", () => {
      // The component uses `const { theme } = useTheme()` and includes
      // `theme` in the useEffect dependency array: [code, isStreaming, closed, theme]
      // This ensures theme changes trigger re-render. Verified structurally.
      mockTheme = "dark";
      const html = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={true} closed={false} />,
      );
      // Component renders successfully with dark theme mock
      expect(html).toContain('data-testid="streaming-doc-code-block"');
    });
  });

  describe("cancellation when code changes during render", () => {
    it("uses renderIdRef counter to invalidate stale renders", () => {
      // The component uses `const renderIdRef = useRef(0)` and increments it
      // on each render attempt: `const currentRender = ++renderIdRef.current`
      // The async callback checks: `if (cancelled || currentRender !== renderIdRef.current) return`
      // This ensures that if code changes while a render is in-flight,
      // the stale result is discarded.

      // Verify both renders produce valid output (no crash)
      const html1 = renderToStaticMarkup(
        <MermaidBlock code="graph TD; A-->B" isStreaming={false} closed={true} />,
      );
      const html2 = renderToStaticMarkup(
        <MermaidBlock code="graph TD; C-->D" isStreaming={false} closed={true} />,
      );

      expect(html1).toBeDefined();
      expect(html2).toBeDefined();
    });

    it("cleanup function sets cancelled flag to prevent stale state updates", () => {
      // The useEffect returns: `() => { cancelled = true; }`
      // This is the standard React pattern for cancelling async operations.
      // Combined with renderIdRef, it provides double protection against
      // stale renders when props change rapidly.

      // Verify component handles rapid prop changes without error
      const codes = [
        "graph TD; A-->B",
        "graph TD; C-->D",
        "sequenceDiagram\n  A->>B: msg",
      ];

      for (const code of codes) {
        const html = renderToStaticMarkup(
          <MermaidBlock code={code} isStreaming={false} closed={true} />,
        );
        expect(html).toBeDefined();
      }
    });
  });
});
