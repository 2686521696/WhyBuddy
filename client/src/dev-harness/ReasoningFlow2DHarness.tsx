/**
 * Dev-only 2D Reasoning Flow Surface harness.
 *
 * 直接渲染独立的 2D infinite canvas 版本，用于快速验证“截图级产品感”效果。
 * 使用与 3D wall 相同的 REASONING_GRAPH_FIXTURE，保证数据边界一致（已隔离的 Effect/Reasoning 数据）。
 *
 * 访问方式：可以在 wall-fixture.html 或单独的 dev 入口挂载。
 * 目标：浅色无限画布、轻量圆角卡片、细虚线贝塞尔 + 中文标签、telemetry + console + minimap + 控制、hover 高亮上下游路径。
 */

import { ReasoningFlowSurface } from "@/components/autopilot/ReasoningFlowSurface";
import { REASONING_GRAPH_FIXTURE } from "./reasoning-graph-fixture";

export function ReasoningFlow2DHarness() {
  // QA mode: the F key (handled inside ReasoningFlowSurface) will now call fit()
  // for consistent reference composition when taking screenshots.
  // Open full-screen or fixed viewport size for best comparison against the target mind-map image.
  //
  // The harness label is only shown when ?debug=1 is present.
  // This keeps default ?surface=2d screenshots completely clean (no overlay on telemetry).
  // Add &debug=1 when you want the "press F + hover nodes" reminder visible in the shot.
  const showHarnessLabel =
    typeof window !== "undefined" &&
    new URL(window.location.href).searchParams.get("debug") === "1";

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#f8fafc" }}>
      <ReasoningFlowSurface
        graph={REASONING_GRAPH_FIXTURE}
        initialScale={0.82}
        className="h-full w-full"
      />
      {/* Top-center harness label (when ?debug=1). Avoids collision with left telemetry and right controls. */}
      {showHarnessLabel && (
        <div
          style={{
            position: "fixed",
            top: 6,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 10,
            color: "#64748b",
            pointerEvents: "none",
            background: "rgba(255,255,255,0.8)",
            padding: "1px 6px",
            borderRadius: 3,
            whiteSpace: "nowrap",
          }}
        >
          2D Reasoning Map QA harness — press F to fit • hover nodes to trace
          paths • ?surface=2d&debug=1
        </div>
      )}
    </div>
  );
}

export default ReasoningFlow2DHarness;
