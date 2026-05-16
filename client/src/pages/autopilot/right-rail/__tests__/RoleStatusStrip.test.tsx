/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 1
 * 回归测试：RoleStatusStrip。
 *
 * 测试策略与本仓既有 right-rail 测试（`AutopilotRightRail.subtimeline-mount.test.tsx`）
 * 保持一致：本仓 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`，引入这些
 * 工具属于跨规格的工具链改造；因此使用 `react-dom/server` `renderToStaticMarkup` +
 * `vi.mock` 替换 `useBlueprintRealtimeStore` 的方式做 SSR 层断言。
 *
 * 覆盖三类契约（与上文规格一一对应）：
 *  1. rolePhases 为空时返回 null，不出现 `data-testid="role-status-strip"`。
 *  2. rolePhases 非空时渲染所有 roleId 与对应相位颜色（thinking → animate-pulse；
 *     acting → bg-amber-100；completed → bg-emerald-50）。
 *  3. roleId 字母序稳定排序：不论 store 注入顺序如何，输出 markup 中 `analyzer`
 *     必须先于 `planner` 出现。
 *
 * 第四个 source-level 断言用于锁定 `<RoleStatusStrip />` 已经被挂载在
 * `AutopilotRightRail.tsx` 的 fabric 分支（`data-stage-placeholder="fabric"` 所在的
 * `<aside>` return 块）内，避免后续重构把它误移到非 fabric 分支或丢失挂载。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RolePhase } from "@/lib/blueprint-realtime-store";

// ─── 受控的 rolePhases 状态 ───────────────────────────────────────────────

let mockedRolePhases: Record<string, RolePhase> = {};

function setMockedRolePhases(next: Record<string, RolePhase>): void {
  mockedRolePhases = { ...next };
}

function resetMockedRolePhases(): void {
  mockedRolePhases = {};
}

// ─── Mock `@/lib/blueprint-realtime-store` ────────────────────────────────

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((
    selector?: (state: { rolePhases: Record<string, RolePhase> }) => unknown
  ) => {
    const snapshot = { rolePhases: mockedRolePhases };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { RoleStatusStrip } from "../RoleStatusStrip";

// ─── Layer 1：SSR 契约 ─────────────────────────────────────────────────────

describe("RoleStatusStrip render contract", () => {
  beforeEach(() => {
    resetMockedRolePhases();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedRolePhases();
  });

  it("returns null when rolePhases is empty (folded state)", () => {
    setMockedRolePhases({});

    const markup = renderToStaticMarkup(<RoleStatusStrip />);

    // 折叠态：返回 null → markup 为空字符串，且不可能含有 testid。
    expect(markup).not.toContain('data-testid="role-status-strip"');
    expect(markup).toBe("");
  });

  it("renders one badge per role with phase-specific color classes", () => {
    setMockedRolePhases({
      planner: "thinking",
      analyzer: "acting",
      reviewer: "completed",
    });

    const markup = renderToStaticMarkup(<RoleStatusStrip />);

    expect(markup).toContain('data-testid="role-status-strip"');
    expect(markup).toContain("planner");
    expect(markup).toContain("analyzer");
    expect(markup).toContain("reviewer");

    // 相位颜色：thinking → animate-pulse + bg-blue-50
    expect(markup).toContain("animate-pulse");
    // acting → bg-amber-100
    expect(markup).toContain("bg-amber-100");
    // completed → bg-emerald-50（注意：completed 与 observing 都用 emerald 家族，
    // 但 completed 是 -50（更浅），observing 是 -100；这里锁定 -50 以区分。）
    expect(markup).toContain("bg-emerald-50");

    // 容器布局 class
    expect(markup).toContain("flex flex-wrap gap-1.5");
  });

  it("sorts roles alphabetically regardless of insertion order", () => {
    // 故意以非字母序注入；迭代顺序按 ES2015 规范保留插入序，
    // 因此如果组件未排序，markup 中 planner 会先于 analyzer。
    setMockedRolePhases({
      reviewer: "completed",
      planner: "thinking",
      analyzer: "acting",
    });

    const markup = renderToStaticMarkup(<RoleStatusStrip />);

    const analyzerIdx = markup.indexOf(">analyzer<");
    const plannerIdx = markup.indexOf(">planner<");
    const reviewerIdx = markup.indexOf(">reviewer<");

    // 三个 badge 都必须出现
    expect(analyzerIdx).toBeGreaterThan(-1);
    expect(plannerIdx).toBeGreaterThan(-1);
    expect(reviewerIdx).toBeGreaterThan(-1);

    // 字母序：analyzer < planner < reviewer
    expect(analyzerIdx).toBeLessThan(plannerIdx);
    expect(plannerIdx).toBeLessThan(reviewerIdx);
  });
});

// ─── Layer 2：源代码层 — 挂载点必须位于 fabric 分支 ────────────────────────

describe("AutopilotRightRail mounts <RoleStatusStrip /> inside the fabric branch", () => {
  it("references <RoleStatusStrip /> within the fabric <aside> return block", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../AutopilotRightRail.tsx"),
      "utf8"
    );

    // <RoleStatusStrip /> 至少出现一次
    const jsxMatches = source.match(/<RoleStatusStrip\b/g) ?? [];
    expect(jsxMatches.length).toBeGreaterThanOrEqual(1);

    // 关键事实：挂载点必须出现在 fabric 分支的 <aside> return 块中。
    // 我们用 `data-stage-placeholder="fabric"` 这个 fabric 分支独有的标识
    // 与下一个顶层 helper（`function ActiveNodeContent` 已经在文件顶部声明，
    // 因此 fabric 分支真正的下一个顶层符号是 `export default AutopilotRightRail`）
    // 之间的范围作为 fabric 分支的 source slice。
    const fabricBlockMatch = source.match(
      /data-stage-placeholder="fabric"[\s\S]*?export\s+default\s+AutopilotRightRail/
    );
    expect(fabricBlockMatch).not.toBeNull();
    expect(fabricBlockMatch?.[0] ?? "").toMatch(/<RoleStatusStrip\s*\/>/);

    // 进一步确认非 fabric 分支（fileTop ↔ fabric placeholder 之间）不挂载，
    // 避免被误移到“当 currentStage !== 'fabric' 时”的 placeholder 分支。
    const headBlockMatch = source.match(
      /currentStage\s*!==\s*"fabric"[\s\S]*?data-stage-placeholder="fabric"/
    );
    expect(headBlockMatch).not.toBeNull();
    expect(headBlockMatch?.[0] ?? "").not.toMatch(/<RoleStatusStrip\b/);
  });
});
