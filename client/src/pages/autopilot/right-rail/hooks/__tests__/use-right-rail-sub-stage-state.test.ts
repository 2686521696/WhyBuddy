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

const { isValidSubStage, parseSubFromSearch, applySubToSearch } = __testing__;

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
      const first = applySubToSearch("?foo=bar", "spec_documents");
      const second = applySubToSearch(`?${first}`, "spec_documents");
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
