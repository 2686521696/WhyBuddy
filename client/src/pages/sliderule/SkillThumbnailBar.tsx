/**
 * SkillThumbnailBar — 6 个 Skill 缩略图横排
 *
 * inactive 状态 opacity-20，active 时全亮 + 细边框高亮。
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
    <div className={`flex items-center gap-2 ${className}`}>
      {SKILLS.map(({ id, label, abbr, iconBg, activeBorder, evidenceKey }) => {
        const isActive = activeSkillId === id || (!activeSkillId && id === "appBundle");
        const hasEvidence = perSkill[evidenceKey as keyof typeof perSkill]?.evidencePresent === true;

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect?.(id)}
            title={label}
            className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition-all duration-200 ${
              isActive
                ? `opacity-100 ring-2 ${activeBorder} border-transparent bg-white shadow-sm`
                : "border-[#E7E2D9] bg-white opacity-20 hover:opacity-50"
            }`}
          >
            {/* Mini icon */}
            <div className={`h-6 w-6 rounded-lg ${iconBg} flex items-center justify-center`}>
              <span className="text-[9px] font-bold text-white">{abbr}</span>
            </div>
            <span className="text-[9px] font-medium text-stone-600">{label}</span>

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
