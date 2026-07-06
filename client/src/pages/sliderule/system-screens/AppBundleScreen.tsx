/**
 * AppBundleScreen — 六系统发布证据看板（默认视图）
 *
 * 无激活 Skill 时展示，汇总所有系统的证据状态。
 * 是整个 SlideRuleStudio 的"主页"进度锚点。
 */

import React from "react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

interface AppBundleScreenProps {
  publishClosure?: PublishClosureSummary | null;
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

export function AppBundleScreen({
  publishClosure,
  isActive = false,
  className = "",
}: AppBundleScreenProps) {
  type SkillEv = { evidencePresent?: boolean; summary?: string } | undefined;
  type SkillKey = "datamodel" | "rbac" | "workflow" | "page" | "aigc" | "appbundle";
  const perSkill = (publishClosure?.perSkillEvidence ?? {}) as Partial<Record<SkillKey, SkillEv>>;
  const totalPresent = publishClosure?.evidencePresentCount ?? 0;
  const totalSkills = publishClosure?.skillCount ?? 6;
  const blocked = publishClosure?.blocked ?? true;
  const allDone = !blocked && totalPresent >= totalSkills;

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="appBundle"
      data-active={isActive}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-emerald-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">AppBundle</span>
        <span className="text-xs text-slate-400">发布证据看板</span>
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
      <div className="h-1 w-full bg-slate-100">
        <div
          className={`h-1 transition-all duration-700 ${allDone ? "bg-emerald-400" : "bg-amber-400"}`}
          style={{ width: `${totalSkills > 0 ? Math.round((totalPresent / totalSkills) * 100) : 0}%` }}
        />
      </div>

      {/* Six skill cards */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SKILL_META.map(({ key, label, desc, color, dot }) => {
            const ev = perSkill[key as keyof typeof perSkill];
            const present = ev?.evidencePresent === true;
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 transition-all ${
                  present
                    ? "border-emerald-200 bg-emerald-50/60"
                    : "border-slate-200 bg-white opacity-60"
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
                <div className="mt-2 text-[11px] text-slate-500">{desc}</div>
                {present && ev?.summary && (
                  <div className="mt-1.5 line-clamp-2 text-[10px] text-slate-400">{ev.summary}</div>
                )}
              </div>
            );
          })}
        </div>

        {!publishClosure && (
          <div className="mt-6 text-center text-xs text-slate-300">
            发送应用意图后，SlideRule 将逐系统填充发布证据
          </div>
        )}
      </div>
    </div>
  );
}
