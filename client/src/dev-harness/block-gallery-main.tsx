/**
 * Dev-only entry：体验区块视觉对照台，/block-gallery.html（vite dev 下可达）。
 *
 * 用途见 BlockGalleryHarness.tsx。跟 wall-fixture 一样只用于视觉 QA 截图，
 * 不进生产产物（vite 的构建入口只有 index.html）。
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../index.css";
import { BlockGalleryHarness } from "./BlockGalleryHarness";

const container = document.getElementById("block-gallery-root");
if (!container) throw new Error("block-gallery-root container missing");

createRoot(container).render(
  <StrictMode>
    <BlockGalleryHarness />
  </StrictMode>
);
