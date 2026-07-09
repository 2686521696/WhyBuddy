/**
 * GitHub Pages static demo for /sliderule — localStorage session + seeded graph state.
 * No backend, no LLM, no web search; pilot/deterministic executor only.
 */

import type { SlideRuleSessionStore } from "@/lib/sliderule-runtime";
import {
  commitArtifact,
  createInitialSessionState,
  deriveNodeStatus,
  intakeMessage,
} from "@/lib/sliderule-runtime";
import type {
  Artifact,
  V5SessionState,
} from "@shared/blueprint/v5-reasoning-state";
import {
  commitTrusted,
  createRawArtifact,
  markTrusted,
} from "@/lib/sliderule-fullpath-fixtures";
import { buildStructuredReport } from "@shared/blueprint/sliderule-report-builder";

export const GITHUB_PAGES_DEMO_SESSION_ID = "github-pages-sliderule-demo";
export const GITHUB_PAGES_DEMO_GOAL =
  "做一个权限管理系统（支持 RBAC + 数据范围）";

// v3：种子带发布闭环 + 五系统模型（右侧直接渲染运行应用）。升版本号让老访客的
// 旧缓存失效、重播新种子。
const STORAGE_KEY_PREFIX = "sliderule:github-pages-demo:v3:";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Pre-seeded session so the reasoning canvas shows nodes on first visit. */
export function createGithubPagesSlideRuleSeedSession(): V5SessionState {
  const sessionId = GITHUB_PAGES_DEMO_SESSION_ID;
  let state = createInitialSessionState("", sessionId);

  const goalIntake = intakeMessage(state, {
    turnId: "pages-demo-seed-goal",
    userText: GITHUB_PAGES_DEMO_GOAL,
  });
  state = goalIntake.preparedState;

  const intake = intakeMessage(state, {
    turnId: "pages-demo-seed-intake",
    userText: "分析安全风险，并检索外部证据",
  });
  state = intake.preparedState;

  state = commitTrusted(
    state,
    "demo-risk-1",
    "risk.analyze",
    "安全",
    "risk",
    "pages-demo-run-risk"
  );

  const evidenceRaw = createRawArtifact(
    "demo-evidence-1",
    "evidence.search",
    "接地",
    "evidence",
    [
      "【全网检索 · 演示数据】",
      "1. RBAC 权限模型选型指南",
      "   URL: https://zhuanlan.zhihu.com/p/demo-rbac",
      "   摘要: 基于角色的访问控制（Role-based access control）是企业权限系统常见方案。",
      "2. 基于 RBAC 权限模型的架构设计",
      "   URL: https://www.cnblogs.com/demo/rbac-arch",
      "   摘要: 数据范围过滤 + 角色授权的组合实践。",
    ].join("\n")
  );
  evidenceRaw.provenance = "web:search" as Artifact["provenance"];
  evidenceRaw.summary =
    "【来源: F2_Web_Search 取数】检索「RBAC 权限」· 2 条（演示）";

  const committed = commitArtifact(
    state,
    evidenceRaw,
    "pages-demo-run-evidence",
    false,
    ["demo-risk-1"],
    "pilot-template" // pilot/demo seed -> use pilot-template baseline for K3
  );
  state = committed.updatedState;
  markTrusted(state, "demo-evidence-1");

  state = commitTrusted(
    state,
    "demo-synth-1",
    "synthesis.merge",
    "综合",
    "synthesis",
    "pages-demo-run-synth",
    ["demo-risk-1", "demo-evidence-1"]
  );

  state = commitTrusted(
    state,
    "demo-tree-1",
    "structure.decompose",
    "架构",
    "spec_tree",
    "pages-demo-run-tree",
    ["demo-risk-1", "demo-evidence-1"]
  );
  const treeArt = state.artifacts?.find(a => a.id === "demo-tree-1");
  if (treeArt) {
    treeArt.content =
      "C_PROMPT:built · G_INV:attempt1:passed\n" +
      "【SPEC Tree · template】\n" +
      "- [root] RBAC 权限系统\n" +
      "  - [req-1] 角色与权限模型\n" +
      "  - [req-2] 数据范围过滤\n" +
      "  - [task-1] 审计日志";
  }

  const built = buildStructuredReport({
    state,
    inputArtifactIds: ["demo-risk-1", "demo-evidence-1", "demo-synth-1"],
    roleId: "综合",
    turnLabel: "演示",
  });
  const reportRaw = createRawArtifact(
    "demo-report-1",
    "report.write",
    "综合",
    "report",
    built.content
  );
  reportRaw.title = built.title;
  reportRaw.summary = built.summary;
  reportRaw.evidenceRefs = ["demo-evidence-1", "demo-risk-1"];

  const reportCommit = commitArtifact(
    state,
    reportRaw,
    "pages-demo-run-report",
    false,
    ["demo-synth-1", "demo-evidence-1", "demo-risk-1"],
    "pilot-template" // pilot/demo seed -> use pilot-template baseline for K3
  );
  state = reportCommit.updatedState;
  markTrusted(state, "demo-report-1");

  state = {
    ...state,
    goal: {
      text: GITHUB_PAGES_DEMO_GOAL,
      status: "clear",
    },
    runtimePhase: "done",
    deliveryPhase: "shipped",
  };

  // 静态演示的发布闭环载荷：带完整五系统模型段（modelSection），让右侧舞台
  // 直接渲染可运行应用 + 游标透视可用。artifactId 用 runtime-linkage- 前缀
  // ——evidenceSourceOf 识别为「内置演示域」，诚实标注非 LLM 生成。
  (state as V5SessionState & { publishClosure?: unknown }).publishClosure =
    createGithubPagesDemoPublishClosure();

  return deriveNodeStatus(state);
}

/** 五系统模型（权限管理系统演示域）：实体/流程/角色/页面/AI 交叉引用全部闭合。 */
export function createGithubPagesDemoFiveSystemModel() {
  return {
    datamodel: {
      entities: [
        {
          id: "user",
          name: "用户",
          fields: [
            { id: "user_id", name: "工号", type: "string" },
            { id: "name", name: "姓名", type: "string" },
            { id: "department", name: "部门", type: "string" },
            { id: "status", name: "在职状态", type: "enum" },
            { id: "risk_level", name: "越权风险等级", type: "string" },
          ],
        },
        {
          id: "role",
          name: "角色",
          fields: [
            { id: "role_id", name: "角色编号", type: "string" },
            { id: "name", name: "角色名", type: "string" },
            { id: "data_scope", name: "数据范围", type: "enum" },
          ],
        },
        {
          id: "grant_request",
          name: "授权申请",
          fields: [
            { id: "request_id", name: "申请编号", type: "string" },
            { id: "applicant", name: "申请人", type: "string" },
            { id: "target_role", name: "目标角色", type: "string" },
            { id: "reason", name: "申请理由", type: "string" },
            { id: "status", name: "审批状态", type: "enum" },
            { id: "risk_note", name: "AI 风险提示", type: "string" },
          ],
        },
      ],
    },
    rbac: {
      roles: ["employee", "security_auditor", "sys_admin"],
      permissions: [
        "user:read",
        "user:manage",
        "role:manage",
        "grant:submit",
        "grant:approve",
        "audit:read",
      ],
      menus: [
        {
          id: "menu_users",
          label: "用户管理",
          roleRefs: ["sys_admin", "security_auditor"],
          permissionRefs: ["user:read", "user:manage"],
        },
        {
          id: "menu_roles",
          label: "角色与数据范围",
          roleRefs: ["sys_admin"],
          permissionRefs: ["role:manage"],
        },
        {
          id: "menu_grants",
          label: "授权申请",
          roleRefs: ["employee", "security_auditor", "sys_admin"],
          permissionRefs: ["grant:submit", "grant:approve"],
        },
      ],
    },
    workflow: {
      id: "wf_grant",
      nodes: [
        {
          id: "n_submit",
          name: "提交授权申请",
          assigneeRole: "employee",
          phase: "申请",
        },
        {
          id: "n_review",
          name: "安全审核",
          assigneeRole: "security_auditor",
          phase: "审核",
        },
        {
          id: "n_apply",
          name: "授权生效",
          assigneeRole: "sys_admin",
          phase: "生效",
        },
      ],
      transitions: [
        { from: "n_submit", to: "n_review" },
        { from: "n_review", to: "n_apply", condition: "审核通过" },
        { from: "n_review", to: "n_submit", condition: "驳回补充理由" },
      ],
    },
    page: {
      pages: [
        {
          id: "user_admin_page",
          name: "用户管理页",
          fieldBindings: [
            "user.user_id",
            "user.name",
            "user.department",
            "user.status",
            "user.risk_level",
          ],
          actionPermissions: ["user:manage"],
        },
        {
          id: "grant_request_page",
          name: "授权申请页",
          fieldBindings: [
            "grant_request.request_id",
            "grant_request.applicant",
            "grant_request.target_role",
            "grant_request.reason",
            "grant_request.status",
            "grant_request.risk_note",
          ],
          actionPermissions: ["grant:submit", "grant:approve"],
        },
        {
          id: "role_scope_page",
          name: "角色与数据范围页",
          fieldBindings: ["role.role_id", "role.name", "role.data_scope"],
          actionPermissions: ["role:manage"],
        },
      ],
    },
    aigc: {
      capabilities: [
        {
          id: "cap_grant_risk_scan",
          name: "越权风险扫描",
          inputFields: [
            "grant_request.applicant",
            "grant_request.target_role",
            "grant_request.reason",
          ],
          outputField: "grant_request.risk_note",
          roleRefs: ["security_auditor"],
        },
        {
          id: "cap_user_risk_score",
          name: "用户风险评级",
          inputFields: ["user.department", "user.status"],
          outputField: "user.risk_level",
          roleRefs: ["security_auditor", "sys_admin"],
        },
      ],
    },
    appbundle: {
      pageBindings: [
        { pageRef: "grant_request_page", workflowRef: "wf_grant" },
        { pageRef: "user_admin_page", workflowRef: "wf_grant" },
      ],
      roleRefs: ["employee", "security_auditor", "sys_admin"],
      dataModelRefs: ["user", "role", "grant_request"],
    },
  };
}

/** 发布闭环载荷（PublishClosureSummary 形状）：证据 6/6 + 每系统 modelSection。 */
export function createGithubPagesDemoPublishClosure() {
  const model = createGithubPagesDemoFiveSystemModel();
  const skills = [
    "datamodel",
    "rbac",
    "workflow",
    "page",
    "aigc",
    "appbundle",
  ] as const;
  const perSkillEvidence = Object.fromEntries(
    skills.map(skill => [
      skill,
      {
        evidencePresent: true,
        evidenceRef: `runtime-linkage-${skill}-demo`,
        artifactId: `runtime-linkage-${skill}-demo`,
        digest: `demo-${skill}`,
        modelSection: model[skill],
      },
    ])
  );
  return {
    blocked: false,
    blockerCount: 0,
    evidencePresentCount: skills.length,
    skillCount: skills.length,
    versionPinsChecked: true,
    closureId: "pages-demo-closure",
    closureHash: "demo0000",
    stableDigest: "demo0000",
    generatedAt: "2026-07-01T00:00:00Z",
    tierCounts: { hard_blocker: 0, warning: 0, info: 0 },
    topBlockers: [],
    perSkillEvidence,
    chatSummary: [
      "闭环状态：**closed，证据 6/6**（演示数据，展示推演收口后的形态）。",
      "",
      "现在右侧就是这套「权限管理系统」的可运行数字孪生：",
      "- **3 类角色**（员工 / 安全审计员 / 系统管理员）协作，右上角可切换角色看权限联动；",
      "- **3 个核心实体**（用户、角色、授权申请）支撑用户管理、角色与数据范围、授权申请 3 个页面，可直接录入数据；",
      "- **授权申请 → 安全审核 → 授权生效** 的审批流可实际提交推进；",
      "- **2 项 AI 能力**（越权风险扫描、用户风险评级）可试跑并把结果写回字段。",
      "",
      "建议体验：打开右上角「游标」，悬停任意字段或按钮，透视它背后的实体、权限与流程声明；顶栏「交付物」可导出结构化 Markdown。",
      "",
      "完整版（连接后端 + 真 LLM）支持任意一句话意图的全程实时推演：每一步 LLM 想法直播、五系统模型边生成边渲染。",
    ].join("\n"),
  };
}

/**
 * Note for GitHub Pages BYOK demo (B4):
 * - Open the top HUD (always visible in Pages mode).
 * - Look for "BYOK: not set" section → choose preset (e.g. openai/deepseek), paste your API key → Save.
 * - Key stays 100% in your browser localStorage (never sent to this site or anywhere but the vendor you chose).
 * - Next input will switch to browser-llm executor (production baseline, real LLM via K1/K2/K3).
 * - Clear to revert to pilot templates.
 * - CSP allows direct connect to the presets (see client/index.html).
 * - Multi-key pool supported in storage (advanced: edit localStorage or extend UI).
 */

export function createGithubPagesSlideRuleSessionStore(
  opts: { storage?: StorageLike | null } = {}
): SlideRuleSessionStore {
  const backing = opts.storage ?? storage();

  return {
    async load(sessionId: string): Promise<V5SessionState | undefined> {
      if (!backing) return undefined;
      const raw = backing.getItem(STORAGE_KEY_PREFIX + sessionId);
      if (!raw) return undefined;
      try {
        const parsed = JSON.parse(raw);
        // publishClosure (if present in saved) or absent (legacy) both tolerated; adapter in useSlideRuleSession also preserves.
        return parsed as V5SessionState;
      } catch {
        return undefined;
      }
    },

    async save(state: V5SessionState): Promise<V5SessionState> {
      const sessionId = state.sessionId || GITHUB_PAGES_DEMO_SESSION_ID;
      const now = new Date().toISOString();
      // Explicit carry of publishClosure (if present) for session store persistence + legacy compat.
      const pc = (state as any).publishClosure;
      const saved: any = {
        ...state,
        sessionId,
        lastActive: now,
        createdAt:
          (state as V5SessionState & { createdAt?: string }).createdAt || now,
      };
      if (pc !== undefined) saved.publishClosure = pc;
      backing?.setItem(STORAGE_KEY_PREFIX + sessionId, JSON.stringify(saved));
      return saved as V5SessionState;
    },

    async deleteSession(sessionId: string): Promise<void> {
      backing?.removeItem(STORAGE_KEY_PREFIX + sessionId);
    },
  };
}

/** First visit: seed graph; returning visitors: restore localStorage snapshot. */
export async function loadOrSeedGithubPagesDemoSession(
  store: SlideRuleSessionStore,
  sessionId = GITHUB_PAGES_DEMO_SESSION_ID
): Promise<V5SessionState> {
  const existing = await store.load(sessionId);
  if (existing?.goal?.text?.trim() && (existing.artifacts?.length ?? 0) > 0) {
    return deriveNodeStatus(existing);
  }
  const seed = createGithubPagesSlideRuleSeedSession();
  return store.save(seed);
}
