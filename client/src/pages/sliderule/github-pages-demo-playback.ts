/**
 * GitHub Pages 演示回放驱动 — 接口对齐 driveFullViaPythonStream。
 *
 * Pages 静态托管没有 Python 后端，访客点「发送」后由本模块按
 * github-pages-demo-template.ts（真实 LLM 推演一次性捕获）回放全过程：
 * 推理步骤 → 六系统逐个生成（缩略图点亮 + 模型实时输出）→ 发布闭环
 * → 推演总结。产出的 finalState / publishClosure 与真实链路同构，
 * 右侧发布看板与可运行数字孪生照常渲染。
 */

import type { DriveFullStreamOpts, SkillId } from "@/lib/sliderule-marathon-driver";
import {
  commitArtifact,
  deriveNodeStatus,
} from "@/lib/sliderule-runtime";
import type { Artifact, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import {
  commitTrusted,
  createRawArtifact,
  markTrusted,
} from "@/lib/sliderule-fullpath-fixtures";
import { buildStructuredReport } from "@shared/blueprint/sliderule-report-builder";
import { GITHUB_PAGES_DEMO_TEMPLATE } from "./github-pages-demo-template";

/** 回放节奏（毫秒）。既要有"在推演"的实感，又不能拖太久。 */
const STEP_DELAY = 700;
const SKILL_DELAY = 900;
const SUMMARY_CHUNK_DELAY = 60;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/** 推演前段的推理步骤（能力 id 走真实 CAPABILITY_PROCESS_LABELS 文案）。 */
const REASONING_STEPS: Array<{ capabilityId: string; loop: number }> = [
  { capabilityId: "risk.analyze", loop: 0 },
  { capabilityId: "evidence.search", loop: 0 },
  { capabilityId: "synthesis.merge", loop: 1 },
  { capabilityId: "structure.decompose", loop: 1 },
];

/** 与真实闭环同构的最终会话态：可信产物链 + 发布闭环 + 已收口阶段。 */
function buildDemoFinalState(prepared: V5SessionState): V5SessionState {
  let state = prepared;

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
  evidenceRaw.summary = "【来源: F2_Web_Search 取数】检索「RBAC 权限」· 2 条（演示）";
  const committed = commitArtifact(
    state,
    evidenceRaw,
    "pages-demo-run-evidence",
    false,
    ["demo-risk-1"],
    "pilot-template"
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
    "pilot-template"
  );
  state = reportCommit.updatedState;
  markTrusted(state, "demo-report-1");

  state = {
    ...state,
    goal: {
      text: prepared.goal?.text || GITHUB_PAGES_DEMO_TEMPLATE.goal,
      status: "clear",
    },
    runtimePhase: "done",
    deliveryPhase: "shipped",
  } as V5SessionState;

  (state as V5SessionState & { publishClosure?: unknown }).publishClosure =
    GITHUB_PAGES_DEMO_TEMPLATE.publishClosure;

  return deriveNodeStatus(state);
}

/**
 * 按模板回放一轮推演。返回值形状与 driveFullViaPythonStream 一致；
 * 中途 abort 时返回 null（外层已有降级处理）。
 */
export async function driveGithubPagesDemoPlayback(
  state: V5SessionState,
  _userText: string,
  opts: DriveFullStreamOpts = {}
): Promise<{
  finalState: V5SessionState;
  stopReason?: string;
  loops?: unknown[];
  publishClosure?: unknown;
} | null> {
  const signal = opts.stopSignal;
  try {
    for (const step of REASONING_STEPS) {
      opts.onReasoningStep?.(step.capabilityId, step.loop);
      await wait(STEP_DELAY, signal);
    }

    for (const capture of GITHUB_PAGES_DEMO_TEMPLATE.skills) {
      const skillId = capture.skill as SkillId;
      opts.onSkillActivated?.(skillId, capture.label);
      // 模型内容分两段"流出"，右栏画面与思考流有生长感
      const modelJson = JSON.stringify(capture.modelSection, null, 2);
      const mid = Math.ceil(modelJson.length / 2);
      opts.onLlmDelta?.(modelJson.slice(0, mid), "five-system-model");
      await wait(SKILL_DELAY / 2, signal);
      opts.onLlmDelta?.(modelJson.slice(mid), "five-system-model");
      await wait(SKILL_DELAY / 2, signal);
      opts.onSkillCompleted?.(skillId, false, {
        mermaid: capture.mermaid || null,
        evidencePresent: true,
        evidenceRef: `runtime-linkage-${skillId.toLowerCase()}-demo`,
        artifactId: `runtime-linkage-${skillId.toLowerCase()}-demo`,
        digest: `demo-${skillId.toLowerCase()}`,
        edges: null,
        modelSection: capture.modelSection as Record<string, unknown>,
      });
    }

    // 推演总结：按句片段流出（与真实 closure.summary 的 SSE 节奏一致）
    const summary = GITHUB_PAGES_DEMO_TEMPLATE.chatSummary;
    const chunkSize = 24;
    for (let i = 0; i < summary.length; i += chunkSize) {
      opts.onLlmDelta?.(summary.slice(i, i + chunkSize), "closure.summary");
      await wait(SUMMARY_CHUNK_DELAY, signal);
    }

    const finalState = buildDemoFinalState(state);
    return {
      finalState,
      stopReason: "completed",
      publishClosure: GITHUB_PAGES_DEMO_TEMPLATE.publishClosure,
      loops: opts.turnId
        ? [
            {
              loopTurnId: opts.turnId,
              plan: {
                selected: [],
                reason: "github_pages_demo_playback",
                expectedArtifacts: [],
              },
              committedArtifactIds: [],
              stopSignal: "github_pages_demo_playback",
            },
          ]
        : [],
    };
  } catch {
    return null; // aborted → 外层统一降级
  }
}
