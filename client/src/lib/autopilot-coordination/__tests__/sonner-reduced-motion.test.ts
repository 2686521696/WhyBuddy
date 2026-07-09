import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("sonner reduced motion stylesheet", () => {
  it("disables transitions and animations inside the reduced-motion media query", async () => {
    const cssPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../../node_modules/sonner/dist/styles.css"
    );
    const css = await readFile(cssPath, "utf-8");

    expect(css).toContain("@media (prefers-reduced-motion)");
    expect(css).toContain("transition: none !important;");
    expect(css).toContain("animation: none !important;");
  });
});
