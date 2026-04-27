import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const { appState } = vi.hoisted(() => ({
  appState: {
    locale: "en-US",
    runtimeMode: "frontend",
    setRuntimeMode: async () => {},
  },
}));

vi.mock("@/lib/store", () => ({
  useAppStore: (selector: (state: typeof appState) => unknown) =>
    selector(appState),
}));

import { LaunchGoalInput } from "../LaunchGoalInput";

describe("LaunchGoalInput", () => {
  it("renders textarea with character count", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: "Hello world",
        onChange: () => {},
      })
    );

    expect(markup).toContain('data-testid="launch-goal-textarea"');
    expect(markup).toContain('data-testid="launch-goal-char-count"');
    expect(markup).toContain("11 / 2000");
  });

  it("shows 0 / 2000 when value is empty", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: "",
        onChange: () => {},
      })
    );

    expect(markup).toContain("0 / 2000");
  });

  it("respects custom maxLength", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: "test",
        onChange: () => {},
        maxLength: 500,
      })
    );

    expect(markup).toContain("4 / 500");
  });

  it("renders placeholder text in English", () => {
    appState.locale = "en-US";
    const markup = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: "",
        onChange: () => {},
      })
    );

    expect(markup).toContain("Describe the task goal you want to accomplish");
  });

  it("renders placeholder text in Chinese", () => {
    appState.locale = "zh-CN";
    const markup = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: "",
        onChange: () => {},
      })
    );

    expect(markup).toContain("描述你想要完成的任务目标");
    appState.locale = "en-US";
  });

  it("renders the label", () => {
    appState.locale = "en-US";
    const markup = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: "",
        onChange: () => {},
      })
    );

    expect(markup).toContain("Enter your goal");
    expect(markup).toContain('id="launch-goal-label"');
  });

  it("renders aria-labelledby pointing to the label", () => {
    const markup = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: "",
        onChange: () => {},
      })
    );

    expect(markup).toContain('aria-labelledby="launch-goal-label"');
  });

  it("shows correct count at boundary values", () => {
    // At 1999 chars
    const value1999 = "a".repeat(1999);
    const markup1999 = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: value1999,
        onChange: () => {},
      })
    );
    expect(markup1999).toContain("1999 / 2000");

    // At 2000 chars
    const value2000 = "a".repeat(2000);
    const markup2000 = renderToStaticMarkup(
      createElement(LaunchGoalInput, {
        value: value2000,
        onChange: () => {},
      })
    );
    expect(markup2000).toContain("2000 / 2000");
  });
});
