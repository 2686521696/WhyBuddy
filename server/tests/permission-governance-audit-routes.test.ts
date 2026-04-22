import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync } from "node:crypto";
import { describe, it, expect } from "vitest";

import type {
  AgentRole,
  AgentPermissionPolicy,
  PermissionAuditEntry,
  PermissionTemplate,
} from "../../shared/permission/contracts.js";
import { RoleStore } from "../permission/role-store.js";
import { PolicyStore } from "../permission/policy-store.js";
import { TokenService } from "../permission/token-service.js";
import { PermissionCheckEngine } from "../permission/check-engine.js";
import { AuditLogger } from "../permission/audit-logger.js";
import { AuditChain } from "../audit/audit-chain.js";
import { AuditCollector } from "../audit/audit-collector.js";
import { AuditQuery } from "../audit/audit-query.js";
import { AuditVerifier } from "../audit/audit-verifier.js";
import { AnomalyDetector } from "../audit/anomaly-detector.js";
import { ComplianceMapper } from "../audit/compliance-mapper.js";
import { AuditExport } from "../audit/audit-export.js";
import { AuditRetention } from "../audit/audit-retention.js";
import { TimestampProvider } from "../audit/timestamp-provider.js";
import { createAuditRouter } from "../routes/audit.js";

const SECRET = "permission-governance-audit-secret";

function createInMemoryDb() {
  let roles: AgentRole[] = [];
  let policies: AgentPermissionPolicy[] = [];
  let templates: PermissionTemplate[] = [];
  let permissionAudit: PermissionAuditEntry[] = [];

  return {
    getPermissionRoles: () => roles,
    setPermissionRoles: (next: AgentRole[]) => {
      roles = next;
    },
    getPermissionPolicies: () => policies,
    setPermissionPolicies: (next: AgentPermissionPolicy[]) => {
      policies = next;
    },
    getPermissionTemplates: () => templates,
    setPermissionTemplates: (next: PermissionTemplate[]) => {
      templates = next;
    },
    getPermissionAudit: () => permissionAudit,
    addPermissionAudit: (entry: PermissionAuditEntry) => {
      permissionAudit.push(entry);
    },
  };
}

function createKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKey: privateKey.export({ type: "sec1", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

async function withServer(
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const db = createInMemoryDb();
  const roleStore = new RoleStore(db as any);
  const policyStore = new PolicyStore(db as any, roleStore);
  const tokenService = new TokenService(policyStore, roleStore, SECRET);

  const keys = createKeys();
  const auditChain = new AuditChain({
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
  });
  const auditCollector = new AuditCollector(auditChain, new TimestampProvider());
  const auditQuery = new AuditQuery(auditChain, auditCollector);
  const auditVerifier = new AuditVerifier(auditChain);
  const anomalyDetector = new AnomalyDetector(auditChain, auditCollector);
  const complianceMapper = new ComplianceMapper(auditChain);
  const auditExport = new AuditExport(auditChain, auditCollector);
  const auditRetention = new AuditRetention(auditChain, auditCollector);

  const permissionAuditLogger = new AuditLogger(db as any, auditCollector);
  const engine = new PermissionCheckEngine(tokenService, permissionAuditLogger, new Map());

  roleStore.createRole({
    roleId: "risk-role",
    roleName: "Risk Role",
    description: "Allows a high-risk MCP operation for governance testing",
    permissions: [
      {
        resourceType: "mcp_tool",
        action: "call",
        constraints: {},
        effect: "allow",
      },
    ],
  });

  policyStore.createPolicy({
    agentId: "agent-risk",
    assignedRoles: ["risk-role"],
    customPermissions: [],
    deniedPermissions: [],
    effectiveAt: new Date().toISOString(),
    expiresAt: null,
  });

  const token = tokenService.issueToken("agent-risk");
  engine.checkPermission("agent-risk", "mcp_tool", "call", "mcp://tool/unsafe", token.token);
  auditCollector.recordSync({
    eventType: "AGENT_EXECUTED" as any,
    actor: { type: "agent", id: "agent-risk" },
    action: "workflow.execute",
    resource: { type: "workflow", id: "wf-governance" },
    result: "success",
    metadata: {
      workflowId: "wf-governance",
      missionId: "mission-governance",
      decisionId: "dec-governance",
      links: {
        workflowId: "wf-governance",
        missionId: "mission-governance",
        replayId: "wf-governance",
      },
    },
  });
  auditCollector.flush();

  const app = express();
  app.use(express.json());
  app.use("/api/audit", createAuditRouter({
    chain: auditChain,
    query: auditQuery,
    verifier: auditVerifier,
    anomalyDetector,
    complianceMapper,
    auditExport,
    auditRetention,
    collector: auditCollector,
  }));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    auditCollector.destroy();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe("Permission governance audit routes", () => {
  it("returns governance-enforced entries from /api/audit/permissions/:agentId", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/permissions/agent-risk`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(
        body.entries.some((entry: any) => entry.event.eventType === "GOVERNANCE_ENFORCED"),
      ).toBe(true);
    });
  });

  it("returns governance denials from /api/audit/permissions/violations", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/permissions/violations`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(
        body.entries.some((entry: any) => entry.event.result === "denied"),
      ).toBe(true);
    });
  });

  it("returns web-aigc observability catalog from /api/audit/web-aigc/catalog", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/web-aigc/catalog`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(typeof body.version).toBe("string");
      expect(Array.isArray(body.events)).toBe(true);
      expect(
        body.events.some((entry: any) => entry.eventKey === "human.approved"),
      ).toBe(true);
    });
  });

  it("returns web-aigc relation indexes from /api/audit/web-aigc/relation-indexes", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/web-aigc/relation-indexes`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.indexes)).toBe(true);
      expect(
        body.indexes.some((entry: any) => entry.key === "decisionId"),
      ).toBe(true);
    });
  });

  it("returns related web-aigc audit entries from /api/audit/web-aigc/related", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/audit/web-aigc/related?workflowId=wf-governance`,
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThanOrEqual(1);
      expect(
        body.entries.some(
          (entry: any) =>
            entry.event.metadata?.workflowId === "wf-governance" ||
            entry.event.metadata?.links?.workflowId === "wf-governance",
        ),
      ).toBe(true);
    });
  });
});
