import { describe, expect, it } from "vitest";

import * as stageEdit from "../index";

describe("stage-edit barrel", () => {
  it("exports the independent UI and hook primitives", () => {
    expect(stageEdit).toHaveProperty("EditModeField");
    expect(stageEdit).toHaveProperty("InlineConfirmation");
    expect(stageEdit).toHaveProperty("StaleBadge");
    expect(stageEdit).toHaveProperty("RightRailStaleIndicator");
    expect(stageEdit).toHaveProperty("deriveDownstreamImpact");
    expect(stageEdit).toHaveProperty("useInlineEditFlow");
  });
});
