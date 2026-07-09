import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInitialize = vi.fn();
const mockRender = vi.fn().mockResolvedValue({ svg: "<svg>mock</svg>" });

vi.mock("mermaid", () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

// Must import after mock setup
import { getMermaid, renderMermaidDiagram } from "../mermaid-loader";

describe("mermaid-loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getMermaid()", () => {
    it("returns the mermaid module", async () => {
      const mod = await getMermaid();
      expect(mod).toBeDefined();
      expect(mod.default).toBeDefined();
      expect(mod.default.initialize).toBeDefined();
      expect(mod.default.render).toBeDefined();
    });

    it("returns the same cached module on repeated calls", async () => {
      const mod1 = await getMermaid();
      const mod2 = await getMermaid();
      expect(mod1).toBe(mod2);
    });
  });

  describe("renderMermaidDiagram()", () => {
    it("produces SVG string for valid input", async () => {
      const svg = await renderMermaidDiagram("graph TD; A-->B", "light");
      expect(svg).toBe("<svg>mock</svg>");
      expect(mockRender).toHaveBeenCalledWith(
        expect.stringMatching(/^mermaid-diagram-\d+$/),
        "graph TD; A-->B",
      );
    });

    it("throws for invalid mermaid syntax when render rejects", async () => {
      mockRender.mockRejectedValueOnce(new Error("Parse error: invalid syntax"));
      await expect(
        renderMermaidDiagram("invalid%%%diagram", "light"),
      ).rejects.toThrow("Parse error: invalid syntax");
    });

    it("maps light theme to mermaid 'default' theme", async () => {
      await renderMermaidDiagram("graph TD; A-->B", "light");
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "default" }),
      );
    });

    it("maps dark theme to mermaid 'dark' theme", async () => {
      await renderMermaidDiagram("graph TD; A-->B", "dark");
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "dark" }),
      );
    });

    it("sets securityLevel to strict and startOnLoad to false", async () => {
      await renderMermaidDiagram("graph TD; A-->B", "light");
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          securityLevel: "strict",
          startOnLoad: false,
        }),
      );
    });

    it("uses unique render IDs for each call", async () => {
      await renderMermaidDiagram("graph TD; A-->B", "light");
      await renderMermaidDiagram("graph TD; C-->D", "light");

      const firstId = mockRender.mock.calls[0][0] as string;
      const secondId = mockRender.mock.calls[1][0] as string;
      expect(firstId).not.toBe(secondId);
      expect(firstId).toMatch(/^mermaid-diagram-\d+$/);
      expect(secondId).toMatch(/^mermaid-diagram-\d+$/);
    });
  });
});
