/**
 * AppBundleScreen — 六系统发布证据看板（默认视图）
 *
 * 无激活 Skill 时展示，汇总所有系统的证据状态：
 *   - 六系统证据卡片（evidencePresent + evidenceRef/artifactId 证据链接）
 *   - 被闸拦截时整面切 GateBlockedPanel（人话原因 + 修复 CTA，E27）
 *   - 闭环元信息（closureHash · stableDigest · generatedAt · versionPins）
 *   - 五系统模型 appbundle 段的绑定（pageBindings/roleRefs/dataModelRefs，
 *     交叉引用解析到 page/workflow/rbac/datamodel，未解析引用标红）
 * 是整个 SlideRuleStudio 的"主页"进度锚点。
 */

import React, { useMemo, useState } from "react";
import { AppRuntimeScreen } from "../live-runtime/AppRuntimeScreen";
import { SystemLinkageGraph } from "./SystemLinkageGraph";
import { GateBlockedPanel } from "./GateBlockedPanel";
import { MermaidDiagram } from "../MermaidDiagram";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import {
  type FiveSystemModel,
  type RefResolution,
  deriveSystemLinkageGraph,
  evidenceSourceOf,
  linkageToMermaid,
  resolveEntityRef,
  resolvePageRef,
  resolveRoleRef,
  resolveWorkflowRef,
} from "./five-system-model";

interface AppBundleScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** 解析出的五系统模型（appbundle 段绑定 + 各段交叉引用目标）。 */
  model?: FiveSystemModel | null;
  /** 运行应用（浏览器运行时）状态的持久化命名空间 */
  sessionId?: string;
  /** 运行应用的标题（话题名） */
  appTitle?: string;
  isActive?: boolean;
  className?: string;
}

const SKILL_META: Array<{
  key: string;
  label: string;
  desc: string;
  color: string;
  dot: string;
}> = [
  { key: "datamodel", label: "DataModel", desc: "实体字段 · SSOT", color: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-400" },
  { key: "rbac", label: "RBAC", desc: "角色 · 权限 · 菜单", color: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-400" },
  { key: "workflow", label: "Workflow", desc: "流程 · 审批链", color: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-400" },
  { key: "page", label: "Page", desc: "页面 · 字段绑定", color: "bg-teal-50 text-teal-700 ring-teal-200", dot: "bg-teal-400" },
  { key: "aigc", label: "AIGC", desc: "Prompt · 触发条件", color: "bg-pink-50 text-pink-700 ring-pink-200", dot: "bg-pink-400" },
  { key: "appbundle", label: "AppBundle", desc: "发布闭环 · 版本钉扎", color: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-400" },
];

function BindingChip({ res }: { res: RefResolution }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
        res.resolved
          ? "bg-[#e9edf2] text-stone-700"
          : "bg-red-50 text-red-600 ring-1 ring-red-200"
      }`}
    >
      {res.resolved ? res.label : `✗ ${res.label}`}
    </span>
  );
}

export function AppBundleScreen({
  publishClosure,
  model,
  sessionId = "sliderule-v51-product",
  appTitle,
  isActive = false,
  className = "",
}: AppBundleScreenProps) {
  // 运行应用（JSON 渲染的"真系统"）：模型带页面+实体时可用
  const [screenMode, setScreenMode] = useState<"board" | "graph" | "app">("board");
  // 联动图样式：Mermaid 整体架构图（默认，自动布线）⟷ React Flow 交互图
  const [graphStyle, setGraphStyle] = useState<"mermaid" | "flow">("mermaid");
  // 架构图缩放：适宽看全貌（默认）⟷ 原始尺寸滚动看细节
  const [archFit, setArchFit] = useState(true);
  const canRunApp = (model?.page?.pages?.length ?? 0) > 0 && (model?.datamodel?.entities?.length ?? 0) > 0;
  // 联动图：至少两个非空系统段才有联动可画
  const canLinkage = useMemo(() => deriveSystemLinkageGraph(model) !== null, [model]);
  const archMermaid = useMemo(() => linkageToMermaid(model), [model]);
  type SkillKey = "datamodel" | "rbac" | "workflow" | "page" | "aigc" | "appbundle";
  const perSkill = (publishClosure?.perSkillEvidence ?? {}) as NonNullable<
    PublishClosureSummary["perSkillEvidence"]
  >;
  const totalPresent = publishClosure?.evidencePresentCount ?? 0;
  const totalSkills = publishClosure?.skillCount ?? 6;
  const blocked = publishClosure?.blocked ?? true;
  const allDone = !blocked && totalPresent >= totalSkills;

  const bundle = model?.appbundle;
  const bindings = useMemo(() => {
    if (!bundle) return null;
    return {
      pages: (bundle.pageBindings ?? []).map((b) => ({
        page: resolvePageRef(b.pageRef, model),
        workflow: resolveWorkflowRef(b.workflowRef, model),
      })),
      roles: (bundle.roleRefs ?? []).map((r) => resolveRoleRef(r, model)),
      entities: (bundle.dataModelRefs ?? []).map((e) => resolveEntityRef(e, model)),
    };
  }, [bundle, model]);
  const hasBindings =
    !!bindings &&
    (bindings.pages.length > 0 || bindings.roles.length > 0 || bindings.entities.length > 0);

  // 看板级来源徽章：取首个可识别来源的证据条目（同一话题六证据同路径产出）。
  const boardSource = useMemo(() => {
    for (const key of Object.keys(perSkill) as SkillKey[]) {
      const source = evidenceSourceOf(perSkill[key]);
      if (source) return source;
    }
    return null;
  }, [perSkill]);

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="appBundle"
      data-active={isActive}
    >
      {/* Header —— 被闸拦截时整面让位给极简错误页（E27 用户定稿风格），
          看板头条/进度条一并隐藏 */}
      {!(publishClosure && blocked) && (
      <>
      <div className="flex items-center gap-2 border-b border-[#e8eaee] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">AppBundle</span>
        <span className="text-xs text-stone-400">发布证据看板</span>
        <div className="ml-auto flex items-center gap-2">
          {(canRunApp || canLinkage) && (
            <div
              className="flex items-center gap-0.5 rounded-full bg-[#e9edf2] p-0.5 ring-1 ring-[#e5e7eb]/80"
              data-testid="appbundle-mode-toggle"
            >
              {([
                { id: "board" as const, label: "证据看板" },
                ...(canLinkage ? [{ id: "graph" as const, label: "联动图" }] : []),
                ...(canRunApp ? [{ id: "app" as const, label: "运行应用" }] : []),
              ]).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`appbundle-mode-${id}`}
                  onClick={() => setScreenMode(id)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    screenMode === id
                      ? "bg-white text-stone-800 shadow-sm"
                      : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          {boardSource && (
            <span
              data-testid={`evidence-source-${boardSource.kind}`}
              className={
                boardSource.kind === "llm"
                  ? "rounded-full bg-[#e6f4ff] px-2 py-0.5 text-[10px] font-medium text-[#0958d9]"
                  : "rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600"
              }
              title={
                boardSource.kind === "llm"
                  ? "本话题为新颖意图，五系统模型由真实 LLM 生成并通过结构闸"
                  : "本话题命中内置演示域（确定性样板，秒出、不调 LLM）"
              }
            >
              {boardSource.label}
            </span>
          )}
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
              allDone
                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                : "bg-amber-50 text-amber-700 ring-amber-200"
            }`}
          >
            {allDone ? "closed" : "blocked"} {totalPresent}/{totalSkills}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 w-full bg-[#e9edf2]">
        <div
          className={`h-1 transition-all duration-700 ${allDone ? "bg-emerald-400" : "bg-amber-400"}`}
          style={{ width: `${totalSkills > 0 ? Math.round((totalPresent / totalSkills) * 100) : 0}%` }}
        />
      </div>
      </>
      )}

      {screenMode === "app" && canRunApp && model ? (
        <div className="min-h-0 flex-1">
          <AppRuntimeScreen model={model} sessionId={sessionId} appTitle={appTitle} />
        </div>
      ) : screenMode === "graph" && canLinkage ? (
        <div className="relative min-h-0 flex-1">
          <div className="absolute right-3 top-2 z-10 flex items-center gap-1.5">
            {graphStyle === "mermaid" && archMermaid && (
              <button
                type="button"
                data-testid="appbundle-arch-fit"
                onClick={() => setArchFit((v) => !v)}
                className="rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-medium text-stone-500 shadow-sm ring-1 ring-[#e5e7eb] transition-colors hover:text-stone-700"
                title={archFit ? "切到原始尺寸，滚动查看细节" : "缩放到容器宽度，看整体结构"}
              >
                {archFit ? "原始尺寸" : "适宽全貌"}
              </button>
            )}
            <div
              className="flex items-center gap-0.5 rounded-full bg-white/95 p-0.5 shadow-sm ring-1 ring-[#e5e7eb]"
              data-testid="appbundle-graph-style"
            >
              {([
                { id: "mermaid" as const, label: "架构图" },
                { id: "flow" as const, label: "交互图" },
              ]).map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`appbundle-graph-${id}`}
                  onClick={() => setGraphStyle(id)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    graphStyle === id
                      ? "bg-[#e9edf2] text-stone-800"
                      : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {graphStyle === "mermaid" && archMermaid ? (
            <div className="h-full w-full overflow-auto p-4" data-testid="appbundle-arch-mermaid">
              <MermaidDiagram chart={archMermaid} fit={archFit} />
              <div className="mt-2 text-center text-[10px] text-stone-400">
                五系统整体架构（Mermaid 自动布线）· 连线标签 = 引用语义 ·{" "}
                {archFit ? "适宽全貌，切「原始尺寸」看细节" : "原始尺寸，滚动查看"}
              </div>
            </div>
          ) : (
            <SystemLinkageGraph model={model} />
          )}
        </div>
      ) : publishClosure && blocked ? (
        // E27：被闸拦截 → 整面人话错误页（原因翻译 + 修复 CTA + 技术详情收纳），
        // 不再裸奔工程码。fail-closed 语义不变，只是讲清楚。
        <div className="min-h-0 flex-1 overflow-auto">
          <GateBlockedPanel publishClosure={publishClosure} />
        </div>
      ) : (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Six skill cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SKILL_META.map(({ key, label, desc, color, dot }) => {
            const ev = perSkill[key as SkillKey];
            const present = ev?.evidencePresent === true;
            return (
              <div
                key={key}
                className={`rounded-md border p-4 transition-all ${
                  present
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-[#e5e7eb] bg-white opacity-60"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${present ? "bg-emerald-400" : dot}`} />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                      present ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : color
                    }`}
                  >
                    {label}
                  </span>
                  <span className="ml-auto text-sm">{present ? "✓" : "○"}</span>
                </div>
                <div className="mt-2 text-[11px] text-stone-500">{desc}</div>
                {present && ev?.summary && (
                  <div className="mt-1.5 line-clamp-2 text-[10px] text-stone-400">{ev.summary}</div>
                )}
                {present && (ev?.artifactId || ev?.evidenceRef) && (
                  <div
                    className="mt-1.5 truncate font-mono text-[9px] text-stone-400"
                    title={ev?.evidenceRef || ev?.artifactId}
                  >
                    {ev?.artifactId || ev?.evidenceRef}
                    {ev?.digest ? ` · ${ev.digest.slice(0, 8)}` : ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Model bindings — appbundle 段（pageBindings / roleRefs / dataModelRefs） */}
        {hasBindings && bindings && (
          <div
            className="mt-3 rounded-md border border-[#e5e7eb] bg-[#eef0f4]/60 p-3"
            data-testid="appbundle-bindings"
          >
            <div className="text-[11px] font-semibold text-stone-600">应用装配绑定</div>
            <div className="mt-2 space-y-2 text-[11px]">
              {bindings.pages.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-24 shrink-0 text-stone-400">页面 ↔ 流程</span>
                  {bindings.pages.map((b, i) => (
                    <span key={`${b.page.ref}-${i}`} className="inline-flex items-center gap-1">
                      <BindingChip res={b.page} />
                      <span className="text-stone-300">→</span>
                      <BindingChip res={b.workflow} />
                    </span>
                  ))}
                </div>
              )}
              {bindings.roles.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-24 shrink-0 text-stone-400">角色（RBAC）</span>
                  {bindings.roles.map((r) => (
                    <BindingChip key={r.ref} res={r} />
                  ))}
                </div>
              )}
              {bindings.entities.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="w-24 shrink-0 text-stone-400">实体（DataModel）</span>
                  {bindings.entities.map((e) => (
                    <BindingChip key={e.ref} res={e} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 系统不变式 — appbundle.invariants（总装约束层）：陈述性约束 + 落地引用，
            门禁已保证 refs 可解析；此处如实罗列，refs 用等宽体便于对照模型。 */}
        {((bundle?.invariants?.length ?? 0) > 0 || bundle?.invariantNotes) && (
          <div
            className="mt-3 rounded-md border border-[#e5e7eb] bg-white p-3"
            data-testid="appbundle-invariants"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-stone-600">系统不变式</span>
              <span className="text-[10px] text-stone-400">
                {bundle!.invariants?.length ?? 0} 条 · 必须恒真的总装约束
              </span>
            </div>
            {/* 修复/剔除留痕（v5_model_repair）：诚实透出，不静默 */}
            {bundle?.invariantNotes &&
              ((bundle.invariantNotes.repaired?.length ?? 0) > 0 ||
                (bundle.invariantNotes.dropped?.length ?? 0) > 0) && (
                <div
                  className="mt-1.5 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 ring-1 ring-amber-200"
                  data-testid="appbundle-invariant-notes"
                >
                  {(bundle.invariantNotes.repaired?.length ?? 0) > 0 && (
                    <span>
                      自动修复 {bundle.invariantNotes.repaired!.length} 处引用
                      （{bundle.invariantNotes.repaired!
                        .map((r) => `${r.from} → ${r.to}`)
                        .join("；")}）
                    </span>
                  )}
                  {(bundle.invariantNotes.dropped?.length ?? 0) > 0 && (
                    <span className="ml-1">
                      剔除 {bundle.invariantNotes.dropped!.length} 条引用无效的不变式
                      （{bundle.invariantNotes.dropped!
                        .map((d) => d.invariantId || d.statement || "")
                        .filter(Boolean)
                        .join("；")}）
                    </span>
                  )}
                </div>
              )}
            <ul className="mt-2 space-y-1.5">
              {(bundle!.invariants ?? []).map((inv, i) => (
                <li
                  key={inv.id || i}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]"
                  data-testid={`appbundle-invariant-${inv.id || i}`}
                >
                  <span className="text-stone-300">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-stone-700">{inv.statement || inv.id}</span>
                  {(inv.systems ?? []).map((s) => (
                    <span
                      key={s}
                      className="rounded-full bg-[#e9edf2] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-stone-500"
                    >
                      {s}
                    </span>
                  ))}
                  {(inv.refs ?? []).map((r) => (
                    <span key={r} className="font-mono text-[9px] text-stone-400">
                      {r}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 展示层修复留痕（E37，v5_model_repair）：图表/统计卡声明的近邻改写
            与枚举违规剔除——诚实透出，不静默。 */}
        {bundle?.presentationNotes &&
          ((bundle.presentationNotes.repaired?.length ?? 0) > 0 ||
            (bundle.presentationNotes.droppedCharts?.length ?? 0) > 0 ||
            (bundle.presentationNotes.droppedStats?.length ?? 0) > 0 ||
            (bundle.presentationNotes.clearedFormats?.length ?? 0) > 0 ||
            (bundle.presentationNotes.clearedIdentity?.length ?? 0) > 0) && (
            <div
              className="mt-3 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 ring-1 ring-amber-200"
              data-testid="appbundle-presentation-notes"
            >
              <span className="font-semibold">展示层自动修复：</span>
              {(bundle.presentationNotes.repaired?.length ?? 0) > 0 && (
                <span>
                  修复 {bundle.presentationNotes.repaired!.length} 处字段引用
                  （{bundle.presentationNotes.repaired!
                    .map((r) => `${r.from} → ${r.to}`)
                    .join("；")}）
                </span>
              )}
              {(bundle.presentationNotes.droppedCharts?.length ?? 0) > 0 && (
                <span className="ml-1">
                  剔除 {bundle.presentationNotes.droppedCharts!.length} 个无法渲染的图表
                  （{bundle.presentationNotes.droppedCharts!
                    .map((d) => d.chartId || "")
                    .filter(Boolean)
                    .join("；")}）
                </span>
              )}
              {(bundle.presentationNotes.droppedStats?.length ?? 0) > 0 && (
                <span className="ml-1">
                  剔除 {bundle.presentationNotes.droppedStats!.length} 个无法渲染的统计卡
                  （{bundle.presentationNotes.droppedStats!
                    .map((d) => d.statId || "")
                    .filter(Boolean)
                    .join("；")}）
                </span>
              )}
              {(bundle.presentationNotes.clearedFormats?.length ?? 0) > 0 && (
                <span className="ml-1">
                  清除 {bundle.presentationNotes.clearedFormats!.length} 个非法格式声明（回默认渲染）
                </span>
              )}
              {(bundle.presentationNotes.clearedIdentity?.length ?? 0) > 0 && (
                <span className="ml-1">
                  清除 {bundle.presentationNotes.clearedIdentity!.length} 个非法身份声明（回默认主题）
                </span>
              )}
            </div>
          )}

        {/* Closure meta */}
        {publishClosure && (publishClosure.closureHash || publishClosure.stableDigest || publishClosure.generatedAt) && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono text-stone-400">
            {publishClosure.closureHash && <span>closureHash={publishClosure.closureHash}</span>}
            {publishClosure.stableDigest && <span>digest={publishClosure.stableDigest}</span>}
            {publishClosure.generatedAt && <span>generatedAt={publishClosure.generatedAt}</span>}
            <span>versionPins={publishClosure.versionPinsChecked ? "checked" : "unchecked"}</span>
          </div>
        )}

        {!publishClosure && (
          <div className="mt-6 text-center text-xs text-stone-300">
            发送应用意图后，SlideRule 将逐系统填充发布证据
          </div>
        )}
      </div>
      )}
    </div>
  );
}
