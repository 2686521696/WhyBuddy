/**
 * Dev-only entry for the wall / reasoning renderer-fidelity harness.
 *
 * Reachable at /wall-fixture.html under `vite dev`.
 * - Default: 3D `BlueprintWallTexture` (old wall fixture)
 * - ?surface=2d : 新 2D ReasoningFlowSurface（独立无限画布，目标产品感）
 *
 * 用于视觉 QA 对比截图效果。NOT prod.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";
// Import additional design tokens/layers for full visual parity with main app (Tailwind + mirofish styles)
import "../styles/mirofish-tokens.css";
import "../styles/mirofish-layer.css";

import { WallFixtureHarness } from "./WallFixtureHarness";
import { ReasoningFlow2DHarness } from "./ReasoningFlow2DHarness";

const container = document.getElementById("wall-fixture-root");
if (!container) {
  throw new Error("wall-fixture-root container missing");
}

const url = new URL(window.location.href);
const use2D = url.searchParams.get("surface") === "2d";

createRoot(container).render(
  <StrictMode>
    {use2D ? <ReasoningFlow2DHarness /> : <WallFixtureHarness />}
  </StrictMode>
);
