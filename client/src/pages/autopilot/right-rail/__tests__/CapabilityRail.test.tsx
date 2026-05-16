/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 2
 * 回归测试：CapabilityRail。
 *
 * 测试策略与既有 right-rail 测试（`AutopilotRightRail.subtimeline-mount.test.tsx`、
 * `RoleStatusStrip.test.tsx`）保持一致：本仓 *未* 集成
 * `@testing-library/react` / `jsdom` / `happy-dom`，引入这些工具属于跨规格的
 * 工具链改造；因此使用 `react-dom/server` `renderToStaticMarkup` + `vi.mock`
 * 替换 `useBlueprintRealtimeStore` 的方式做 SSR 层断言。
 *
 * 覆盖三类契约（与 spec 一一对应）：
 *  1. capabilityStatuses 为空时返回 null，不出现 `data-testid="capability-rail"`。
 *  2. capabilityStatuses 非空时渲染所有 capabilityId 与对应状态颜色：
 *     - invoking → bg-amber-100 + animate-pulse
 *     - completed → bg-emerald-100
 *     - failed → bg-rose-100
 *  3. capabilityId 字母序稳定排序：不论 store 注入顺序如何，输出 markup 中
 *     `docker-analysis-sandbox` 必须先于 `mcp-github-source` 出现。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CapabilityStatus } from "@/lib/blueprint-realtime-store";

// ─── 受控的 capabilityStatuses 状态 ───────────────────────────────────────

let mockedCapabilityStatuses: Record<string, CapabilityStatus> = {};

function setMockedCapabilityStatuses(
  next: Record<string, CapabilityStatus>
): void {
  mockedCapabilityStatuses = { ...next };
}

function resetMockedCapabilityStatuses(): void {
  mockedCapabilityStatuses = {};
}

// ─── Mock `@/lib/blueprint-realtime-store` ────────────────────────────────

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((
    selector?: (state: {
      capabilityStatuses: Record<string, CapabilityStatus>;
    }) => unknown
  ) => {
    const snapshot = { capabilityStatuses: mockedCapabilityStatuses };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { CapabilityRail } from "../CapabilityRail";

// ─── SSR 契约 ──────────────────────────────────────────────────────────────

describe("CapabilityRail render contract", () => {
  beforeEach(() => {
    resetMockedCapabilityStatuses();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedCapabilityStatuses();
  });

  it("returns null when capabilityStatuses is empty (folded state)", () => {
    setMockedCapabilityStatuses({});

    const markup = renderToStaticMarkup(<CapabilityRail />);

    // 折叠态：返回 null → markup 为空字符串，且不可能含有 testid。
    expect(markup).not.toContain('data-testid="capability-rail"');
    expect(markup).toBe("");
  });

  it("renders one badge per capability with status-specific color classes", () => {
    setMockedCapabilityStatuses({
      "docker-analysis-sandbox": "completed",
      "role-system-architecture": "invoking",
      "mcp-github-source": "failed",
    });

    const markup = renderToStaticMarkup(<CapabilityRail />);

    // 容器 testid + 布局 class
    expect(markup).toContain('data-testid="capability-rail"');
    expect(markup).toContain("flex flex-wrap gap-1.5");

    // 三个 capabilityId 都必须出现在 markup 中
    expect(markup).toContain("docker-analysis-sandbox");
    expect(markup).toContain("role-system-architecture");
    expect(markup).toContain("mcp-github-source");

    // 状态颜色：
    // invoking → bg-amber-100 + animate-pulse
    expect(markup).toContain("bg-amber-100");
    expect(markup).toContain("animate-pulse");
    // completed → bg-emerald-100
    expect(markup).toContain("bg-emerald-100");
    // failed → bg-rose-100
    expect(markup).toContain("bg-rose-100");

    // pill 形 badge 的核心 class（gap-1 用于状态点 + 文本之间的间距）
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("px-2 py-0.5");
    expect(markup).toContain("text-[10px]");
  });

  it("sorts capabilities alphabetically regardless of insertion order", () => {
    // 故意以非字母序注入；ES2015 规范保留对象键插入序，
    // 因此如果组件未排序，markup 中 mcp-github-source 会先于 docker-analysis-sandbox。
    setMockedCapabilityStatuses({
      "role-system-architecture": "invoking",
      "mcp-github-source": "failed",
      "docker-analysis-sandbox": "completed",
    });

    const markup = renderToStaticMarkup(<CapabilityRail />);

    const dockerIdx = markup.indexOf("docker-analysis-sandbox");
    const mcpIdx = markup.indexOf("mcp-github-source");
    const roleIdx = markup.indexOf("role-system-architecture");

    // 三个 capabilityId 都必须出现
    expect(dockerIdx).toBeGreaterThan(-1);
    expect(mcpIdx).toBeGreaterThan(-1);
    expect(roleIdx).toBeGreaterThan(-1);

    // 字母序：docker- < mcp- < role-
    expect(dockerIdx).toBeLessThan(mcpIdx);
    expect(mcpIdx).toBeLessThan(roleIdx);
  });
});
