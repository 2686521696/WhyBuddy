/**
 * autopilot-spec-tree-workbench / Wave 0 Task 4
 *
 * 树中心工作台主组件。把 fabric 阶段的 spec_tree + spec_documents 两个
 * sub-stage 合并成单一卡片：
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │ 顶部双 CTA：                                         │
 *   │  [深色] 生成整棵树文档    [描边] 生成当前节点文档    │
 *   ├─────────────────────────────────────────────────────┤
 *   │ #1 root.title  · domain        ▶  3/3 accepted · llm│
 *   │ #2 child-1     · scenario      ▶  2/3 reviewing · llm│
 *   │ #3 child-2     · interface     ▼  生成中             │
 *   │   └ requirements [reviewing · llm] 摘要…              │
 *   │   └ design       [draft · llm]    摘要…              │
 *   │   └ tasks        [尚未生成]                           │
 *   │ #4 leaf-3      · contract      ▶  未生成              │
 *   └─────────────────────────────────────────────────────┘
 *
 * 设计目标：
 * - 顶部双 CTA：默认主操作是"生成整棵树文档"（无须用户先选节点）；
 *   选中节点后次按钮"生成当前节点文档"启用。
 * - 节点行展开式预览：accordion 风格，点击同一行第二次收起。
 * - chip 与展开态都来自 deriveSpecTreeChip，保证稳定 docs 与 ephemeral
 *   流共用同一份折算逻辑。
 * - 实时 observing 通过 useBlueprintRealtimeStore.agentReasoning.entries
 *   读取并 parse 成 byNodeTitle 快照；稳定 docs 已存在的节点忽略 ephemeral。
 *
 * 不做的事：
 * - 不发 socket / 不写 store；调用 API 仅通过 props.onGenerate*
 *   回调让父级承担副作用。
 * - 不渲染外层 timeline / sub-stage 占位（由 AutopilotRightRail 负责）。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
} from "react";

import { blueprintCopy } from "@/lib/blueprint-copy";
import type { AppLocale } from "@/lib/locale";
import { useBlueprintRealtimeStore } from "@/lib/blueprint-realtime-store";
import { exportSpecDocumentsToDownload } from "@/lib/blueprint-api/exportSpecDocuments";
import {
  deriveSpecDocumentTreeStats,
  type SpecDocumentTreeStats,
} from "@/lib/blueprint-spec-document-stats";

import type {
  BlueprintGenerationJob,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "@shared/blueprint/contracts";

import { deriveSpecTreeChip } from "../derive-spec-tree-chip";
import { parseSpecDocsObservingEntries } from "../parse-spec-docs-observing";

import {
  deriveGenerationState,
  type GenerationScope,
  type OptimisticMark,
} from "./derive-generation-state";

import { SpecTreeChip } from "./SpecTreeChip";
import { SpecDocPreviewBlock } from "./SpecDocPreviewBlock";
import { SpecTreeProgressLayer } from "./SpecTreeProgressLayer";

const DOC_TYPE_ORDER: readonly BlueprintSpecDocumentType[] = [
  "requirements",
  "design",
  "tasks",
];

export type SpecTreeWorkbenchGenerateScope = "all" | "single";

export interface SpecTreeWorkbenchProps {
  jobId: string;
  job: BlueprintGenerationJob | null;
  specTree: BlueprintSpecTree | null;
  /**
   * 可选稳定 docs 来源。当传入时优先使用；不传时由组件内部通过
   * `deriveSpecDocumentTreeStats(job, specTree)` 从 job.artifacts 派生
   * （与既有 minimal-invasive 实现 / SpecDocumentWorkbenchPanel 共用同一份
   * 数据底座，避免维护两份 grouping 逻辑）。
   */
  specDocuments?: ReadonlyArray<BlueprintSpecDocument>;
  locale: AppLocale;
  /**
   * CTA 进行中状态。父级控制 in-flight 锁，本组件只负责展示与触发回调。
   * `null` = 无进行中请求；`"all"` = 整树批量；`"single"` = 单节点。
   */
  generating: SpecTreeWorkbenchGenerateScope | null;
  /** 主 CTA：生成整棵树。父级负责调用 generateBlueprintSpecDocuments(jobId, {})。 */
  onGenerateAll: () => void;
  /** 次 CTA：生成单节点。父级负责调用 generateBlueprintSpecDocuments(jobId, { nodeId })。 */
  onGenerateNode: (nodeId: string) => void;

  // —— spec-generation-perceived-performance 新增（全部可选，缺省退化为既有行为） ——
  /**
   * 父级错误（来自 `specDocsError`），存在即 `failure` 候选。
   * 缺省（`undefined` / `null`）时不参与派生，组件行为与既有一致。
   * 实际消费见 Task 4.2（接入 `deriveGenerationState`）/ 4.3（失败态渲染）。
   */
  generationError?: { message?: string; detail?: string } | null;
  /**
   * 重试入口：父级以"上次失败的 scope"重新发起生成。
   * 缺省时不渲染重试入口。实际消费见 Task 4.3。
   */
  onRetry?: (scope: GenerationScope, nodeId?: string) => void;
}

// ─── i18n 文案 ────────────────────────────────────────────────────────────

const COPY = {
  ctaAll: { "zh-CN": "生成整棵树文档", "en-US": "Generate all docs" },
  ctaSingle: {
    "zh-CN": "生成当前节点文档",
    "en-US": "Generate current node",
  },
  emptyTree: {
    "zh-CN": "SPEC 树尚未就绪",
    "en-US": "SPEC tree not ready",
  },
  generating: {
    "zh-CN": "生成中…",
    "en-US": "Generating…",
  },
  hintSelectFirst: {
    "zh-CN": "选中一个节点以单独生成",
    "en-US": "Select a node to generate it individually",
  },

  // —— spec-generation-perceived-performance / Task 4.3：三态终态文案 ——
  successNote: {
    "zh-CN": "文档已生成",
    "en-US": "Docs generated",
  },
  failureNote: {
    "zh-CN": "生成失败，请重试",
    "en-US": "Generation failed, please retry",
  },
  retry: {
    "zh-CN": "重试",
    "en-US": "Retry",
  },
  emptyResult: {
    "zh-CN": "本次生成未返回任何节点文档",
    "en-US": "This generation returned no node documents",
  },
} as const;

function t(locale: AppLocale, key: keyof typeof COPY): string {
  const lang = locale === "zh-CN" ? "zh-CN" : "en-US";
  return COPY[key][lang];
}

// ─── helpers ──────────────────────────────────────────────────────────────

function groupDocumentsByNode(
  documents: ReadonlyArray<BlueprintSpecDocument>
): Map<string, BlueprintSpecDocument[]> {
  const out = new Map<string, BlueprintSpecDocument[]>();
  for (const doc of documents) {
    const list = out.get(doc.nodeId);
    if (list) list.push(doc);
    else out.set(doc.nodeId, [doc]);
  }
  return out;
}

/**
 * 把 SpecDocumentTreeStats.byNodeId 的 documents 重新组织成 nodeId →
 * documents map，让 SpecTreeWorkbench 内部可以与 specDocuments prop 走同
 * 一条派生路径。
 */
function statsToDocsMap(
  stats: SpecDocumentTreeStats
): Map<string, BlueprintSpecDocument[]> {
  const out = new Map<string, BlueprintSpecDocument[]>();
  for (const [nodeId, nodeStats] of stats.byNodeId.entries()) {
    out.set(nodeId, [...nodeStats.documents]);
  }
  return out;
}

function pickDocByType(
  docs: ReadonlyArray<BlueprintSpecDocument> | undefined,
  type: BlueprintSpecDocumentType
): BlueprintSpecDocument | undefined {
  if (!docs) return undefined;
  // 按 createdAt 升序时,后者覆盖前者；这里选最后一份（即最新）。
  let last: BlueprintSpecDocument | undefined;
  for (const doc of docs) {
    if (doc.type === type) last = doc;
  }
  return last;
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

export const SpecTreeWorkbench: FC<SpecTreeWorkbenchProps> = ({
  jobId,
  job,
  specTree,
  specDocuments,
  locale,
  generating,
  onGenerateAll,
  onGenerateNode,
  // spec-generation-perceived-performance 新增（Task 4.1 引入，消费见 4.2/4.3）
  generationError,
  onRetry,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  // 实时 observing 流 → byNodeTitle map
  const reasoningEntries = useBlueprintRealtimeStore(
    s => s.agentReasoning.entries
  );
  const observingSnapshot = useMemo(
    () => parseSpecDocsObservingEntries(reasoningEntries),
    [reasoningEntries]
  );

  // ─── spec-generation-perceived-performance / Task 4.3 ────────────────────
  // 只读 specDocsProgress 派生进度，供 pending 态进度反馈层消费。仅读取、
  // 不订阅写入、不回写 store（满足单一真相源约束）。仅当 socket 进度处于
  // running / assembling 时给出 determinate 进度，否则交给反馈层退化为
  // indeterminate（progress = null）。对缺失 slice（如测试 mock）做防御。
  const specDocsProgress = useBlueprintRealtimeStore(s => s.specDocsProgress);
  const readonlyProgress = useMemo<{ processed: number; total: number } | null>(
    () => {
      if (!specDocsProgress) return null;
      const { batchStatus, processedCount, totalCount } = specDocsProgress;
      if (batchStatus === "running" || batchStatus === "assembling") {
        return { processed: processedCount, total: totalCount };
      }
      return null;
    },
    [specDocsProgress]
  );

  // 稳定 docs 按 nodeId 分组：
  // 优先使用 props.specDocuments（如果父级显式传入），否则走
  // deriveSpecDocumentTreeStats(job, specTree) 与既有 AutopilotRightRail
  // 共用同一份派生路径，避免维护两份 grouping。
  const docsByNodeId = useMemo(() => {
    if (specDocuments !== undefined) {
      return groupDocumentsByNode(specDocuments);
    }
    if (job === null || specTree === null) {
      return new Map<string, BlueprintSpecDocument[]>();
    }
    return statsToDocsMap(deriveSpecDocumentTreeStats(job, specTree));
  }, [specDocuments, job, specTree]);

  // 节点行点击 → toggle 展开 + 选中
  const onNodeRowClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setExpandedNodeIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const ctaAllLabel = t(locale, "ctaAll");
  const ctaSingleLabel = t(locale, "ctaSingle");
  const generatingLabel = t(locale, "generating");

  const generatingAll = generating === "all";
  const generatingSingle = generating === "single";

  // autopilot-spec-document-export Task 6.1：是否存在任意已生成文档，
  // 用于决定 "导出全部 SPEC" 按钮的 disabled 状态。
  const hasAnyDocs = useMemo(() => {
    for (const docs of docsByNodeId.values()) {
      if (docs.length > 0) return true;
    }
    return false;
  }, [docsByNodeId]);

  // ─── spec-generation-perceived-performance / Task 4.1 ────────────────────
  // 瞬态生成态脚手架。本任务只建立 props 与瞬态状态/派生字段；CTA 同步置入
  // 乐观标记与 deriveGenerationState 接线在 Task 4.2，按 phase 渲染反馈层在
  // Task 4.3。这些值在此处计算、留待后续任务消费，不改变当前渲染行为。

  // 瞬态乐观标记（点击 CTA 时同步置入，接线见 Task 4.2）。仅 UI，不入真相源。
  const [optimistic, setOptimistic] = useState<OptimisticMark | null>(null);

  // `now` 计时：仅用于推进超时判定（deriveGenerationState 的 `now` 入参），
  // 不承载任何业务数据。仅在存在乐观标记或父级 In_Flight_Lock 进行中时运行；
  // 组件卸载或离开进行中档（pending）时清理，避免计时器泄漏。
  const [now, setNow] = useState<number>(() => performance.now());
  const generationActive = optimistic !== null || generating !== null;
  useEffect(() => {
    if (!generationActive) {
      return;
    }
    // 进入进行中档时立即对齐一次，避免首帧使用过期 now。
    setNow(performance.now());
    const intervalId = globalThis.setInterval(() => {
      setNow(performance.now());
    }, 1000);
    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [generationActive]);

  // 权威投影派生：只读既有真相源（latestJob + rightRailView 派生层），
  // 供 Task 4.2 的 deriveGenerationState 消费，不引入第二套状态源。

  // authoritativeHasDocs ← 复用既有 hasAnyDocs（docsByNodeId 中存在任意非空文档）。
  const authoritativeHasDocs = hasAnyDocs;

  // authoritativeSpecTreeReady ← hasPersistedSpecTree 语义（specTree.nodes.length > 0）。
  const authoritativeSpecTreeReady = Boolean(specTree?.nodes?.length);

  // 当前权威文档计数与 job 版本信号，用于检测回写后"文档计数 / job 版本前进"。
  const authoritativeDocCount = useMemo(() => {
    let count = 0;
    for (const docs of docsByNodeId.values()) {
      count += docs.length;
    }
    return count;
  }, [docsByNodeId]);
  const authoritativeJobVersion = job?.version ?? null;

  // 生成发起时捕获的权威基线（文档计数 + job 版本）。基线在 CTA 点击置入乐观
  // 标记时由 Task 4.2 写入；在此仅建立载体。基线为空表示本会话尚未发起生成。
  const settledBaselineRef = useRef<{
    docCount: number;
    jobVersion: string | null;
  } | null>(null);

  // 记忆上次发起生成的范围（与单节点 nodeId），用于 failure 态重试入口以"相同
  // 范围"重新发起（满足 R2.7）。在 CTA 点击同步处理内写入；不入真相源。
  const lastGenerationRef = useRef<{
    scope: GenerationScope;
    nodeId?: string;
  } | null>(null);

  // authoritativeSettled ← 相对发起基线，文档计数或 job 版本是否已前进
  // （即本次请求结果是否已被权威投影确认）。基线为空时恒为 false（派生为 idle）。
  const authoritativeSettled = (() => {
    const baseline = settledBaselineRef.current;
    if (baseline === null) {
      return false;
    }
    return (
      authoritativeDocCount > baseline.docCount ||
      authoritativeJobVersion !== baseline.jobVersion
    );
  })();

  // ─── spec-generation-perceived-performance / Task 4.2 ────────────────────
  // 接入 deriveGenerationState：把父级 In_Flight_Lock、父级错误、瞬态乐观标记
  // 与权威投影派生折算为单一生成状态机 phase（idle|pending|success|failure|
  // empty）。本任务消费 phase 用于容器 data-state 与 CTA disabled 判定；按
  // phase 渲染反馈层 / 重试入口 / 空·成功态文案在 Task 4.3。
  const generationStateView = deriveGenerationState({
    inFlight: generating,
    error: generationError ?? null,
    optimistic,
    authoritativeHasDocs,
    authoritativeSpecTreeReady,
    authoritativeSettled,
    now,
  });
  const phase = generationStateView.phase;

  // 乐观 → 权威单帧交接：权威状态就绪（phase 离开 pending）后，于同一渲染帧内
  // 清除瞬态乐观标记，使乐观态与权威态并存不超过一帧、中间无 idle/空白帧。
  useEffect(() => {
    if (optimistic !== null && phase !== "pending") {
      setOptimistic(null);
    }
  }, [optimistic, phase]);

  // CTA disabled 统一以 phase 判定：pending 时所有 all/single 触发器同时 disabled。
  const ctaDisabledByPhase = phase === "pending";

  // CTA 点击同步处理：立即置入乐观标记 + 捕获权威基线（供 authoritativeSettled
  // 检测回写后"文档计数 / job 版本前进"），再调用父级回调。乐观标记在同步事件内
  // 写入，使派生 phase 在下一帧前即为 pending，不等待投影层传播。
  const handleGenerateAllClick = useCallback(() => {
    settledBaselineRef.current = {
      docCount: authoritativeDocCount,
      jobVersion: authoritativeJobVersion,
    };
    lastGenerationRef.current = { scope: "all" };
    setOptimistic({ scope: "all", startedAt: performance.now() });
    onGenerateAll();
  }, [authoritativeDocCount, authoritativeJobVersion, onGenerateAll]);

  const handleGenerateSingleClick = useCallback(() => {
    if (selectedNodeId === null) return;
    settledBaselineRef.current = {
      docCount: authoritativeDocCount,
      jobVersion: authoritativeJobVersion,
    };
    lastGenerationRef.current = { scope: "single", nodeId: selectedNodeId };
    setOptimistic({ scope: "single", startedAt: performance.now() });
    onGenerateNode(selectedNodeId);
  }, [
    authoritativeDocCount,
    authoritativeJobVersion,
    onGenerateNode,
    selectedNodeId,
  ]);

  // 失败重试：以"上次失败请求的范围"（及单节点 nodeId）经父级重新发起。
  // 仅当父级提供 onRetry 且记忆到上次发起范围时可用（缺省退化为不渲染入口）。
  const handleRetry = useCallback(() => {
    const last = lastGenerationRef.current;
    if (last === null || onRetry === undefined) return;
    onRetry(last.scope, last.nodeId);
  }, [onRetry]);

  if (!specTree || specTree.nodes.length === 0) {
    return (
      <div
        data-testid="spec-tree-workbench"
        data-state="empty"
        className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-3 py-3 text-xs font-semibold text-slate-500"
      >
        {t(locale, "emptyTree")}
      </div>
    );
  }

  return (
    <div
      data-testid="spec-tree-workbench"
      data-state={phase}
      data-generating={generating ?? "none"}
      className="space-y-3"
    >
      {/* 顶部双 CTA */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="spec-tree-workbench-cta-all"
          disabled={ctaDisabledByPhase}
          onClick={handleGenerateAllClick}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700 disabled:bg-slate-400"
        >
          {generatingAll ? generatingLabel : ctaAllLabel}
        </button>
        <button
          type="button"
          data-testid="spec-tree-workbench-cta-single"
          disabled={ctaDisabledByPhase || selectedNodeId === null}
          onClick={handleGenerateSingleClick}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
        >
          {generatingSingle ? generatingLabel : ctaSingleLabel}
        </button>
        {selectedNodeId === null ? (
          <span className="text-[10px] text-slate-400">
            {t(locale, "hintSelectFirst")}
          </span>
        ) : null}

        {/* autopilot-spec-document-export Task 6.1: 整树导出按钮 */}
        <BulkExportButton
          jobId={jobId}
          granularity="tree"
          disabled={!hasAnyDocs}
          testId="spec-tree-workbench-export-all"
          idleLabel="导出全部 SPEC"
        />
      </div>

      {/* ─── spec-generation-perceived-performance / Task 4.3：按 phase 渲染反馈层 ───
          pending → 进度反馈层；failure → 重试入口；empty → 空结果说明；
          success → 成功提示。三类终态均保留既有树/节点内容（下方 <ul> 不卸载、
          不清空），满足 R2.11「不 blank-out」。 */}
      {phase === "pending" ? (
        <SpecTreeProgressLayer
          locale={locale}
          scope={generationStateView.scope ?? "all"}
          progress={readonlyProgress}
        />
      ) : null}

      {phase === "failure" ? (
        <div
          data-testid="spec-tree-workbench-failure"
          role="alert"
          className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"
        >
          <span>{t(locale, "failureNote")}</span>
          {onRetry !== undefined && lastGenerationRef.current !== null ? (
            <button
              type="button"
              data-testid="spec-tree-workbench-retry"
              onClick={handleRetry}
              className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-bold text-amber-700 transition hover:bg-amber-100"
            >
              {t(locale, "retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      {phase === "empty" ? (
        <div
          data-testid="spec-tree-workbench-empty"
          className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-xs font-semibold text-slate-500"
        >
          {t(locale, "emptyResult")}
        </div>
      ) : null}

      {phase === "success" ? (
        <div
          data-testid="spec-tree-workbench-success"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700"
        >
          {t(locale, "successNote")}
        </div>
      ) : null}

      {/* 节点行列表 */}
      <ul
        data-testid="spec-tree-workbench-list"
        className="space-y-1 p-1.5"
      >
        {specTree.nodes.map(node => (
          <SpecTreeNodeRow
            key={node.id}
            jobId={jobId}
            node={node}
            locale={locale}
            isSelected={selectedNodeId === node.id}
            isExpanded={expandedNodeIds.has(node.id)}
            docs={docsByNodeId.get(node.id) ?? []}
            ephemeral={observingSnapshot.byNodeTitle.get(node.title)}
            onClick={onNodeRowClick}
          />
        ))}
      </ul>
    </div>
  );
};

// ─── 节点行子组件 ─────────────────────────────────────────────────────────

interface SpecTreeNodeRowProps {
  /**
   * 蓝图 job UUID，向下传给 SpecDocPreviewBlock 用于触发导出 API。
   */
  jobId: string;
  node: BlueprintSpecTreeNode;
  /**
   * 当前界面 locale，用于 node.title 通过 blueprintCopy 走中英文翻译表。
   * 同时 chip / type 标识保持英文（结构化标识符不翻译）。
   */
  locale: AppLocale;
  isSelected: boolean;
  isExpanded: boolean;
  docs: ReadonlyArray<BlueprintSpecDocument>;
  ephemeral: "generating" | "fallback" | undefined;
  onClick: (nodeId: string) => void;
}

const SpecTreeNodeRow: FC<SpecTreeNodeRowProps> = ({
  jobId,
  node,
  locale,
  isSelected,
  isExpanded,
  docs,
  ephemeral,
  onClick,
}) => {
  const chipDescriptor = useMemo(
    () => deriveSpecTreeChip(docs, ephemeral),
    [docs, ephemeral]
  );

  return (
    <li
      data-testid="spec-tree-workbench-row"
      data-node-id={node.id}
      data-selected={isSelected ? "true" : "false"}
      data-expanded={isExpanded ? "true" : "false"}
      className={
        "rounded-md transition " +
        (isSelected ? "bg-slate-50" : "hover:bg-slate-50/60")
      }
    >
      <button
        type="button"
        onClick={() => onClick(node.id)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="text-[10px] font-mono text-slate-400">
          {isExpanded ? "▼" : "▶"}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-800">
          {blueprintCopy(node.title, locale)}
        </span>
        <span className="shrink-0 text-[9px] font-mono text-slate-400">
          · {String(node.type).replace(/_/g, " ")}
        </span>
        <SpecTreeChip descriptor={chipDescriptor} />
      </button>

      {isExpanded ? (
        <div
          data-testid="spec-tree-workbench-row-expanded"
          className="space-y-1.5 px-2 pb-2"
        >
          {DOC_TYPE_ORDER.map(type => (
            <SpecDocPreviewBlock
              key={type}
              type={type}
              jobId={jobId}
              document={pickDocByType(docs, type)}
            />
          ))}
          {/* autopilot-spec-document-export Task 6.1: 节点级导出按钮 */}
          <div className="pt-1">
            <BulkExportButton
              jobId={jobId}
              granularity="node"
              nodeId={node.id}
              disabled={docs.length === 0}
              testId="spec-tree-node-export-button"
              idleLabel="导出本节点 .zip"
            />
          </div>
        </div>
      ) : null}
    </li>
  );
};

export default SpecTreeWorkbench;

// ─── BulkExportButton ────────────────────────────────────────────────────

/**
 * autopilot-spec-document-export Task 6.1：节点级 / 整树批量导出按钮。
 *
 * - granularity="node" 必须配合 nodeId
 * - granularity="tree" 不需要 nodeId
 * - 状态机：idle | downloading | error
 * - 失败时 inline 显示 ⚠ + tooltip，按钮恢复 enabled
 */
interface BulkExportButtonProps {
  jobId: string;
  granularity: "node" | "tree";
  nodeId?: string;
  disabled: boolean;
  testId: string;
  idleLabel: string;
}

const BulkExportButton: FC<BulkExportButtonProps> = ({
  jobId,
  granularity,
  nodeId,
  disabled,
  testId,
  idleLabel,
}) => {
  const [state, setState] = useState<"idle" | "downloading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const downloading = state === "downloading";
  const buttonDisabled = disabled || downloading;

  const onClick = async () => {
    if (buttonDisabled) return;
    setState("downloading");
    setErrorMessage(null);
    try {
      await exportSpecDocumentsToDownload({
        jobId,
        granularity,
        nodeId,
      });
      setState("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message.slice(0, 120));
      setState("error");
    }
  };

  const label = downloading
    ? "导出中..."
    : state === "error"
      ? `${idleLabel} ⚠`
      : idleLabel;

  return (
    <button
      type="button"
      data-testid={testId}
      data-export-state={state}
      disabled={buttonDisabled}
      onClick={onClick}
      title={errorMessage ?? idleLabel}
      className={
        "rounded-md border px-2.5 py-1 text-[11px] font-bold transition " +
        (buttonDisabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"
          : state === "error"
            ? "cursor-pointer border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            : "cursor-pointer border-slate-300 bg-white text-slate-700 hover:bg-slate-50")
      }
    >
      {label}
    </button>
  );
};
