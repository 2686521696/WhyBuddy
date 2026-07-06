/**
 * AppBundleScreen — 六系统发布证据看板（默认视图）
 *
 * 无激活 Skill 时展示，汇总所有系统的证据状态：
 *   - 六系统证据卡片（evidencePresent + evidenceRef/artifactId 证据链接）
 *   - 发布阻塞项（topBlockers：code/path/affectedSkill，fail-closed 如实展示）
 *   - 闭环元信息（closureHash · stableDigest · generatedAt · versionPins）
 *   - 五系统模型 appbundle 段的绑定（pageBindings/roleRefs/dataModelRefs，
 *     交叉引用解析到 page/workflow/rbac/datamodel，未解析引用标红）
 * 是整个 SlideRuleStudio 的"主页"进度锚点。
 */

import React, { useMemo } from "react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import {
  type FiveSystemModel,
  type RefResolution,
  resolveEntityRef,
  resolvePageRef,
  resolveRoleRef,
  resolveWorkflowRef,
} from "./five-system-model";

interface AppBundleScreenProps {
  publishClosure?: PublishClosureSummary | null;
  /** 解析出的五系统模型（appbundle 段绑定 + 各段交叉引用目标）。 */
  model?: FiveSystemModel | null;
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
          ? "bg-[#F0EDE5] text-stone-700"
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
  isActive = false,
  className = "",
}: AppBundleScreenProps) {
  type SkillKey = "datamodel" | "rbac" | "workflow" | "page" | "aigc" | "appbundle";
  const perSkill = (publishClosure?.perSkillEvidence ?? {}) as NonNullable<
    PublishClosureSummary["perSkillEvidence"]
  >;
  const totalPresent = publishClosure?.evidencePresentCount ?? 0;
  const totalSkills = publishClosure?.skillCount ?? 6;
  const blocked = publishClosure?.blocked ?? true;
  const allDone = !blocked && totalPresent >= totalSkills;
  const topBlockers = publishClosure?.topBlockers ?? [];

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

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="appBundle"
      data-active={isActive}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-[#EFEBE2] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">AppBundle</span>
        <span className="text-xs text-stone-400">发布证据看板</span>
        <div className="ml-auto flex items-center gap-2">
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
      <div className="h-1 w-full bg-[#F0EDE5]">
        <div
          className={`h-1 transition-all duration-700 ${allDone ? "bg-emerald-400" : "bg-amber-400"}`}
          style={{ width: `${totalSkills > 0 ? Math.round((totalPresent / totalSkills) * 100) : 0}%` }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Blockers — fail-closed 如实展示 */}
        {blocked && topBlockers.length > 0 && (
          <div
            className="mb-3 rounded-xl border border-red-200 bg-red-50/60 p-3"
            data-testid="appbundle-blockers"
          >
            <div className="text-[11px] font-semibold text-red-700">
              发布阻塞项 · {publishClosure?.blockerCount ?? topBlockers.length}
            </div>
            <ul className="mt-1.5 space-y-1">
              {topBlockers.map((b, i) => (
                <li key={`${b.code}-${i}`} className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono font-medium text-red-700">
                    {b.code}
                  </span>
                  {b.affectedSkill && (
                    <span className="rounded bg-white px-1.5 py-0.5 text-red-600 ring-1 ring-red-200">
                      skill={b.affectedSkill}
                    </span>
                  )}
                  {b.path && <span className="font-mono text-red-400">{b.path}</span>}
                  {b.ref && <span className="font-mono text-red-400">ref={b.ref}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Six skill cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SKILL_META.map(({ key, label, desc, color, dot }) => {
            const ev = perSkill[key as SkillKey];
            const present = ev?.evidencePresent === true;
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 transition-all ${
                  present
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-[#E7E2D9] bg-white opacity-60"
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
            className="mt-3 rounded-xl border border-[#E7E2D9] bg-[#F5F1EA]/60 p-3"
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
    </div>
  );
}
