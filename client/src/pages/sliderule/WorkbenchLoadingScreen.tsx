/**
 * WorkbenchLoadingScreen — E33 工作台加载幕布（按用户视觉稿 2026-07-17）。
 *
 * 会话水合（loadOrCreateSessionState → setSessionHydrated）期间盖在整个
 * 视口上：左侧栏骨架 + 居中品牌标/「正在准备工作台」/进度条 + 右侧工作台
 * 骨架预览。水合完成淡出后卸载，不留 DOM。
 *
 * 诚实边界：进度条是不确定动画（indeterminate），不假装知道百分比；
 * 幕布还带 15s 自毁兜底——水合链路万一挂掉，宁可露出真实空态也不无限转。
 */

import React from "react";

const BAR = "rounded bg-[#e9edf2]";

function SkeletonBar({ className }: { className: string }) {
  return <div className={`${BAR} ${className}`} aria-hidden />;
}

export function WorkbenchLoadingScreen({ visible }: { visible: boolean }) {
  // 淡出后卸载：visible 翻 false 先加 opacity-0（450ms 过渡），再摘 DOM
  const [mounted, setMounted] = React.useState(visible);
  const [fading, setFading] = React.useState(false);
  React.useEffect(() => {
    if (visible) {
      setMounted(true);
      setFading(false);
      return;
    }
    if (!mounted) return;
    setFading(true);
    const t = window.setTimeout(() => setMounted(false), 450);
    return () => window.clearTimeout(t);
  }, [visible, mounted]);

  // 兜底自毁：水合链路异常时 15s 后让位给真实界面（绝不无限转圈）
  React.useEffect(() => {
    if (!mounted) return;
    const t = window.setTimeout(() => setMounted(false), 15000);
    return () => window.clearTimeout(t);
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      data-testid="sliderule-loading-screen"
      className={`fixed inset-0 z-[120] flex bg-[#f7f8fa] transition-opacity duration-[450ms] ${
        fading ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* 进度条动画（indeterminate）：仅本组件用，随组件挂卸 */}
      <style>{`@keyframes sr-load-sweep{0%{transform:translateX(-100%)}55%{transform:translateX(160%)}100%{transform:translateX(160%)}}`}</style>

      {/* ── 左侧栏骨架 ─────────────────────────────────── */}
      <aside className="hidden w-[248px] shrink-0 flex-col gap-2 border-r border-[#eceef2] bg-white/70 px-4 py-5 sm:flex">
        <div className="mb-3 flex items-center gap-2">
          <img
            src={`${import.meta.env.BASE_URL}assets/sliderule-brand-mark.svg`}
            alt=""
            className="h-6 w-6"
          />
          <span className="text-[15px] font-semibold text-[#1f2329]">
            SlideRule<span className="text-[#1677ff]">.AI</span>
          </span>
        </div>
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-2.5 px-1 py-1.5">
            <SkeletonBar className="h-5 w-5" />
            <SkeletonBar className="h-3 w-28" />
          </div>
        ))}
        <div className="mt-2 flex items-center gap-2 rounded-[9px] border border-[#eceef2] bg-white px-3 py-2.5">
          <span className="text-sm text-stone-300">+</span>
          <SkeletonBar className="h-3 w-32" />
        </div>
        <div className="mt-4 px-1 text-[12px] text-stone-400">最近会话</div>
        {[0, 1, 2, 3, 4].map(i => (
          <div key={i} className="flex items-center gap-2.5 px-1 py-1.5">
            <SkeletonBar className="h-6 w-6" />
            <SkeletonBar className={`h-3 ${i % 2 ? "w-32" : "w-36"}`} />
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-2.5">
          {[0, 1].map(i => (
            <div key={i} className="flex items-center gap-2.5 px-1 py-1">
              <SkeletonBar className="h-4 w-4 rounded-full" />
              <SkeletonBar className="h-3 w-24" />
            </div>
          ))}
        </div>
      </aside>

      {/* ── 中列：极淡对话骨架垫底 + 前景加载卡 ───────────── */}
      <main className="relative flex min-w-0 flex-1 flex-col items-center justify-center">
        <div className="pointer-events-none absolute inset-0 flex flex-col px-10 py-12 opacity-45">
          <SkeletonBar className="mx-auto h-8 w-44 rounded-full" />
          <div className="mx-auto mt-14 flex w-full max-w-[460px] flex-col items-center gap-3.5">
            <div className={`${BAR} h-20 w-20 rounded-full`} aria-hidden />
            <SkeletonBar className="mt-4 h-3.5 w-64" />
            <SkeletonBar className="h-3.5 w-48" />
            <div className="mt-6 h-px w-full bg-[#eceef2]" />
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex w-full items-center gap-3">
                <SkeletonBar className="h-2.5 w-2.5 rounded-full" />
                <SkeletonBar className={`h-3 ${i % 2 ? "w-2/3" : "w-4/5"}`} />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-auto flex w-full max-w-[520px] items-center gap-3 rounded-[14px] border border-[#eceef2] bg-white px-4 py-3.5">
            <SkeletonBar className="h-4 w-4 rounded-full" />
            <SkeletonBar className="h-3 flex-1" />
            <SkeletonBar className="h-7 w-7 rounded-[8px]" />
          </div>
        </div>

        <div className="relative flex flex-col items-center">
          {/* 三蓝条品牌图形（视觉稿样式）：官方尺标 logo 小尺寸发糊，改内联绘制 */}
          <svg width="46" height="46" viewBox="0 0 46 46" aria-label="SlideRule">
            <rect x="6" y="18" width="9" height="22" rx="2.5" fill="#69a9ff" />
            <rect x="18.5" y="10" width="9" height="30" rx="2.5" fill="#1677ff" />
            <rect x="31" y="14" width="9" height="26" rx="2.5" fill="#3d8bff" />
          </svg>
          <div className="mt-5 text-[19px] font-semibold tracking-[0.01em] text-[#1f2329]">
            正在准备工作台
          </div>
          <div className="mt-2 text-[13px] text-stone-400">
            加载推演引擎与最近会话
          </div>
          <div className="mt-6 h-[3px] w-64 overflow-hidden rounded-full bg-[#e9edf2]">
            <div
              className="h-full w-2/5 rounded-full bg-[#1677ff]"
              style={{ animation: "sr-load-sweep 1.6s ease-in-out infinite" }}
            />
          </div>
          <div className="mt-4 text-[12px] text-stone-400">
            请稍候，马上就好
          </div>
        </div>
      </main>

      {/* ── 右列：工作台骨架预览（大屏才出，向右探出裁切）──── */}
      <div className="pointer-events-none hidden w-[42%] items-center overflow-hidden py-10 pr-0 lg:flex">
        <div className="h-[86%] w-[112%] translate-x-6 rounded-l-[16px] border border-[#eceef2] bg-white/80 p-5 opacity-60 shadow-[0_10px_40px_rgb(15_23_42/0.05)]">
          <div className="flex items-center gap-3 border-b border-[#f0f1f4] pb-4">
            <SkeletonBar className="h-8 w-8 rounded-full" />
            <SkeletonBar className="h-3 w-24" />
            <SkeletonBar className="h-3 w-16" />
            <div className="ml-auto flex items-center gap-2">
              <SkeletonBar className="h-6 w-16 rounded-[6px]" />
              <SkeletonBar className="h-6 w-20 rounded-[6px]" />
            </div>
          </div>
          <div className="flex gap-5 pt-5">
            <div className="hidden w-32 shrink-0 flex-col gap-3 xl:flex">
              {[0, 1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-2">
                  <SkeletonBar className="h-4 w-4 rounded-full" />
                  <SkeletonBar className="h-2.5 flex-1" />
                </div>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="grid grid-cols-4 gap-3">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="flex flex-col gap-2 rounded-[10px] border border-[#f0f1f4] p-3">
                    <SkeletonBar className="h-2 w-10" />
                    <SkeletonBar className="h-3.5 w-16" />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-[3fr_2fr] gap-3">
                <div className="rounded-[10px] border border-[#f0f1f4] p-4">
                  <SkeletonBar className="h-24 w-full" />
                </div>
                <div className="flex items-center justify-center gap-4 rounded-[10px] border border-[#f0f1f4] p-4">
                  <div className={`${BAR} h-16 w-16 rounded-full`} aria-hidden />
                  <div className="flex flex-col gap-2">
                    {[0, 1, 2].map(i => (
                      <SkeletonBar key={i} className="h-2.5 w-16" />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2.5 rounded-[10px] border border-[#f0f1f4] p-4">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-3">
                    <SkeletonBar className="h-2.5 w-16" />
                    <SkeletonBar className="h-2.5 flex-1" />
                    <SkeletonBar className="h-2.5 w-12" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
