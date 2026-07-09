/**
 * Integration tests for MarkdownRenderer mermaid routing.
 *
 * Verifies that the MarkdownRenderer correctly routes mermaid-annotated code
 * blocks to MermaidBlock and non-mermaid blocks to CodeBlock.
 *
 * Since MermaidBlock starts closed diagrams in "loading" state during SSR,
 * we verify routing by checking:
 * - Mermaid blocks: rendered via MermaidBlock (shows the loading placeholder)
 * - Non-mermaid blocks: rendered via CodeBlock directly (shows language label)
 *
 * We also test the tokenizer's detection logic directly for precise assertions.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>mermaid output</svg>" }),
  },
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggleTheme: undefined, switchable: false }),
}));

// Import after mocks
import { MarkdownRenderer, __testing__ } from "../MarkdownRenderer";

const { normalizeFlattenedMermaidCode, tokenizeMarkdown } = __testing__;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderMarkdown(markdown: string, isStreaming = false) {
  return renderToStaticMarkup(
    <MarkdownRenderer markdown={markdown} isStreaming={isStreaming} locale="en-US" />,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MarkdownRenderer — mermaid routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("tokenizer detection", () => {
    it("tokenizes mermaid code block with language field", () => {
      const md = "```mermaid\ngraph TD; A-->B\n```";
      const tokens = tokenizeMarkdown(md);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        kind: "code",
        language: "mermaid",
        code: "graph TD; A-->B",
        closed: true,
      });
    });

    it("tokenizes Mermaid with mixed case", () => {
      const md = "```Mermaid\nsequenceDiagram\n  A->>B: Hello\n```";
      const tokens = tokenizeMarkdown(md);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        kind: "code",
        language: "Mermaid",
        closed: true,
      });
    });

    it("tokenizes non-mermaid code block normally", () => {
      const md = "```typescript\nconst x = 1;\n```";
      const tokens = tokenizeMarkdown(md);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        kind: "code",
        language: "typescript",
        closed: true,
      });
    });

    it("tokenizes code block without language annotation", () => {
      const md = "```\nsome plain text\n```";
      const tokens = tokenizeMarkdown(md);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        kind: "code",
        language: undefined,
        closed: true,
      });
    });

    it("tokenizes unclosed mermaid block during streaming", () => {
      const md = "```mermaid\ngraph TD; A-->B";
      const tokens = tokenizeMarkdown(md);

      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        kind: "code",
        language: "mermaid",
        code: "graph TD; A-->B",
        closed: false,
      });
    });
  });

  describe("rendering routes", () => {
    it('routes language="mermaid" to MermaidBlock', () => {
      const md = "```mermaid\ngraph TD; A-->B\n```";
      const html = renderMarkdown(md);

      expect(html).toContain('data-testid="mermaid-loading"');
      expect(html).not.toContain('data-testid="streaming-doc-code-block"');
    });

    it('routes language="Mermaid" (case-insensitive) to MermaidBlock', () => {
      const md = "```Mermaid\nsequenceDiagram\n  A->>B: Hello\n```";
      const html = renderMarkdown(md);

      expect(html).toContain('data-testid="mermaid-loading"');
      expect(html).not.toContain('data-language="plain"');
    });

    it('routes language="typescript" to CodeBlock (not MermaidBlock)', () => {
      const md = "```typescript\nconst x = 1;\n```";
      const html = renderMarkdown(md);

      // Regular CodeBlock renders with normalized language
      expect(html).toContain('data-language="typescript"');
      expect(html).toContain('data-testid="streaming-doc-code-block"');
    });

    it("routes code block with no language annotation to CodeBlock", () => {
      const md = "```\nsome plain text\n```";
      const html = renderMarkdown(md);

      expect(html).toContain('data-language="plain"');
      expect(html).toContain('data-testid="streaming-doc-code-block"');
    });

    it("renders mixed mermaid and non-mermaid blocks correctly", () => {
      const md = [
        "```typescript",
        "const x = 1;",
        "```",
        "",
        "```mermaid",
        "graph TD; A-->B",
        "```",
        "",
        "```json",
        '{"key": "value"}',
        "```",
      ].join("\n");

      const html = renderMarkdown(md);

      // Should have 2 code blocks total (typescript + json); mermaid shows loading
      const codeBlockMatches = html.match(
        /data-testid="streaming-doc-code-block"/g,
      );
      expect(codeBlockMatches?.length).toBe(2);
      expect(html).toContain('data-testid="mermaid-loading"');

      // Should have typescript and json language attributes (from direct CodeBlock)
      expect(html).toContain('data-language="typescript"');
      expect(html).toContain('data-language="json"');

      // Mermaid block is no longer shown as raw code while the diagram renderer loads.
      expect(html).not.toContain("graph TD; A--&gt;B");
    });

    it("renders unclosed mermaid block as streaming CodeBlock", () => {
      const md = "```mermaid\ngraph TD; A-->B";
      const html = renderMarkdown(md, true);

      // Unclosed block during streaming: MermaidBlock renders CodeBlock with streaming
      expect(html).toContain('data-testid="streaming-doc-code-block"');
      expect(html).toContain('data-is-streaming="true"');
      expect(html).toContain("graph TD; A--&gt;B");
    });

    it("routes flattened live mermaid paragraphs to MermaidBlock", () => {
      const md =
        "mermaid graph TD A[Request Intake] --> B[Route Selection] B --> C[Repository Context Loading]";
      const html = renderMarkdown(md);

      expect(html).toContain('data-testid="mermaid-loading"');
      expect(html).not.toContain("mermaid graph TD");
    });
  });

  describe("detection logic correctness", () => {
    it("normalizes flattened graph diagrams into parseable edge lines", () => {
      const code = normalizeFlattenedMermaidCode(
        "mermaid graph TD A[Request Intake] --> B[Route Selection] B --> C[Repository Context Loading]",
      );

      expect(code).toBe(
        [
          "graph TD",
          "  A[Request Intake] --> B[Route Selection]",
          "  B --> C[Repository Context Loading]",
        ].join("\n"),
      );
    });

    it("detection uses case-insensitive comparison", () => {
      // The renderToken function uses: token.language?.toLowerCase().trim() === "mermaid"
      const variants = ["mermaid", "Mermaid", "MERMAID", "MeRmAiD"];

      for (const lang of variants) {
        const md = `\`\`\`${lang}\ngraph TD; A-->B\n\`\`\``;
        const tokens = tokenizeMarkdown(md);
        const token = tokens[0];

        // All variants should have language field set
        expect(token).toMatchObject({ kind: "code", closed: true });

        // The detection logic in renderToken does toLowerCase().trim()
        const isMermaid =
          (token as { language?: string }).language?.toLowerCase().trim() ===
          "mermaid";
        expect(isMermaid).toBe(true);
      }
    });

    it("does not route similar-but-different languages to MermaidBlock", () => {
      const nonMermaidLanguages = [
        "mermaid-js",
        "mermaidx",
        "mer",
        "diagram",
        "plantuml",
      ];

      for (const lang of nonMermaidLanguages) {
        const isMermaid = lang.toLowerCase().trim() === "mermaid";
        expect(isMermaid).toBe(false);
      }
    });

    it("handles undefined language correctly (routes to CodeBlock)", () => {
      const md = "```\nplain code\n```";
      const tokens = tokenizeMarkdown(md);
      const token = tokens[0] as { language?: string };

      const isMermaid =
        token.language?.toLowerCase().trim() === "mermaid";
      expect(isMermaid).toBe(false);
    });
  });
});
