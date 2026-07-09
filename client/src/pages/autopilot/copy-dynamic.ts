/**
 * Shared `copyDynamic` helper for the SPEC-FIRST 蓝图驾驶舱页面。
 *
 * 历史上 `copyDynamic` / `DYNAMIC_ZH_COPY` 内联在 `AutopilotRoutePage.tsx` 中。
 * `.kiro/specs/spec-first-stage-process-artifact-split-uniform/` 任务 1.2a 把
 * `buildPreflightExecutionFallbackEntries` 抽出到 `right-rail/stage-split-descriptor/`
 * 模块；该函数依赖 `copyDynamic`。`right-rail/` 子树**不允许**反向 import
 * `AutopilotRoutePage.tsx`（避免 design.md Component 0 中描述的循环依赖），
 * 因此把 `copyDynamic` 与其字典 `DYNAMIC_ZH_COPY` 一并提到这个 sibling 模块，
 * 让 page 与 right-rail 都可以从同一处消费。
 *
 * 实现保持 bit-for-bit 与原 `AutopilotRoutePage.tsx` 中的版本一致：
 * - 入参签名 `(locale, value)`、返回非空 string
 * - `en-US` 直接返回原值；`zh-CN` 优先查字典，再按三个固定前缀正则降级
 * - 不抛异常，不调用 `Date.now()` / 随机值
 */

import type { AppLocale } from "@/lib/locale";

const DYNAMIC_ZH_COPY: Record<string, string> = {
  // ─── Route names ──────────────────────────────────────────────────────────
  "Primary SPEC asset route": "主路线：SPEC 资产路线",
  "Documentation-first conservative route": "备选路线：文档优先稳态路线",
  "Preview-first exploratory route": "备选路线：效果预演探索路线",
  "Primary runtime path": "主路线：运行时路径",
  "Fallback runtime path": "备选路线：降级运行时路径",
  "LLM custom runtime route": "LLM 自定义运行时路线",

  // ─── Route descriptions / summaries ───────────────────────────────────────
  "Primary and alternative routes prepared for SPEC tree derivation.":
    "已为 SPEC 树推导准备主路线与备选路线。",
  "Use executor-backed role agent runtime.":
    "使用执行器支撑的角色代理运行时。",
  "Keep lite mode available for degraded execution.":
    "保留轻量模式以支持降级执行。",
  "Clarify the requested product direction, derive the durable SPEC tree, then expand documents, preview, and implementation prompts.":
    "澄清产品方向，推导可沉淀的 SPEC 树，再扩展规格文档、效果预演和实现提示词。",
  "Create a narrower SPEC tree first, freeze requirements/design/tasks, then preview and package prompts after review.":
    "先创建更收敛的 SPEC 树，评审后冻结 requirements / design / tasks，再生成预演和提示词。",
  "Push route analysis toward effect preview early, then backfill SPEC documents from the selected prototype direction.":
    "更早进入效果预演，再从选定的原型方向回填 SPEC 文档。",

  // ─── Stage step labels ────────────────────────────────────────────────────
  "Clarify execution intent": "澄清执行意图",
  "Scan GitHub source": "扫描 GitHub 源码",
  "Map capability pool": "映射能力池",
  "Derive SPEC tree seed": "推导 SPEC 树种子",
  "Plan previews and prompts": "规划效果预演与提示词",
  "Collect target users and boundaries.": "收集目标用户与边界条件。",
  "Inspect repositories and extract technology stack, module boundaries, and reusable assets.":
    "检查仓库并提取技术栈、模块边界与可复用资产。",
  "Choose Docker, MCP, skills, AIGC nodes, and specialist roles for analysis coverage.":
    "选择 Docker、MCP、Skills、AIGC 节点与专业角色来覆盖分析任务。",
  "Transform primary and alternative route nodes into an editable SPEC tree asset.":
    "将主路线与备选路线节点转成可编辑的 SPEC 树资产。",
  "Prepare the downstream effect preview, architecture diagram, and implementation prompt package.":
    "准备下游效果预演、架构图与实现提示词包。",
  "Analyze source safely in an isolated runtime.":
    "在隔离运行时中安全分析源码。",
  "Build RBAC with audit evidence.": "构建带审计证据的 RBAC。",
  "Specification document generation": "规格文档生成",
  "Confirm source SPEC coverage": "确认源 SPEC 覆盖度",
  "Select a route for SPEC tree derivation.": "选择路线以推导 SPEC 树。",

  // ─── Clarification legacy patterns ────────────────────────────────────────
  "What is the primary goal of this project?": "这个项目的主要目标是什么？",
  "Who are the target users?": "目标用户是谁？",
  "What are the key constraints or boundaries?": "关键约束或边界是什么？",
  "What does success look like for this feature?": "这个功能的成功标准是什么？",
  "Are there any existing systems this needs to integrate with?":
    "是否有需要集成的现有系统？",
};

export function copyDynamic(locale: AppLocale, value: string | undefined): string {
  if (!value) return "";
  if (locale === "en-US") return value;

  const direct = DYNAMIC_ZH_COPY[value] ?? DYNAMIC_ZH_COPY[value.trim()];
  if (direct) return direct;

  const selectedRoute = value.match(/^Selected route:\s*(.+)$/);
  if (selectedRoute) {
    return `已选择路线：${copyDynamic(locale, selectedRoute[1])}`;
  }

  const specAssetTree = value.match(/^SPEC asset tree:\s*(.+)$/);
  if (specAssetTree) {
    return `SPEC 资产树：${copyDynamic(locale, specAssetTree[1])}`;
  }

  const effectPreview = value.match(/^Effect preview:\s*(.+)$/);
  if (effectPreview) {
    return `效果预演：${copyDynamic(locale, effectPreview[1])}`;
  }

  return value;
}
