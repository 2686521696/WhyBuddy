import { describe, expect, it } from "vitest";
import {
  EXECUTOR_CAPABILITIES,
  EXECUTOR_CAPABILITY_SET,
} from "../executor/contracts.js";

describe("executor capability vocabulary", () => {
  it("does not contain duplicate capability names", () => {
    expect(EXECUTOR_CAPABILITY_SET.size).toBe(EXECUTOR_CAPABILITIES.length);
  });

  it("uses stable lowercase dot-delimited names", () => {
    for (const capability of EXECUTOR_CAPABILITIES) {
      expect(capability).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
    }
  });
});
