/**
 * 「作品墙」密度压测台（dev-only，/app-wall-perf.html）。
 *
 * 为什么需要：应用中心的卡片不是截图，是**真挂一个 AppRuntimeScreen**
 * （见 AppsWorkbench 的 LiveAppThumb）。现在一页 12 张、统一 16:9、
 * IntersectionObserver 懒挂载，首屏只有几张进视口。而「作品墙」那版设计是
 * 大中小交错铺满一屏——**首屏十几张全部可见，懒挂载帮不上忙**，每张里面
 * 还各有若干 ECharts 实例。同屏四十个图表实例是什么开销，没人量过。
 *
 * 这个台子只干一件事：**用与生产完全同一个组件**，按可配的张数/尺寸/版式
 * 铺出来，把挂载耗时、堆内存、图表实例数、长任务、滚动掉帧交给驱动脚本读。
 * 用别的轻量替身去测毫无意义——重量全在那个组件里。
 *
 * URL 参数：
 *   ?n=14            卡片张数（默认 14，对齐设计稿一屏的密度）
 *   &layout=dense    dense（12 栅格 + grid-auto-flow:row dense，大中小交错）
 *                    | uniform（现状：等宽 16:9 四列）
 *   &lazy=0          关掉 IntersectionObserver（强制全部立刻挂载，测最坏情况）
 *
 * 纪律：模型一律取**真实会话**的五系统模型（GET /api/sliderule/sessions）。
 * 张数不够就把已有模型循环复用——压测要的是"N 个同时渲染"，不是 N 个不同
 * 应用；但绝不用手搓的假模型，那会让区块数量/图表数量偏离真实分布，测出来
 * 的数字不能用来定版式密度。
 */

import React from "react";

import {
  parseFiveSystemModelFromPerSkillEvidence,
  type FiveSystemModel,
} from "@/pages/sliderule/system-screens/five-system-model";

// 与 AppsWorkbench 同一个懒加载入口：分包边界也要一致，否则测出来的首屏
// 成本跟生产不是一回事。
const LazyAppRuntimeScreen = React.lazy(() =>
  import("@/pages/sliderule/live-runtime/AppRuntimeScreen").then(m => ({
    default: m.AppRuntimeScreen,
  }))
);

type Tier = "lg" | "md" | "sm";

/** 交错版式里每档卡占的栅格数（12 列）。lg 6 列 / md 4 列 / sm 3 列。 */
const SPAN: Record<Tier, { col: number; row: number }> = {
  lg: { col: 6, row: 2 },
  md: { col: 4, row: 2 },
  sm: { col: 3, row: 1 },
};

/**
 * 档位分配。刻意**不随机**：设计稿写的是"随机但间距统一"，但缩放是硬的
 * （scale = min(w/1440, h/810)），把桌面档应用扔进 3 栅格的小卡里，
 * 缩放会落到 8% 上下，那一格就是一团灰。这里按 lg→md→sm→md 循环，
 * 保证三档都出现、又不会让某一档全落在最小格上。
 */
function tierOf(i: number): Tier {
  const cycle: Tier[] = ["lg", "md", "sm", "md", "sm", "lg", "sm", "md"];
  return cycle[i % cycle.length];
}

interface Loaded {
  sessionId: string;
  goal: string;
  model: FiveSystemModel;
}

/** 驱动脚本读的那份数据。挂在 window 上，避免让脚本去猜 DOM。 */
declare global {
  interface Window {
    __wallPerf?: {
      config: { n: number; layout: string; lazy: boolean };
      /** 真实拿到的模型数（不足 n 时会循环复用） */
      distinctModels: number;
      /** 全部卡片挂载完成的时刻（performance.now()），未完成为 null */
      mountedAt: number | null;
      /** 开始挂载的时刻 */
      startedAt: number | null;
    };
  }
}

function PerfCard({
  item,
  tier,
  index,
  lazy,
  onMounted,
}: {
  item: Loaded;
  tier: Tier;
  index: number;
  lazy: boolean;
  onMounted: () => void;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = React.useState(!lazy);

  React.useEffect(() => {
    if (!lazy) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [lazy]);

  const span = SPAN[tier];
  return (
    <div
      ref={ref}
      data-testid="wall-card"
      data-tier={tier}
      data-index={index}
      style={{
        gridColumn: `span ${span.col}`,
        gridRow: `span ${span.row}`,
        minHeight: tier === "sm" ? 130 : 260,
      }}
      className="pointer-events-none relative overflow-hidden rounded-xl border border-stone-200 bg-[#f0f2f5] shadow-sm"
    >
      <div style={{ display: "none" }} id={`wall-controls-${index}`} />
      {visible && (
        <React.Suspense fallback={<div className="h-full w-full bg-[#eef1f5]" />}>
          <MountReporter onMounted={onMounted} />
          <LazyAppRuntimeScreen
            model={item.model}
            sessionId={`${item.sessionId}#perf${index}`}
            appTitle={item.goal}
            controlsContainer={
              (typeof document !== "undefined"
                ? (document.getElementById(`wall-controls-${index}`) as HTMLDivElement | null)
                : null) ?? undefined
            }
          />
        </React.Suspense>
      )}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1 text-[10px] text-white">
        {tier} · {item.goal.slice(0, 18)}
      </div>
    </div>
  );
}

/** 只为在 Suspense 解开后报一次"我挂上了"，不渲染任何东西。 */
function MountReporter({ onMounted }: { onMounted: () => void }) {
  React.useEffect(() => {
    onMounted();
  }, [onMounted]);
  return null;
}

export function AppWallPerfHarness() {
  const params = new URLSearchParams(window.location.search);
  const n = Math.max(1, Math.min(60, Number(params.get("n") || 14)));
  const layout = params.get("layout") === "uniform" ? "uniform" : "dense";
  const lazy = params.get("lazy") !== "0";

  const [items, setItems] = React.useState<Loaded[] | null>(null);
  const [error, setError] = React.useState("");
  const mountedCount = React.useRef(0);

  React.useEffect(() => {
    window.__wallPerf = {
      config: { n, layout, lazy },
      distinctModels: 0,
      mountedAt: null,
      startedAt: null,
    };
  }, [n, layout, lazy]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const listRes = await fetch("/api/sliderule/sessions");
        const list = await listRes.json();
        const ids: string[] = (Array.isArray(list) ? list : list?.sessions || [])
          .map((s: { sessionId?: string; id?: string }) => s.sessionId || s.id)
          .filter(Boolean);
        const loaded: Loaded[] = [];
        for (const id of ids) {
          const res = await fetch(`/api/sliderule/sessions/${encodeURIComponent(id)}`);
          if (!res.ok) continue;
          const detail = await res.json();
          const closure = findClosure(detail);
          const model = closure
            ? parseFiveSystemModelFromPerSkillEvidence(closure.perSkillEvidence)
            : null;
          if (model && Object.keys(model).length > 0) {
            loaded.push({
              sessionId: id,
              goal: String(pickGoal(detail) || id),
              model,
            });
          }
        }
        if (!alive) return;
        if (loaded.length === 0) {
          setError("一个可运行模型都没拿到——先跑出至少一个 closed 6/6 的会话再来压测");
          return;
        }
        if (window.__wallPerf) window.__wallPerf.distinctModels = loaded.length;
        setItems(loaded);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onMounted = React.useCallback(() => {
    mountedCount.current += 1;
    if (window.__wallPerf && mountedCount.current >= n) {
      window.__wallPerf.mountedAt = performance.now();
    }
  }, [n]);

  React.useEffect(() => {
    if (items && window.__wallPerf) window.__wallPerf.startedAt = performance.now();
  }, [items]);

  if (error)
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", color: "#b91c1c" }} data-testid="wall-error">
        {error}
      </div>
    );
  if (!items) return <div style={{ padding: 24, fontFamily: "system-ui" }}>加载真实模型…</div>;

  // 张数不够就循环复用（见文件头说明）
  const cards = Array.from({ length: n }, (_, i) => items[i % items.length]);

  return (
    <div style={{ padding: 16, background: "#f6f7f9", minHeight: "100vh" }}>
      <div
        data-testid="wall-grid"
        style={
          layout === "dense"
            ? {
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gridAutoRows: 130,
                // 「小卡填补大卡产生的空间」原生就有，不需要 masonry 库
                gridAutoFlow: "row dense",
                gap: 12,
              }
            : {
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 16,
              }
        }
      >
        {cards.map((item, i) => (
          <PerfCard
            key={i}
            item={item}
            index={i}
            tier={layout === "dense" ? tierOf(i) : "md"}
            lazy={lazy}
            onMounted={onMounted}
          />
        ))}
      </div>
    </div>
  );
}

/** 从会话详情里挖出闭环证据（形状与 AppsWorkbench 同源，容忍嵌套差异）。 */
type PerSkillEvidence = Partial<Record<string, { modelSection?: unknown } | undefined>>;

function findClosure(node: unknown, depth = 0): { perSkillEvidence: PerSkillEvidence } | null {
  if (depth > 8 || !node) return null;
  if (Array.isArray(node)) {
    for (const v of node) {
      const g = findClosure(v, depth + 1);
      if (g) return g;
    }
    return null;
  }
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (o.perSkillEvidence) return o as { perSkillEvidence: PerSkillEvidence };
    for (const v of Object.values(o)) {
      const g = findClosure(v, depth + 1);
      if (g) return g;
    }
  }
  return null;
}

function pickGoal(node: unknown, depth = 0): string | null {
  if (depth > 6 || !node || typeof node !== "object") return null;
  const o = node as Record<string, unknown>;
  if (typeof o.text === "string" && o.text.length > 4) return o.text;
  for (const v of Object.values(o)) {
    const g = pickGoal(v, depth + 1);
    if (g) return g;
  }
  return null;
}

export default AppWallPerfHarness;
