import { describe, expect, it } from "vitest";
import { capacityPolicyValid, INDEPENDENT_STRUCTURE_BATCH12_LABELS, notificationRouteValid } from "../independent-structure-blocks-batch12";
import { assetStackPrimaryValid, roundRobinHostDistributionValid } from "../independent-structure-blocks-batch12-replacements";

describe("independent structure batch 12 gates", () => {
  it("requires each round-robin host group to close at 100 percent", () => {
    expect(roundRobinHostDistributionValid([{ group: "sales", priority: 3, weight: 60, fixed: false }, { group: "sales", priority: 2, weight: 40, fixed: false }])).toBe(true);
    expect(roundRobinHostDistributionValid([{ group: "sales", priority: 3, weight: 80, fixed: false }])).toBe(false);
    expect(roundRobinHostDistributionValid([{ group: "sales", priority: 3, weight: 100, fixed: false }, { group: "sales", priority: 4, weight: 0, fixed: true }])).toBe(true);
  });

  it("requires one primary and stable unique stack order", () => {
    expect(assetStackPrimaryValid([{ id: "a", order: 0, primary: true }, { id: "b", order: 1, primary: false }])).toBe(true);
    expect(assetStackPrimaryValid([{ id: "a", order: 0, primary: true }, { id: "b", order: 0, primary: false }])).toBe(false);
    expect(assetStackPrimaryValid([{ id: "a", order: 0, primary: true }])).toBe(false);
  });

  it("keeps inbox limits inside agent capacity", () => {
    expect(capacityPolicyValid([{ capacity: 10, inboxLimit: 6, excluded: false }], 60)).toBe(true);
    expect(capacityPolicyValid([{ capacity: 10, inboxLimit: 12, excluded: false }], 60)).toBe(false);
    expect(capacityPolicyValid([{ capacity: 0, inboxLimit: 0, excluded: true }], 60)).toBe(true);
  });

  it("rejects orphan notification routes", () => {
    expect(notificationRouteValid([{ id: "root", parent: "", receiver: "ops", matcher: "severity=critical", provisioned: false }, { id: "child", parent: "root", receiver: "sms", matcher: "team=pay", provisioned: false }])).toBe(true);
    expect(notificationRouteValid([{ id: "child", parent: "missing", receiver: "sms", matcher: "team=pay", provisioned: false }])).toBe(false);
    expect(Object.keys(INDEPENDENT_STRUCTURE_BATCH12_LABELS)).toHaveLength(2);
  });
});
