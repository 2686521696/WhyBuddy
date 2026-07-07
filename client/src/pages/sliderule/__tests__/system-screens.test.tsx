/**
 * 系统屏（Workflow / AIGC / AppBundle）做实回归测试。
 *
 * 覆盖三条主线：
 *   1. 渲染模型内容 — 五系统模型段（nodes/transitions、capabilities、bindings）出现在输出里；
 *   2. 交叉引用解析 — assigneeRole→rbac.roles、"entity.field"→datamodel、
 *      pageRef/workflowRef/roleRefs/dataModelRefs 的 resolved/unresolved 都如实渲染；
 *   3. 空态/降级态 — 模型缺失时诚实降级（占位提示 / 跨系统联动降级标注），不冒充真实产物。
 *
 * 本仓库 React 组件测试约定：react-dom/server renderToStaticMarkup，不引入 jsdom/RTL。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowScreen } from "../system-screens/WorkflowScreen";
import { AigcScreen } from "../system-screens/AigcScreen";
import { AppBundleScreen } from "../system-screens/AppBundleScreen";
import { ActiveSystemScreen } from "../system-screens/ActiveSystemScreen";
import { DataModelScreen } from "../system-screens/DataModelScreen";
import { PageScreen } from "../system-screens/PageScreen";
import { RbacScreen } from "../system-screens/RbacScreen";
import { WorkflowRuntimePanel } from "../live-runtime/WorkflowRuntimePanel";
import { EntityDataPanel } from "../live-runtime/EntityDataPanel";
import { AigcTryRunPanel } from "../live-runtime/AigcTryRunPanel";
import {
  parseFiveSystemModel,
  parseFiveSystemModelFromContents,
  parseFiveSystemModelFromPerSkillEvidence,
  mergeFiveSystemModels,
  workflowModelToMermaid,
  crossSkillEdgesToMermaid,
  datamodelToMermaid,
  deriveErGraphData,
  deriveWorkflowGraphData,
  evidenceSourceOf,
  resolveFieldRef,
  resolveRoleRef,
  type FiveSystemModel,
} from "../system-screens/five-system-model";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

// ---------------------------------------------------------------------------
// Fixtures — 与 v5_llm_generate._SCHEMA_INSTRUCTION 的形状一致
// ---------------------------------------------------------------------------

const MODEL: FiveSystemModel = {
  datamodel: {
    entities: [
      {
        id: "course",
        name: "课程",
        fields: [
          { id: "title", name: "课程名", type: "string" },
          { id: "capacity", name: "容量", type: "number" },
        ],
      },
      {
        id: "enrollment",
        name: "选课记录",
        fields: [{ id: "status", name: "状态", type: "enum" }],
      },
    ],
  },
  rbac: {
    roles: ["student", "teacher", "registrar"],
    permissions: ["course:read", "course:approve"],
    menus: [{ id: "m1", label: "选课", roleRefs: ["student"], permissionRefs: ["course:read"] }],
  },
  workflow: {
    id: "wf_enroll",
    nodes: [
      { id: "submit", name: "提交选课", assigneeRole: "student" },
      { id: "approve", name: "教务审批", assigneeRole: "registrar" },
      { id: "ghost", name: "幽灵节点", assigneeRole: "not_a_role" },
    ],
    transitions: [
      { from: "submit", to: "approve", condition: "容量未满" },
      { from: "approve", to: "submit", condition: "退回" },
    ],
  },
  page: {
    pages: [
      {
        id: "enroll_page",
        name: "选课页",
        fieldBindings: ["course.title"],
        actionPermissions: ["course:read"],
      },
    ],
  },
  aigc: {
    capabilities: [
      {
        id: "cap_summary",
        name: "课程简介生成",
        inputFields: ["course.title", "course.capacity"],
        outputField: "enrollment.status",
        roleRefs: ["teacher"],
      },
      {
        id: "cap_broken",
        name: "坏引用能力",
        inputFields: ["nonexistent.field"],
        outputField: "course.title",
        roleRefs: ["ghost_role"],
      },
    ],
  },
  appbundle: {
    pageBindings: [
      { pageRef: "enroll_page", workflowRef: "wf_enroll" },
      { pageRef: "missing_page", workflowRef: "missing_wf" },
    ],
    roleRefs: ["student", "registrar"],
    dataModelRefs: ["course", "no_such_entity"],
  },
};

const CLOSURE_CLOSED: PublishClosureSummary = {
  blocked: false,
  blockerCount: 0,
  evidencePresentCount: 6,
  skillCount: 6,
  versionPinsChecked: true,
  closureHash: "abcd1234",
  stableDigest: "digest99",
  generatedAt: "2026-07-06T00:00:00Z",
  tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
  topBlockers: [],
  perSkillEvidence: {
    datamodel: { evidencePresent: true, artifactId: "llm-linkage-datamodel", digest: "d1d1d1d1d1" },
    rbac: { evidencePresent: true, artifactId: "llm-linkage-rbac" },
    workflow: { evidencePresent: true, artifactId: "llm-linkage-workflow", evidenceRef: "evidence:workflow:llm-linkage-workflow" },
    page: { evidencePresent: true, artifactId: "llm-linkage-page" },
    aigc: { evidencePresent: true, artifactId: "llm-linkage-aigc" },
    appbundle: { evidencePresent: true, artifactId: "llm-linkage-appbundle" },
  },
};

const CLOSURE_BLOCKED: PublishClosureSummary = {
  ...CLOSURE_CLOSED,
  blocked: true,
  blockerCount: 1,
  evidencePresentCount: 2,
  topBlockers: [
    {
      code: "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED",
      path: "runtimeClosure.perSkillEvidence",
      affectedSkill: "aigc",
    },
  ],
  perSkillEvidence: {
    ...CLOSURE_CLOSED.perSkillEvidence!,
    aigc: { evidencePresent: false },
    workflow: { evidencePresent: false },
  },
};

// ---------------------------------------------------------------------------
// five-system-model 解析与 mermaid 构建
// ---------------------------------------------------------------------------

describe("five-system-model 解析", () => {
  it("解析完整模型 JSON（裸 JSON）", () => {
    const parsed = parseFiveSystemModel(JSON.stringify(MODEL));
    expect(parsed).not.toBeNull();
    expect(parsed!.workflow!.nodes).toHaveLength(3);
    expect(parsed!.rbac!.roles).toContain("registrar");
  });

  it("解析 fenced ```json 块", () => {
    const raw = "推演产出如下：\n```json\n" + JSON.stringify(MODEL) + "\n```\n完毕。";
    const parsed = parseFiveSystemModel(raw);
    expect(parsed?.aigc?.capabilities).toHaveLength(2);
  });

  it("识别裸 workflow 段（nodes+transitions 无外层 key）", () => {
    const parsed = parseFiveSystemModel(JSON.stringify(MODEL.workflow));
    expect(parsed?.workflow?.id).toBe("wf_enroll");
  });

  it("非结构化文本 / mermaid 边图返回 null（fail-closed）", () => {
    expect(parseFiveSystemModel("flowchart LR\n  a --> b")).toBeNull();
    expect(parseFiveSystemModel("")).toBeNull();
    expect(parseFiveSystemModel(null)).toBeNull();
    expect(parseFiveSystemModel('{"unrelated": true}')).toBeNull();
  });

  it("parseFiveSystemModelFromContents 跨 skill 合并段", () => {
    const merged = parseFiveSystemModelFromContents({
      workflow: JSON.stringify({ workflow: MODEL.workflow }),
      aigc: JSON.stringify({ aigc: MODEL.aigc, rbac: MODEL.rbac }),
      dataModel: "flowchart LR\n  datamodel --> rbac", // 非 JSON，跳过
    });
    expect(merged?.workflow?.nodes).toHaveLength(3);
    expect(merged?.aigc?.capabilities).toHaveLength(2);
    expect(merged?.rbac?.roles).toContain("student");
    expect(merged?.datamodel).toBeUndefined();
  });

  it("解析 SSE skill_result 实际形状：mermaid 边图 + fenced JSON 模型段共存", () => {
    // useSlideRuleSession 把 skill_result 的 mermaid 与 modelSection 拼成一条内容：
    // 前段供 extractFlow/extractMermaid，后段 fenced JSON 供本解析器。
    const live =
      'flowchart LR\n  rbac["rbac"] -->|RBAC_WORKFLOW_ASSIGNEE_EVIDENCE| workflow["workflow"]' +
      "\n\n```json\n" + JSON.stringify({ workflow: MODEL.workflow }) + "\n```";
    const parsed = parseFiveSystemModel(live);
    expect(parsed?.workflow?.nodes).toHaveLength(3);
    const merged = parseFiveSystemModelFromContents({ workflow: live });
    expect(merged?.workflow?.id).toBe("wf_enroll");
  });

  it("parseFiveSystemModelFromPerSkillEvidence 从持久化 modelSection 重建（reload 路径）", () => {
    const model = parseFiveSystemModelFromPerSkillEvidence({
      datamodel: { modelSection: MODEL.datamodel },
      rbac: { modelSection: MODEL.rbac },
      workflow: { modelSection: MODEL.workflow },
      page: {}, // 无 modelSection —— 段缺失，不伪造
      aigc: { modelSection: MODEL.aigc },
      appbundle: { modelSection: MODEL.appbundle },
    });
    expect(model?.workflow?.nodes).toHaveLength(3);
    expect(model?.aigc?.capabilities).toHaveLength(2);
    expect(model?.page).toBeUndefined();
    // 确定性域：perSkillEvidence 无 modelSection → null（fail-closed）
    expect(
      parseFiveSystemModelFromPerSkillEvidence({
        datamodel: { evidencePresent: true } as { modelSection?: unknown },
      })
    ).toBeNull();
    expect(parseFiveSystemModelFromPerSkillEvidence(null)).toBeNull();
  });

  it("mergeFiveSystemModels 段级合并，primary 优先，皆空返回 null", () => {
    const primary: FiveSystemModel = { workflow: MODEL.workflow };
    const fallback: FiveSystemModel = {
      workflow: { id: "stale_wf", nodes: [], transitions: [] },
      rbac: MODEL.rbac,
    };
    const merged = mergeFiveSystemModels(primary, fallback);
    expect(merged?.workflow?.id).toBe("wf_enroll"); // primary 覆盖 fallback
    expect(merged?.rbac?.roles).toContain("student"); // fallback 补齐缺段
    expect(mergeFiveSystemModels(null, null)).toBeNull();
    expect(mergeFiveSystemModels({}, undefined)).toBeNull();
  });

  it("workflowModelToMermaid 输出 nodes/transitions/条件/角色", () => {
    const chart = workflowModelToMermaid(MODEL.workflow)!;
    expect(chart).toContain("flowchart TD");
    expect(chart).toContain('submit["提交选课<br/>@student"]');
    expect(chart).toContain("submit -->|容量未满| approve");
    // 无节点 → null（调用方降级）
    expect(workflowModelToMermaid({ nodes: [] })).toBeNull();
    expect(workflowModelToMermaid(undefined)).toBeNull();
  });

  it("crossSkillEdgesToMermaid 与 Python _skill_edges_to_mermaid 同构", () => {
    const chart = crossSkillEdgesToMermaid("workflow", [
      { sourceSkill: "rbac", targetSkill: "workflow", state: "allowed", evidenceKey: "RBAC_WORKFLOW_ASSIGNEE_EVIDENCE" },
      { sourceSkill: "rbac", targetSkill: "workflow", state: "allowed" }, // 去重
    ]);
    expect(chart).toContain('rbac["rbac"] -->|RBAC_WORKFLOW_ASSIGNEE_EVIDENCE| workflow["workflow"]');
    expect(chart.split("\n")).toHaveLength(2);
    expect(crossSkillEdgesToMermaid("aigc", [])).toBe('flowchart LR\n  aigc["aigc"]');
  });

  it("交叉引用解析：resolved 与 unresolved", () => {
    expect(resolveRoleRef("registrar", MODEL).resolved).toBe(true);
    expect(resolveRoleRef("not_a_role", MODEL).resolved).toBe(false);
    const ok = resolveFieldRef("course.title", MODEL);
    expect(ok.resolved).toBe(true);
    expect(ok.label).toBe("课程.课程名");
    expect(resolveFieldRef("nonexistent.field", MODEL).resolved).toBe(false);
    expect(resolveFieldRef("noDotRef", MODEL).resolved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorkflowScreen
// ---------------------------------------------------------------------------

describe("WorkflowScreen", () => {
  it("模型存在时渲染节点/转移计数 + 节点角色表", () => {
    const html = renderToStaticMarkup(
      <WorkflowScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain("3 节点 · 2 转移");
    expect(html).toContain("提交选课");
    expect(html).toContain("教务审批");
    expect(html).toContain('data-testid="workflow-node-roles"');
    expect(html).toContain("evidence ✓");
    // 占位提示不应出现
    expect(html).not.toContain("推演完成后将显示真实业务流程");
  });

  it("assigneeRole 交叉引用：resolved 打勾、unresolved 标红并计数", () => {
    const html = renderToStaticMarkup(<WorkflowScreen model={MODEL} />);
    expect(html).toContain("✓ student");
    expect(html).toContain("✓ registrar");
    expect(html).toContain("✗ not_a_role");
    expect(html).toContain("1 个角色未在 RBAC 定义");
  });

  it("无模型有 SSE mermaid → 标注实时联动，不显示节点表", () => {
    const html = renderToStaticMarkup(
      <WorkflowScreen mermaidSource={"flowchart LR\n  rbac --> workflow"} />
    );
    expect(html).toContain("跨系统联动 · 实时");
    expect(html).not.toContain('data-testid="workflow-node-roles"');
  });

  it("刷新后仅有持久化 skillRuntimeGraph → 用真实边重建，不落占位", () => {
    const html = renderToStaticMarkup(
      <WorkflowScreen
        skillRuntimeGraph={{
          bySkill: {
            workflow: [
              { sourceSkill: "rbac", targetSkill: "workflow", state: "allowed", evidenceKey: "RBAC_WORKFLOW_ASSIGNEE_EVIDENCE" },
            ],
          },
        }}
      />
    );
    expect(html).toContain("跨系统联动 · 已持久化");
    expect(html).not.toContain("推演完成后将显示真实业务流程");
  });

  it("空态：不渲染假域流程图，只显示诚实空状态提示", () => {
    const html = renderToStaticMarkup(<WorkflowScreen />);
    expect(html).toContain('data-testid="screen-empty-hint"');
    expect(html).toContain("业务流程图");
    expect(html).not.toContain("跨系统联动");
  });
});

// ---------------------------------------------------------------------------
// AigcScreen
// ---------------------------------------------------------------------------

describe("AigcScreen", () => {
  it("模型存在时渲染能力卡片 + 字段绑定交叉解析", () => {
    const html = renderToStaticMarkup(
      <AigcScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain('data-testid="aigc-capabilities"');
    expect(html).toContain("课程简介生成");
    expect(html).toContain("2 项 AI 能力");
    // resolved 输入字段 → 实体名.字段名
    expect(html).toContain("课程.课程名");
    expect(html).toContain("课程.容量");
    // resolved 输出字段
    expect(html).toContain("选课记录.状态");
    // roleRefs 交叉到 rbac
    expect(html).toContain("teacher");
    expect(html).toContain("evidence ✓");
    // 占位内容不应出现
    expect(html).not.toContain("采购描述生成");
    expect(html).not.toContain("推演完成后将显示真实 AIGC 功能设计");
  });

  it("坏引用如实标红（fail-closed 不静默）", () => {
    const html = renderToStaticMarkup(<AigcScreen model={MODEL} />);
    expect(html).toContain("✗ nonexistent.field");
    expect(html).toContain("✗ ghost_role");
  });

  it("rawContent 有跨系统联动图但无结构化清单 → 降级标注", () => {
    const html = renderToStaticMarkup(
      <AigcScreen rawContent={"flowchart LR\n  aigc --> appbundle"} />
    );
    expect(html).toContain('data-testid="aigc-degraded"');
    expect(html).toContain("未携带结构化 AIGC 能力清单");
    expect(html).not.toContain('data-testid="aigc-capabilities"');
  });

  it("空态：不渲染假域 AI 能力卡，只显示诚实空状态提示", () => {
    const html = renderToStaticMarkup(<AigcScreen />);
    expect(html).toContain('data-testid="screen-empty-hint"');
    expect(html).not.toContain("采购描述生成"); // 采购假域占位已移除
  });
});

// ---------------------------------------------------------------------------
// AppBundleScreen
// ---------------------------------------------------------------------------

describe("AppBundleScreen", () => {
  it("closed 闭环：6/6 + 证据链接 + 闭环元信息", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen publishClosure={CLOSURE_CLOSED} />
    );
    expect(html).toContain("closed 6/6");
    expect(html).toContain("llm-linkage-workflow");
    expect(html).toContain("llm-linkage-datamodel");
    expect(html).toContain("closureHash=abcd1234");
    expect(html).toContain("digest=digest99");
    expect(html).toContain("versionPins=checked");
    expect(html).not.toContain('data-testid="appbundle-blockers"');
  });

  it("blocked 闭环：阻塞项如实展示 code/path/affectedSkill", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen publishClosure={CLOSURE_BLOCKED} />
    );
    expect(html).toContain("blocked 2/6");
    expect(html).toContain('data-testid="appbundle-blockers"');
    expect(html).toContain("APPBUNDLE_RUNTIME_CLOSURE_BLOCKED");
    expect(html).toContain("skill=aigc");
    expect(html).toContain("runtimeClosure.perSkillEvidence");
  });

  it("模型 appbundle 段绑定：页面↔流程/角色/实体 交叉解析", () => {
    const html = renderToStaticMarkup(
      <AppBundleScreen publishClosure={CLOSURE_CLOSED} model={MODEL} />
    );
    expect(html).toContain('data-testid="appbundle-bindings"');
    // resolved：pageRef → 页面名，workflowRef → workflow id
    expect(html).toContain("选课页");
    expect(html).toContain("wf_enroll");
    // unresolved 标红
    expect(html).toContain("✗ missing_page");
    expect(html).toContain("✗ missing_wf");
    expect(html).toContain("✗ no_such_entity");
    // dataModelRefs resolved → 实体名
    expect(html).toContain("课程");
  });

  it("空态：无 publishClosure → 诚实提示，无绑定区", () => {
    const html = renderToStaticMarkup(<AppBundleScreen />);
    expect(html).toContain("发送应用意图后");
    expect(html).toContain("blocked 0/6");
    expect(html).not.toContain('data-testid="appbundle-bindings"');
  });
});

// ---------------------------------------------------------------------------
// ActiveSystemScreen — 派发 + skillContents 模型注入集成
// ---------------------------------------------------------------------------

describe("ActiveSystemScreen 派发", () => {
  it("skillContents 携带模型 JSON 时，workflow 屏拿到交叉引用后的模型", () => {
    const html = renderToStaticMarkup(
      <ActiveSystemScreen
        activeSkillId="workflow"
        skillContents={{ workflow: JSON.stringify(MODEL) }}
        publishClosure={CLOSURE_CLOSED}
      />
    );
    expect(html).toContain("3 节点 · 2 转移");
    expect(html).toContain("✗ not_a_role"); // rbac 段共享给 workflow 屏做交叉校验
  });

  it("无激活 Skill 默认 AppBundle 看板（含模型绑定）", () => {
    const html = renderToStaticMarkup(
      <ActiveSystemScreen
        activeSkillId={null}
        skillContents={{ appBundle: JSON.stringify(MODEL) }}
        publishClosure={CLOSURE_CLOSED}
      />
    );
    expect(html).toContain("发布证据看板");
    expect(html).toContain('data-testid="appbundle-bindings"');
  });

  it("aigc 激活时能力卡片可见", () => {
    const html = renderToStaticMarkup(
      <ActiveSystemScreen
        activeSkillId="aigc"
        skillContents={{ aigc: JSON.stringify(MODEL) }}
      />
    );
    expect(html).toContain('data-testid="aigc-capabilities"');
    expect(html).toContain("课程简介生成");
  });

  it("reload 路径：无 skillContents，仅 publishClosure.perSkillEvidence.modelSection 也能渲染模型", () => {
    const closureWithModel: PublishClosureSummary = {
      ...CLOSURE_CLOSED,
      perSkillEvidence: {
        datamodel: { evidencePresent: true, modelSection: MODEL.datamodel as Record<string, unknown> },
        rbac: { evidencePresent: true, modelSection: MODEL.rbac as Record<string, unknown> },
        workflow: { evidencePresent: true, modelSection: MODEL.workflow as Record<string, unknown> },
        page: { evidencePresent: true, modelSection: MODEL.page as Record<string, unknown> },
        aigc: { evidencePresent: true, modelSection: MODEL.aigc as Record<string, unknown> },
        appbundle: { evidencePresent: true, modelSection: MODEL.appbundle as Record<string, unknown> },
      },
    };
    const workflowHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="workflow" publishClosure={closureWithModel} />
    );
    expect(workflowHtml).toContain("3 节点 · 2 转移");
    expect(workflowHtml).toContain("提交选课");
    const aigcHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="aigc" publishClosure={closureWithModel} />
    );
    expect(aigcHtml).toContain('data-testid="aigc-capabilities"');
    expect(aigcHtml).toContain("课程简介生成");
    const bundleHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId={null} publishClosure={closureWithModel} />
    );
    expect(bundleHtml).toContain('data-testid="appbundle-bindings"');
  });

  it("确定性域（无 modelSection）不伪造模型：closed 6/6 但各屏走降级链", () => {
    const workflowHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="workflow" publishClosure={CLOSURE_CLOSED} />
    );
    // 无模型 → 不出现节点角色表；证据徽标仍如实展示
    expect(workflowHtml).not.toContain('data-testid="workflow-node-roles"');
    expect(workflowHtml).toContain("evidence ✓");
    const aigcHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="aigc" publishClosure={CLOSURE_CLOSED} />
    );
    expect(aigcHtml).not.toContain('data-testid="aigc-capabilities"');
  });
});

// ---------------------------------------------------------------------------
// 诚实路径标注 — 来源徽章（LLM 生成 / 内置演示域）+ 占位明示 + datamodel 重建
// ---------------------------------------------------------------------------

const CLOSURE_BUILTIN: PublishClosureSummary = {
  ...CLOSURE_CLOSED,
  perSkillEvidence: {
    datamodel: { evidencePresent: true, artifactId: "runtime-linkage-datamodel" },
    rbac: { evidencePresent: true, artifactId: "runtime-linkage-rbac" },
    workflow: { evidencePresent: true, artifactId: "runtime-linkage-workflow" },
    page: { evidencePresent: true, artifactId: "runtime-linkage-page" },
    aigc: { evidencePresent: true, artifactId: "runtime-linkage-aigc" },
    appbundle: { evidencePresent: true, artifactId: "runtime-linkage-appbundle" },
  },
};

describe("诚实路径标注（来源徽章 + 占位明示）", () => {
  it("evidenceSourceOf：artifactId 前缀 → 来源；识别不了返回 null", () => {
    expect(evidenceSourceOf({ artifactId: "llm-linkage-page" })).toEqual({
      kind: "llm",
      label: "LLM 生成",
    });
    expect(evidenceSourceOf({ artifactId: "runtime-linkage-page" })).toEqual({
      kind: "builtin",
      label: "内置演示域",
    });
    expect(evidenceSourceOf({ evidenceRef: "llm-linkage-rbac" })?.kind).toBe("llm");
    expect(evidenceSourceOf({ artifactId: "something-else" })).toBeNull();
    expect(evidenceSourceOf(null)).toBeNull();
  });

  it("LLM 闭环：各系统屏头部出现「LLM 生成」珊瑚徽章", () => {
    for (const skill of ["workflow", "rbac", "page", "aigc", "dataModel"] as const) {
      const html = renderToStaticMarkup(
        <ActiveSystemScreen activeSkillId={skill} publishClosure={CLOSURE_CLOSED} />
      );
      expect(html).toContain('data-testid="evidence-source-llm"');
      expect(html).toContain("LLM 生成");
      expect(html).toContain("evidence ✓");
    }
  });

  it("内置演示域闭环：各系统屏 + AppBundle 看板出现「内置演示域」琥珀徽章", () => {
    const workflowHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId="workflow" publishClosure={CLOSURE_BUILTIN} />
    );
    expect(workflowHtml).toContain('data-testid="evidence-source-builtin"');
    expect(workflowHtml).toContain("内置演示域");
    const bundleHtml = renderToStaticMarkup(
      <ActiveSystemScreen activeSkillId={null} publishClosure={CLOSURE_BUILTIN} />
    );
    expect(bundleHtml).toContain('data-testid="evidence-source-builtin"');
  });

  it("无证据时不渲染任何徽章（不猜、不冒充）", () => {
    const html = renderToStaticMarkup(<ActiveSystemScreen activeSkillId="workflow" />);
    expect(html).not.toContain("evidence ✓");
    expect(html).not.toContain("evidence-source-");
  });

  it("datamodelToMermaid：实体字段 → erDiagram；空实体 fail-closed 返回 null", () => {
    const diagram = datamodelToMermaid(MODEL.datamodel);
    expect(diagram).not.toBeNull();
    expect(diagram).toContain("erDiagram");
    expect(diagram).toContain("course {");
    expect(diagram).toContain("string title");
    expect(datamodelToMermaid({ entities: [] })).toBeNull();
    expect(datamodelToMermaid(undefined)).toBeNull();
  });

  it("datamodelToMermaid：ref/*_ref 字段生成关联边（词干唯一匹配，歧义不画线）", () => {
    // 复现真实产出的命名形态：user_ref→user_profile（包含）、birth_ref→birth_info（前缀）、
    // chart_ref→wuyun_liuqi_chart（后缀）
    const diagram = datamodelToMermaid({
      entities: [
        { id: "user_profile", fields: [{ id: "user_id", type: "string" }] },
        { id: "birth_info", fields: [{ id: "user_ref", type: "ref" }] },
        { id: "wuyun_liuqi_chart", fields: [{ id: "birth_ref", type: "ref" }] },
        {
          id: "constitution_assessment",
          fields: [
            { id: "chart_ref", type: "ref" },
            { id: "user_ref", type: "string" }, // 命名约定即可，不要求 type=ref
          ],
        },
      ],
    })!;
    expect(diagram).toContain('user_profile ||--o{ birth_info : "user_ref"');
    expect(diagram).toContain('birth_info ||--o{ wuyun_liuqi_chart : "birth_ref"');
    expect(diagram).toContain('wuyun_liuqi_chart ||--o{ constitution_assessment : "chart_ref"');
    expect(diagram).toContain('user_profile ||--o{ constitution_assessment : "user_ref"');
    // user_profile 自己的 user_id 不产生自引用边
    expect(diagram).not.toContain("user_profile ||--o{ user_profile");
    // 歧义（两个候选）不画线
    const ambiguous = datamodelToMermaid({
      entities: [
        { id: "order_item", fields: [] },
        { id: "order_log", fields: [] },
        { id: "shipment", fields: [{ id: "order_ref", type: "ref" }] },
      ],
    })!;
    expect(ambiguous).not.toContain("||--o{ shipment");
  });

  it("deriveErGraphData：实体卡数据 + 关联边（G6 渲染路径，与 mermaid 同一套推断）", () => {
    const data = deriveErGraphData({
      entities: [
        { id: "user_profile", name: "用户", fields: [{ id: "name", name: "姓名", type: "string" }] },
        { id: "birth_info", fields: [{ id: "user_ref", name: "所属用户", type: "ref" }] },
      ],
    })!;
    expect(data.nodes.map((n) => n.id)).toEqual(["user_profile", "birth_info"]);
    expect(data.nodes[0].name).toBe("用户");
    expect(data.nodes[1].fields[0].refTarget).toBe("user_profile");
    expect(data.edges).toEqual([
      { source: "birth_info", target: "user_profile", label: "user_ref" },
    ]);
    expect(deriveErGraphData({ entities: [] })).toBeNull();
  });

  it("deriveWorkflowGraphData：始/终判定、角色解析、条件边（G6 活图路径）", () => {
    const data = deriveWorkflowGraphData(MODEL)!;
    const byId = Object.fromEntries(data.nodes.map((n) => [n.id, n]));
    expect(byId.submit.isStart).toBe(false); // approve→submit 退回边使其有入边
    expect(byId.ghost.isStart).toBe(true); // 无入边
    expect(byId.ghost.isTerminal).toBe(true); // 无出边
    expect(byId.submit.roleResolved).toBe(true);
    expect(byId.ghost.role).toBe("not_a_role");
    expect(byId.ghost.roleResolved).toBe(false); // 未在 rbac.roles 声明 → 标红
    expect(data.edges).toContainEqual({ from: "submit", to: "approve", condition: "容量未满" });
    expect(deriveWorkflowGraphData({})).toBeNull();
  });

  // 注意：ActiveSystemScreen 全屏常挂载（hidden），负向断言必须直渲染目标屏，
  // 否则其他隐藏屏的占位文案会串进同一份 HTML。
  it("DataModel 屏 reload 路径：模型实体重建真实 ER，不再显示采购占位", () => {
    const html = renderToStaticMarkup(
      <DataModelScreen
        publishClosure={CLOSURE_CLOSED}
        model={{ datamodel: MODEL.datamodel }}
      />
    );
    expect(html).not.toContain("占位示意");
    expect(html).not.toContain("PurchaseOrder");
  });

  it("DataModel/Page 屏空态不再渲染假域示例，只显示诚实空状态提示", () => {
    const dmHtml = renderToStaticMarkup(<DataModelScreen />);
    expect(dmHtml).toContain('data-testid="screen-empty-hint"');
    expect(dmHtml).toContain("实体关系图");
    expect(dmHtml).not.toContain("PurchaseOrder"); // 采购假域示例已移除
    const pageHtml = renderToStaticMarkup(<PageScreen />);
    expect(pageHtml).toContain('data-testid="screen-empty-hint"');
    expect(pageHtml).not.toContain("采购申请表");
  });

  it("RBAC 屏模型路径：roles/menus/permissions 真实渲染，未声明权限标红", () => {
    const modelWithUndeclaredPerm: FiveSystemModel = {
      ...MODEL,
      rbac: {
        roles: ["student", "registrar"],
        permissions: ["course:read"],
        menus: [
          { id: "m1", label: "选课", roleRefs: ["student"], permissionRefs: ["course:read"] },
          { id: "m2", label: "审批台", roleRefs: ["registrar"], permissionRefs: ["course:approve"] }, // 未声明
        ],
      },
    };
    const html = renderToStaticMarkup(<RbacScreen model={modelWithUndeclaredPerm} />);
    expect(html).toContain("student");
    expect(html).toContain("registrar");
    expect(html).toContain("选课");
    expect(html).toContain("审批台");
    expect(html).toContain("2 角色 · 1 权限 · 2 菜单");
    expect(html).toContain("course:read");
    expect(html).toContain("✗ course:approve"); // 未在 permissions 清单声明 → 标红
    expect(html).not.toContain("占位示意");
    expect(html).not.toContain("采购单:创建"); // 不再显示采购占位
  });

  it("RBAC 屏无模型时显示空状态提示，有模型时优先于 rawContent", () => {
    const placeholderHtml = renderToStaticMarkup(<RbacScreen />);
    expect(placeholderHtml).toContain('data-testid="screen-empty-hint"');
    expect(placeholderHtml).not.toContain("采购单:创建"); // 采购假域占位已移除
    const modelHtml = renderToStaticMarkup(
      <RbacScreen model={MODEL} rawContent={"# 角色: 文本角色\n权限: something"} />
    );
    expect(modelHtml).toContain("student"); // model 优先
    expect(modelHtml).not.toContain("文本角色");
  });

  it("Page 屏模型路径：pages[].fieldBindings 交叉解析渲染，未解析绑定标红", () => {
    const modelWithBrokenBinding: FiveSystemModel = {
      ...MODEL,
      page: {
        pages: [
          {
            id: "enroll_page",
            name: "选课页",
            fieldBindings: ["course.title", "nonexistent.field"],
            actionPermissions: ["course:read"],
          },
        ],
      },
    };
    const html = renderToStaticMarkup(<PageScreen model={modelWithBrokenBinding} />);
    expect(html).toContain("选课页");
    expect(html).toContain("课程.课程名"); // resolved → 实体名.字段名
    expect(html).toContain("✗ nonexistent.field"); // unresolved 如实标红
    expect(html).toContain("course:read");
    expect(html).not.toContain("占位示意");
    expect(html).not.toContain("采购申请表");
  });
});

describe("浏览器运行时（试运行）入口", () => {
  it("Workflow 屏有模型时显示 流程图/试运行 切换；无模型不显示", () => {
    const withModel = renderToStaticMarkup(
      <WorkflowScreen model={MODEL} publishClosure={CLOSURE_CLOSED} />
    );
    expect(withModel).toContain('data-testid="workflow-mode-toggle"');
    expect(withModel).toContain("试运行");
    const withoutModel = renderToStaticMarkup(<WorkflowScreen />);
    expect(withoutModel).not.toContain('data-testid="workflow-mode-toggle"');
  });

  it("WorkflowRuntimePanel 初始态提供「发起实例」", () => {
    const html = renderToStaticMarkup(
      <WorkflowRuntimePanel model={MODEL} sessionId="t-runtime" />
    );
    expect(html).toContain('data-testid="workflow-runtime-panel"');
    expect(html).toContain('data-testid="runtime-start"');
    expect(html).toContain("发起实例");
  });

  it("DataModelScreen 有实体时提供「模型图⟷数据表」切换；无模型不显示", () => {
    const withModel = renderToStaticMarkup(<DataModelScreen model={MODEL} sessionId="t-dm" />);
    expect(withModel).toContain('data-testid="datamodel-mode-toggle"');
    expect(withModel).toContain("数据表");
    const withoutModel = renderToStaticMarkup(<DataModelScreen />);
    expect(withoutModel).not.toContain('data-testid="datamodel-mode-toggle"');
  });

  it("AigcScreen 有能力清单时提供「能力清单⟷能力试跑」切换；无模型不显示", () => {
    const withModel = renderToStaticMarkup(<AigcScreen model={MODEL} />);
    expect(withModel).toContain('data-testid="aigc-mode-toggle"');
    expect(withModel).toContain("能力试跑");
    const withoutModel = renderToStaticMarkup(<AigcScreen />);
    expect(withoutModel).not.toContain('data-testid="aigc-mode-toggle"');
  });

  it("AigcTryRunPanel 按能力切页、输入字段解析实体名、提供「试跑」", () => {
    const html = renderToStaticMarkup(<AigcTryRunPanel model={MODEL} goal="选课系统" />);
    expect(html).toContain('data-testid="aigc-tryrun-panel"');
    expect(html).toContain('data-testid="aigc-tryrun-cap-cap_summary"');
    expect(html).toContain('data-testid="aigc-tryrun-run"');
    expect(html).toContain("试跑");
    expect(html).toContain("课程"); // resolveFieldRef 解析出实体名
  });

  it("EntityDataPanel 按实体切页并提供「新增一行」（空表如实提示）", () => {
    const html = renderToStaticMarkup(<EntityDataPanel model={MODEL} sessionId="t-dm" />);
    expect(html).toContain('data-testid="datamodel-data-panel"');
    expect(html).toContain('data-testid="datamodel-entity-course"');
    expect(html).toContain('data-testid="datamodel-entity-enrollment"');
    expect(html).toContain('data-testid="datamodel-add-row"');
    expect(html).toContain("暂无数据");
    expect(html).toContain("容量"); // 字段列头来自实体定义
  });
});
