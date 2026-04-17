import { describe, expect, it } from "vitest";

import {
  DEBUG_PATH,
  LEGACY_COMMAND_CENTER_LEGACY_PATH,
  LEGACY_COMMAND_CENTER_PATH,
  MAIN_PATH_ITEMS,
  MORE_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  getPrimaryNavigationId,
  isLowFrequencyPath,
} from "../navigation-config";

describe("navigation convergence config", () => {
  it("keeps the primary navigation focused on office and more", () => {
    expect(PRIMARY_NAV_ITEMS.map(item => item.id)).toEqual(["office", "more"]);
  });

  it("keeps tasks available as a secondary main path", () => {
    expect(MAIN_PATH_ITEMS.map(item => item.id)).toEqual(["office", "tasks"]);
  });

  it("maps routes into the converged primary paths", () => {
    expect(getPrimaryNavigationId("/")).toBe("office");
    expect(getPrimaryNavigationId("/tasks")).toBe("office");
    expect(getPrimaryNavigationId("/tasks/task-42")).toBe("office");
    expect(getPrimaryNavigationId("/lineage")).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_PATH)).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_PATH)).toBe("more");
    expect(getPrimaryNavigationId(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(
      "more"
    );
  });

  it("collects low-frequency destinations in the More drawer", () => {
    expect(MORE_NAV_ITEMS.map(item => item.id)).toEqual([
      "config",
      "permissions",
      "audit",
      "help",
    ]);
  });

  it("treats debug, lineage, and legacy command center routes as low-frequency paths", () => {
    expect(isLowFrequencyPath(DEBUG_PATH)).toBe(true);
    expect(isLowFrequencyPath("/lineage")).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_PATH)).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(true);
    expect(isLowFrequencyPath("/tasks")).toBe(false);
  });
});
