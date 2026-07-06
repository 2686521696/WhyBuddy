/**
 * AigcScreen — AIGC Prompt 卡片 + 触发条件
 *
 * 展示 AIGC Skill 产出的 AI 功能：prompt 模板、触发时机、输入/输出字段。
 */

import React from "react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

interface AigcScreenProps {
  publishClosure?: PublishClosureSummary | null;
  rawContent?: string | null;
  isActive?: boolean;
  className?: string;
}

interface AigcFeature {
  name: string;
  trigger: string;
  inputFields: string[];
  outputField: string;
  promptPreview: string;
}

const PLACEHOLDER_FEATURES: AigcFeature[] = [
  {
    name: "采购描述生成",
    trigger: "用户点击「AI 填写」按钮",
    inputFields: ["采购品类", "预算金额", "使用部门"],
    outputField: "采购原因",
    promptPreview: "你是企业采购助理，根据以下信息生成简洁的采购申请描述：品类={品类}，金额={金额}，部门={部门}。",
  },
  {
    name: "审批意见建议",
    trigger: "审批人打开审批详情页",
    inputFields: ["采购标题", "历史审批记录", "申请人部门"],
    outputField: "审批意见（建议）",
    promptPreview: "根据采购申请内容和历史记录，提供一条中立的审批建议（50字以内）。",
  },
];

export function AigcScreen({
  publishClosure,
  rawContent,
  isActive = false,
  className = "",
}: AigcScreenProps) {
  const features = PLACEHOLDER_FEATURES;
  const evidence = publishClosure?.perSkillEvidence?.["aigc"];
  const hasEvidence = evidence?.evidencePresent === true;

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="aigc"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-pink-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">AIGC</span>
        <span className="text-xs text-slate-400">Prompt 模板 · 触发条件</span>
        {hasEvidence && (
          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
            evidence ✓
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="space-y-4">
          {features.map((feat) => (
            <div
              key={feat.name}
              className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${rawContent ? "" : "opacity-40"}`}
            >
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-pink-50 px-2 py-0.5 text-[11px] font-semibold text-pink-700 ring-1 ring-pink-200">
                  AI
                </span>
                <span className="text-sm font-semibold text-slate-800">{feat.name}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="mb-1 font-medium text-slate-500">触发时机</div>
                  <div className="rounded-md bg-slate-50 px-2 py-1.5 text-slate-700">{feat.trigger}</div>
                </div>
                <div>
                  <div className="mb-1 font-medium text-slate-500">输出字段</div>
                  <div className="rounded-md bg-pink-50 px-2 py-1.5 text-pink-700">{feat.outputField}</div>
                </div>
              </div>

              <div className="mt-3 text-xs">
                <div className="mb-1 font-medium text-slate-500">输入字段</div>
                <div className="flex flex-wrap gap-1">
                  {feat.inputFields.map((f) => (
                    <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{f}</span>
                  ))}
                </div>
              </div>

              <div className="mt-3 text-xs">
                <div className="mb-1 font-medium text-slate-500">Prompt 预览</div>
                <div className="rounded-md bg-slate-900 px-3 py-2 font-mono text-[10px] leading-5 text-slate-300">
                  {feat.promptPreview}
                </div>
              </div>
            </div>
          ))}
        </div>

        {!rawContent && (
          <div className="mt-4 text-center text-[10px] text-slate-300">
            推演完成后将显示真实 AIGC 功能设计
          </div>
        )}
      </div>
    </div>
  );
}
