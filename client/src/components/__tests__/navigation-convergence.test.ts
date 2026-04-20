import { describe, expect, it } from "vitest";

import {
  DEBUG_AUDIT_PATH,
  DEBUG_CONFIG_PATH,
  DEBUG_HELP_PATH,
  DEBUG_PERMISSIONS_PATH,
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
    expect(getPrimaryNavigationId(DEBUG_CONFIG_PATH)).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_PERMISSIONS_PATH)).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_AUDIT_PATH)).toBe("more");
    expect(getPrimaryNavigationId(DEBUG_HELP_PATH)).toBe("more");
    expect(getPrimaryNavigationId("/debug/lineage")).toBe("more");
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
    expect(MORE_NAV_ITEMS.find(item => item.id === "config")?.href).toBe(
      DEBUG_CONFIG_PATH
    );
    expect(MORE_NAV_ITEMS.find(item => item.id === "permissions")?.href).toBe(
      DEBUG_PERMISSIONS_PATH
    );
    expect(MORE_NAV_ITEMS.find(item => item.id === "audit")?.href).toBe(
      DEBUG_AUDIT_PATH
    );
    expect(MORE_NAV_ITEMS.find(item => item.id === "help")?.href).toBe(
      DEBUG_HELP_PATH
    );
  });

  it("treats debug, lineage, and legacy command center routes as low-frequency paths", () => {
    expect(isLowFrequencyPath(DEBUG_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_CONFIG_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_PERMISSIONS_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_AUDIT_PATH)).toBe(true);
    expect(isLowFrequencyPath(DEBUG_HELP_PATH)).toBe(true);
    expect(isLowFrequencyPath("/lineage")).toBe(true);
    expect(isLowFrequencyPath("/debug/lineage")).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_PATH)).toBe(true);
    expect(isLowFrequencyPath(LEGACY_COMMAND_CENTER_LEGACY_PATH)).toBe(true);
    expect(isLowFrequencyPath("/tasks")).toBe(false);
  });
});
