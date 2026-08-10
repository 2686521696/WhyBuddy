import usageJson from "./generated/block-component-usage.json";
import type { BaseComponentDef } from "./base-components/base-catalog";

export type UsageDevice = "desktop" | "phone";

type GeneratedBlockUsage = {
  desktop: string[];
  phone: string[];
};

type GeneratedUsage = {
  version: number;
  audit: {
    method: string;
    renderedButNotCataloged: string[];
    phoneEnabledBlocks: string[];
    desktopDeclarationMismatches: Record<
      string,
      { undeclared: string[]; notDetected: string[] }
    >;
  };
  blocks: Record<string, GeneratedBlockUsage>;
};

export interface ComponentUsage {
  desktopBlocks: string[];
  phoneBlocks: string[];
  allBlocks: string[];
}

export interface BlockComponentUsage {
  desktop: string[];
  phone: string[];
  all: string[];
}

// ECharts is a shared custom renderer: desktop and phone each have a dedicated
// chart host, while the catalog intentionally keeps one shared custom entry.
const SHARED_COMPONENTS = new Set(["ECharts"]);

const GENERATED = usageJson as GeneratedUsage;

function reverseIndex(device: UsageDevice): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [blockType, usage] of Object.entries(GENERATED.blocks)) {
    for (const component of usage[device]) {
      const blocks = index.get(component);
      if (blocks) blocks.push(blockType);
      else index.set(component, [blockType]);
    }
  }
  for (const blocks of index.values())
    blocks.sort((a, b) => a.localeCompare(b));
  return index;
}

const DESKTOP_BLOCKS = reverseIndex("desktop");
const PHONE_BLOCKS = reverseIndex("phone");

export function usageFor(component: BaseComponentDef): ComponentUsage {
  const shared = SHARED_COMPONENTS.has(component.name);
  const desktopBlocks =
    component.platform === "pc" || shared
      ? (DESKTOP_BLOCKS.get(component.name) ?? [])
      : [];
  const phoneBlocks =
    component.platform === "mobile" || shared
      ? (PHONE_BLOCKS.get(component.name) ?? [])
      : [];
  return {
    desktopBlocks,
    phoneBlocks,
    allBlocks: [...new Set([...desktopBlocks, ...phoneBlocks])],
  };
}

export function usageForName(name: string): ComponentUsage {
  return {
    desktopBlocks: DESKTOP_BLOCKS.get(name) ?? [],
    phoneBlocks: PHONE_BLOCKS.get(name) ?? [],
    allBlocks: [
      ...new Set([
        ...(DESKTOP_BLOCKS.get(name) ?? []),
        ...(PHONE_BLOCKS.get(name) ?? []),
      ]),
    ],
  };
}

export function usageMapFor(
  components: BaseComponentDef[]
): Map<string, ComponentUsage> {
  return new Map(
    components.map(component => [component.name, usageFor(component)])
  );
}

export function usageStats(components: BaseComponentDef[]) {
  const rows = components.map(component => ({
    component,
    usage: usageFor(component),
  }));
  return {
    total: rows.length,
    desktop: rows.filter(row => row.usage.desktopBlocks.length > 0).length,
    phone: rows.filter(row => row.usage.phoneBlocks.length > 0).length,
    any: rows.filter(row => row.usage.allBlocks.length > 0).length,
    unlinked: rows.filter(row => row.usage.allBlocks.length === 0).length,
    desktopRelations: Object.values(GENERATED.blocks).reduce(
      (total, usage) => total + usage.desktop.length,
      0
    ),
    phoneRelations: Object.values(GENERATED.blocks).reduce(
      (total, usage) => total + usage.phone.length,
      0
    ),
  };
}

/** Forward lookup for block cards. This is the same generated graph used by the reverse statistics. */
export function usageForBlock(blockType: string): BlockComponentUsage {
  const usage = GENERATED.blocks[blockType] ?? { desktop: [], phone: [] };
  return {
    desktop: usage.desktop,
    phone: usage.phone,
    all: [...new Set([...usage.desktop, ...usage.phone])],
  };
}

/** Search and AI proposal callers need the same reverse graph as the page. */
export function blocksUsing(componentName: string): string[] {
  return usageForName(componentName).allBlocks;
}

export function generatedUsage() {
  return GENERATED;
}
