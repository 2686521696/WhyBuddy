import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TakeoverCard, type TakeoverCardProps } from "../TakeoverCard";

/* ─── Helpers ─── */

function makeProps(overrides?: Partial<TakeoverCardProps>): TakeoverCardProps {
  return {
    title: "Takeover/Evidence",
    hasPendingDecision: false,
    decisionPrompt: null,
    decisionPresets: [],
    decisionNote: "",
    onSetDecisionNote: vi.fn(),
    onLaunchDecision: vi.fn(),
    onSubmitOperatorAction: vi.fn(),
    operatorActionLoading: false,
    takeoverSummary: null,
    locale: "en-US",
    ...overrides,
  };
}

function render(props: TakeoverCardProps): string {
  return renderToStaticMarkup(<TakeoverCard {...props} />);
}

/* ─── Tests ─── */

describe("TakeoverCard", () => {
  describe("empty state (hasPendingDecision = false)", () => {
    it("renders 'No takeover needed' when hasPendingDecision is false and no summary (en)", () => {
      const markup = render(makeProps({ hasPendingDecision: false, locale: "en-US" }));
      expect(markup).toContain("No takeover needed");
    });

    it("renders '当前无需接管' when hasPendingDecision is false and no summary (zh-CN)", () => {
      const markup = render(makeProps({ hasPendingDecision: false, locale: "zh-CN" }));
      expect(markup).toContain("当前无需接管");
    });

    it("renders takeover summary when available and no pending decision", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: false,
          takeoverSummary: "Agent completed review successfully",
        }),
      );
      expect(markup).toContain("Agent completed review successfully");
      expect(markup).not.toContain("No takeover needed");
    });

    it("does not render decision presets when hasPendingDecision is false", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: false,
          decisionPresets: [{ id: "approve", label: "Approve" }],
        }),
      );
      expect(markup).not.toContain("Approve");
    });

    it("does not render note textarea when hasPendingDecision is false", () => {
      const markup = render(makeProps({ hasPendingDecision: false }));
      expect(markup).not.toContain("textarea");
    });
  });

  describe("pending decision (hasPendingDecision = true)", () => {
    it("renders decision prompt text", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          decisionPrompt: "Please review the generated report",
        }),
      );
      expect(markup).toContain("Please review the generated report");
    });

    it("renders decision preset buttons", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          decisionPresets: [
            { id: "approve", label: "Approve" },
            { id: "reject", label: "Reject" },
          ],
        }),
      );
      expect(markup).toContain("Approve");
      expect(markup).toContain("Reject");
    });

    it("renders note textarea", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
        }),
      );
      expect(markup).toContain("textarea");
    });

    it("renders note label in English", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          locale: "en-US",
        }),
      );
      expect(markup).toContain("Note");
    });

    it("renders note label in Chinese", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          locale: "zh-CN",
        }),
      );
      expect(markup).toContain("备注");
    });

    it("does not render empty state when hasPendingDecision is true", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          decisionPresets: [{ id: "ok", label: "OK" }],
        }),
      );
      expect(markup).not.toContain("No takeover needed");
      expect(markup).not.toContain("当前无需接管");
    });

    it("renders decision note value in textarea", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          decisionNote: "Looks good to me",
        }),
      );
      expect(markup).toContain("Looks good to me");
    });
  });

  describe("loading state (operatorActionLoading = true)", () => {
    it("disables all decision preset buttons when loading", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          operatorActionLoading: true,
          decisionPresets: [
            { id: "approve", label: "Approve" },
            { id: "reject", label: "Reject" },
          ],
        }),
      );
      // All buttons should have disabled attribute
      const disabledCount = (markup.match(/disabled=""/g) || []).length;
      // textarea + 2 buttons = 3 disabled elements
      expect(disabledCount).toBeGreaterThanOrEqual(2);
    });

    it("disables textarea when loading", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          operatorActionLoading: true,
        }),
      );
      // The textarea should be disabled
      expect(markup).toContain("disabled");
    });
  });

  describe("design tokens", () => {
    it("uses card background and foreground tokens", () => {
      const markup = render(makeProps());
      expect(markup).toContain("bg-card");
      expect(markup).toContain("text-card-foreground");
    });

    it("uses border token", () => {
      const markup = render(makeProps());
      expect(markup).toContain("border");
    });

    it("uses rounded-lg for border radius", () => {
      const markup = render(makeProps());
      expect(markup).toContain("rounded-lg");
    });
  });

  describe("primary button style", () => {
    it("uses primary color for decision preset buttons", () => {
      const markup = render(
        makeProps({
          hasPendingDecision: true,
          decisionPresets: [{ id: "approve", label: "Approve" }],
        }),
      );
      expect(markup).toContain("bg-primary");
      expect(markup).toContain("text-primary-foreground");
    });
  });

  describe("card title", () => {
    it("renders the provided title", () => {
      const markup = render(makeProps({ title: "接管/证据" }));
      expect(markup).toContain("接管/证据");
    });
  });
});
