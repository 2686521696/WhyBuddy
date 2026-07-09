import { describe, expect, it } from "vitest";
import {
  createGithubPagesSlideRuleSeedSession,
  createGithubPagesSlideRuleSessionStore,
  GITHUB_PAGES_DEMO_GOAL,
  loadOrSeedGithubPagesDemoSession,
} from "../github-pages-sliderule-demo";

describe("github-pages-sliderule-demo", () => {
  it("seeds a session with goal, risk, and grounded web evidence", () => {
    const state = createGithubPagesSlideRuleSeedSession();
    expect(state.goal?.text).toBe(GITHUB_PAGES_DEMO_GOAL);
    expect(state.artifacts?.length).toBeGreaterThanOrEqual(4);
    expect(state.goal?.status).toBe("clear");
    expect(state.deliveryPhase).toBe("shipped");
    const evidence = state.artifacts?.find((a) => a.id === "demo-evidence-1");
    expect(evidence?.provenance).toBe("web:search");
    expect(state.graph?.nodes?.length).toBeGreaterThan(0);
    expect(state.conversation?.length).toBeGreaterThanOrEqual(2);
  });

  it("persists demo session in memory-backed localStorage shim", async () => {
    const mem = new Map<string, string>();
    const store = createGithubPagesSlideRuleSessionStore({
      storage: {
        getItem: (k) => mem.get(k) ?? null,
        setItem: (k, v) => {
          mem.set(k, v);
        },
        removeItem: (k) => {
          mem.delete(k);
        },
      },
    });

    const first = await loadOrSeedGithubPagesDemoSession(store, "demo-s1");
    expect(first.artifacts?.length).toBeGreaterThanOrEqual(2);

    const second = await loadOrSeedGithubPagesDemoSession(store, "demo-s1");
    expect(second.artifacts?.length).toBe(first.artifacts?.length);
  });
});