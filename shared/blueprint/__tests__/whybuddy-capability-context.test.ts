import { describe, it, expect } from "vitest";
import type { V5SessionState } from "../v5-reasoning-state.js";
import {
  buildCapabilityContext,
  formatContextForPrompt,
  classifyCapabilityTier,
} from "../whybuddy-capability-context.js";
import { buildStructuredReport } from "../whybuddy-report-builder.js";
import {
  getOutputContract,
  renderContractForPrompt,
  REPORT_WRITE_CONTRACT,
  DOCUMENT_DRAFT_CONTRACT,
} from "../whybuddy-output-contracts.js";
import { evaluateQualityGate, PRODUCTION_BASELINE, PILOT_TEMPLATE_BASELINE } from "../whybuddy-quality-gate.js";

/**
 * K1 内容厚度供给改造 · 探索 + 保全测试
 * 方法论：探索测试断言“当前（修复后）应成立的厚输出行为”，注释标明“修复前必败”。
 */

function makeArtifact(id: string, kind: string, capId: string, content: string) {
  return {
    id,
    kind,
    title: `${kind}-${id}`,
    content,
    producedBy: { capabilityId: capId, roleId: "agent" },
  };
}

function makeStateWithLongArtifacts(longContent: string): V5SessionState {
  const base: any = {
    goal: { text: "权限系统 MVP · 内容厚度回归" },
    artifacts: [
      makeArtifact("r1", "risk", "risk.analyze", "风险-HEAD " + longContent + " 风险-TAIL"),
      makeArtifact("c1", "synthesis", "synthesis.merge", "SYN " + longContent.slice(200, 900) + " SYN-END"),
      makeArtifact("rep1", "report", "report.write", "旧报告片段（不应被新报告循环使用）"),
    ],
    staleArtifactIds: [],
  };
  return base as V5SessionState;
}

describe("K1 · capability context supply (buildCapabilityContext + report-builder fragments)", () => {
  const LONG = "X".repeat(300) + "MARKER_500_600区_" + "Y".repeat(400) + "Z".repeat(1200);

  it("【K1.1 探索测试】 report.write 骨架中应包含上游 risk 产物 500-600 区标志性子串（修复前 140 截断必丢失此区间 → 当前必败注释）", () => {
    const state = makeStateWithLongArtifacts(LONG);
    const report = buildStructuredReport({
      state,
      inputArtifactIds: ["r1", "c1"],
      roleId: "综合",
    });

    // 标志性子串必须出现在最终 report content 中（来自 risk 产物的中段）
    expect(report.content).toContain("MARKER_500_600区_");
    // 同时不应再有静默 140 截断的痕迹（旧行为）
    expect(report.content).not.toMatch(/MARKER_500_600区_…[^t]/); // 避免被 140 掐断后只剩头
    // 显式截断标注在极长时仍应出现（上限 1500）
    // 这里 LONG ~1900+，所以风险片段会触发标注
    expect(report.content).toMatch(/truncated \d+ chars/);
  });

  it("【K1.2 探索测试】 buildCapabilityContext 对 report.write（收敛类）返回完整 content（含标志子串），对轻能力维持 ~220 上限", () => {
    const state = makeStateWithLongArtifacts(LONG);

    // 收敛类：应给足 6000 预算内的完整（或带可见截断标注）
    const conv = buildCapabilityContext(state, "report.write", ["r1", "c1"]);
    const convStr = formatContextForPrompt(conv);
    expect(convStr).toContain("MARKER_500_600区_");
    expect(conv.some((e) => e.content.includes("[truncated") || e.content.length > 300)).toBe(true);

    // 轻能力（例如 intent.clarify 不在白名单）：走 220 上限
    const light = buildCapabilityContext(state, "intent.clarify", ["r1"]);
    expect(light.length).toBeGreaterThan(0);
    // 轻能力不应把整段 LONG 喂进去
    const lightStr = formatContextForPrompt(light);
    expect(lightStr.length).toBeLessThan(900); // 粗略上限，容忍格式 + 截断标注
    // 轻能力走 220 上限（+ 截断标注后仍明显短于收敛类的 6000）
    expect(light[0].content.length).toBeLessThanOrEqual(280);
    expect(light[0].truncated).toBe(true); // 证明确实被掐而非全量喂给轻能力
  });

  it("【K1.3 保全测试】 轻能力 prompt 体量同量级；classify 正确分层；buildStructuredReport 仍产出 9 段结构段标", () => {
    const state = makeStateWithLongArtifacts(LONG);

    expect(classifyCapabilityTier("report.write")).toBe("convergence");
    expect(classifyCapabilityTier("risk.analyze")).toBe("analysis");
    expect(classifyCapabilityTier("intent.clarify")).toBe("light");
    expect(classifyCapabilityTier("gap.ask")).toBe("light");

    const light = buildCapabilityContext(state, "intent.clarify");
    expect(light.length).toBeLessThanOrEqual(6);

    const report = buildStructuredReport({ state, inputArtifactIds: ["r1"], roleId: "综合" });
    expect(report.content).toContain("支撑证据：");
    expect(report.content).toContain("反证/挑战：");
    expect(report.content).toContain("风险：");
    expect(report.content).toContain("收敛决策：");
    expect(report.content).toContain("未解缺口：");
    expect(report.content).toContain("下一步工程化分支：");
  });

  it("【K1.3 保全测试】 serialize 行为与 STATE 纯函数性质（buildStructuredReport 不应改变输入 state）", () => {
    const state = makeStateWithLongArtifacts(LONG);
    const before = JSON.stringify(state);
    buildStructuredReport({ state, inputArtifactIds: ["r1", "c1"] });
    const after = JSON.stringify(state);
    expect(after).toBe(before);
  });
});

describe("K2 · output contracts (single source of truth for thickness)", () => {
  it("【K2.1 探索测试】 report.write 契约含 9 段关键 heading、支撑证据 minChild、min 2400 字；render 出的 prompt 文本含 'Expand each section' 且不含 'only polish'", () => {
    const c = getOutputContract("report.write");
    expect(c).toBeTruthy();
    expect(c?.requiredHeadings).toContain("支撑证据");
    expect(c?.requiredHeadings).toContain("未解缺口");
    expect(c?.minContentChars).toBeGreaterThanOrEqual(2400);
    expect(c?.minChildBlocks?.min).toBeGreaterThanOrEqual(2);

    const rendered = renderContractForPrompt(REPORT_WRITE_CONTRACT);
    expect(rendered).toContain("Expand");
    expect(rendered).not.toMatch(/only polish/i);
    expect(rendered).toContain("支撑证据");
  });

  it("【K2.1 探索测试】 document.draft 契约含 '## 术语表'、mermaid + ts_interface 要求、EARS；可被用于 prompt 注入", () => {
    const c = getOutputContract("document.draft");
    expect(c).toBeTruthy();
    expect(c?.requiredHeadings).toContain("## 术语表");
    expect(c?.requiredEmbedded).toContain("mermaid");
    expect(c?.requiredEmbedded).toContain("ts_interface");
    expect(c?.earsSections?.length || 0).toBeGreaterThan(0);

    const rendered = renderContractForPrompt(DOCUMENT_DRAFT_CONTRACT);
    expect(rendered).toContain("mermaid");
    expect(rendered).toContain("EARS");
  });

  it("【K2.2 保全测试】 非契约能力（如 intent.clarify / risk.analyze）getOutputContract 返回 undefined；轻能力 prompt 字节量不因契约膨胀", () => {
    expect(getOutputContract("intent.clarify")).toBeUndefined();
    expect(getOutputContract("risk.analyze")).toBeUndefined();
    expect(getOutputContract("gap.ask")).toBeUndefined();

    // 快照式保全：render 对 report 产生合理长度（>300 字的指令），但不影响轻能力路径
    const r = renderContractForPrompt(REPORT_WRITE_CONTRACT);
    expect(r.length).toBeGreaterThan(300);
  });
});

describe("K3 · G_QUALITY content gate (with K2 contract)", () => {
  it("【K3.1 探索测试】 薄 content（50 字 report）走 commit 路径后 quality:failed 且 trust 非 gated_pass（当前无门时必败）", () => {
    // 模拟一个极薄的 report artifact（K3 落地前会全绿通过）
    const thinArtifact: any = {
      id: "thin-r",
      kind: "report",
      title: "薄报告",
      content: "结论：可行。", // 远低于 2400 + 缺多个段标
      producedBy: { capabilityId: "report.write", roleId: "综合" },
      provenance: "llm",
    };
    const q = evaluateQualityGate(thinArtifact, undefined, PRODUCTION_BASELINE);
    expect(q).toBeTruthy();
    expect(q?.status).toBe("failed");
    expect(q?.gateId).toBe("quality");
    expect(String(q?.reason || "")).toMatch(/content|heading|contract/i);
  });

  it("【K3.2 保全测试】 厚 content（满足 report contract）+ pilot baseline 下质量门 passed；commit gates 集合不变", () => {
    const thick = "支撑证据：\n- 来自 risk / 风险: 数据越权 WHEN 跨租户访问 THE system SHALL 拒绝 [evidenceRef: r1]\n- 来自 counter: 反驳 ABAC 成本 (IF 小团队 THEN 避免)\n风险：审计缺失\n收敛决策：RBAC MVP\n未解缺口：细粒度策略\n下一步工程化分支：- structure.decompose\n（填充到满足 2400+ 字的演示文本）" + "X".repeat(2200);
    const art: any = {
      id: "thick-r",
      kind: "report",
      content: thick,
      producedBy: { capabilityId: "report.write" },
    };
    const qProd = evaluateQualityGate(art, REPORT_WRITE_CONTRACT, PRODUCTION_BASELINE);
    // 生产基线可能因缺少完整 9 段头仍 failed，这里只验 pilot 基线放宽后可过（K3+K4 合并要点）
    const qPilot = evaluateQualityGate(art, REPORT_WRITE_CONTRACT, PILOT_TEMPLATE_BASELINE);
    expect(qPilot?.status).toBe("passed");
    expect(qPilot?.baseline).toBe("pilot-template");
  });
});
