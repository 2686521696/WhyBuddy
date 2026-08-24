/**
 * 设计系统面板：浮在舞台右上，不是抽屉。
 *
 * ⚠ 2026-08-25 用户原话「点击新建弹出右侧显示**不是抽屉那种**，可以新建保存」。
 *   抽屉（全高遮罩 + 边缘滑入）会把正在跑的应用整个盖住，而用户改配色时恰恰
 *   要看着那个应用。所以做成一块浮层面板：有自己的边界和阴影，右侧留白，
 *   舞台仍然可见可点。
 *
 * ⚠ 色板那几格显示的是 `deriveIdentityPalette` 的真实派生结果，不是另算一套
 *   近似色——面板上看到的必须就是生成出来的那个颜色。
 */
import React from "react";
import { Check, Plus, Trash2, X } from "lucide-react";

import { deriveIdentityPalette } from "@/lib/identity-palette";
import { DesignSystemSwatch } from "./DesignSystemSwatch";
import { useDesignSystemPanel } from "./DesignSystemContext";
import {
  deleteCustomDesignSystem,
  isCustomDesignSystem,
  saveCustomDesignSystem,
  type DesignSystemRadius,
} from "./design-system";

const RADII: Array<{ id: DesignSystemRadius; label: string; px: number }> = [
  { id: "none", label: "直角", px: 0 },
  { id: "sm", label: "小", px: 4 },
  { id: "md", label: "中", px: 8 },
  { id: "lg", label: "大", px: 16 },
];

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1.5 text-[11px] font-medium text-stone-500">
        {label}
      </div>
      {children}
    </div>
  );
}

export function DesignSystemPanel({
  onApplied,
}: {
  /** 保存/应用之后回调（作曲家据此把选中态切过去）。 */
  onApplied?: (id: string) => void;
}) {
  const panel = useDesignSystemPanel();
  const sys = panel?.editing ?? null;
  if (!panel || !sys) return null;

  const palette = deriveIdentityPalette(sys.seed);
  const custom = isCustomDesignSystem(sys.id);

  const apply = () => {
    // 预设看着不改直接应用 → 不落自建；改过或新建 → 存成自己的一套。
    if (panel.mode === "create") saveCustomDesignSystem(sys);
    panel.apply(sys.id);
    onApplied?.(sys.id);
    panel.close();
  };

  return (
    <div
      data-testid="sliderule-design-panel"
      /* fixed 而不是 absolute：首页没有舞台容器，absolute 会找不到定位父级
         而贴到文档左上。fixed 让它在首页和会话内都稳定浮在右侧。 */
      className="pointer-events-auto fixed right-4 top-16 z-[70] flex max-h-[calc(100vh-96px)] w-[300px] flex-col overflow-hidden rounded-[12px] border border-[#e5e7eb] bg-white shadow-[0_24px_64px_rgb(15_23_42/0.18)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-[#eef0f4] px-3 py-2.5">
        <DesignSystemSwatch seed={sys.seed} size={18} />
        <input
          value={sys.label}
          onChange={e => panel.patch({ label: e.target.value })}
          data-testid="sliderule-design-panel-name"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-semibold text-stone-800 outline-none"
        />
        <button
          type="button"
          onClick={panel.close}
          aria-label="关闭"
          className="flex h-6 w-6 items-center justify-center rounded-md text-stone-400 transition hover:bg-[#f4f4f5] hover:text-stone-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <Row label="明暗">
          <div className="flex items-center rounded-full bg-[#f4f4f5] p-0.5">
            {[
              { on: false, label: "浅色" },
              { on: true, label: "深色" },
            ].map(o => (
              <button
                key={String(o.on)}
                type="button"
                aria-pressed={sys.dark === o.on}
                onClick={() => panel.patch({ dark: o.on })}
                className={`h-6 flex-1 rounded-full text-[12px] transition ${
                  sys.dark === o.on
                    ? "bg-white font-medium text-[#171717] shadow-sm"
                    : "text-[#5e5e5e]"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="种子色">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={sys.seed}
              onChange={e => panel.patch({ seed: e.target.value })}
              data-testid="sliderule-design-panel-seed"
              className="h-7 w-9 cursor-pointer rounded border border-[#e5e7eb] bg-white p-0.5"
            />
            <input
              value={sys.seed.toUpperCase()}
              onChange={e => {
                const v = e.target.value.trim();
                if (/^#[0-9a-fA-F]{6}$/.test(v)) panel.patch({ seed: v });
              }}
              className="h-7 min-w-0 flex-1 rounded border border-[#e5e7eb] px-2 font-mono text-[12px] text-stone-700 outline-none"
            />
          </div>
        </Row>

        <Row label="派生色板（真实渲染用的这份）">
          <div className="grid grid-cols-4 gap-1.5">
            {[
              ["主色", palette.primary],
              ["浅端", palette.gradTo],
              ["强调底", palette.accentBg],
              ["侧栏", palette.sidebarBg],
              ["内容底", palette.contentBg],
              ["强调字", palette.accentFg],
              ["侧栏字", palette.sidebarText],
              ["悬停", palette.primaryHover],
            ].map(([name, hex]) => (
              <div key={name} className="min-w-0">
                <div
                  className="h-7 w-full rounded ring-1 ring-black/10"
                  style={{ background: hex as string }}
                />
                <div className="mt-0.5 truncate text-[9px] text-stone-400">
                  {name}
                </div>
              </div>
            ))}
          </div>
        </Row>

        <Row label="角半径">
          <div className="flex gap-1.5">
            {RADII.map(r => (
              <button
                key={r.id}
                type="button"
                aria-pressed={sys.radius === r.id}
                onClick={() => panel.patch({ radius: r.id })}
                title={`${r.label}（${r.px}px）`}
                className={`h-8 flex-1 border text-[11px] transition ${
                  sys.radius === r.id
                    ? "border-[#1677ff] bg-[#eef5ff] text-[#1677ff]"
                    : "border-[#e5e7eb] text-stone-500 hover:bg-[#f8f9fb]"
                }`}
                style={{ borderRadius: Math.max(2, r.px) }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </Row>

        <Row label="具体参照（模型照着这句写，比形容词管用）">
          <textarea
            value={sys.reference ?? ""}
            onChange={e => panel.patch({ reference: e.target.value })}
            rows={3}
            data-testid="sliderule-design-panel-reference"
            placeholder="例：政府审批窗口的受理系统，几乎没有颜色，靠字重和留白分层"
            className="w-full resize-none rounded border border-[#e5e7eb] px-2 py-1.5 text-[12px] leading-5 text-stone-700 outline-none placeholder:text-stone-300"
          />
        </Row>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-[#eef0f4] px-3 py-2.5">
        {custom && (
          <button
            type="button"
            aria-label="删除"
            onClick={() => {
              deleteCustomDesignSystem(sys.id);
              panel.close();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition hover:bg-[#fef2f2] hover:text-[#dc2626]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={apply}
          data-testid="sliderule-design-panel-apply"
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md bg-[#171717] text-[12px] font-medium text-white transition hover:bg-black"
        >
          {panel.mode === "create" ? (
            <>
              <Plus className="h-3.5 w-3.5" />
              保存并应用
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" />
              应用
            </>
          )}
        </button>
      </div>
    </div>
  );
}
