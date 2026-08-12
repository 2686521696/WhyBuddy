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
  approvalRulesSatisfied,
  credentialSlotsReady,
  INDEPENDENT_STRUCTURE_BATCH9_LABELS,
  lineageDepthValid,
  mailRuleDraftValid,
  sessionSelectionCanRevoke,
  shareDraftValid,
} from "../independent-structure-blocks-batch9";
import PhoneExperienceBlock from "../phone-mobile/PhoneExperienceBlock";

const rows = {
  demo: [
    {
      id: "a",
      createdAt: "2026-08-11",
      values: {
        principal: "产品组",
        kind: "internal",
        permission: "编辑",
        expiry: "",
        status: "直接",
        user: "wang.xiao",
        client: "Web",
        device: "Chrome current",
        ip: "10.0.0.1",
        access: "刚刚",
        dataset: "dwd.orders",
        column: "customer_id",
        direction: "downstream",
        depth: 0,
        impact: 18,
        slot: "Slack",
        credential: "生产 Bot",
        credentialType: "OAuth2",
        testStatus: "success",
        required: "true",
        rule: "安全",
        requiredCount: 2,
        approvedCount: 1,
        approver: "陈晓",
        optional: "false",
        invalid: "false",
        account: "invoice@example.com",
        folder: "INBOX",
        condition: "主题",
        action: "mark-read",
        parameter: "",
        metadata: "文档类型：发票",
      },
    },
    {
      id: "b",
      createdAt: "2026-08-11",
      values: {
        principal: "客户链接",
        kind: "link",
        permission: "查看",
        expiry: "2026-09-01",
        status: "密码",
        user: "wang.xiao",
        client: "Mobile",
        device: "Safari",
        ip: "10.0.0.2",
        access: "8 分钟前",
        dataset: "mart.customer",
        column: "buyer_id",
        direction: "downstream",
        depth: 1,
        impact: 35,
        slot: "Database",
        credential: "只读账户",
        credentialType: "PostgreSQL",
        testStatus: "error",
        required: "true",
        rule: "代码所有者",
        requiredCount: 1,
        approvedCount: 1,
        approver: "林海",
        optional: "false",
        invalid: "false",
        account: "finance@example.com",
        folder: "Archive",
        condition: "附件名",
        action: "move",
        parameter: "Processed",
        metadata: "标签：归档",
      },
    },
  ],
};

const bindings: Record<string, ExperienceBlockInstance["binding"]> = {
  FileShareAccessComposer: {
    entityRef: "demo",
    principalNameFieldRef: "principal",
    shareKindFieldRef: "kind",
    permissionFieldRef: "permission",
    expiryFieldRef: "expiry",
    statusFieldRef: "status",
    targets: ["file"],
  },
  IdentitySessionRevocationConsole: {
    entityRef: "demo",
    userFieldRef: "user",
    clientFieldRef: "client",
    deviceFieldRef: "device",
    ipAddressFieldRef: "ip",
    lastAccessFieldRef: "access",
    targets: ["session"],
  },
  ColumnLineageImpactExplorer: {
    entityRef: "demo",
    datasetFieldRef: "dataset",
    columnFieldRef: "column",
    directionFieldRef: "direction",
    depthFieldRef: "depth",
    impactFieldRef: "impact",
  },
  WorkflowCredentialBindingPanel: {
    entityRef: "demo",
    slotFieldRef: "slot",
    credentialFieldRef: "credential",
    credentialTypeFieldRef: "credentialType",
    testStatusFieldRef: "testStatus",
    requiredFieldRef: "required",
    targets: ["node"],
  },
  MergeApprovalRuleMatrix: {
    entityRef: "demo",
    ruleNameFieldRef: "rule",
    requiredCountFieldRef: "requiredCount",
    approvedCountFieldRef: "approvedCount",
    approverFieldRef: "approver",
    optionalFieldRef: "optional",
    invalidFieldRef: "invalid",
    targets: ["merge"],
  },
  DocumentMailRuleComposer: {
    entityRef: "demo",
    accountFieldRef: "account",
    folderFieldRef: "folder",
    conditionFieldRef: "condition",
    actionFieldRef: "action",
    actionParameterFieldRef: "parameter",
    metadataFieldRef: "metadata",
    targets: ["rule"],
  },
};

describe("independent structure block batch 9", () => {
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
    const selected = Object.keys(INDEPENDENT_STRUCTURE_BATCH9_LABELS).map(
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
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH9_LABELS)) {
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
    for (const type of Object.keys(INDEPENDENT_STRUCTURE_BATCH9_LABELS)) {
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
    expect(shareDraftValid("internal", "产品组", false, "", false, "")).toBe(
      true
    );
    expect(shareDraftValid("link", "", true, "short", false, "")).toBe(false);
    expect(sessionSelectionCanRevoke(["a", "b"])).toBe(true);
    expect(sessionSelectionCanRevoke(["a", "a"])).toBe(false);
    expect(lineageDepthValid(3)).toBe(true);
    expect(lineageDepthValid(6)).toBe(false);
    expect(
      credentialSlotsReady(["api"], { api: "prod" }, { api: "success" })
    ).toBe(true);
    expect(
      credentialSlotsReady(["api"], { api: "prod" }, { api: "error" })
    ).toBe(false);
    expect(approvalRulesSatisfied([{ required: 2, approved: 2 }])).toBe(true);
    expect(
      approvalRulesSatisfied([{ required: 1, approved: 1, invalid: true }])
    ).toBe(false);
    expect(
      mailRuleDraftValid("mail", "INBOX", ["invoice"], "move", "Processed")
    ).toBe(true);
    expect(mailRuleDraftValid("mail", "INBOX", ["invoice"], "move")).toBe(
      false
    );
  });
});
