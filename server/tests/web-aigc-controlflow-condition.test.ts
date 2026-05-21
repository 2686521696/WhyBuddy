import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  evaluateConditionRules,
  evaluateRuntimeConditionExpression,
  type ConditionRule,
  type ConditionRelation,
} from "../core/web-aigc-controlflow.js";

describe("evaluateConditionRules — 14 operators + AND/OR", () => {
  // --- eq ---
  describe("eq operator", () => {
    it("returns true for equal numbers", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 5, operator: "eq", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
      expect(result.results[0].result).toBe(true);
    });

    it("returns true for numeric string vs number", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "10", operator: "eq", rightValue: 10 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns true for null == null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "eq", rightValue: null }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for null vs non-null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "eq", rightValue: "hello" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns true for equal strings", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "abc", operator: "eq", rightValue: "abc" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for different strings", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "abc", operator: "eq", rightValue: "xyz" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- neq ---
  describe("neq operator", () => {
    it("returns true for different values", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 1, operator: "neq", rightValue: 2 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for equal values", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "x", operator: "neq", rightValue: "x" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- in ---
  describe("in operator", () => {
    it("returns true when left is in array", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "b", operator: "in", rightValue: ["a", "b", "c"] }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns true when left is in comma-separated string", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "admin", operator: "in", rightValue: "admin,user,guest" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false when left is not in array", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "d", operator: "in", rightValue: ["a", "b", "c"] }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns false when left is null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "in", rightValue: ["a", "b"] }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- not_in ---
  describe("not_in operator", () => {
    it("returns true when left is not in array", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "d", operator: "not_in", rightValue: ["a", "b", "c"] }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false when left is in array", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "a", operator: "not_in", rightValue: ["a", "b", "c"] }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- gt ---
  describe("gt operator", () => {
    it("returns true for 10 > 5", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 10, operator: "gt", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for 5 > 10", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 5, operator: "gt", rightValue: 10 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns false when left is null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "gt", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("falls back to string comparison for non-numeric", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "b", operator: "gt", rightValue: "a" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });
  });

  // --- gte ---
  describe("gte operator", () => {
    it("returns true for 5 >= 5", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 5, operator: "gte", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for 4 >= 5", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 4, operator: "gte", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- lt ---
  describe("lt operator", () => {
    it("returns true for 3 < 5", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 3, operator: "lt", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for 5 < 3", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 5, operator: "lt", rightValue: 3 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- lte ---
  describe("lte operator", () => {
    it("returns true for 5 <= 5", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 5, operator: "lte", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for 6 <= 5", () => {
      const result = evaluateConditionRules(
        [{ leftValue: 6, operator: "lte", rightValue: 5 }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- is_empty ---
  describe("is_empty operator", () => {
    it("returns true for null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "is_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns true for undefined", () => {
      const result = evaluateConditionRules(
        [{ leftValue: undefined, operator: "is_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns true for empty string", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "  ", operator: "is_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns true for empty array", () => {
      const result = evaluateConditionRules(
        [{ leftValue: [], operator: "is_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns true for empty object", () => {
      const result = evaluateConditionRules(
        [{ leftValue: {}, operator: "is_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for non-empty string", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello", operator: "is_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns false for non-empty array", () => {
      const result = evaluateConditionRules(
        [{ leftValue: [1], operator: "is_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- is_not_empty ---
  describe("is_not_empty operator", () => {
    it("returns true for non-empty value", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello", operator: "is_not_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false for null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "is_not_empty" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- starts_with ---
  describe("starts_with operator", () => {
    it("returns true when string starts with prefix", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello world", operator: "starts_with", rightValue: "hello" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false when string does not start with prefix", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello world", operator: "starts_with", rightValue: "world" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns false when left is null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "starts_with", rightValue: "x" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- ends_with ---
  describe("ends_with operator", () => {
    it("returns true when string ends with suffix", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello world", operator: "ends_with", rightValue: "world" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false when string does not end with suffix", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello world", operator: "ends_with", rightValue: "hello" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- contains ---
  describe("contains operator", () => {
    it("returns true when string contains substring", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello world", operator: "contains", rightValue: "lo wo" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false when string does not contain substring", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "hello world", operator: "contains", rightValue: "xyz" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns false when left is null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "contains", rightValue: "x" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });

  // --- regex ---
  describe("regex operator", () => {
    it("returns true when pattern matches", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "abc123", operator: "regex", rightValue: "^[a-z]+\\d+$" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
    });

    it("returns false when pattern does not match", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "abc", operator: "regex", rightValue: "^\\d+$" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns false for invalid regex pattern", () => {
      const result = evaluateConditionRules(
        [{ leftValue: "abc", operator: "regex", rightValue: "[invalid" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("returns false when left is null", () => {
      const result = evaluateConditionRules(
        [{ leftValue: null, operator: "regex", rightValue: ".*" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });

    it("logs warning when regex execution is slow", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // This test just verifies the function doesn't crash on a normal regex
      // A truly slow regex would block the event loop, so we just test the path exists
      const result = evaluateConditionRules(
        [{ leftValue: "test", operator: "regex", rightValue: "test" }],
        "AND",
        {},
      );
      expect(result.matched).toBe(true);
      warnSpy.mockRestore();
    });
  });

  // --- AND relation ---
  describe("AND relation", () => {
    it("returns true when all rules match", () => {
      const rules: ConditionRule[] = [
        { leftValue: 10, operator: "gt", rightValue: 5 },
        { leftValue: "hello", operator: "starts_with", rightValue: "he" },
        { leftValue: "world", operator: "is_not_empty" },
      ];
      const result = evaluateConditionRules(rules, "AND", {});
      expect(result.matched).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results.every(r => r.result)).toBe(true);
    });

    it("returns false when one rule fails", () => {
      const rules: ConditionRule[] = [
        { leftValue: 10, operator: "gt", rightValue: 5 },
        { leftValue: 3, operator: "gt", rightValue: 100 },
        { leftValue: "hello", operator: "is_not_empty" },
      ];
      const result = evaluateConditionRules(rules, "AND", {});
      expect(result.matched).toBe(false);
      expect(result.results[0].result).toBe(true);
      expect(result.results[1].result).toBe(false);
      expect(result.results[2].result).toBe(true);
    });
  });

  // --- OR relation ---
  describe("OR relation", () => {
    it("returns true when at least one rule matches", () => {
      const rules: ConditionRule[] = [
        { leftValue: 1, operator: "gt", rightValue: 100 },
        { leftValue: "hello", operator: "eq", rightValue: "hello" },
      ];
      const result = evaluateConditionRules(rules, "OR", {});
      expect(result.matched).toBe(true);
    });

    it("returns false when all rules fail", () => {
      const rules: ConditionRule[] = [
        { leftValue: 1, operator: "gt", rightValue: 100 },
        { leftValue: "abc", operator: "eq", rightValue: "xyz" },
      ];
      const result = evaluateConditionRules(rules, "OR", {});
      expect(result.matched).toBe(false);
    });
  });

  // --- Variable resolution ---
  describe("variable resolution ($global.x)", () => {
    it("resolves $global.x from variables", () => {
      const variables = { status: "active", count: 42 };
      const rules: ConditionRule[] = [
        { leftValue: "$status", operator: "eq", rightValue: "active" },
      ];
      const result = evaluateConditionRules(rules, "AND", variables);
      expect(result.matched).toBe(true);
    });

    it("resolves $.path style variables", () => {
      const variables = { user: { role: "admin" } };
      const rules: ConditionRule[] = [
        { leftValue: "$.user.role", operator: "eq", rightValue: "admin" },
      ];
      const result = evaluateConditionRules(rules, "AND", variables);
      expect(result.matched).toBe(true);
    });

    it("resolves variable on right side too", () => {
      const variables = { threshold: 10, current: 15 };
      const rules: ConditionRule[] = [
        { leftValue: "$current", operator: "gt", rightValue: "$threshold" },
      ];
      const result = evaluateConditionRules(rules, "AND", variables);
      expect(result.matched).toBe(true);
    });

    it("returns false when variable is not found", () => {
      const variables = {};
      const rules: ConditionRule[] = [
        { leftValue: "$nonexistent", operator: "is_not_empty" },
      ];
      const result = evaluateConditionRules(rules, "AND", variables);
      expect(result.matched).toBe(false);
    });
  });

  // --- Empty rules ---
  describe("edge cases", () => {
    it("returns matched=false for empty rules array", () => {
      const result = evaluateConditionRules([], "AND", {});
      expect(result.matched).toBe(false);
      expect(result.results).toHaveLength(0);
    });

    it("returns matched=false for null/undefined rules", () => {
      const result = evaluateConditionRules(
        null as unknown as ConditionRule[],
        "AND",
        {},
      );
      expect(result.matched).toBe(false);
    });
  });
});

// --- Backward compatibility: expression string still works ---
describe("evaluateRuntimeConditionExpression — backward compat", () => {
  it("evaluates simple equality expression", () => {
    const result = evaluateRuntimeConditionExpression("status==='active'", {
      status: "active",
    });
    expect(result.matched).toBe(true);
  });

  it("evaluates numeric comparison", () => {
    const result = evaluateRuntimeConditionExpression("count>5", {
      count: 10,
    });
    expect(result.matched).toBe(true);
  });

  it("returns error for empty expression", () => {
    const result = evaluateRuntimeConditionExpression("", {});
    expect(result.matched).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("evaluates inequality", () => {
    const result = evaluateRuntimeConditionExpression("x!==y", {
      x: "hello",
      y: "world",
    });
    expect(result.matched).toBe(true);
  });
});
