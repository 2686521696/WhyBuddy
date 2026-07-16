/**
 * GateBlockedPanel — 发布闭环被闸拦截时的整面错误页（E27）。
 *
 * 设计原则：诚实，但说人话。标题讲发生了什么，原因卡把 blocker code 翻译成
 * 用户能行动的语言，主 CTA 直达 E26 缺口修复轮（哪里缺补哪里）；工程字段
 * （code / path / ref / closureHash…）全部收进可折叠的「技术详情」，默认不打扰。
 * fail-closed 语义不变：这页只是把"如实拦截"讲清楚，绝不粉饰成绿。
 */

import React from "react";
import { ShieldAlert, Wrench } from "lucide-react";
import type { PublishClosureSummary } from "../derive-cross-runtime-summary";

const SKILL_CHIPS: Array<{ key: string; label: string }> = [
  { key: "datamodel", label: "数据模型" },
  { key: "rbac", label: "角色权限" },
  { key: "workflow", label: "工作流" },
  { key: "page", label: "页面" },
  { key: "aigc", label: "AI 能力" },
  { key: "appbundle", label: "应用装配" },
];

interface HumanReason {
  tag: string;
  title: string;
  hint: string;
}

type Blocker = NonNullable<PublishClosureSummary["topBlockers"]>[number];

/** blocker code → 人话原因卡；返回 null 表示该项与标题重复，不单列。 */
function humanizeBlocker(b: Blocker): HumanReason | null {
  switch (b.code) {
    case "LLM_GENERATE_DISABLED":
      return {
        tag: "部署配置",
        title: "五系统模型生成开关未开启",
        hint: "在部署的 .env 里设置 SLIDERULE_LLM_GENERATE_ENABLED=1 并重启服务，然后点「补齐缺口」继续。",
      };
    case "LLM_GENERATE_FAILED":
      return {
        tag: "上游服务",
        title: "五系统模型生成失败",
        hint: `${b.ref ? `失败原因：${b.ref}。` : ""}多为模型网关波动，点「补齐缺口」重试即可。`,
      };
    case "MODEL_GATE_BLOCKED":
      return {
        tag: "结构校验",
        title: "生成的模型没有通过结构闸",
        hint: `${b.ref ? `${b.ref}。` : ""}点「补齐缺口」重新生成，结构闸会再次把关。`,
      };
    case "APPBUNDLE_RUNTIME_CLOSURE_BLOCKED":
      // 这条就是"被拦截"本身，标题已表达，不再重复列一条
      return null;
    default:
      return b.code
        ? { tag: "其他", title: String(b.code), hint: b.ref ? String(b.ref) : "" }
        : null;
  }
}

export function GateBlockedPanel({
  publishClosure,
  onRepair,
}: {
  publishClosure: PublishClosureSummary;
  /** 缺省行为：广播 sliderule:repair-gaps（与消息区「补齐缺口」同一条链路） */
  onRepair?: () => void;
}) {
  const perSkill = (publishClosure.perSkillEvidence ?? {}) as Record<
    string,
    { evidencePresent?: boolean } | undefined
  >;
  const present = publishClosure.evidencePresentCount ?? 0;
  const total = publishClosure.skillCount ?? 6;
  const blockers = publishClosure.topBlockers ?? [];

  const reasons = blockers
    .map(humanizeBlocker)
    .filter((r): r is HumanReason => r !== null);
  if (reasons.length === 0) {
    reasons.push({
      tag: "证据缺口",
      title: "部分系统还没有可信证据支撑",
      hint: "推演如实停在闸前（不造假放行）。点「补齐缺口」只补缺的部分，已完成的产物原样保留。",
    });
  }

  const repair = () => {
    if (onRepair) onRepair();
    else window.dispatchEvent(new CustomEvent("sliderule:repair-gaps"));
  };

  return (
    <div
      className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-5 px-6 py-10 text-center"
      data-testid="appbundle-gate-blocked"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 ring-1 ring-amber-200">
        <ShieldAlert className="h-7 w-7 text-amber-500" />
      </div>

      <div>
        <div className="text-[15px] font-semibold text-stone-800">
          发布闭环被闸拦截
        </div>
        <div className="mt-1.5 text-[12px] leading-relaxed text-stone-500">
          证据不够就不放行——这是如实的检查结果，不是故障。当前 {present}/{total} 项系统证据到位。
        </div>
      </div>

      {/* 六系统证据进度：一眼看出缺哪几块 */}
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {SKILL_CHIPS.map(({ key, label }) => {
          const ok = perSkill[key]?.evidencePresent === true;
          return (
            <span
              key={key}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
                ok
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : "bg-white text-stone-400 ring-[#e5e7eb]"
              }`}
            >
              {ok ? "✓" : "○"} {label}
            </span>
          );
        })}
      </div>

      {/* 原因卡（人话） */}
      <div className="w-full space-y-2 text-left" data-testid="appbundle-blocked-reasons">
        {reasons.map((r, i) => (
          <div
            key={`${r.title}-${i}`}
            className="rounded-lg border border-amber-200/70 bg-amber-50/50 px-3.5 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-white px-1.5 py-0.5 text-[9px] font-medium text-amber-600 ring-1 ring-amber-200">
                {r.tag}
              </span>
              <span className="text-[12px] font-medium text-stone-800">{r.title}</span>
            </div>
            {r.hint && (
              <div className="mt-1 text-[11px] leading-relaxed text-stone-500">{r.hint}</div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          data-testid="appbundle-repair-cta"
          onClick={repair}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#1677ff] px-4 py-2 text-[12px] font-medium text-white shadow-[0_4px_14px_rgb(22_119_255/0.35)] transition hover:bg-[#0958d9]"
        >
          <Wrench className="h-3.5 w-3.5" />
          补齐缺口
        </button>
        <div className="text-[10px] text-stone-400">
          只重跑缺口对应的步骤，已完成的产物原样保留 · 想整轮重来可在对话里点「重新推演」
        </div>
      </div>

      {/* 工程字段收纳：给排查的人留全量事实，默认不打扰 */}
      <details className="w-full text-left">
        <summary className="cursor-pointer select-none text-[10px] text-stone-400 transition hover:text-stone-600">
          技术详情
        </summary>
        <div className="mt-2 space-y-1 rounded-md bg-[#f7f8fa] p-2.5 font-mono text-[9px] leading-relaxed text-stone-500">
          {blockers.map((b, i) => (
            <div key={`${b.code}-${i}`} className="break-all">
              {b.code}
              {b.affectedSkill ? ` skill=${b.affectedSkill}` : ""}
              {b.path ? ` ${b.path}` : ""}
              {b.ref ? ` ref=${b.ref}` : ""}
            </div>
          ))}
          <div className="break-all text-stone-400">
            {publishClosure.closureHash && <>closureHash={publishClosure.closureHash} </>}
            {publishClosure.stableDigest && <>digest={publishClosure.stableDigest} </>}
            {publishClosure.generatedAt && <>generatedAt={publishClosure.generatedAt} </>}
            versionPins={publishClosure.versionPinsChecked ? "checked" : "unchecked"}
          </div>
        </div>
      </details>
    </div>
  );
}
