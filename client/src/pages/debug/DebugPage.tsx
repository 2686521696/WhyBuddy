import { Bug, GitBranch, Settings2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

import { AuditPanel } from "@/components/AuditPanel";
import { PermissionPanel } from "@/components/permissions/PermissionPanel";
import {
  WorkspacePageShell,
  WorkspacePanel,
} from "@/components/workspace/WorkspacePageShell";
import { useI18n } from "@/i18n";
import { useAppStore } from "@/lib/store";

function t(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

type DebugTab = "overview" | "permissions" | "audit";

export default function DebugPage() {
  const { locale } = useI18n();
  const [, setLocation] = useLocation();
  const toggleConfig = useAppStore(state => state.toggleConfig);
  const [activeTab, setActiveTab] = useState<DebugTab>("overview");

  return (
    <WorkspacePageShell
      eyebrow={t(locale, "内部调试面", "Internal Debug Surface")}
      title={t(locale, "低频治理与调试入口", "Low-frequency Governance Tools")}
      description={t(
        locale,
        "这个页面不作为普通用户主路径暴露，只承接内部调试、治理与低频工具访问。",
        "This route is intentionally hidden from the normal primary flow and only holds internal debugging, governance, and low-frequency tools."
      )}
    >
      <WorkspacePanel strong className="p-5">
        <div className="grid gap-4 xl:grid-cols-3">
          <button
            type="button"
            onClick={() => setLocation("/lineage")}
            className="workspace-panel workspace-panel-inset rounded-[24px] px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {t(locale, "数据血缘", "Data Lineage")}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {t(
                    locale,
                    "继续保留 `/lineage` 深链能力，但不再作为普通主导航高频入口。",
                    "Keep `/lineage` reachable as a deep link without treating it as a normal high-frequency navigation item."
                  )}
                </div>
              </div>
              <GitBranch className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => toggleConfig()}
            className="workspace-panel workspace-panel-inset rounded-[24px] px-5 py-5 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {t(locale, "运行时配置", "Runtime Configuration")}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {t(
                    locale,
                    "模型来源、运行时与浏览器同步等低频操作继续通过配置面板管理。",
                    "Keep runtime mode, model source, and browser-sync controls in the configuration panel."
                  )}
                </div>
              </div>
              <Settings2 className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </button>

          <div className="workspace-panel workspace-panel-inset rounded-[24px] px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[var(--workspace-text-strong)]">
                  {t(locale, "调试说明", "Debug Notes")}
                </div>
                <div className="mt-2 text-xs leading-5 text-[var(--workspace-text-muted)]">
                  {t(
                    locale,
                    "本轮先收口入口心智，不要求把所有低频工具完全迁入同一页；这里先提供隐藏壳与统一落点。",
                    "This pass prioritizes navigation convergence rather than fully migrating every low-frequency tool into one page."
                  )}
                </div>
              </div>
              <Bug className="mt-0.5 size-5 shrink-0 text-[var(--workspace-text-subtle)]" />
            </div>
          </div>
        </div>
      </WorkspacePanel>

      <WorkspacePanel className="p-5">
        <div className="flex flex-wrap gap-2">
          {([
            ["overview", t(locale, "概览", "Overview")],
            ["permissions", t(locale, "权限", "Permissions")],
            ["audit", t(locale, "审计", "Audit")],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                activeTab === id
                  ? "bg-[#5E8B72] text-white"
                  : "bg-white/70 text-[var(--workspace-text-muted)] hover:bg-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === "overview" ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[22px] border border-[var(--workspace-panel-border)] bg-white/44 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--workspace-text-strong)]">
                <ShieldCheck className="size-4 text-[var(--studio-sage-strong)]" />
                {t(locale, "权限与治理", "Permissions and Governance")}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--workspace-text-muted)]">
                {t(
                  locale,
                  "权限矩阵、审计链路与运行时配置都属于低频治理能力，应从普通主路径退场，收敛到这里或其他隐藏入口。",
                  "Permission matrices, audit trails, and runtime governance are low-frequency capabilities and should live behind this internal surface instead of the normal primary path."
                )}
              </p>
            </div>

            <div className="rounded-[22px] border border-[var(--workspace-panel-border)] bg-white/44 px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[var(--workspace-text-strong)]">
                <GitBranch className="size-4 text-[var(--studio-accent-strong)]" />
                {t(locale, "深链保留", "Deep-link Compatibility")}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--workspace-text-muted)]">
                {t(
                  locale,
                  "像 `/lineage` 这类旧路径仍可保留实现，但普通用户不再从主导航直接进入。",
                  "Legacy deep links such as `/lineage` can remain implemented, but they should no longer be promoted through the normal primary navigation."
                )}
              </p>
            </div>
          </div>
        ) : null}

        {activeTab === "permissions" ? (
          <div className="mt-5 h-[640px] overflow-hidden rounded-[24px] border border-[var(--workspace-panel-border)] bg-white/70">
            <PermissionPanel />
          </div>
        ) : null}

        {activeTab === "audit" ? (
          <div className="mt-5 h-[640px] overflow-hidden rounded-[24px] border border-[var(--workspace-panel-border)] bg-white/70">
            <AuditPanel />
          </div>
        ) : null}
      </WorkspacePanel>
    </WorkspacePageShell>
  );
}
