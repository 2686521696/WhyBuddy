import { describe, expect, it } from "vitest";
import {
  createGithubPagesSlideRuleSeedSession,
  createGithubPagesSlideRuleSessionStore,
  GITHUB_PAGES_DEMO_GOAL,
  loadOrSeedGithubPagesDemoSession,
} from "../github-pages-sliderule-demo";
import { driveGithubPagesDemoPlayback } from "../github-pages-demo-playback";
import { GITHUB_PAGES_DEMO_TEMPLATE } from "../github-pages-demo-template";
import { intakeMessage } from "@/lib/sliderule-runtime";

describe("github-pages-sliderule-demo", () => {
  it("seeds a blank session so the visitor runs the demo themselves", () => {
    const state = createGithubPagesSlideRuleSeedSession();
    expect(state.goal?.text ?? "").toBe("");
    expect(state.artifacts?.length ?? 0).toBe(0);
  });

  it("persists demo session in memory-backed localStorage shim and keeps a played run", async () => {
    const mem = new Map<string, string>();
    const store = createGithubPagesSlideRuleSessionStore({
      storage: {
        getItem: k => mem.get(k) ?? null,
        setItem: (k, v) => {
          mem.set(k, v);
        },
        removeItem: k => {
          mem.delete(k);
        },
      },
    });

    const first = await loadOrSeedGithubPagesDemoSession(store, "demo-s1");
    expect(first.artifacts?.length ?? 0).toBe(0);

    // 模拟访客跑完一轮回放后落库：goal + artifacts 齐 → 后续访问恢复快照而非重播种子
    const played = {
      ...first,
      sessionId: "demo-s1",
      goal: { text: GITHUB_PAGES_DEMO_GOAL, status: "clear" as const },
      artifacts: [{ id: "a1" } as any],
    };
    await store.save(played as any);
    const second = await loadOrSeedGithubPagesDemoSession(store, "demo-s1");
    expect(second.goal?.text).toBe(GITHUB_PAGES_DEMO_GOAL);
    expect(second.artifacts?.length).toBe(1);
  });
});

describe("github-pages-demo-playback", () => {
  it("template carries real captured six-skill evidence + closure", () => {
    expect(GITHUB_PAGES_DEMO_TEMPLATE.skills.map(s => s.skill)).toEqual([
      "dataModel",
      "rbac",
      "workflow",
      "page",
      "aigc",
      "appBundle",
    ]);
    for (const s of GITHUB_PAGES_DEMO_TEMPLATE.skills) {
      expect(Object.keys(s.modelSection).length).toBeGreaterThan(0);
    }
    const pc = GITHUB_PAGES_DEMO_TEMPLATE.publishClosure as any;
    expect(pc.blocked).toBe(false);
    expect(pc.evidencePresentCount).toBe(6);
    expect(GITHUB_PAGES_DEMO_TEMPLATE.chatSummary.length).toBeGreaterThan(100);
  });

  it("plays back skill events and returns a shipped final state with publish closure", async () => {
    const seed = createGithubPagesSlideRuleSeedSession();
    const { preparedState } = intakeMessage(seed, {
      turnId: "t-playback",
      userText: GITHUB_PAGES_DEMO_GOAL,
    });

    const activated: string[] = [];
    const completed: string[] = [];
    let summaryText = "";
    const res = await driveGithubPagesDemoPlayback(
      preparedState,
      GITHUB_PAGES_DEMO_GOAL,
      {
        turnId: "t-playback",
        onSkillActivated: id => activated.push(id),
        onSkillCompleted: (id, hasError, detail) => {
          completed.push(id);
          expect(hasError).toBe(false);
          expect(detail?.modelSection).toBeTruthy();
        },
        onLlmDelta: (text, label) => {
          if (label === "closure.summary") summaryText += text;
        },
      }
    );

    expect(res).not.toBeNull();
    expect(activated).toHaveLength(6);
    expect(completed).toHaveLength(6);
    expect(summaryText).toBe(GITHUB_PAGES_DEMO_TEMPLATE.chatSummary);
    const final = res!.finalState as any;
    expect(final.goal?.status).toBe("clear");
    expect(final.deliveryPhase).toBe("shipped");
    expect(final.publishClosure?.evidencePresentCount).toBe(6);
    expect((final.artifacts?.length ?? 0)).toBeGreaterThanOrEqual(4);
  }, 60000);
});
