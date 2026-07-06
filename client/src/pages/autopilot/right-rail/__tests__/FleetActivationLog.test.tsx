/**
 * autopilot-streaming-experience integration-gap-2026-05-16 — UI 消费面 Step 3
 * 回归测试：FleetActivationLog。
 *
 * 测试策略与本仓既有 right-rail 测试（`AutopilotRightRail.subtimeline-mount.test.tsx`、
 * `RoleStatusStrip.test.tsx`）保持一致：本仓 *未* 集成 `@testing-library/react` /
 * `jsdom` / `happy-dom`，因此使用 `react-dom/server` `renderToStaticMarkup` +
 * `vi.mock` 替换 `useBlueprintRealtimeStore` 的方式做 SSR 层断言。
 *
 * 覆盖三类契约（与 spec 直接对应）：
 *  1. agentProgress 为空 → 返回 null，markup 中不出现 `data-testid="fleet-activation-log"`。
 *  2. agentProgress 非空（15 条）→ 仅渲染最后 12 条（role-04..role-15），
 *     `role-01 / role-02 / role-03` 必须被裁掉；并且 markup 中
 *     `role-04`（最早可见条目）出现在 `role-15`（最新条目）之前，即按时间正序渲染。
 *  3. type 颜色：thinking → `text-blue-300`，acting → `text-amber-300`，
 *     failed → `text-rose-400`（暗色主题色阶，与组件 resolveTypeColorClass 对齐），
 *     全部出现在同一份 markup 中。
 */

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentProgressEntry } from "@/lib/blueprint-realtime-store";

// ─── 受控的 agentProgress 状态 ─────────────────────────────────────────────

let mockedAgentProgress: AgentProgressEntry[] = [];

function setMockedAgentProgress(next: AgentProgressEntry[]): void {
  mockedAgentProgress = [...next];
}

function resetMockedAgentProgress(): void {
  mockedAgentProgress = [];
}

// ─── Mock `@/lib/blueprint-realtime-store` ────────────────────────────────

vi.mock("@/lib/blueprint-realtime-store", () => {
  const useBlueprintRealtimeStore = ((
    selector?: (state: { agentProgress: AgentProgressEntry[] }) => unknown
  ) => {
    const snapshot = { agentProgress: mockedAgentProgress };
    return selector ? selector(snapshot) : snapshot;
  }) as unknown as typeof import("@/lib/blueprint-realtime-store").useBlueprintRealtimeStore;

  return {
    useBlueprintRealtimeStore,
    __setSocket: () => {},
  };
});

import { FleetActivationLog } from "../FleetActivationLog";

// ─── 测试夹具 ──────────────────────────────────────────────────────────────

/**
 * 构造一个 `AgentProgressEntry`。
 *
 * - `index` 用于派生 `id` / `roleId` / `timestamp` 三个字段，保证可断言。
 * - `roleId` 形如 `role-01`、`role-02`、… 便于在 markup 中按顺序定位。
 * - `timestamp` 以基准点 `2025-01-01T00:00:00Z` 起步、每条间隔 1 秒，
 *   保证时间戳字段（HH:MM:SS）也呈现单调递增。
 */
const BASE_TIMESTAMP = Date.UTC(2025, 0, 1, 0, 0, 0); // 2025-01-01T00:00:00Z

function makeEntry(
  index: number,
  type: AgentProgressEntry["type"] = "acting",
  message?: string
): AgentProgressEntry {
  const padded = String(index).padStart(2, "0");
  return {
    id: `progress-${padded}`,
    roleId: `role-${padded}`,
    type,
    message,
    timestamp: BASE_TIMESTAMP + index * 1000,
  };
}

function makeSequentialEntries(count: number): AgentProgressEntry[] {
  return Array.from({ length: count }, (_, i) => makeEntry(i + 1));
}

// ─── Layer 1：SSR 契约 ─────────────────────────────────────────────────────

describe("FleetActivationLog render contract", () => {
  beforeEach(() => {
    resetMockedAgentProgress();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetMockedAgentProgress();
  });

  it("returns null when agentProgress is empty (folded state)", () => {
    setMockedAgentProgress([]);

    const markup = renderToStaticMarkup(<FleetActivationLog />);

    // 折叠态：返回 null → markup 为空字符串，绝不应出现 testid。
    expect(markup).not.toContain('data-testid="fleet-activation-log"');
    expect(markup).toBe("");
  });

  it("renders only the last 12 entries oldest-first when agentProgress has 15", () => {
    // 15 条按时间递增排列；store FIFO 语义下最新在末尾，
    // 因此组件应保留 role-04..role-15、丢弃 role-01..role-03。
    setMockedAgentProgress(makeSequentialEntries(15));

    const markup = renderToStaticMarkup(<FleetActivationLog />);

    // 容器存在
    expect(markup).toContain('data-testid="fleet-activation-log"');

    // 视觉密度类。原 spec 锁定的是浅色主题（mt-3 / max-h-[180px] / rounded-lg /
    // border-slate-100 / bg-slate-50）；组件后来改为暗色紧凑主题（archived autopilot
    // 面区，见 FleetActivationLog.tsx 当前实现），此处随实现更新为现行 class 锁定，
    // 继续守护"滚动容器 + 等宽字体 + 有界高度"的核心密度契约。
    expect(markup).toContain("mt-1");
    expect(markup).toContain("max-h-[140px]");
    expect(markup).toContain("overflow-y-auto");
    expect(markup).toContain("rounded");
    expect(markup).toContain("border-white/[0.08]");
    expect(markup).toContain("bg-white/[0.03]");
    expect(markup).toContain("font-mono");

    // 被裁掉的最早 3 条不应出现
    expect(markup).not.toContain("role-01");
    expect(markup).not.toContain("role-02");
    expect(markup).not.toContain("role-03");

    // 可见的 12 条都应出现
    for (let i = 4; i <= 15; i += 1) {
      const padded = String(i).padStart(2, "0");
      expect(markup).toContain(`role-${padded}`);
    }

    // 排序：oldest-first → role-04 必须出现在 role-15 之前
    const role04Idx = markup.indexOf("role-04");
    const role15Idx = markup.indexOf("role-15");
    expect(role04Idx).toBeGreaterThan(-1);
    expect(role15Idx).toBeGreaterThan(-1);
    expect(role04Idx).toBeLessThan(role15Idx);
  });

  it("colors each progress type with its dedicated tailwind class", () => {
    // 同时覆盖 thinking / acting / observing / completed / failed 五类，
    // 重点断言 spec 点名的三类（thinking / acting / failed）颜色 class。
    setMockedAgentProgress([
      makeEntry(1, "thinking", "analyzing scope"),
      makeEntry(2, "acting", "invoking github mcp"),
      makeEntry(3, "observing", "received response"),
      makeEntry(4, "completed", "stage closed"),
      makeEntry(5, "failed", "tool error"),
    ]);

    const markup = renderToStaticMarkup(<FleetActivationLog />);

    // 容器存在
    expect(markup).toContain('data-testid="fleet-activation-log"');

    // spec 点名的三类（组件已切换到暗色主题的 -300/-400 色阶，
    // 见 FleetActivationLog.tsx resolveTypeColorClass；断言随实现更新，
    // 继续守护"每类 type 有专属颜色 class"的契约）
    expect(markup).toContain("text-blue-300"); // thinking
    expect(markup).toContain("text-amber-300"); // acting
    expect(markup).toContain("text-rose-400"); // failed

    // 顺带验证另外两类也具备颜色 class，避免后续重构误删
    expect(markup).toContain("text-emerald-300"); // observing
    expect(markup).toContain("text-emerald-400"); // completed

    // type 文案与 message 应以 ` · ` 拼接（仅当 message 存在时）
    expect(markup).toContain("analyzing scope");
    expect(markup).toContain("invoking github mcp");
  });
});

// ─── Layer 2：源代码层 — 阶段 2 右栏只保留执行流 / 产物流 ─────────────────

describe("AutopilotRightRail stage-2 observability placement", () => {
  it("keeps CapabilityRail and FleetActivationLog outside the SPEC authoring stage", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(__dirname, "../AutopilotRightRail.tsx"),
      "utf8"
    );

    // SPEC tree / SPEC documents 阶段应由执行流 + 产物流承载，不再追加右栏观测日志。
    expect(source).toContain("const showFabricObservability");
    expect(source).toMatch(
      /activeStageKey\s*!==\s*"spec_tree"[\s\S]*activeStageKey\s*!==\s*"spec_documents"/
    );

    // 其它 fabric 子阶段仍可使用能力轨与激活日志；挂载必须在保护条件内。
    const guardedBlockMatch = source.match(
      /\{showFabricObservability\s*\?\s*\([\s\S]*?\)\s*:\s*null\}/
    );
    expect(guardedBlockMatch).not.toBeNull();
    expect(guardedBlockMatch?.[0] ?? "").toMatch(/<CapabilityRail\s*\/>/);
    expect(guardedBlockMatch?.[0] ?? "").toMatch(/<FleetActivationLog\s*\/>/);
  });
});
