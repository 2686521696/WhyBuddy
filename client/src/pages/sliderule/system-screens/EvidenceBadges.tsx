/**
 * EvidenceBadges — 系统屏头部的证据徽章组。
 *
 * 诚实路径标注：evidence ✓ 只说明证据在场；来源徽章说明它是哪条路径产的——
 *   「LLM 生成」（珊瑚）  llm-linkage-*     真实 LLM 五系统生成
 *   「内置演示域」（琥珀）runtime-linkage-* 确定性 fixture，不调 LLM
 * 识别不了来源时只渲染 evidence ✓（不猜）。无证据时整组不渲染。
 */

import React from "react";
import { evidenceSourceOf } from "./five-system-model";

interface EvidenceBadgesProps {
  evidence?:
    | {
        evidencePresent?: boolean;
        artifactId?: string;
        evidenceRef?: string;
      }
    | null;
}

export function EvidenceBadges({ evidence }: EvidenceBadgesProps) {
  if (evidence?.evidencePresent !== true) return null;
  const source = evidenceSourceOf(evidence);
  return (
    <>
      {source && (
        <span
          data-testid={`evidence-source-${source.kind}`}
          className={
            source.kind === "llm"
              ? "rounded-full bg-[#F8E8E0] px-2 py-0.5 text-[10px] font-medium text-[#C4633F]"
              : "rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600"
          }
          title={
            source.kind === "llm"
              ? "本话题为新颖意图，五系统模型由真实 LLM 生成并通过结构闸"
              : "本话题命中内置演示域（确定性样板，秒出、不调 LLM）"
          }
        >
          {source.label}
        </span>
      )}
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
        evidence ✓
      </span>
    </>
  );
}
