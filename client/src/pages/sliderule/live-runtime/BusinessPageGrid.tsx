import React from "react";
import {
  BUSINESS_GRID_COLUMNS,
  type BusinessGridItem,
  type BusinessPageBreakpoint,
} from "./business-page-layout";

export default function BusinessPageGrid({
  breakpoint,
  items,
  renderItem,
}: {
  breakpoint: BusinessPageBreakpoint;
  items: BusinessGridItem[];
  renderItem: (blockRef: string) => React.ReactNode;
}) {
  const columns = BUSINESS_GRID_COLUMNS[breakpoint];
  return (
    <div
      data-testid="business-page-grid"
      data-breakpoint={breakpoint}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(" + columns + ",minmax(0,1fr))",
        gridAutoRows: "minmax(min-content,auto)",
        gap: breakpoint === "phone" ? 8 : 12,
        alignItems: "start",
        minWidth: 0,
      }}
    >
      {items.map(item => {
        const node = renderItem(item.blockRef);
        if (node === null || node === undefined || node === false) return null;
        return (
          <div
            key={item.blockRef}
            data-layout-ref={item.blockRef}
            style={{
              gridColumn: item.x + 1 + " / span " + item.w,
              gridRow: item.y + 1 + " / span " + item.h,
              minWidth: 0,
              alignSelf: "stretch",
            }}
          >
            {node}
          </div>
        );
      })}
    </div>
  );
}
