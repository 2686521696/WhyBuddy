/**
 * spec-generation-perceived-performance / Task 7.3
 *
 * shim 等价与一致性的契约测试。
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
 *
 * 实现口径（与本仓现有 React 组件测试一致，见
 * `spec-tree-workbench/__tests__/SpecTreeWorkbench.test.tsx` 与
 * `right-rail/__tests__/AutopilotRightRail.spec-docs-failure-toast.test.ts`）：
 *
 *   本仓库 *未* 集成 `@testing-library/react` / `jsdom` / `happy-dom`，
 *   `test:client` 走默认 node 环境（`vitest run client/src`）。Generation_State_Machine
 *   的乐观置入、超时计时与 In_Flight_Lock 并发幂等都依赖一次真实点击、
 *   `useState` / `useRef` 重渲染与异步决胜，无法在 `renderToStaticMarkup`（SSR）
 *   下被驱动。
 *
 *   因此本文件采用源代码层契约断言（source-level contract）：直接读相关源文件，
 *   断言 shim 转发等价、三实现的状态机/反馈层归属、以及触发统一经父级
 *   `triggerSpecDocsGeneration`（唯一 In_Flight_Lock）这组不变式存在且未被破坏。
 *   断言对格式保持鲁棒（用正则容忍空白与引号差异），不引入新的测试基础设施。
 */

import { describe, expect, it } from "vitest";

async function readSource(relativeFromHere: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(__dirname, relativeFromHere), "utf8");
}

/**
 * 去除注释（块注释 `/* … *\/` 与行注释 `// …`），用于「负向断言」——
 * 即断言某标识符不出现在真实代码中。这些 shim / wrapper 的 JSDoc 刻意
 * 在文字说明里提到 `deriveGenerationState` / `SpecTreeProgressLayer`
 * （说明它们「故意不承载」状态机），因此原始源码会包含这些 token；只有
 * 剥离注释后才能可靠断言真实代码未引用它们。本仓所有相关 import 路径用
 * 单 `/` 而非 `//`，故行注释剥离不会误伤 import。
 */
async function readCodeOnly(relativeFromHere: string): Promise<string> {
  const raw = await readSource(relativeFromHere);
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

// 路径常量：以本测试文件目录为锚点解析三实现 + 父级 + 状态机核心。
const SHIM_SPECS_PANEL = "../SpecTreePanel.tsx"; // @/pages/specs/panels/SpecTreePanel
const CANONICAL_AUTOPILOT_PANEL =
  "../../../autopilot/right-rail/panels/SpecTreePanel.tsx"; // @/pages/autopilot/right-rail/panels/SpecTreePanel
const CANONICAL_WORKBENCH =
  "../../../autopilot/right-rail/spec-tree-workbench/SpecTreeWorkbench.tsx";
const RIGHT_RAIL = "../../../autopilot/right-rail/AutopilotRightRail.tsx";
const DERIVE_STATE =
  "../../../autopilot/right-rail/spec-tree-workbench/derive-generation-state.ts";

// ─── R3.1 / R3.3：shim 纯转发等价，且不含独立状态机 / 反馈层 ────────────────

describe("SpecTreePanel shim 纯转发等价 (R3.1 / R3.3)", () => {
  it("@/pages/specs/panels/SpecTreePanel 是纯 re-export 转发到 canonical autopilot 实现", async () => {
    const source = await readSource(SHIM_SPECS_PANEL);
    // 转发 SpecTreePanel 与其 props 类型到 canonical 位置（容忍引号/空白差异）。
    expect(source).toMatch(
      /export\s*\{\s*SpecTreePanel\s*\}\s*from\s*["']@\/pages\/autopilot\/right-rail\/panels\/SpecTreePanel["']/
    );
    expect(source).toMatch(
      /export\s*type\s*\{\s*SpecTreePanelProps\s*\}\s*from\s*["']@\/pages\/autopilot\/right-rail\/panels\/SpecTreePanel["']/
    );
  });

  it("shim 不实现独立 Generation_State_Machine 或 Progress_Feedback_Layer", async () => {
    // 负向断言剥离注释：JSDoc 会以文字提及这些 token（说明刻意不承载）。
    const code = await readCodeOnly(SHIM_SPECS_PANEL);
    // 不引入/调用状态机核心。
    expect(code).not.toMatch(/\bderiveGenerationState\b/);
    // 不渲染进度反馈层。
    expect(code).not.toMatch(/\bSpecTreeProgressLayer\b/);
    // 不维护任何独立的乐观 / 生成状态（shim 不应有本地状态）。
    expect(code).not.toMatch(/\buseState\b/);
    expect(code).not.toMatch(/\buseReducer\b/);
  });
});

// ─── R3.1 / R3.2 / R3.4：autopilot wrapper 不承载独立业务并发标志 ────────────

describe("autopilot SpecTreePanel wrapper 不承载独立生成状态机 (R3.1 / R3.2 / R3.4)", () => {
  it("wrapper 不引用 deriveGenerationState / SpecTreeProgressLayer", async () => {
    // 负向断言剥离注释：wrapper 的 JSDoc 文字也提到这些 token。
    const code = await readCodeOnly(CANONICAL_AUTOPILOT_PANEL);
    expect(code).not.toMatch(/\bderiveGenerationState\b/);
    expect(code).not.toMatch(/\bSpecTreeProgressLayer\b/);
  });

  it("wrapper 不维护独立业务并发标志（无 generating/optimistic 本地状态）", async () => {
    const code = await readCodeOnly(CANONICAL_AUTOPILOT_PANEL);
    // 纯 prop 转发 wrapper：不持有任何 useState/useReducer 生成并发状态。
    expect(code).not.toMatch(/\buseState\b/);
    expect(code).not.toMatch(/\buseReducer\b/);
    // 不应声明独立的 specDocsGenerating 一类并发标志。
    expect(code).not.toMatch(/specDocsGenerating/);
    expect(code).not.toMatch(/setOptimistic/);
  });
});

// ─── R3.1：Generation_State_Machine 唯一锚定在规范实现 SpecTreeWorkbench ──────

describe("Generation_State_Machine 唯一锚定在规范实现 (R3.1)", () => {
  it("canonical SpecTreeWorkbench 消费 deriveGenerationState 并渲染 SpecTreeProgressLayer", async () => {
    const source = await readSource(CANONICAL_WORKBENCH);
    // 导入并调用状态机核心。
    expect(source).toMatch(
      /import\s*\{[\s\S]*?deriveGenerationState[\s\S]*?\}/
    );
    expect(source).toMatch(/deriveGenerationState\(/);
    // 在 pending 档渲染进度反馈层。
    expect(source).toMatch(/import\s*\{\s*SpecTreeProgressLayer\s*\}/);
    expect(source).toMatch(/<SpecTreeProgressLayer/);
    // 容器派生 data-state（状态取值集合由 phase 决定）。
    expect(source).toMatch(/data-state=\{phase\}/);
  });
});

// ─── R3.1：状态取值集合一致 —— phase 恰为 idle|pending|success|failure|empty ──

describe("Generation_State_Machine phase 取值集合一致 (R3.1)", () => {
  it("canonical deriveGenerationState 的 GenerationPhase 恰覆盖 idle/pending/success/failure/empty", async () => {
    const source = await readSource(DERIVE_STATE);
    // 抓取 `export type GenerationPhase = ...;` 联合类型声明体。
    const match = source.match(
      /export\s+type\s+GenerationPhase\s*=([\s\S]*?);/
    );
    expect(match).not.toBeNull();
    const body = match![1];
    const members = body
      .split("|")
      .map(token => token.trim().replace(/^["']|["']$/g, ""))
      .filter(token => token.length > 0);
    // 取值集合相等（顺序无关）。
    expect([...members].sort()).toEqual(
      ["empty", "failure", "idle", "pending", "success"].sort()
    );
  });
});

// ─── R3.2 / R3.5：触发统一经父级 triggerSpecDocsGeneration（唯一 In_Flight_Lock）─

describe("触发统一经父级 In_Flight_Lock (R3.2 / R3.5)", () => {
  it("triggerSpecDocsGeneration 是唯一并发锚点，含 specDocsGenerating !== null 幂等 early return", async () => {
    const source = await readSource(RIGHT_RAIL);
    // 唯一的 In_Flight_Lock + API + 回写锚点。
    expect(source).toMatch(/triggerSpecDocsGeneration/);
    // 锁已被任意范围标记进行中时 early return（不发起新 API 调用）。
    expect(source).toMatch(/specDocsGenerating\s*!==\s*null\s*\)\s*return/);
  });

  it("父级把生成触发器经 onGenerateAll / onGenerateNode 收敛到 triggerSpecDocsGeneration", async () => {
    const source = await readSource(RIGHT_RAIL);
    // CTA 触发器最终都路由到唯一锚点（经 handleGenerate* 包装）。
    expect(source).toMatch(/triggerSpecDocsGeneration\(\s*["']all["']\s*\)/);
    expect(source).toMatch(
      /triggerSpecDocsGeneration\(\s*["']single["']\s*,\s*nodeId\s*\)/
    );
    // 透传给规范实现的回调来自父级 handler。
    expect(source).toMatch(/onGenerateAll=\{handleGenerateAllSpecDocs\}/);
    expect(source).toMatch(/onGenerateNode=\{handleGenerateNodeSpecDocs\}/);
  });

  it("SpecTreeWorkbench 不直接调用生成 API，而是经父级 onGenerateAll / onGenerateNode 上行", async () => {
    const source = await readSource(CANONICAL_WORKBENCH);
    // 组件触发生成只调用父级回调，不直接发 API。
    expect(source).toMatch(/onGenerateAll\(\)/);
    expect(source).toMatch(/onGenerateNode\(/);
    // 负向断言剥离注释：JSDoc 文字会以「父级负责调用 generateBlueprintSpecDocuments」
    // 形式提及该 API；只有剥离注释后才能可靠断言真实代码未直接调用它。
    const code = await readCodeOnly(CANONICAL_WORKBENCH);
    // 不旁路真相源 / 不直接调用 blueprint 生成 API。
    expect(code).not.toMatch(/generateBlueprintSpecDocuments/);
    // 不维护独立的业务并发标志（specDocsGenerating 只存在于父级）。
    expect(code).not.toMatch(/specDocsGenerating/);
  });
});
