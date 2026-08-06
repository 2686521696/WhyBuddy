export const PAGE_CONTENT_REF = "page-content";

export type BusinessPageBreakpoint = "desktop" | "tablet" | "phone";

export interface BusinessGridItem {
  blockRef: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BusinessGridLayouts = Partial<
  Record<BusinessPageBreakpoint, BusinessGridItem[]>
>;

export interface LegacyBusinessSlots {
  summary: string[];
  primary: string[];
  secondary: string[];
  activity: string[];
  content: string[];
}

export const BUSINESS_GRID_COLUMNS: Record<BusinessPageBreakpoint, number> = {
  desktop: 12,
  tablet: 8,
  phone: 4,
};

const BREAKPOINTS: BusinessPageBreakpoint[] = ["desktop", "tablet", "phone"];

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeItems(
  raw: unknown,
  validRefs: ReadonlySet<string>,
  columns: number
): BusinessGridItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: BusinessGridItem[] = [];

  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const blockRef = String(item.blockRef ?? "").trim();
    const rawX = asInteger(item.x);
    const rawY = asInteger(item.y);
    const rawW = asInteger(item.w);
    const rawH = asInteger(item.h);
    if (
      !blockRef ||
      !validRefs.has(blockRef) ||
      seen.has(blockRef) ||
      rawX === null ||
      rawY === null ||
      rawW === null ||
      rawH === null ||
      rawW <= 0 ||
      rawH <= 0
    ) {
      continue;
    }

    const w = Math.min(columns, rawW);
    const x = Math.min(Math.max(0, rawX), columns - w);
    items.push({
      blockRef,
      x,
      y: Math.max(0, rawY),
      w,
      h: rawH,
    });
    seen.add(blockRef);
  }

  return items.sort((a, b) => a.y - b.y || a.x - b.x);
}

export function normalizeBusinessGrid(
  raw: unknown,
  validRefs: ReadonlySet<string>
): BusinessGridLayouts | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const layouts: BusinessGridLayouts = {};

  for (const breakpoint of BREAKPOINTS) {
    const items = normalizeItems(
      source[breakpoint],
      validRefs,
      BUSINESS_GRID_COLUMNS[breakpoint]
    );
    if (items.length > 0) layouts[breakpoint] = items;
  }

  return Object.keys(layouts).length > 0 ? layouts : undefined;
}

function projectItems(
  items: BusinessGridItem[],
  breakpoint: BusinessPageBreakpoint
): BusinessGridItem[] {
  const columns = BUSINESS_GRID_COLUMNS[breakpoint];
  if (breakpoint === "phone") {
    return items
      .slice()
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((item, index) => ({
        ...item,
        x: 0,
        y: index,
        w: columns,
      }));
  }
  return items.map(item => {
    const w = Math.min(columns, item.w);
    return {
      ...item,
      w,
      x: Math.min(Math.max(0, item.x), columns - w),
    };
  });
}

export function resolveBusinessGrid(
  layouts: BusinessGridLayouts,
  breakpoint: BusinessPageBreakpoint
): BusinessGridItem[] {
  const source =
    layouts[breakpoint] ??
    (breakpoint === "phone" ? layouts.tablet : undefined) ??
    layouts.desktop ??
    [];
  return projectItems(source, breakpoint);
}

export function ensurePageContentItem(
  items: BusinessGridItem[],
  breakpoint: BusinessPageBreakpoint
): BusinessGridItem[] {
  if (items.some(item => item.blockRef === PAGE_CONTENT_REF)) return items;
  const nextY = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  return [
    ...items,
    {
      blockRef: PAGE_CONTENT_REF,
      x: 0,
      y: nextY,
      w: BUSINESS_GRID_COLUMNS[breakpoint],
      h: breakpoint === "phone" ? 2 : 3,
    },
  ];
}

function fullWidthItems(
  refs: string[],
  columns: number,
  startY: number
): BusinessGridItem[] {
  return refs.map((blockRef, index) => ({
    blockRef,
    x: 0,
    y: startY + index,
    w: columns,
    h: 1,
  }));
}

function phonePreset(kind: string, slots: LegacyBusinessSlots): BusinessGridItem[] {
  const ordered =
    kind === "dashboard"
      ? [
          ...slots.summary,
          PAGE_CONTENT_REF,
          ...slots.secondary,
          ...slots.activity,
          ...slots.primary,
          ...slots.content,
        ]
      : [
          ...slots.summary,
          ...slots.primary,
          PAGE_CONTENT_REF,
          ...slots.secondary,
          ...slots.activity,
          ...slots.content,
        ];
  return ordered.map((blockRef, index) => ({
    blockRef,
    x: 0,
    y: index,
    w: BUSINESS_GRID_COLUMNS.phone,
    h: blockRef === PAGE_CONTENT_REF ? 2 : 1,
  }));
}

export function upgradeLegacySlotsToGrid(
  kind: string,
  slots: LegacyBusinessSlots
): Required<Pick<BusinessGridLayouts, "desktop" | "tablet" | "phone">> {
  const desktopColumns = BUSINESS_GRID_COLUMNS.desktop;
  if (kind === "dashboard") {
    const desktop = fullWidthItems(slots.summary, desktopColumns, 0);
    const contentY = desktop.length;
    const support = [...slots.secondary, ...slots.activity];
    desktop.push({
      blockRef: PAGE_CONTENT_REF,
      x: 0,
      y: contentY,
      w: support.length > 0 ? 8 : desktopColumns,
      h: 3,
    });
    support.forEach((blockRef, index) => {
      desktop.push({
        blockRef,
        x: 8,
        y: contentY + index,
        w: 4,
        h: support.length === 1 ? 3 : 1,
      });
    });
    fullWidthItems(
      [...slots.primary, ...slots.content],
      desktopColumns,
      contentY + 3
    ).forEach(item => desktop.push(item));
    const tablet = desktop.map(item => ({
      ...item,
      x: 0,
      w: BUSINESS_GRID_COLUMNS.tablet,
    }));
    return { desktop, tablet, phone: phonePreset(kind, slots) };
  }

  const leading = [...slots.summary, ...slots.primary];
  const desktop = fullWidthItems(leading, desktopColumns, 0);
  const contentY = desktop.length;
  const support = [...slots.secondary, ...slots.activity, ...slots.content];

  if ((kind === "kanban" || kind === "calendar") && support.length > 0) {
    desktop.push({
      blockRef: PAGE_CONTENT_REF,
      x: 0,
      y: contentY,
      w: 9,
      h: 3,
    });
    support.forEach((blockRef, index) => {
      desktop.push({
        blockRef,
        x: 9,
        y: contentY + index,
        w: 3,
        h: support.length === 1 ? 3 : 1,
      });
    });
  } else if (support.length > 0) {
    desktop.push({
      blockRef: PAGE_CONTENT_REF,
      x: 0,
      y: contentY,
      w: 8,
      h: 3,
    });
    support.forEach((blockRef, index) => {
      desktop.push({
        blockRef,
        x: 8,
        y: contentY + index,
        w: 4,
        h: support.length === 1 ? 3 : 1,
      });
    });
  } else {
    desktop.push({
      blockRef: PAGE_CONTENT_REF,
      x: 0,
      y: contentY,
      w: desktopColumns,
      h: 3,
    });
  }

  const tablet = desktop.map(item => ({
    ...item,
    x: 0,
    w: BUSINESS_GRID_COLUMNS.tablet,
  }));

  return { desktop, tablet, phone: phonePreset(kind, slots) };
}
