import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import catalogJson from "@experience-blocks";
import { usageForBlock } from "../../component-usage";
import {
  BLOCK_DEFINITIONS,
  ExperienceBlockBoundary,
  type ExperienceBlockInstance,
} from "../block-registry";
import {
  alertExpressionPipelineValid,
  authenticationFlowCanSave,
  filterScopesValid,
  fulfillmentAllocationValid,
  INDEPENDENT_STRUCTURE_BATCH10_LABELS,
  scaffolderTaskActions,
  scaffolderTaskStatus,
  syncWaveCanAdvance,
} from "../independent-structure-blocks-batch10";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = {
  demo: [
    {
      id: "root",
      createdAt: "2026-08-11",
      values: {
        name: "Browser",
        authParent: "",
        scopeParent: "",
        requirement: "REQUIRED",
        priority: 0,
        configurable: "true",
        kind: "filter",
        label: "区域",
        filter: "",
        line: "line-1",
        product: "T 恤",
        ordered: 3,
        warehouse: "华东仓",
        available: 3,
        preorder: "false",
        ref: "A",
        expressionKind: "Query",
        input: "",
        formula: "rate(errors[5m])",
        preview: "success",
        resource: "migration",
        phase: "PreSync",
        wave: -1,
        resourceKind: "Job",
        syncStatus: "healthy",
        step: "读取模板",
        stepStatus: "failed",
        log: "template loaded",
        output: "catalog-info.yaml",
        duration: 4,
      },
    },
    {
      id: "child",
      createdAt: "2026-08-11",
      values: {
        name: "Login form",
        authParent: "root",
        scopeParent: "",
        requirement: "ALTERNATIVE",
        priority: 10,
        configurable: "true",
        kind: "chart",
        label: "收入趋势",
        filter: "root",
        line: "line-1",
        product: "T 恤",
        ordered: 3,
        warehouse: "华南仓",
        available: 2,
        preorder: "false",
        ref: "B",
        expressionKind: "Reduce",
        input: "A",
        formula: "last(A)",
        preview: "success",
        resource: "orders-api",
        phase: "Sync",
        wave: 0,
        resourceKind: "Deployment",
        syncStatus: "synced",
        step: "发布仓库",
        stepStatus: "failed",
        log: "push rejected",
        output: "https://git.example.com/orders",
        duration: 7,
      },
    },
  ],
};

const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  AuthenticationFlowExecutionTree: {
    entityRef: "demo",
    executionNameFieldRef: "name",
    parentExecutionFieldRef: "authParent",
    requirementFieldRef: "requirement",
    priorityFieldRef: "priority",
    configurableFieldRef: "configurable",
    targets: ["flow"],
  },
  DashboardFilterScopeMapper: {
    entityRef: "demo",
    nodeKindFieldRef: "kind",
    nodeLabelFieldRef: "label",
    parentNodeFieldRef: "scopeParent",
    filterFieldRef: "filter",
    targets: ["dashboard"],
  },
  OrderFulfillmentAllocationComposer: {
    entityRef: "demo",
    orderLineFieldRef: "line",
    productFieldRef: "product",
    orderedQuantityFieldRef: "ordered",
    warehouseFieldRef: "warehouse",
    availableQuantityFieldRef: "available",
    preorderFieldRef: "preorder",
    targets: ["order"],
  },
  AlertExpressionPipelineBuilder: {
    entityRef: "demo",
    refIdFieldRef: "ref",
    expressionKindFieldRef: "expressionKind",
    inputRefFieldRef: "input",
    formulaFieldRef: "formula",
    previewStatusFieldRef: "preview",
    targets: ["alert"],
  },
  SyncWaveResourceSequencer: {
    entityRef: "demo",
    resourceNameFieldRef: "resource",
    phaseFieldRef: "phase",
    waveFieldRef: "wave",
    resourceKindFieldRef: "resourceKind",
    syncStatusFieldRef: "syncStatus",
    targets: ["application"],
  },
  ScaffolderTaskExecutionConsole: {
    entityRef: "demo",
    stepNameFieldRef: "step",
    stepStatusFieldRef: "stepStatus",
    logFieldRef: "log",
    outputFieldRef: "output",
    durationFieldRef: "duration",
    targets: ["task"],
  },
};

describe("independent structure block batch 10", () => {
  it("keeps structure families globally unique and explicit", () => {
    const catalog = catalogJson as {
      blocks: Array<{
        type: string;
        structureFamily?: string;
        structureDelta?: string;
        rendererKey: string;
        rendererStatus: string;
      }>;
    };
    const structured = catalog.blocks.filter(block => block.structureFamily);
    const selected = Object.keys(INDEPENDENT_STRUCTURE_BATCH10_LABELS).map(
      type => catalog.blocks.find(block => block.type === type)!
    );
    expect(new Set(structured.map(block => block.structureFamily)).size).toBe(
      structured.length
    );
    expect(
      selected.every(
        block =>
          block.rendererStatus === "real" && Boolean(block.structureDelta)
      )
    ).toBe(true);
    expect(new Set(selected.map(block => block.rendererKey)).size).toBe(6);
  });

  it("renders six desktop and six dedicated phone structures", () => {
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH10_LABELS)) {
      const block: ExperienceBlockInstance = {
        id: type,
        type,
        props: { surface: "plain" },
        binding: bindings[type],
      };
      const desktop = renderToStaticMarkup(
        <ExperienceBlockBoundary block={block} entityRows={rows} />
      );
      const phone = renderToStaticMarkup(
        <PhoneExperienceBlock block={block} entityRows={rows} />
      );
      expect(BLOCK_DEFINITIONS[type]?.phone, type).toBe(true);
      expect(desktop, type).not.toContain("尚未绑定");
      expect(phone, type).not.toContain("尚未绑定");
      expect(phone, type).toContain('data-testid="phone-');
    }
  });

  it("uses six distinct non-table component signatures", () => {
    const desktop = new Set<string>(),
      phone = new Set<string>();
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH10_LABELS)) {
      const usage = usageForBlock(type);
      expect(usage.desktop, type).not.toContain("Table");
      expect(usage.phone, type).not.toContain("M.Table");
      desktop.add(usage.desktop.slice().sort().join("|"));
      phone.add(usage.phone.slice().sort().join("|"));
    }
    expect(desktop.size).toBe(6);
    expect(phone.size).toBe(6);
  });

  it("enforces the six source-derived state gates", () => {
    expect(
      authenticationFlowCanSave([
        { parent: "", priority: 0, requirement: "REQUIRED" },
      ])
    ).toBe(true);
    expect(
      authenticationFlowCanSave([
        { parent: "", priority: 0, requirement: "DISABLED" },
      ])
    ).toBe(false);
    expect(filterScopesValid(["filter"], { filter: ["chart"] })).toBe(true);
    expect(filterScopesValid(["filter"], { filter: ["filter"] })).toBe(false);
    expect(
      fulfillmentAllocationValid([
        {
          lineId: "line",
          ordered: 2,
          allocations: [{ warehouseId: "east", quantity: 2 }],
        },
      ])
    ).toBe(true);
    expect(
      fulfillmentAllocationValid([
        {
          lineId: "line",
          ordered: 1,
          allocations: [{ warehouseId: "east", quantity: 2 }],
        },
      ])
    ).toBe(false);
    expect(
      alertExpressionPipelineValid([
        { refId: "A", inputRef: "", condition: false },
        { refId: "B", inputRef: "A", condition: true },
      ])
    ).toBe(true);
    expect(
      alertExpressionPipelineValid([
        { refId: "A", inputRef: "A", condition: true },
      ])
    ).toBe(false);
    expect(
      syncWaveCanAdvance([{ phase: "PreSync", wave: -1, status: "healthy" }], 0)
    ).toBe(true);
    expect(
      syncWaveCanAdvance([{ phase: "PreSync", wave: -1, status: "failed" }], 0)
    ).toBe(false);
    expect(scaffolderTaskActions("running")).toEqual({
      canCancel: true,
      canRetry: false,
      showLogs: false,
    });
    expect(scaffolderTaskActions("failed")).toEqual({
      canCancel: false,
      canRetry: true,
      showLogs: true,
    });
    expect(scaffolderTaskStatus(["completed", "failed"])).toBe("failed");
    expect(scaffolderTaskStatus(["completed", "completed"])).toBe("completed");
  });
});
