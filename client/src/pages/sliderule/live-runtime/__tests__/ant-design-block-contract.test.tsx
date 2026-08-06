import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ExperienceBlockBoundary,
  type ExperienceBlockInstance,
  type ExperienceBlockRendererProps,
} from "../block-registry";

function render(
  block: ExperienceBlockInstance,
  props: Omit<ExperienceBlockRendererProps, "block"> = {}
) {
  return renderToStaticMarkup(
    <ExperienceBlockBoundary block={block} {...props} />
  );
}

describe("experience blocks use Ant Design primitives", () => {
  it("renders FilterBar as QueryFilter with Ant Design form controls", () => {
    const html = render(
      {
        id: "filters",
        type: "FilterBar",
        props: { title: "Check-in Filters", showDateRange: true },
      },
      {
        filterState: { enumFilters: {} },
        filterFieldOptions: [
          {
            id: "status",
            label: "Status",
            options: [{ value: "open", label: "Open" }],
          },
        ],
        dateRangeField: { id: "created_at", label: "Created at" },
      }
    );

    expect(html).toContain("ant-pro-query-filter");
    expect(html).toContain("ant-picker");
    expect(html).toContain("ant-select");
    expect(html).not.toContain('type="date"');
  });

  it("renders WorkflowTimeline with Ant Design Steps instead of hand-drawn cards", () => {
    const html = render(
      {
        id: "workflow",
        type: "WorkflowTimeline",
        props: { title: "Exception Recovery" },
      },
      {
        workflow: {
          nodes: [
            { id: "detect", name: "Detect", assigneeRole: "front_desk" },
            { id: "verify", name: "Verify", assigneeRole: "manager" },
          ],
          transitions: [
            { from: "detect", to: "verify", condition: "manual review" },
          ],
        },
      }
    );

    expect(html).toContain("ant-steps");
    expect(html).toContain("ant-steps-item");
    expect(html).not.toContain("anticon-arrow-right");
  });

  it("renders QuickActionPanel with ProCard", () => {
    const html = render(
      { id: "actions", type: "QuickActionPanel", props: { title: "Actions" } },
      { pageActions: [{ id: "create", label: "Create", permitted: true }] }
    );

    expect(html).toContain("ant-pro-card");
    expect(html).toContain("ant-btn");
  });

  it("renders MetricGrid with StatisticCard", () => {
    const html = render(
      {
        id: "metrics",
        type: "MetricGrid",
        props: { title: "Overview" },
        binding: { entityRef: "orders", aggregate: "count" },
      },
      {
        entityRows: {
          orders: [
            { id: "1", values: {}, createdAt: "2026-01-01" },
            { id: "2", values: {}, createdAt: "2026-01-01" },
          ],
        },
      }
    );

    expect(html).toContain("ant-pro-statistic-card");
    expect(html).not.toContain("bg-stone-50");
  });
});
