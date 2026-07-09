/**
 * XrayPanel — 应用主舞台的「游标」透视栏（计算尺游标：对齐读数）。
 *
 * 融合哲学（方向 B）：运行应用是主角，五系统不是六个并列模块，而是应用
 * 背后的骨架。开游标后，本栏跟随你在应用里的当前页面，实时透视它背后的
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

/** 元素级游标目标：应用内被悬停的具体元素（对齐焦点）。 */
export type XrayTarget =
  | { kind: "field"; entityId: string; fieldId: string; label: string }
  | { kind: "action"; label: string; pageId: string; permission: string | null; granted: boolean; role?: string }
  | { kind: "menu"; pageId: string; label: string }
  | { kind: "ai"; capId: string; label: string }
  | { kind: "workflow"; label: string; pageId: string };

/** 元素目标 → 背后声明的解读（纯函数，供焦点卡渲染与单测）。 */
export function describeXrayTarget(
  model: FiveSystemModel,
  target: XrayTarget
): { skill: SkillId; title: string; lines: string[] } {
  const entities = model.datamodel?.entities ?? [];
  if (target.kind === "field") {
    const entity = entities.find((e) => e.id === target.entityId);
    const field = entity?.fields?.find((f) => f.id === target.fieldId);
    const ref = `${target.entityId}.${target.fieldId}`;
    const pages = (model.page?.pages ?? []).filter((p) => (p.fieldBindings ?? []).includes(ref));
    const caps = model.aigc?.capabilities ?? [];
    const readers = caps.filter((c) => (c.inputFields ?? []).includes(ref));
    const writers = caps.filter((c) => c.outputField === ref);
    const lines = [
      `字段类型：${field?.type || "string"}`,
      `被 ${pages.length} 个页面绑定${pages.length ? `：${pages.map((p) => p.name || p.id).join("、")}` : ""}`,
    ];
    if (readers.length) lines.push(`AI 读取：${readers.map((c) => c.name || c.id).join("、")}`);
    if (writers.length) lines.push(`AI 写回：${writers.map((c) => c.name || c.id).join("、")}`);
    return {
      skill: "dataModel",
      title: `${entity?.name || target.entityId} · ${field?.name || target.fieldId}`,
      lines,
    };
  }
  if (target.kind === "action") {
    const holders = deriveRoleAccess(model)
      .filter((r) => target.permission && r.permissions.includes(target.permission))
      .map((r) => r.role);
    return {
      skill: "rbac",
      title: `按钮「${target.label}」`,
      lines: [
        target.permission ? `权限声明：${target.permission}` : "未声明权限（公共动作）",
        target.role
          ? target.granted
            ? `当前角色 ${target.role} 已持有 → 可用`
            : `当前角色 ${target.role} 未持有 → 已锁`
          : "",
        holders.length ? `持有角色：${holders.join("、")}` : "",
      ].filter(Boolean),
    };
  }
  if (target.kind === "menu") {
    const pageDef = (model.page?.pages ?? []).find((p) => p.id === target.pageId);
    const roles = deriveRoleAccess(model)
      .filter((r) => {
        const actions = pageDef?.actionPermissions ?? [];
        return actions.length === 0 || actions.some((a) => r.permissions.includes(a));
      })
      .map((r) => r.role);
    return {
      skill: "page",
      title: `页面「${target.label}」`,
      lines: [
        `字段绑定 ${pageDef?.fieldBindings?.length ?? 0} 项 · 动作声明 ${pageDef?.actionPermissions?.length ?? 0} 项`,
        roles.length ? `可见角色：${roles.join("、")}` : "",
      ].filter(Boolean),
    };
  }
  if (target.kind === "ai") {
    const cap = (model.aigc?.capabilities ?? []).find((c) => c.id === target.capId);
    return {
      skill: "aigc",
      title: `AI 能力「${cap?.name || target.label}」`,
      lines: [
        `输入：${(cap?.inputFields ?? []).join("、") || "—"}`,
        `写回：${cap?.outputField || "—"}`,
        cap?.roleRefs?.length ? `可用角色：${cap.roleRefs.join("、")}` : "",
      ].filter(Boolean),
    };
  }
  // workflow
  const binding = (model.appbundle?.pageBindings ?? []).find(
    (b) => b.pageRef === target.pageId && b.workflowRef
  );
  const nodes = model.workflow?.nodes ?? [];
  return {
    skill: "workflow",
    title: `动作「${target.label}」`,
    lines: [
      binding?.workflowRef ? `发起流程：${binding.workflowRef}` : "本页绑定的审批流",
      nodes.length ? `共 ${nodes.length} 个节点，首节点「${nodes[0]?.name || nodes[0]?.id}」` : "",
    ].filter(Boolean),
  };
}

/** 当前页面（或 home 全景）的游标切片：每个系统与这一页的真实关联。 */
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
  target = null,
  onOpenSystem,
}: {
  model: FiveSystemModel;
  schema: AppRuntimeSchema;
  activePageId: string;
  /** 元素级焦点：应用内正被悬停的元素（null = 页面级透视） */
  target?: XrayTarget | null;
  /** 深入某个系统屏（侧滑抽屉） */
  onOpenSystem: (skill: SkillId) => void;
}) {
  const xray = React.useMemo(
    () => derivePageXray(model, schema, activePageId),
    [model, schema, activePageId]
  );
  const focus = React.useMemo(
    () => (target ? describeXrayTarget(model, target) : null),
    [model, target]
  );

  // TRAE Work 式右栏：灰色小节标题 + 图标文字行，去卡片/胶囊，留白呼吸
  return (
    <div
      className="flex h-full w-[276px] shrink-0 flex-col overflow-hidden rounded-md border border-[#e9edf2] bg-white"
      data-testid="sliderule-xray-panel"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="text-[12px] text-stone-400">游标 · 页面背后</div>
        <div className="mt-1 truncate text-[13px] font-semibold text-stone-800" data-testid="xray-page-title">
          {xray.pageTitle}
        </div>

        {/* 对齐焦点：悬停应用内元素时浮出其背后声明（点击深入对应系统屏） */}
        {focus && (
          <button
            type="button"
            onClick={() => onOpenSystem(focus.skill)}
            data-testid="xray-focus"
            className="mt-3 block w-full rounded border-l-2 border-[#1677ff] bg-[#FDF6F1] px-3 py-2 text-left transition hover:bg-[#FBEEE5]"
          >
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-stone-800">
              <span className="text-[#1677ff]">{SECTION_ICON[focus.skill] ?? <Waypoints className="h-3.5 w-3.5" />}</span>
              <span className="min-w-0 truncate">{focus.title}</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {focus.lines.map((line, i) => (
                <div key={i} className="text-[11px] leading-4 text-stone-500">
                  {line}
                </div>
              ))}
            </div>
          </button>
        )}

        <div className="mt-5 space-y-5">
          {xray.sections.map((s) => (
            <div key={s.skill} data-testid={`xray-section-${s.skill}`}>
              <button
                type="button"
                onClick={() => onOpenSystem(s.skill)}
                title={`深入${s.title} · ${s.relation}`}
                className="group flex w-full items-center gap-1.5 text-left text-[12px] text-stone-400 transition hover:text-stone-600"
              >
                {s.title}
                <span className="opacity-0 transition group-hover:opacity-100">›</span>
              </button>
              <div className="mt-1.5">
                {s.items.length === 0 && (
                  <div className="px-0.5 py-0.5 text-[12px] text-stone-300">{s.relation}</div>
                )}
                {s.items.slice(0, 5).map((it, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenSystem(s.skill)}
                    className="flex w-full items-center gap-2 rounded-sm px-1 py-[3px] text-left transition hover:bg-[#F7F5F0]"
                  >
                    <span className="shrink-0 text-stone-300">{SECTION_ICON[s.skill]}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-stone-700">{it}</span>
                  </button>
                ))}
                {s.items.length > 5 && (
                  <div className="px-1 py-0.5 text-[11px] text-stone-300">还有 {s.items.length - 5} 项…</div>
                )}
              </div>
            </div>
          ))}

          <div data-testid="xray-section-appBundle">
            <button
              type="button"
              onClick={() => onOpenSystem("appBundle")}
              className="group flex w-full items-center gap-2 rounded-sm px-1 py-[3px] text-left transition hover:bg-[#F7F5F0]"
            >
              <Waypoints className="h-3.5 w-3.5 shrink-0 text-stone-300" />
              <span className="text-[12.5px] text-stone-700">五系统联动总图</span>
              <span className="ml-auto text-stone-300 opacity-0 transition group-hover:opacity-100">›</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
