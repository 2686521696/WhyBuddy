/**
 * XrayPanel — 应用主舞台的「X 光」透视栏。
 *
 * 融合哲学（方向 B）：运行应用是主角，五系统不是六个并列模块，而是应用
 * 背后的骨架。开 X 光后，本栏跟随你在应用里的当前页面，实时透视它背后的
 * 实体/流程/角色/AI 能力/页面蓝图；点任何一节侧滑抽屉进入对应系统屏深看。
 * 纯派生渲染：模型进、透视出，不持有任何状态。
 */

import React from "react";
import type { SkillId } from "@/lib/sliderule-marathon-driver";
import type { FiveSystemModel } from "./system-screens/five-system-model";
import type { AppRuntimeSchema } from "./live-runtime/app-runtime-schema";
import { deriveRoleAccess, pageAccessForRole } from "./live-runtime/rbac-preview";
import { Boxes, Cpu, GitBranch, LayoutTemplate, Users, Waypoints } from "lucide-react";

export interface XraySection {
  skill: SkillId;
  title: string;
  items: string[];
  /** 一句话说明该系统与当前页面的关系 */
  relation: string;
}

/** 当前页面（或 home 全景）的 X 光切片：每个系统与这一页的真实关联。 */
export function derivePageXray(
  model: FiveSystemModel,
  schema: AppRuntimeSchema,
  activePageId: string
): { pageTitle: string; sections: XraySection[] } {
  const entities = model.datamodel?.entities ?? [];
  const entityName = (id: string | null | undefined) => {
    if (!id) return null;
    const e = entities.find((x) => x.id === id);
    return e ? `${e.name || e.id}` : id;
  };
  const roleAccess = deriveRoleAccess(model);

  const page = schema.pages.find((p) => p.id === activePageId) ?? null;

  if (!page) {
    // home / 未匹配：应用全景切片
    const wfNodes = model.workflow?.nodes ?? [];
    const overview: XraySection[] = [
        {
          skill: "dataModel",
          title: "数据模型",
          relation: "全应用的数据地基",
          items: entities.map((e) => `${e.name || e.id} · ${e.fields?.length ?? 0} 字段`),
        },
        {
          skill: "workflow",
          title: "工作流",
          relation: "驱动业务推进的审批链",
          items: wfNodes.map((n) => n.name || n.id),
        },
        {
          skill: "rbac",
          title: "角色权限",
          relation: "谁能进入、能做什么",
          items: roleAccess.map((r) => `${r.role} · ${r.permissions.length} 权限`),
        },
        {
          skill: "page",
          title: "页面",
          relation: "应用的全部界面",
          items: schema.pages.map((p) => p.title),
        },
        {
          skill: "aigc",
          title: "AI 能力",
          relation: "可写回字段的生成能力",
          items: (model.aigc?.capabilities ?? []).map((c) => c.name || c.id || ""),
        },
    ];
    return {
      pageTitle: "工作台（全景）",
      sections: overview.map((s) => ({ ...s, items: s.items.filter(Boolean) })),
    };
  }

  // 具体页面切片
  const mainEntity = entities.find((e) => e.id === page.entityId);
  const boundWorkflowRef = (model.appbundle?.pageBindings ?? []).find(
    (b) => b.pageRef === page.id && b.workflowRef
  )?.workflowRef;
  const wfNodes = model.workflow?.nodes ?? [];
  const visibleRoles = roleAccess
    .filter((r) => pageAccessForRole([page], r).some((a) => a.visible))
    .map((r) => r.role);

  return {
    pageTitle: page.title,
    sections: [
      {
        skill: "dataModel",
        title: "数据模型",
        relation: "本页读写的数据",
        items: mainEntity
          ? [
              `主实体：${mainEntity.name || mainEntity.id}`,
              `表格列 ${page.columns.length} · 表单项 ${page.formFields.length}`,
            ]
          : [],
      },
      {
        skill: "page",
        title: "页面蓝图",
        relation: "字段绑定与操作权声明",
        items: [
          `${page.columns.length + page.formFields.length > 0 ? "字段绑定" : "无绑定"} · 动作 ${page.actions.length} 项`,
        ],
      },
      {
        skill: "workflow",
        title: "工作流",
        relation: page.workflowLinked ? "本页可发起流程" : "本页未挂流程",
        items: page.workflowLinked
          ? [boundWorkflowRef || "已绑定流程", ...wfNodes.slice(0, 4).map((n) => n.name || n.id)]
          : [],
      },
      {
        skill: "rbac",
        title: "角色权限",
        relation: "谁能看到这一页",
        items: visibleRoles,
      },
      {
        skill: "aigc",
        title: "AI 能力",
        relation: page.aiActions.length > 0 ? "详情抽屉可用的生成动作" : "本页无 AI 动作",
        items: page.aiActions.map((a) => `${a.label} → ${a.outputLabel}`),
      },
    ],
  };
}

const SECTION_ICON: Record<string, React.ReactNode> = {
  dataModel: <Boxes className="h-3.5 w-3.5" />,
  workflow: <GitBranch className="h-3.5 w-3.5" />,
  rbac: <Users className="h-3.5 w-3.5" />,
  page: <LayoutTemplate className="h-3.5 w-3.5" />,
  aigc: <Cpu className="h-3.5 w-3.5" />,
};

export function XrayPanel({
  model,
  schema,
  activePageId,
  onOpenSystem,
}: {
  model: FiveSystemModel;
  schema: AppRuntimeSchema;
  activePageId: string;
  /** 深入某个系统屏（侧滑抽屉） */
  onOpenSystem: (skill: SkillId) => void;
}) {
  const xray = React.useMemo(
    () => derivePageXray(model, schema, activePageId),
    [model, schema, activePageId]
  );

  return (
    <div
      className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden rounded-2xl border border-[#E7E2D9] bg-white/85"
      data-testid="sliderule-xray-panel"
    >
      <div className="border-b border-[#F0EDE5] px-3.5 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-stone-400">
          X 光 · 页面背后
        </div>
        <div className="mt-0.5 truncate text-[13px] font-semibold text-stone-800" data-testid="xray-page-title">
          {xray.pageTitle}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {xray.sections.map((s) => (
          <button
            key={s.skill}
            type="button"
            onClick={() => onOpenSystem(s.skill)}
            data-testid={`xray-section-${s.skill}`}
            className="block w-full rounded-xl border border-transparent px-2.5 py-2 text-left transition hover:border-[#E7E2D9] hover:bg-[#FAF8F3]"
            title={`深入${s.title}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-stone-600">
              <span className="text-[#B0552F]">{SECTION_ICON[s.skill]}</span>
              {s.title}
              <span className="ml-auto font-normal text-stone-300">›</span>
            </div>
            <div className="mt-0.5 text-[10px] text-stone-400">{s.relation}</div>
            {s.items.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {s.items.slice(0, 4).map((it, i) => (
                  <span
                    key={i}
                    className="max-w-full truncate rounded-md bg-[#F5F1EA] px-1.5 py-0.5 text-[10px] text-stone-600"
                  >
                    {it}
                  </span>
                ))}
                {s.items.length > 4 && (
                  <span className="rounded-md px-1 py-0.5 text-[10px] text-stone-400">
                    +{s.items.length - 4}
                  </span>
                )}
              </div>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onOpenSystem("appBundle")}
          data-testid="xray-section-appBundle"
          className="mt-1 flex w-full items-center gap-1.5 rounded-xl border border-dashed border-[#E7E2D9] px-2.5 py-2 text-[11px] font-semibold text-stone-500 transition hover:bg-[#FAF8F3]"
        >
          <Waypoints className="h-3.5 w-3.5 text-[#B0552F]" />
          五系统联动总图
          <span className="ml-auto font-normal text-stone-300">›</span>
        </button>
      </div>
    </div>
  );
}
