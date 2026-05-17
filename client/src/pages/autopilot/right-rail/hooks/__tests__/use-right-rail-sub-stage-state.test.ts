/**
 * Unit 测试 —— Task 2：URL `?sub=xxx` 读 / 写 / 非法值降级
 *
 * 对应 spec：`.kiro/specs/autopilot-step-driven-rail-navigation/`
 * - Requirement 1.1-1.7、2.6、6.6-6.7、10.4
 *
 * 约束：
 * - 不引入 `@testing-library/react` / `jsdom` / `happy-dom`（项目默认 node 环境）。
 * - 采用 Spec 4 Task 11 "方案 D"：通过 `__testing__` 命名导出的 pure layer
 *   （`parseSubFromSearch` / `applySubToSearch` / `isValidSubStage`）直接覆盖 URL 解析
 *   与应用逻辑，不依赖 `window.location` / `window.history`。
 * - hook 的 React render 层、URL 真实 replaceState 写入路径在 Task 10 的 PBT / 可选
 *   integration test 中覆盖。
 */

import { describe, expect, it } from "vitest";

import { __testing__ } from "../use-right-rail-sub-stage-state";
import { RAIL_SUB_STAGE_ORDER, type AutopilotRailSubStage } from "../../types";

const {
  isValidSubStage,
  parseSubFromSearch,
  applySubToSearch,
  resolveScrollBehavior,
  scrollAnchorIntoView,
  isInputFocused,
  resolveKeyboardIntent,
  stepSubStage,
} = __testing__;

describe("use-right-rail-sub-stage-state / Task 2 — URL pure helpers", () => {
  describe("isValidSubStage", () => {
    it("accepts all 8 canonical sub-stage values", () => {
      for (const v of RAIL_SUB_STAGE_ORDER) {
        expect(isValidSubStage(v)).toBe(true);
      }
    });

    it("rejects empty string, null, undefined", () => {
      expect(isValidSubStage("")).toBe(false);
      expect(isValidSubStage(null)).toBe(false);
      expect(isValidSubStage(undefined)).toBe(false);
    });

    it("rejects unknown strings", () => {
      expect(isValidSubStage("unknown_sub_stage")).toBe(false);
      expect(isValidSubStage("fabric")).toBe(false);
      expect(isValidSubStage("sub_tree")).toBe(false);
    });

    it("rejects case mismatches", () => {
      expect(isValidSubStage("SPEC_TREE")).toBe(false);
      expect(isValidSubStage("Spec_Tree")).toBe(false);
      expect(isValidSubStage("spec_Tree")).toBe(false);
    });

    it("rejects values with leading / trailing whitespace", () => {
      expect(isValidSubStage(" spec_tree")).toBe(false);
      expect(isValidSubStage("spec_tree ")).toBe(false);
      expect(isValidSubStage(" spec_tree ")).toBe(false);
    });
  });

  describe("parseSubFromSearch", () => {
    it("returns the sub value when search has a legal ?sub", () => {
      expect(parseSubFromSearch("?sub=spec_tree")).toBe("spec_tree");
      expect(parseSubFromSearch("sub=spec_tree")).toBe("spec_tree");
    });

    it("returns null when search is empty or missing", () => {
      expect(parseSubFromSearch("")).toBe(null);
      expect(parseSubFromSearch(null)).toBe(null);
      expect(parseSubFromSearch(undefined)).toBe(null);
      expect(parseSubFromSearch("?")).toBe(null);
    });

    it("returns null when search has no sub param", () => {
      expect(parseSubFromSearch("?foo=bar")).toBe(null);
      expect(parseSubFromSearch("?baz=qux&other=1")).toBe(null);
    });

    it("returns null when sub has empty value", () => {
      expect(parseSubFromSearch("?sub=")).toBe(null);
    });

    it("returns null when sub value is not in RAIL_SUB_STAGE_ORDER", () => {
      expect(parseSubFromSearch("?sub=not_a_real_stage")).toBe(null);
      expect(parseSubFromSearch("?sub=fabric")).toBe(null);
    });

    it("returns null when sub value has case mismatch", () => {
      expect(parseSubFromSearch("?sub=SPEC_TREE")).toBe(null);
    });

    it("reads sub correctly when other query params are present", () => {
      expect(parseSubFromSearch("?foo=bar&sub=prompt_package")).toBe("prompt_package");
      expect(parseSubFromSearch("?sub=artifact_memory&foo=bar")).toBe("artifact_memory");
      expect(parseSubFromSearch("?a=1&sub=effect_preview&b=2")).toBe("effect_preview");
    });

    it("handles URL-encoded query strings gracefully", () => {
      // `URLSearchParams` 自动解码；有效 sub 值不含 `%` 或空格，所以编码后应能解出
      expect(parseSubFromSearch("?sub=spec_tree&name=hello%20world")).toBe("spec_tree");
    });
  });

  describe("applySubToSearch", () => {
    it("writes sub into an empty search", () => {
      expect(applySubToSearch("", "spec_tree")).toBe("sub=spec_tree");
      expect(applySubToSearch(null, "spec_tree")).toBe("sub=spec_tree");
      expect(applySubToSearch(undefined, "spec_tree")).toBe("sub=spec_tree");
    });

    it("writes sub while preserving other params", () => {
      expect(applySubToSearch("?foo=bar", "runtime_capability")).toBe(
        "foo=bar&sub=runtime_capability",
      );
      expect(applySubToSearch("foo=bar", "runtime_capability")).toBe(
        "foo=bar&sub=runtime_capability",
      );
    });

    it("overwrites existing sub", () => {
      expect(applySubToSearch("?sub=spec_tree", "prompt_package")).toBe("sub=prompt_package");
      expect(applySubToSearch("?foo=bar&sub=spec_tree", "prompt_package")).toBe(
        "foo=bar&sub=prompt_package",
      );
    });

    it("removes sub when next is null", () => {
      expect(applySubToSearch("?sub=spec_tree", null)).toBe("");
      expect(applySubToSearch("?foo=bar&sub=spec_tree", null)).toBe("foo=bar");
      expect(applySubToSearch("?foo=bar&sub=spec_tree&baz=qux", null)).toBe("foo=bar&baz=qux");
    });

    it("returns empty string when clearing sub from empty / no-sub search", () => {
      expect(applySubToSearch("", null)).toBe("");
      expect(applySubToSearch("?foo=bar", null)).toBe("foo=bar");
      expect(applySubToSearch(null, null)).toBe("");
      expect(applySubToSearch(undefined, null)).toBe("");
    });

    it("is idempotent: applying same value twice yields same result", () => {
      const first = applySubToSearch("?foo=bar", "spec_tree");
      const second = applySubToSearch(`?${first}`, "spec_tree");
      expect(second).toBe(first);
    });
  });

  describe("parseSubFromSearch + applySubToSearch round-trip", () => {
    it("every sub-stage survives a write -> parse round-trip", () => {
      for (const v of RAIL_SUB_STAGE_ORDER) {
        const written = applySubToSearch("", v);
        const parsed = parseSubFromSearch(`?${written}`);
        expect(parsed).toBe(v);
      }
    });

    it("writing null after writing a value clears sub", () => {
      for (const v of RAIL_SUB_STAGE_ORDER) {
        const written = applySubToSearch("", v);
        const cleared = applySubToSearch(`?${written}`, null);
        expect(parseSubFromSearch(`?${cleared}`)).toBe(null);
      }
    });

    it("write -> parse preserves other query params", () => {
      const cases: Array<[string, AutopilotRailSubStage]> = [
        ["foo=bar", "spec_tree"],
        ["a=1&b=2", "effect_preview"],
        ["x=y", "artifact_memory"],
      ];
      for (const [others, target] of cases) {
        const written = applySubToSearch(`?${others}`, target);
        const params = new URLSearchParams(written);
        expect(params.get("sub")).toBe(target);
        // 其他参数仍保留
        const othersParams = new URLSearchParams(others);
        for (const [k, v] of othersParams.entries()) {
          expect(params.get(k)).toBe(v);
        }
      }
    });
  });
});

// =============================================================================
// Task 3 —— scroll behavior pure helpers
// =============================================================================

describe("use-right-rail-sub-stage-state / Task 3 — scroll helpers", () => {
  describe("resolveScrollBehavior", () => {
    it("returns 'auto' when isFirstMount is true, regardless of reduced motion", () => {
      expect(
        resolveScrollBehavior({ isFirstMount: true, prefersReducedMotion: false }),
      ).toBe("auto");
      expect(
        resolveScrollBehavior({ isFirstMount: true, prefersReducedMotion: true }),
      ).toBe("auto");
    });

    it("returns 'auto' when prefers-reduced-motion is reduce", () => {
      expect(
        resolveScrollBehavior({ isFirstMount: false, prefersReducedMotion: true }),
      ).toBe("auto");
    });

    it("returns 'smooth' only when not first mount and no reduced motion", () => {
      expect(
        resolveScrollBehavior({ isFirstMount: false, prefersReducedMotion: false }),
      ).toBe("smooth");
    });
  });

  describe("scrollAnchorIntoView", () => {
    /**
     * 构造一个极简 stub：`container.querySelector` 返回一个带 `scrollIntoView` spy 的对象，
     * 以便在 node 环境下覆盖 scroll 触发路径而无需 jsdom。
     */
    function makeContainer(options: {
      anchorAttr: string;
      anchorValue: string;
      hasAnchor?: boolean;
      anchorHasScroll?: boolean;
      throwOnQuery?: boolean;
      throwOnScroll?: boolean;
    }): {
      container: Element;
      scrollCalls: Array<ScrollIntoViewOptions | undefined>;
    } {
      const scrollCalls: Array<ScrollIntoViewOptions | undefined> = [];
      const anchor =
        options.anchorHasScroll === false
          ? ({} as HTMLElement)
          : ({
              scrollIntoView: (opts?: ScrollIntoViewOptions) => {
                if (options.throwOnScroll) {
                  throw new Error("stub scroll throw");
                }
                scrollCalls.push(opts);
              },
            } as unknown as HTMLElement);
      const container = {
        querySelector: (selector: string) => {
          if (options.throwOnQuery) {
            throw new Error("stub query throw");
          }
          const expected = `[${options.anchorAttr}="${options.anchorValue}"]`;
          if (options.hasAnchor === false) {
            return null;
          }
          if (selector === expected) {
            return anchor;
          }
          return null;
        },
      } as unknown as Element;
      return { container, scrollCalls };
    }

    it("returns false when container is null", () => {
      expect(
        scrollAnchorIntoView({
          container: null,
          anchorAttr: "data-sub-stage-anchor",
          anchorValue: "spec_tree",
          behavior: "auto",
        }),
      ).toBe(false);
    });

    it("returns false when anchor is not found (no throw)", () => {
      const { container } = makeContainer({
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "spec_tree",
        hasAnchor: false,
      });
      expect(
        scrollAnchorIntoView({
          container,
          anchorAttr: "data-sub-stage-anchor",
          anchorValue: "spec_tree",
          behavior: "auto",
        }),
      ).toBe(false);
    });

    it("returns false when querySelector throws", () => {
      const { container } = makeContainer({
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "spec_tree",
        throwOnQuery: true,
      });
      expect(
        scrollAnchorIntoView({
          container,
          anchorAttr: "data-sub-stage-anchor",
          anchorValue: "spec_tree",
          behavior: "auto",
        }),
      ).toBe(false);
    });

    it("returns false when anchor element lacks scrollIntoView", () => {
      const { container } = makeContainer({
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "spec_tree",
        anchorHasScroll: false,
      });
      expect(
        scrollAnchorIntoView({
          container,
          anchorAttr: "data-sub-stage-anchor",
          anchorValue: "spec_tree",
          behavior: "auto",
        }),
      ).toBe(false);
    });

    it("returns false (no throw) when scrollIntoView itself throws", () => {
      const { container } = makeContainer({
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "spec_tree",
        throwOnScroll: true,
      });
      expect(
        scrollAnchorIntoView({
          container,
          anchorAttr: "data-sub-stage-anchor",
          anchorValue: "spec_tree",
          behavior: "auto",
        }),
      ).toBe(false);
    });

    it("calls scrollIntoView with the given behavior and default block='start'", () => {
      const { container, scrollCalls } = makeContainer({
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "spec_tree",
      });
      const ok = scrollAnchorIntoView({
        container,
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "spec_tree",
        behavior: "smooth",
      });
      expect(ok).toBe(true);
      expect(scrollCalls).toHaveLength(1);
      expect(scrollCalls[0]).toEqual({ behavior: "smooth", block: "start" });
    });

    it("respects explicit block option", () => {
      const { container, scrollCalls } = makeContainer({
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "artifact_memory",
      });
      scrollAnchorIntoView({
        container,
        anchorAttr: "data-sub-stage-anchor",
        anchorValue: "artifact_memory",
        behavior: "auto",
        block: "center",
      });
      expect(scrollCalls[0]).toEqual({ behavior: "auto", block: "center" });
    });
  });
});

// =============================================================================
// Task 4 —— keyboard pure helpers
// =============================================================================

describe("use-right-rail-sub-stage-state / Task 4 — keyboard helpers", () => {
  /**
   * 伪造一个最小的 `Element`-like 目标，支持 tagName / getAttribute / parentElement
   * 链式访问。isInputFocused 只会用到这些字段，所以不需要 jsdom。
   */
  function makeTarget(opts: {
    tagName?: string;
    contentEditable?: string | null;
    parent?: ReturnType<typeof makeTarget> | null;
  }): EventTarget {
    const parent = opts.parent ?? null;
    return {
      tagName: opts.tagName ?? "DIV",
      getAttribute: (name: string) => {
        if (name === "contenteditable") {
          return opts.contentEditable ?? null;
        }
        return null;
      },
      parentElement: parent,
    } as unknown as EventTarget;
  }

  describe("isInputFocused", () => {
    it("returns false for null / undefined / non-element target", () => {
      expect(isInputFocused(null)).toBe(false);
      expect(isInputFocused({} as EventTarget)).toBe(false);
    });

    it("returns true for INPUT / TEXTAREA / SELECT", () => {
      expect(isInputFocused(makeTarget({ tagName: "INPUT" }))).toBe(true);
      expect(isInputFocused(makeTarget({ tagName: "TEXTAREA" }))).toBe(true);
      expect(isInputFocused(makeTarget({ tagName: "SELECT" }))).toBe(true);
    });

    it("is case-insensitive on tagName", () => {
      expect(isInputFocused(makeTarget({ tagName: "input" }))).toBe(true);
      expect(isInputFocused(makeTarget({ tagName: "Input" }))).toBe(true);
    });

    it("returns true when contenteditable='true'", () => {
      expect(
        isInputFocused(makeTarget({ tagName: "DIV", contentEditable: "true" })),
      ).toBe(true);
    });

    it("returns true when contenteditable is empty string (HTML spec allows)", () => {
      expect(
        isInputFocused(makeTarget({ tagName: "DIV", contentEditable: "" })),
      ).toBe(true);
    });

    it("returns false when contenteditable='false'", () => {
      expect(
        isInputFocused(makeTarget({ tagName: "DIV", contentEditable: "false" })),
      ).toBe(false);
    });

    it("walks up parentElement to find ancestor input", () => {
      const input = makeTarget({ tagName: "INPUT" });
      const child = makeTarget({
        tagName: "SPAN",
        parent: input as ReturnType<typeof makeTarget>,
      });
      const grandchild = makeTarget({
        tagName: "SPAN",
        parent: child as ReturnType<typeof makeTarget>,
      });
      expect(isInputFocused(grandchild)).toBe(true);
    });

    it("returns false when neither self nor ancestors match", () => {
      const root = makeTarget({ tagName: "MAIN" });
      const mid = makeTarget({
        tagName: "DIV",
        parent: root as ReturnType<typeof makeTarget>,
      });
      const leaf = makeTarget({
        tagName: "BUTTON",
        parent: mid as ReturnType<typeof makeTarget>,
      });
      expect(isInputFocused(leaf)).toBe(false);
    });
  });

  describe("resolveKeyboardIntent", () => {
    const baseEvent = {
      key: "[",
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      target: makeTarget({ tagName: "BODY" }),
      currentStage: "fabric" as string | undefined,
      drawerOpen: false,
    };

    it("returns 'ignore' when target is INPUT (focus guard)", () => {
      expect(
        resolveKeyboardIntent({
          ...baseEvent,
          target: makeTarget({ tagName: "INPUT" }),
        }),
      ).toBe("ignore");
    });

    it("returns 'ignore' when metaKey pressed", () => {
      expect(
        resolveKeyboardIntent({ ...baseEvent, metaKey: true }),
      ).toBe("ignore");
    });

    it("returns 'ignore' when ctrlKey pressed", () => {
      expect(
        resolveKeyboardIntent({ ...baseEvent, ctrlKey: true }),
      ).toBe("ignore");
    });

    it("returns 'ignore' when altKey pressed", () => {
      expect(
        resolveKeyboardIntent({ ...baseEvent, altKey: true }),
      ).toBe("ignore");
    });

    it("maps '[' to step-prev in fabric stage", () => {
      expect(resolveKeyboardIntent({ ...baseEvent, key: "[" })).toBe("step-prev");
    });

    it("maps ']' to step-next in fabric stage", () => {
      expect(resolveKeyboardIntent({ ...baseEvent, key: "]" })).toBe("step-next");
    });

    it("maps Shift+P to toggle-pin in fabric stage", () => {
      expect(
        resolveKeyboardIntent({ ...baseEvent, key: "P", shiftKey: true }),
      ).toBe("toggle-pin");
    });

    it("returns 'ignore' for 'P' without shift (not toggle-pin)", () => {
      expect(
        resolveKeyboardIntent({ ...baseEvent, key: "P", shiftKey: false }),
      ).toBe("ignore");
    });

    it("returns 'close-drawer' only when Escape + drawerOpen (fabric or not)", () => {
      // fabric + drawerOpen
      expect(
        resolveKeyboardIntent({ ...baseEvent, key: "Escape", drawerOpen: true }),
      ).toBe("close-drawer");
      // non-fabric + drawerOpen
      expect(
        resolveKeyboardIntent({
          ...baseEvent,
          key: "Escape",
          drawerOpen: true,
          currentStage: "input",
        }),
      ).toBe("close-drawer");
    });

    it("returns 'ignore' for Escape when drawer closed", () => {
      expect(
        resolveKeyboardIntent({ ...baseEvent, key: "Escape", drawerOpen: false }),
      ).toBe("ignore");
    });

    it("returns 'ignore' for '[' / ']' / Shift+P in non-fabric stage", () => {
      const cases = [
        { ...baseEvent, key: "[", currentStage: "input" },
        { ...baseEvent, key: "]", currentStage: "selection" },
        { ...baseEvent, key: "P", shiftKey: true, currentStage: "clarification" },
      ];
      for (const c of cases) {
        expect(resolveKeyboardIntent(c)).toBe("ignore");
      }
    });

    it("returns 'ignore' for unknown keys", () => {
      expect(resolveKeyboardIntent({ ...baseEvent, key: "a" })).toBe("ignore");
      expect(resolveKeyboardIntent({ ...baseEvent, key: "Enter" })).toBe("ignore");
      expect(resolveKeyboardIntent({ ...baseEvent, key: "Tab" })).toBe("ignore");
    });
  });

  describe("stepSubStage", () => {
    it("returns RAIL_SUB_STAGE_ORDER[0] for next when current is undefined", () => {
      expect(stepSubStage(undefined, "next")).toBe(RAIL_SUB_STAGE_ORDER[0]);
    });

    it("returns undefined for prev when current is undefined", () => {
      expect(stepSubStage(undefined, "prev")).toBe(undefined);
    });

    it("returns undefined at boundaries (no wraparound)", () => {
      expect(stepSubStage(RAIL_SUB_STAGE_ORDER[0], "prev")).toBe(undefined);
      expect(
        stepSubStage(
          RAIL_SUB_STAGE_ORDER[RAIL_SUB_STAGE_ORDER.length - 1],
          "next",
        ),
      ).toBe(undefined);
    });

    it("advances index by +1 / -1 respectively", () => {
      for (let i = 1; i < RAIL_SUB_STAGE_ORDER.length; i += 1) {
        expect(stepSubStage(RAIL_SUB_STAGE_ORDER[i], "prev")).toBe(
          RAIL_SUB_STAGE_ORDER[i - 1],
        );
      }
      for (let i = 0; i < RAIL_SUB_STAGE_ORDER.length - 1; i += 1) {
        expect(stepSubStage(RAIL_SUB_STAGE_ORDER[i], "next")).toBe(
          RAIL_SUB_STAGE_ORDER[i + 1],
        );
      }
    });

    it("is symmetric: prev then next returns to the same sub-stage (except at boundaries)", () => {
      for (let i = 1; i < RAIL_SUB_STAGE_ORDER.length - 1; i += 1) {
        const prev = stepSubStage(RAIL_SUB_STAGE_ORDER[i], "prev");
        const back = stepSubStage(prev, "next");
        expect(back).toBe(RAIL_SUB_STAGE_ORDER[i]);
      }
    });
  });
});
