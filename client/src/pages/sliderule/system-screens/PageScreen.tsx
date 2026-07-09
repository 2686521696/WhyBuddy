/**
 * PageScreen — 页面 wireframe（字段列表 + 操作按钮）
 *
 * 数据优先级（诚实降级链）：
 *   1. 五系统模型 page 段：pages[].fieldBindings 经 resolveFieldRef 与
 *      datamodel 交叉校验（未解析引用如实标红），actionPermissions 渲染为按钮。
 *   2. 占位骨架（降透明度 + 明示），不冒充真实产物。
 */

import React, { useMemo } from "react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";
import { EvidenceBadges } from "./EvidenceBadges";
import { EmptyScreenHint } from "./EmptyScreenHint";
import { resolveFieldRef, type FiveSystemModel } from "./five-system-model";

interface PageScreenProps {
  publishClosure?: PublishClosureSummary | null;
  rawContent?: string | null;
  /** 解析出的五系统模型（page 段 + datamodel 段做字段绑定交叉校验）。 */
  model?: FiveSystemModel | null;
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

export function PageScreen({
  publishClosure,
  rawContent,
  model,
  isActive = false,
  className = "",
}: PageScreenProps) {
  // 模型 page 段在场时渲染真实页面结构；否则占位骨架（明示，不伪装）。
  const modelPages = model?.page?.pages ?? [];
  const isPlaceholder = modelPages.length === 0;
  const pages = useMemo<PageDef[]>(() => {
    if (modelPages.length === 0) return [];
    return modelPages.map((p, i) => ({
      title: p.name || p.id || `页面 ${i + 1}`,
      fields: (p.fieldBindings ?? []).map((ref) => {
        const res = resolveFieldRef(ref, model);
        return {
          name: res.label,
          type: res.resolved ? "bound" : "unresolved",
          required: false,
          editable: true,
        };
      }),
      actions: (p.actionPermissions ?? []).map(String),
    }));
  }, [modelPages, model]);
  const evidence = publishClosure?.perSkillEvidence?.["page"];

  return (
    <div
      className={`flex h-full w-full flex-col bg-white ${className}`}
      data-skill="page"
      data-active={isActive}
    >
      <div className="flex items-center gap-2 border-b border-[#e8eaee] px-4 py-2.5">
        <div className="h-2 w-2 rounded-full bg-teal-400" />
        <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">Page</span>
        <span className="text-xs text-stone-400">页面 Wireframe</span>
        <div className="ml-auto flex items-center gap-1.5">
          <EvidenceBadges evidence={evidence} />
        </div>
      </div>

      {isPlaceholder ? (
        <EmptyScreenHint title="页面字段绑定（Wireframe）" desc="页面、字段与操作权限，来自五系统模型 page 段" />
      ) : (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {pages.map((page) => (
            <div key={page.title} className={`rounded-md border border-[#e5e7eb] bg-[#eef0f4] p-3 `}>
              {/* Page title bar */}
              <div className="mb-3 flex items-center gap-2 rounded border border-[#e5e7eb] bg-white px-3 py-1.5 shadow-sm">
                <div className="h-1.5 w-1.5 rounded-full bg-teal-400" />
                <span className="text-xs font-semibold text-stone-700">{page.title}</span>
              </div>

              {/* Fields */}
              <div className="space-y-1.5">
                {page.fields.map((field) => (
                  <div key={field.name} className="flex items-center gap-2">
                    <span
                      className={`w-20 shrink-0 truncate text-[10px] ${
                        field.type === "unresolved" ? "text-red-500" : "text-stone-500"
                      }`}
                      title={field.type === "unresolved" ? `字段绑定未在数据模型中解析：${field.name}` : field.name}
                    >
                      {field.type === "unresolved" ? "✗ " : ""}
                      {field.name}
                    </span>
                    <div
                      className={`h-5 flex-1 rounded border text-[10px] ${
                        field.editable
                          ? "border-[#d3d8e0] bg-white"
                          : "border-transparent bg-[#e9edf2] text-stone-400"
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
                    className={`rounded-sm px-2.5 py-1 text-[10px] font-medium ${
                      i === 0
                        ? "bg-teal-500 text-white"
                        : "border border-[#e5e7eb] bg-white text-stone-600"
                    }`}
                  >
                    {action}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

      </div>
      )}
    </div>
  );
}
