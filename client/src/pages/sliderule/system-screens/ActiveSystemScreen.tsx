/**
 * ActiveSystemScreen — 16:9 主视图容器
 *
 * 根据 activeSkillId 派发到对应系统渲染器。
 * 无激活 Skill 时默认展示 AppBundleScreen（发布证据看板）。
 */

import React from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { DataModelScreen } from "./DataModelScreen";
import { WorkflowScreen } from "./WorkflowScreen";
import { RbacScreen } from "./RbacScreen";
import { PageScreen } from "./PageScreen";
import { AigcScreen } from "./AigcScreen";
import { AppBundleScreen } from "./AppBundleScreen";

interface ActiveSystemScreenProps {
  activeSkillId: SkillId | null;
  publishClosure?: PublishClosureSummary | null;
  /** Latest mermaid source from skill_result events */
  latestMermaid?: string | null;
  /** Raw content strings by skill (populated as SSE results arrive) */
  skillContents?: Partial<Record<SkillId, string>>;
  className?: string;
}

export function ActiveSystemScreen({
  activeSkillId,
  publishClosure,
  latestMermaid,
  skillContents = {},
  className = "",
}: ActiveSystemScreenProps) {
  // 16:9 aspect ratio wrapper
  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
      style={{ aspectRatio: "16 / 9" }}
    >
      <div className="absolute inset-0">
        {/* Each screen is mounted but only the active one is fully visible.
            Keeping them all mounted avoids mermaid re-render flicker. */}

        <div className={activeSkillId === "dataModel" ? "h-full w-full" : "hidden"}>
          <DataModelScreen
            publishClosure={publishClosure}
            mermaidSource={latestMermaid ?? skillContents.dataModel}
            isActive={activeSkillId === "dataModel"}
          />
        </div>

        <div className={activeSkillId === "workflow" ? "h-full w-full" : "hidden"}>
          <WorkflowScreen
            publishClosure={publishClosure}
            mermaidSource={latestMermaid ?? skillContents.workflow}
            isActive={activeSkillId === "workflow"}
          />
        </div>

        <div className={activeSkillId === "rbac" ? "h-full w-full" : "hidden"}>
          <RbacScreen
            publishClosure={publishClosure}
            rawContent={skillContents.rbac}
            isActive={activeSkillId === "rbac"}
          />
        </div>

        <div className={activeSkillId === "page" ? "h-full w-full" : "hidden"}>
          <PageScreen
            publishClosure={publishClosure}
            rawContent={skillContents.page}
            isActive={activeSkillId === "page"}
          />
        </div>

        <div className={activeSkillId === "aigc" ? "h-full w-full" : "hidden"}>
          <AigcScreen
            publishClosure={publishClosure}
            rawContent={skillContents.aigc}
            isActive={activeSkillId === "aigc"}
          />
        </div>

        {/* Default / appBundle — show when no skill is active */}
        <div className={!activeSkillId || activeSkillId === "appBundle" ? "h-full w-full" : "hidden"}>
          <AppBundleScreen
            publishClosure={publishClosure}
            isActive={!activeSkillId || activeSkillId === "appBundle"}
          />
        </div>
      </div>
    </div>
  );
}
