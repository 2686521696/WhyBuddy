/**
 * PageScreen — 页面 wireframe（字段列表 + 操作按钮）
 *
 * 展示 Page Skill 产出的页面结构：字段列表、表单区域、操作按钮。
 */

import React, { useMemo } from "react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

interface PageScreenProps {
  publishClosure?: PublishClosureSummary | null;
  rawContent?: string | null;
  isActive?: boolean;
  className?: string;
}

interface FieldDef {
  name: string;
  type: string;
  required?: boolean;
  editable?: boolean;
}

interface PageDef {
  title: string;
  fields: FieldDef[];
  actions: string[];
}

const PLACEHOLDER_PAGES: PageDef[] = [
  {
    title: "采购申请表",
    fields: [
      { name: "标题", type: "text", required: true, editable: true },
      { name: "申请金额", type: "number", required: true, editable: true },
      { name: "采购原因", type: "textarea", required: true, editable: true },
      { name: "申请人", type: "readonly", required: false, editable: false },
      { name: "状态", type: "readonly", required: false, editable: false },
    ],
    actions: ["提交申请", "保存草稿", "取消"],
  },
  {
    title: "审批详情",
    fields: [
      { name: "采购标题", type: "readonly", required: false, editable: false },
      { name: "申请金额", type: "readonly", required: false, editable: false },
      { name: "审批意见", type: "textarea", required: true, editable: true },
    ],
    actions: ["批准", "拒绝"],
  },
];

export function PageScreen({
  publishClosure,
  rawContent,
  isActive = false,
  className = "",
}: PageScreenProps) {
  const pages = PLACEHOLDER_PAGES; // future: parse rawContent
  const evidence = publishClosure?.perSkillEvidence?.["page"];
  const hasEvidence = evidence?.evidencePresent === true;

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="page"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#EFEBE2] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-teal-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Page</span>
        <span className="text-xs text-stone-400">页面 Wireframe</span>
        {hasEvidence && (
          <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
            evidence ✓
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {pages.map((page) => (
            <div key={page.title} className={`rounded-xl border border-[#E7E2D9] bg-[#F5F1EA] p-3 ${rawContent ? "" : "opacity-40"}`}>
              {/* Page title bar */}
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#E7E2D9] bg-white px-3 py-1.5 shadow-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                <span className="text-xs font-semibold text-stone-700">{page.title}</span>
              </div>

              {/* Fields */}
              <div className="space-y-1.5">
                {page.fields.map((field) => (
                  <div key={field.name} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-[10px] text-stone-500">{field.name}</span>
                    <div
                      className={`h-5 flex-1 rounded border text-[10px] ${
                        field.editable
                          ? "border-[#D8D1C4] bg-white"
                          : "border-transparent bg-[#F0EDE5] text-stone-400"
                      }`}
                    />
                    {field.required && (
                      <span className="text-[10px] text-red-400">*</span>
                    )}
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {page.actions.map((action, i) => (
                  <div
                    key={action}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-medium ${
                      i === 0
                        ? "bg-teal-500 text-white"
                        : "border border-[#E7E2D9] bg-white text-stone-600"
                    }`}
                  >
                    {action}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {!rawContent && (
          <div className="mt-4 text-center text-[10px] text-stone-300">
            推演完成后将显示真实页面字段绑定
          </div>
        )}
      </div>
    </div>
  );
}
