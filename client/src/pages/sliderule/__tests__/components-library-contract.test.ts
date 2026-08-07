import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../ComponentsLibraryPage.tsx", import.meta.url),
  "utf8"
);
const registrySource = readFileSync(
  new URL("../live-runtime/block-registry.tsx", import.meta.url),
  "utf8"
);
const htmlSource = readFileSync(
  new URL("../../../../index.html", import.meta.url),
  "utf8"
);
const catalog = JSON.parse(
  readFileSync(
    new URL("../../../../../slide-rule-python/services/data/experience_block_catalog.json", import.meta.url),
    "utf8"
  )
) as { blocks: Array<{ type: string; pageKinds?: string[] }> };

describe("components library UI contract", () => {
  it("uses Ant Design controls and cards for the library shell", () => {
    expect(pageSource).toContain("Input.Search");
    expect(pageSource).toContain("components-page-kind-switch");
    expect(pageSource).not.toContain("components-section-switch");
    expect(pageSource).toContain("components-device-switch");
    expect(pageSource).toContain("Tag.CheckableTag");
    expect(pageSource).toContain("<Card");
    expect(pageSource).toContain("@ant-design/icons");
    expect(pageSource).not.toContain('from "lucide-react"');
    expect(pageSource).not.toMatch(/<(?:input|button)\b/);
  });

  it("filters blocks directly by the six page kinds from the shared catalog", () => {
    const legalKinds = new Set([
      "workbench",
      "kanban",
      "calendar",
      "wizard",
      "dashboard",
      "monitor",
    ]);
    expect(pageSource).toContain('React.useState("workbench")');
    expect(pageSource).toContain("block.pageKinds");
    for (const block of catalog.blocks) {
      expect(block.pageKinds?.length, block.type).toBeGreaterThan(0);
      expect(block.pageKinds?.every(kind => legalKinds.has(kind)), block.type).toBe(true);
    }
  });

  it("keeps one explicit desktop/mobile preview switch and the real phone renderer", () => {
    expect(pageSource).toContain('data-testid="components-device-switch"');
    expect(pageSource).toContain('setDevice("desktop")');
    expect(pageSource).toContain('setDevice("phone")');
    expect(pageSource).toContain("<LazyPhoneExperienceBlock");
    expect(pageSource).toContain("手机档 · 桌面降级");
  });

  it("uses the application-center gradient metadata overlay", () => {
    expect(pageSource).toContain("bg-gradient-to-t from-black/70 via-black/35 to-transparent");
    expect(pageSource).toContain('position: "relative"');
  });

  it("keeps progress indicators named and allows browser zoom", () => {
    expect(registrySource).toContain(
      "aria-label={`${item.label}相对排名进度`}"
    );
    expect(htmlSource).not.toContain("maximum-scale");
  });
});
