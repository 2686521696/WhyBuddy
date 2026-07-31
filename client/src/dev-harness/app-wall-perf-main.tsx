/**
 * Dev-only entry：「作品墙」密度压测台，/app-wall-perf.html（vite dev 下可达）。
 *
 * 用途见 AppWallPerfHarness.tsx。跟 block-gallery / wall-fixture 同一套路子，
 * 不进生产产物（vite 的构建入口只有 index.html）。
 *
 * 刻意**不套 StrictMode**：StrictMode 在开发下会把每个组件挂载两遍，
 * 压测要的是真实挂载成本，双挂会让所有数字翻倍且不可比。
 */
import { createRoot } from "react-dom/client";

import "../index.css";
import { AppWallPerfHarness } from "./AppWallPerfHarness";

const container = document.getElementById("app-wall-perf-root");
if (!container) throw new Error("app-wall-perf-root container missing");

createRoot(container).render(<AppWallPerfHarness />);
