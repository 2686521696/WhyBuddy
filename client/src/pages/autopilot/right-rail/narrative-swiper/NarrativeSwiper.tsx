/**
 * Autopilot 右栏底部叙事 Swiper — `<NarrativeSwiper>` 组件
 *
 * 使用 embla-carousel-react + embla-carousel-autoplay 替代手写拖拽/轮播逻辑，
 * 获得真实的 CSS transform 滑动轨道、惯性、弹性回弹与内置 autoplay。
 *
 * 对应 spec：
 * - `.kiro/specs/autopilot-right-rail-narrative-swiper/requirements.md`
 *   - Requirement 2.1-2.12：Swiper 容器与即来即走交互
 *   - Requirement 7.1-7.5：响应式三档
 *   - Requirement 8.1-8.7：可访问性
 *   - Requirement 6.1-6.6：阶段切换与卡片生命周期
 *
 * 关键约束：
 * - 使用 embla-carousel-react + embla-carousel-autoplay（已安装）
 * - 不扩大 TS 基线
 * - SSR 安全：embla 在 SSR 下不初始化引擎，仅输出静态结构
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FC,
} from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";

import type { AppLocale } from "@/lib/locale";
import type { BlueprintGenerationJob } from "@shared/blueprint/contracts";

import type { NarrativeCard, Stage } from "./narrative-card-types";
import { STAGE_VISUAL_LANES } from "./stage-visual-lane";
import { useNarrativeCardStream } from "./use-narrative-card-stream";
import { useViewportTier, type ViewportTier } from "../hooks/use-viewport-tier";

// ─── Props ─────────────────────────────────────────────────────────────────

export interface NarrativeSwiperProps {
  /** 当前 Stage；由 AutopilotRightRail 传入，对应 STAGE_ORDER 的 6 个值。 */
  stage: Stage;
  /** 当前蓝图 job，用于派生 route_decision / artifact / node_completed。 */
  job: BlueprintGenerationJob | null;
  /** 应用语言。 */
  locale: AppLocale;
  /** 容量上限，默认 8。 */
  capacity?: number;
  /** Dwell_Time 默认 ms，默认 5000。 */
  defaultDwellMs?: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────

/** hover 离开后恢复 autoplay 的延迟（ms）。 */
const HOVER_LEAVE_DELAY_MS = 300;

// ─── i18n helper ───────────────────────────────────────────────────────────

function t(locale: AppLocale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

// ─── useReducedMotion ──────────────────────────────────────────────────────

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reducedMotion;
}

// ─── Responsive height helper ──────────────────────────────────────────────

function resolveResponsiveClass(tier: ViewportTier): string {
  switch (tier) {
    case "side-fixed":
      return "h-[26%] min-h-[140px] max-h-[240px]";
    case "side-collapsible":
      return "h-[96px] min-h-[96px] max-h-[120px]";
    case "drawer":
      return "";
  }
}

// ─── EmptyLanePlaceholder ──────────────────────────────────────────────────

function EmptyLanePlaceholder({ locale }: { locale: AppLocale }) {
  return (
    <div
      className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-slate-500"
      data-testid="narrative-swiper-empty"
    >
      <span>
        {t(locale, "等待新的输入单据投入柜台", "Waiting for narrative cards…")}
      </span>
    </div>
  );
}

// ─── MobileChip ────────────────────────────────────────────────────────────

function MobileChip({
  locale,
  stage,
  cards,
  activeIndex,
}: {
  locale: AppLocale;
  stage: Stage;
  cards: NarrativeCard[];
  activeIndex: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isPreview = stage === "effect_preview";
  const currentCard: NarrativeCard | undefined = cards[activeIndex];
  const showSheet = expanded && !isPreview;

  return (
    <>
      <button
        type="button"
        data-testid="narrative-swiper-chip"
        data-stage={stage}
        aria-label={t(locale, "展开叙事卡片", "Expand narrative cards")}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full bg-slate-800/90 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-sm"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="size-2 rounded-full bg-blue-400 animate-pulse" />
        <span className="max-w-[120px] truncate">
          {currentCard?.headline ?? t(locale, "叙事流", "Narrative")}
        </span>
        {cards.length > 0 && (
          <span className="text-slate-400">{activeIndex + 1}/{cards.length}</span>
        )}
      </button>

      {showSheet && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 max-h-[50vh] overflow-y-auto rounded-t-xl border-t border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          role="dialog"
          aria-label={t(locale, "叙事卡片列表", "Narrative card list")}
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t(locale, "叙事卡片", "Narrative Cards")}
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="rounded p-1 text-slate-400 hover:text-slate-600"
              aria-label={t(locale, "关闭", "Close")}
            >
              ✕
            </button>
          </div>
          <ul className="space-y-2">
            {cards.map((card, i) => (
              <li
                key={card.id}
                className={
                  "rounded-md border p-2 text-xs " +
                  (i === activeIndex
                    ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/30"
                    : "border-slate-200 dark:border-slate-700")
                }
              >
                <p className="font-medium text-slate-700 dark:text-slate-200 truncate">
                  {card.headline}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ─── NarrativeSwiper ───────────────────────────────────────────────────────

export const NarrativeSwiper: FC<NarrativeSwiperProps> = ({
  stage,
  job: _job,
  locale,
  capacity = 8,
  defaultDwellMs = 5000,
}) => {
  const tier = useViewportTier();
  const reducedMotion = useReducedMotion();
  const lane = STAGE_VISUAL_LANES[stage];
  const { cards, echoCount } = useNarrativeCardStream({ stage, capacity });

  // ─── Stage Transition Tracking ─────────────────────────────────────────────
  const prevStageRef = useRef<Stage>(stage);
  const [stageTransitioning, setStageTransitioning] = useState(false);

  useEffect(() => {
    if (prevStageRef.current !== stage) {
      setStageTransitioning(true);
      const timer = setTimeout(() => setStageTransitioning(false), 600);
      prevStageRef.current = stage;
      return () => clearTimeout(timer);
    }
  }, [stage]);

  // ─── Embla Carousel ────────────────────────────────────────────────────────
  const autoplayPlugin = useRef(
    Autoplay({
      delay: defaultDwellMs,
      stopOnInteraction: true,
      stopOnMouseEnter: true,
      stopOnFocusIn: true,
    })
  );

  const [emblaRef, emblaApi] = useEmblaCarousel(
    {
      loop: true,
      align: "center",
      skipSnaps: false,
      duration: reducedMotion ? 0 : 20,
    },
    reducedMotion ? [] : [autoplayPlugin.current]
  );

  // ─── Track selected index ─────────────────────────────────────────────────
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!emblaApi) return;
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap());
    emblaApi.on("select", onSelect);
    onSelect();
    return () => { emblaApi.off("select", onSelect); };
  }, [emblaApi]);

  // ─── Reindex when cards change ─────────────────────────────────────────────
  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.reInit();
  }, [emblaApi, cards.length]);

  // ─── Hover pause/resume ────────────────────────────────────────────────────
  const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    autoplayPlugin.current.stop();
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoverLeaveTimerRef.current = setTimeout(() => {
      autoplayPlugin.current.play();
      hoverLeaveTimerRef.current = null;
    }, HOVER_LEAVE_DELAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
    };
  }, []);

  // ─── Focus pause ──────────────────────────────────────────────────────────
  const handleFocus = useCallback(() => autoplayPlugin.current.stop(), []);
  const handleBlur = useCallback(() => autoplayPlugin.current.play(), []);

  // ─── Keyboard nav ─────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!emblaApi) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); emblaApi.scrollPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); emblaApi.scrollNext(); }
    },
    [emblaApi],
  );

  // ─── Nav button handlers ──────────────────────────────────────────────────
  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

  // ─── Derived state ────────────────────────────────────────────────────────
  const currentCard: NarrativeCard | undefined = cards[selectedIndex];
  const isEchoCard = selectedIndex < echoCount;
  const visibleTotal = Math.max(0, cards.length - echoCount);
  const displayIndex = Math.max(0, selectedIndex - echoCount) + 1;

  // ─── < 768px：chip 形态 ───────────────────────────────────────────────────
  if (tier === "drawer") {
    return (
      <MobileChip locale={locale} stage={stage} cards={cards} activeIndex={selectedIndex} />
    );
  }

  const transitionClass = reducedMotion ? "transition-none" : "transition-all duration-[600ms]";

  return (
    <section
      role="region"
      aria-label={t(locale, "当前阶段叙事流", "Current stage narrative")}
      data-testid="narrative-swiper"
      data-stage={stage}
      data-viewport-tier={tier}
      className={
        "relative shrink-0 border-t border-slate-200/40 " +
        lane.backgroundClass + " " +
        transitionClass + " " +
        resolveResponsiveClass(tier) + " " +
        "select-none overflow-hidden"
      }
      tabIndex={0}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {cards.length === 0 ? (
        <EmptyLanePlaceholder locale={locale} />
      ) : (
        <>
          {/* Embla viewport */}
          <div className="h-full overflow-hidden" ref={emblaRef}>
            <div className="flex h-full touch-pan-y">
              {cards.map((card, i) => (
                <div
                  key={card.id}
                  className="flex min-w-0 flex-[0_0_100%] items-center justify-center px-10"
                >
                  <div
                    className={
                      "w-full max-w-full overflow-hidden rounded-md border bg-white/80 p-3 dark:bg-slate-800/60 " +
                      lane.cardBorderClass +
                      (i < echoCount ? " opacity-50" : "") +
                      (stageTransitioning ? " opacity-30 transition-opacity duration-[600ms]" : "")
                    }
                    data-card-id={card.id}
                    data-source={card.source}
                    data-echo={i < echoCount ? "true" : undefined}
                  >
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                      {card.headline}
                    </p>
                    {card.detail && (
                      <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">
                        {card.detail}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Left nav button */}
          <button
            type="button"
            aria-label={t(locale, "上一张叙事卡片", "Previous narrative card")}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-200/70 p-1.5 text-slate-600 hover:bg-slate-300/80 focus-visible:ring-2 focus-visible:ring-blue-400 dark:bg-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-600/70"
            onClick={scrollPrev}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>

          {/* Right nav button */}
          <button
            type="button"
            aria-label={t(locale, "下一张叙事卡片", "Next narrative card")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-slate-200/70 p-1.5 text-slate-600 hover:bg-slate-300/80 focus-visible:ring-2 focus-visible:ring-blue-400 dark:bg-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-600/70"
            onClick={scrollNext}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          {/* Position indicator */}
          <span className="absolute bottom-2 right-3 text-xs text-slate-400 dark:text-slate-500">
            {visibleTotal > 0 ? `${displayIndex} / ${visibleTotal}` : ""}
          </span>
        </>
      )}

      {/* Aria live region */}
      <div aria-live="polite" aria-atomic="false" className="sr-only">
        {currentCard?.headline ?? ""}
      </div>
    </section>
  );
};
