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
import {
  parseFiveSystemModel,
  parseFiveSystemModelFromContents,
  workflowModelToMermaid,
  crossSkillEdgesToMermaid,
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

  it("空态：无任何数据 → 占位降透明 + 诚实提示", () => {
    const html = renderToStaticMarkup(<WorkflowScreen />);
    expect(html).toContain("推演完成后将显示真实业务流程");
    expect(html).toContain("opacity-40");
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

  it("空态：占位卡片降透明 + 诚实提示", () => {
    const html = renderToStaticMarkup(<AigcScreen />);
    expect(html).toContain("推演完成后将显示真实 AIGC 功能设计");
    expect(html).toContain("opacity-40");
    expect(html).toContain("采购描述生成"); // 占位（明确 40% 透明度呈现）
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
});
