import React from "react";
import { Download, FileText, GitBranch, Layers, PackageCheck, ScrollText, Sparkles, Workflow, X } from "lucide-react";
import type { Artifact, V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { parseReportSections } from "./parse-report-sections";
import { MarkdownRenderer } from "@/pages/autopilot/right-rail/streaming-doc/MarkdownRenderer";
import { DEFAULT_LOCALE } from "@/lib/locale";

/**
 * 交付物面板（SettingsDialog 同构外壳）。
 * clear 后一键生成 → 左侧交付物分类导航 + 右侧查看器(报告分段/规格树/文档/提示词包/架构图/交接包)。
 * 报告分类即第②项的结构化阅读器(分段 + 证据链)。
 */
type CategoryId = "report" | "spec_tree" | "docs" | "prompt" | "arch" | "handoff";

const CATEGORY_META: Record<CategoryId, { label: string; icon: React.ReactNode }> = {
  report: { label: "推演报告", icon: <ScrollText className="h-4 w-4" /> },
  spec_tree: { label: "规格树", icon: <GitBranch className="h-4 w-4" /> },
  docs: { label: "规格文档", icon: <FileText className="h-4 w-4" /> },
  prompt: { label: "提示词包", icon: <Sparkles className="h-4 w-4" /> },
  arch: { label: "架构图", icon: <Workflow className="h-4 w-4" /> },
  handoff: { label: "工程交接", icon: <PackageCheck className="h-4 w-4" /> },
};
const CATEGORY_ORDER: CategoryId[] = ["report", "spec_tree", "docs", "prompt", "arch", "handoff"];

function trustedArtifacts(state: V5SessionState): Artifact[] {
  const stale = new Set(state.staleArtifactIds || []);
  return (state.artifacts || []).filter(
    (a) => (a.trustLevel === "gated_pass" || a.trustLevel === "audited") && !stale.has(a.id)
  );
}

function categoryOf(a: Artifact): CategoryId | null {
  const cap = a.producedBy?.capabilityId;
  if (a.kind === "report") return "report";
  if (a.kind === "spec_tree") return "spec_tree";
  if (cap === "instruction.package") return "prompt";
  if (cap === "handoff.package") return "handoff";
  if (cap === "outcome.visualize") return "arch";
  if (cap === "document.draft" || cap === "task.write" || a.kind === "doc") return "docs";
  return null;
}

function extractMermaid(content: string): string | null {
  const m = content.match(/```mermaid\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : null;
}

// SPEC 树正文前缀里夹着内部门控字样(C_PROMPT:built · C_REDACT… / 【SPEC Tree · template】),
// 这些是机制审计行,不该展示给用户;剥掉后保留 ├─/└─ 树形,交给等宽 <pre> 渲染。
function cleanSpecTree(content: string): string {
  return content
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^C_PROMPT\s*:/.test(t)) return false;
      if (/^【\s*SPEC\s*Tree/i.test(t)) return false;
      return true;
    })
    .join("\n")
    .trim();
}

export function DeliverablesPanel({
  open,
  onClose,
  sessionState,
  isRunning,
  onGenerate,
  onExportMd,
  onEvidenceRefClick,
}: {
  open: boolean;
  onClose: () => void;
  sessionState: V5SessionState;
  isRunning: boolean;
  onGenerate: () => void;
  onExportMd: () => void;
  onEvidenceRefClick?: (artifactId: string) => void;
}) {
  const grouped = React.useMemo(() => {
    const map = new Map<CategoryId, Artifact[]>();
    for (const a of trustedArtifacts(sessionState)) {
      const c = categoryOf(a);
      if (!c) continue;
      const list = map.get(c) ?? [];
      list.push(a);
      map.set(c, list);
    }
    return map;
  }, [sessionState]);

  const available = CATEGORY_ORDER.filter((c) => (grouped.get(c)?.length ?? 0) > 0);
  const [active, setActive] = React.useState<CategoryId>("report");
  React.useEffect(() => {
    if (open && available.length > 0) {
      // Prefer "report" when opening the delivery dialog (e.g. from "查看报告" terminal action)
      if (available.includes("report")) {
        setActive("report");
      } else if (!available.includes(active)) {
        setActive(available[0]);
      }
    }
  }, [open, available, active]);

  if (!open) return null;

  const isClear = sessionState.goal?.status === "clear";
  const activeArtifact = (grouped.get(active) ?? []).slice(-1)[0];

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[81] flex items-center justify-center p-4" onClick={onClose}>
        <div
          className="relative flex h-[min(86vh,760px)] w-[min(96vw,1100px)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgb(15_23_42/0.28)]"
          data-testid="sliderule-deliverables-panel"
          role="dialog"
          aria-label="交付物"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-slate-900">交付物</h3>
              <span className="text-[11px] text-slate-400">推演收敛后的可交付产物</span>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              data-testid="sliderule-deliverables-close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {available.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
              <Layers className="h-10 w-10 text-slate-300" />
              <p className="text-sm font-semibold text-slate-600">
                {isClear ? "推演已收敛 —— 可一键生成交付物" : "推演收敛(clear)后可生成交付物"}
              </p>
              <p className="max-w-sm text-xs text-slate-400">
                交付物含:规格树 · 需求/设计/任务文档 · 提示词包 · 架构图 · 工程交接包。
              </p>
              {isClear && (
                <button
                  onClick={onGenerate}
                  disabled={isRunning}
                  className="mt-1 flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:opacity-40"
                  data-testid="sliderule-deliverables-generate"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isRunning ? "生成中…" : "生成交付物"}
                </button>
              )}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <nav className="flex w-[180px] shrink-0 flex-col gap-1 border-r border-slate-200 bg-slate-50/70 p-3">
                {available.map((c) => (
                  <button
                    key={c}
                    onClick={() => setActive(c)}
                    data-testid={`sliderule-deliverables-nav-${c}`}
                    className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-semibold transition ${
                      active === c ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-white hover:text-slate-800"
                    }`}
                  >
                    {CATEGORY_META[c].icon}
                    {CATEGORY_META[c].label}
                  </button>
                ))}
              </nav>
              <div className="min-w-0 flex-1 overflow-y-auto px-6 py-5" data-testid="sliderule-deliverables-content">
                {activeArtifact ? (
                  <DeliverableViewer
                    category={active}
                    artifact={activeArtifact}
                    onEvidenceRefClick={onEvidenceRefClick}
                  />
                ) : (
                  <p className="text-sm text-slate-400">该分类暂无内容</p>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <span className="text-[11px] text-slate-400">
              {isClear ? "已收敛 · 可生成 / 重新生成" : "未收敛"}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={onExportMd}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50"
                data-testid="sliderule-deliverables-export"
              >
                <Download className="h-3.5 w-3.5" /> 导出 MD
              </button>
              {isClear && (
                <button
                  onClick={onGenerate}
                  disabled={isRunning}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-[13px] font-bold text-white transition hover:bg-indigo-500 disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {available.length > 0 ? "重新生成" : "生成交付物"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function DeliverableViewer({
  category,
  artifact,
  onEvidenceRefClick,
}: {
  category: CategoryId;
  artifact: Artifact;
  onEvidenceRefClick?: (artifactId: string) => void;
}) {
  const content = String(artifact.content || "");

  if (category === "report") {
    const sections = parseReportSections(artifact);
    return (
      <div className="space-y-4">
        <h2 className="text-base font-bold text-slate-900">{artifact.title || "可行性报告"}</h2>
        {sections.map((sec) => (
          <section key={sec.id} className="border-b border-slate-100 pb-4 last:border-0">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{sec.label}</h3>
            {sec.label.includes('多角色立场') ? (
              <div className="mt-2 space-y-3">
                {(() => {
                  const lines = sec.body.trim().split('\n').filter(Boolean);
                  const roles: Array<{role: string, content: string}> = [];
                  let convergence = '';
                  let dissent = '';
                  lines.forEach(line => {
                    const roleMatch = line.match(/^\s*-\s*([^：:]+)：(.+)$/);
                    if (roleMatch) {
                      roles.push({ role: roleMatch[1].trim(), content: roleMatch[2].trim() });
                    } else if (line.includes('收敛分')) {
                      convergence = line.trim();
                    } else if (line.includes('保留异议') || line.includes('异议')) {
                      dissent = line.trim();
                    }
                  });
                  return (
                    <>
                      {roles.length > 0 && (
                        <div className="grid grid-cols-1 gap-2">
                          {roles.map((r, idx) => (
                            <div key={idx} className="rounded border border-slate-200 bg-slate-50 p-2 text-[12px]">
                              <div className="font-semibold text-emerald-700">{r.role} · 立场</div>
                              <div className="mt-1 whitespace-pre-wrap text-slate-700">{r.content}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      {convergence && <div className="text-[12px] text-slate-600 font-medium">{convergence}</div>}
                      {dissent && <div className="text-[12px] text-amber-700">{dissent}</div>}
                    </>
                  );
                })()}
              </div>
            ) : sec.body.trim() ? (
              <div className="mt-2 text-[13px] leading-relaxed text-slate-700">
                <MarkdownRenderer markdown={sec.body.trim()} isStreaming={false} locale={DEFAULT_LOCALE} />
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-slate-400">（空）</p>
            )}
            {sec.evidenceRefs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {sec.evidenceRefs.map((refId) => (
                  <button
                    key={refId}
                    onClick={() => onEvidenceRefClick?.(refId)}
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    证据 {refId}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    );
  }

  if (category === "arch") {
    const mermaid = extractMermaid(content);
    return (
      <div className="space-y-2">
        <h2 className="text-base font-bold text-slate-900">{artifact.title || "架构图"}</h2>
        <p className="text-[11px] text-slate-400">Mermaid 源码（在支持 Mermaid 的查看器中渲染为图）</p>
        <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-700">
          {mermaid || content || "（空）"}
        </pre>
      </div>
    );
  }

  if (category === "spec_tree") {
    const tree = cleanSpecTree(content);
    return (
      <div className="space-y-2">
        <h2 className="text-base font-bold text-slate-900">{artifact.title || "规格树"}</h2>
        <pre className="overflow-x-auto whitespace-pre rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] leading-relaxed text-slate-700">
          {tree || "（空）"}
        </pre>
      </div>
    );
  }

  // docs / prompt / handoff: Markdown 渲染(LLM/模板输出多为 markdown)
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-slate-700">
      <h2 className="text-base font-bold text-slate-900">{artifact.title || CATEGORY_META[category].label}</h2>
      {content.trim() ? (
        <MarkdownRenderer markdown={content.trim()} isStreaming={false} locale={DEFAULT_LOCALE} />
      ) : (
        <p className="text-slate-400">（空）</p>
      )}
    </div>
  );
}
