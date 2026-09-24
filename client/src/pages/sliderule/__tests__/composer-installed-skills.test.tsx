// @vitest-environment jsdom
/**
 * `/` 面板能选已装技能。选中后输入框是可删标签，不是 `@slug` 纯文本。
 *
 * 反向：没装的不出现；摘掉标签再发，正文没有点名。
 * 发出去的那一发必须仍带 `@slug`，否则服务端不预加载技能。
 */
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/skill-store-client", () => ({
  fetchSkillCatalog: async () => [
    {
      id: "office",
      slug: "office-skills",
      name: "office-skills",
      description: "做 PPT / Word / Excel",
      version: "1.0.0",
      installed: true,
    },
    {
      id: "ghost",
      slug: "ghost",
      name: "ghost",
      description: "没装",
      version: "1.0.0",
      installed: false,
    },
  ],
  selectedSkillsDrivePayload: () => undefined,
}));

vi.mock("../connectors-client", () => ({
  listConnectors: async () => [],
}));

import { ComposerDock } from "../ComposerDock";

const sent: string[] = [];

function Harness() {
  const [input, setInput] = React.useState("");
  return (
    <ComposerDock
      input={input}
      setInput={setInput}
      sendMessage={text => {
        sent.push(typeof text === "string" ? text : input);
      }}
      isRunning={false}
      sessionId="mention-ui"
      goal="做个PPT"
    />
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe("已装技能进斜杠面板", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  it("点 / 能选 office-skills，框里是可删标签，发出去仍带 @slug", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await flush();

    const hint = container.querySelector<HTMLButtonElement>(
      '[data-testid="sliderule-slash-hint"]'
    );
    expect(hint).toBeTruthy();
    await act(async () => {
      hint!.click();
    });
    await flush();

    const menu = container.querySelector('[data-testid="sliderule-slash-menu"]');
    expect(menu).toBeTruthy();
    const keys = [
      ...container.querySelectorAll("[data-testid='sliderule-slash-item']"),
    ].map(node => node.getAttribute("data-key"));
    expect(keys).toContain("scope");
    expect(keys).toContain("office-skills");
    expect(keys).not.toContain("ghost");
    expect(container.innerHTML).not.toContain("SkillSelectBar");

    const skill = container.querySelector<HTMLButtonElement>(
      '[data-testid="sliderule-slash-item"][data-key="office-skills"]'
    );
    expect(skill).toBeTruthy();
    await act(async () => {
      skill!.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true })
      );
    });
    await flush();

    const box = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="sliderule-composer-input"]'
    );
    expect(box?.value ?? "").not.toContain("@office-skills");
    expect(box?.placeholder).toBe("输入你的任务。");
    const chip = container.querySelector(
      '[data-testid="sliderule-skill-mention"][data-key="office-skills"]'
    );
    expect(chip?.textContent).toContain("office-skills");
    expect(chip?.textContent).not.toContain("@");
    const remove = chip?.querySelector(
      '[data-testid="sliderule-skill-mention-remove"]'
    );
    expect(remove?.querySelector("svg")).toBeTruthy();
    expect(remove?.textContent ?? "").not.toMatch(/×|x/i);

    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      );
      proto?.set?.call(box, "做一份5页PPT");
      box!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    const send = container.querySelector<HTMLButtonElement>(
      '[data-testid="sliderule-composer-send"]'
    );
    expect(send?.disabled).toBe(false);
    await act(async () => {
      send!.click();
    });
    expect(sent).toEqual(["@office-skills 做一份5页PPT"]);
    expect(
      container.querySelector('[data-testid="sliderule-skill-mention"]')
    ).toBeNull();
  });

  it("摘掉标签再发，正文没有点名", async () => {
    await act(async () => {
      root.render(<Harness />);
    });
    await flush();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="sliderule-slash-hint"]')!
        .click();
    });
    await flush();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="sliderule-slash-item"][data-key="office-skills"]'
        )!
        .dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true })
        );
    });
    await flush();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="sliderule-skill-mention-remove"]'
        )!
        .click();
    });
    await flush();
    expect(
      container.querySelector('[data-testid="sliderule-skill-mention"]')
    ).toBeNull();
    const box = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="sliderule-composer-input"]'
    );
    await act(async () => {
      const proto = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      );
      proto?.set?.call(box, "做一份5页PPT");
      box!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flush();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="sliderule-composer-send"]'
        )!
        .click();
    });
    expect(sent).toEqual(["做一份5页PPT"]);
  });
});
