import { describe, expect, it } from "vitest";

import {
  ReplanButton,
  ReplanConfirmationModal,
  deriveDownstreamImpact,
  useReplanFlow,
} from "../index";

describe("replan module barrel", () => {
  it("exports the standalone replan surface for future right-rail integration", () => {
    expect(typeof deriveDownstreamImpact).toBe("function");
    expect(typeof ReplanConfirmationModal).toBe("function");
    expect(typeof ReplanButton).toBe("function");
    expect(typeof useReplanFlow).toBe("function");
  });
});
