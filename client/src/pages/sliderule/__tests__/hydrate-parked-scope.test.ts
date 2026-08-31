/**
 * 停泊卡 hydrate：会话授予压过 localStorage。
 *
 * ⚠ 2026-08-30：删掉 hydrateParkedScope 调用、改回 loadPreferredDevice()
 * 当第一权威，这条必须红。POST 路径仍可读 localStorage，那是没选范围时
 * 的兜底，不是刷新后的卡。
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const memStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage ??= {
  getItem: (k: string) => memStore.get(k) ?? null,
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
  clear: () => memStore.clear(),
  key: (i: number) => [...memStore.keys()][i] ?? null,
  get length() {
    return memStore.size;
  },
} as Storage;

import { hydrateParkedScope } from "../scope-card-gate";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

afterEach(() => {
  localStorage.clear();
});

describe("hydrateParkedScope", () => {
  it("last scope_card tablet beats localStorage desktop", () => {
    localStorage.setItem("sliderule:preferred-device", "desktop");
    const parked = hydrateParkedScope({
      awaitDetail: "巡店点单",
      goal: { text: "", preferredDevice: "phone" },
      controlTranscript: [
        {
          kind: "scope_card",
          device: "tablet",
          productArchetype: "business_app",
          variant: "full",
          text: "巡店点单",
        },
      ],
    });
    expect(parked.device).toBe("tablet");
    expect(parked.productArchetype).toBe("business_app");
    expect(parked.tools).toEqual([
      "spec",
      "pages",
      "structure",
      "bind",
      "closure",
    ]);
    expect(parked.wiredDevices?.map(row => row.id)).toEqual(
      expect.arrayContaining(["desktop", "phone", "tablet"])
    );
    expect(parked.wiredDevices?.map(row => row.id)).not.toContain("watch");
  });

  it("goal preferredDevice is used when the card has no wired device", () => {
    localStorage.setItem("sliderule:preferred-device", "desktop");
    const parked = hydrateParkedScope({
      awaitDetail: "请假系统",
      goal: { text: "请假系统", preferredDevice: "tablet" },
      controlTranscript: [{ kind: "scope_card", device: "unspecified" }],
    });
    expect(parked.device).toBe("tablet");
    expect(parked.variant).toBe("thin");
  });

  it("goal tools beat an empty last-card tools list", () => {
    const parked = hydrateParkedScope({
      awaitDetail: "请假系统",
      goal: { text: "请假系统", tools: ["spec", "pages", "closure"] },
      controlTranscript: [{ kind: "scope_card", device: "desktop", tools: [] }],
    });
    expect(parked.tools).toEqual(["spec", "pages", "closure"]);
  });

  it("last-card tools beat goal tools when the card actually picked some", () => {
    const parked = hydrateParkedScope({
      awaitDetail: "请假系统",
      goal: { text: "请假系统", tools: ["spec", "pages", "structure", "bind", "closure"] },
      controlTranscript: [
        { kind: "scope_card", device: "desktop", tools: ["spec", "pages"] },
      ],
    });
    expect(parked.tools).toEqual(["spec", "pages"]);
  });

  it("localStorage is last resort only", () => {
    localStorage.setItem("sliderule:preferred-device", "phone");
    const parked = hydrateParkedScope({
      awaitDetail: "请假系统",
      goal: { text: "" },
      controlTranscript: [],
    });
    expect(parked.device).toBe("phone");
  });
});

describe("活路径必须调用 helper", () => {
  it("control_scope hydrate 走 hydrateParkedScope，不以 loadPreferredDevice 为第一权威", () => {
    const session = stripComments(
      readFileSync(
        new URL("../useSlideRuleSession.ts", import.meta.url),
        "utf8"
      )
    );
    const hydrate = session.slice(
      session.indexOf('hydrated.awaitReason === "control_scope"'),
      session.indexOf('hydrated.awaitReason === "control_ask"')
    );
    expect(hydrate).toContain("hydrateParkedScope");
    expect(hydrate).not.toContain("loadPreferredDevice()");
    expect(hydrate).not.toContain("defaultArchetype()");
  });
});
