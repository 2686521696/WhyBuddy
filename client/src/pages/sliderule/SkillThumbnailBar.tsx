/**
 * SkillThumbnailBar — 6 个系统的横向胶囊按钮（样式版：彩色圆图标 + 名称）。
 *
 * active 高亮（品牌色描边 + 白底 + 投影），inactive 保持可读的弱化态
 * （早期 20% 透明度被反馈"看不清有哪些系统"，已废弃）。
 * 点击可手动切换视图（可选）。
 */

import React from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "./derive-cross-runtime-summary";

interface SkillThumbnailBarProps {
  activeSkillId: SkillId | null;
  publishClosure?: PublishClosureSummary | null;
  onSelect?: (id: SkillId) => void;
  className?: string;
}

const SKILLS: Array<{
  id: SkillId;
  label: string;
  abbr: string;
  iconBg: string;
  activeBorder: string;
  evidenceKey: string;
}> = [
  { id: "dataModel",  label: "DataModel",  abbr: "DM",  iconBg: "bg-blue-400",   activeBorder: "ring-blue-400",   evidenceKey: "datamodel"  },
  { id: "workflow",   label: "Workflow",   abbr: "WF",  iconBg: "bg-violet-400", activeBorder: "ring-violet-400", evidenceKey: "workflow"   },
  { id: "rbac",       label: "RBAC",       abbr: "RB",  iconBg: "bg-orange-400", activeBorder: "ring-orange-400", evidenceKey: "rbac"       },
  { id: "page",       label: "Page",       abbr: "PG",  iconBg: "bg-teal-400",   activeBorder: "ring-teal-400",   evidenceKey: "page"       },
  { id: "aigc",       label: "AIGC",       abbr: "AI",  iconBg: "bg-pink-400",   activeBorder: "ring-pink-400",   evidenceKey: "aigc"       },
  { id: "appBundle",  label: "AppBundle",  abbr: "AB",  iconBg: "bg-emerald-400",activeBorder: "ring-emerald-400",evidenceKey: "appbundle"  },
];

export function SkillThumbnailBar({
  activeSkillId,
  publishClosure,
  onSelect,
  className = "",
}: SkillThumbnailBarProps) {
  type SkillKey = "datamodel" | "rbac" | "workflow" | "page" | "aigc" | "appbundle";
  const perSkill = publishClosure?.perSkillEvidence ?? {} as Partial<Record<SkillKey, { evidencePresent?: boolean } | undefined>>;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {SKILLS.map(({ id, label, abbr, iconBg, activeBorder, evidenceKey }) => {
        const isActive = activeSkillId === id || (!activeSkillId && id === "appBundle");
        const hasEvidence = perSkill[evidenceKey as keyof typeof perSkill]?.evidencePresent === true;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect?.(id)}
            title={label}
            className={`relative flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 transition-all duration-200 ${
              isActive
                ? `ring-2 ${activeBorder} border-transparent bg-white shadow-[0_2px_10px_rgb(15_23_42/0.10)]`
                : "border-[#e5e7eb] bg-white/70 hover:border-[#d3d8e0] hover:bg-white"
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${iconBg} ${
                isActive ? "" : "opacity-60"
              }`}
            >
              <span className="text-[9px] font-bold text-white">{abbr}</span>
            </span>
            <span className={`text-xs font-medium ${isActive ? "text-stone-800" : "text-stone-500"}`}>
              {label}
            </span>

            {/* Evidence dot */}
            {hasEvidence && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-white" />
            )}
          </button>
        );
      })}
    </div>
  );
}
