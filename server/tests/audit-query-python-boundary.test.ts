import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { createAuditRouter } from "../routes/audit.js";
import type { AuditRouterDeps } from "../routes/audit.js";
import { AuditEventType } from "../../shared/audit/contracts.js";

async function withAuditServer(
  deps: AuditRouterDeps,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/audit", createAuditRouter(deps));

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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function makeDeps(overrides: Partial<AuditRouterDeps> = {}): AuditRouterDeps {
  const basePage = { pageSize: 25, pageNum: 2 };
  return {
    chain: {
      getEntry: () => null,
      getEntryCount: () => 0,
      getEntries: () => [],
    } as unknown as AuditRouterDeps["chain"],
    query: {
      query: () => ({
        entries: [],
        total: 0,
        page: basePage,
      }),
      search: () => ({
        entries: [],
        total: 0,
        page: basePage,
      }),
      getPermissionViolations: () => [],
      getPermissionTrail: () => [],
      getDataLineageAudit: () => [],
      getWebAigcRelatedEntries: () => [],
    } as unknown as AuditRouterDeps["query"],
    verifier: {
      verifyChain: () => ({ valid: true, checkedRange: { start: 0, end: 0 }, totalEntries: 0, errors: [], verifiedAt: 0 }),
      getLastResult: () => null,
    } as unknown as AuditRouterDeps["verifier"],
    anomalyDetector: {
      getAlerts: () => [],
      updateAlertStatus: () => null,
    } as unknown as AuditRouterDeps["anomalyDetector"],
    complianceMapper: {
      generateReport: () => ({}),
    } as unknown as AuditRouterDeps["complianceMapper"],
    auditExport: {
      exportLog: () => ({ data: "[]", hash: "hash", signature: "signature" }),
    } as unknown as AuditRouterDeps["auditExport"],
    auditRetention: {
      archiveEntries: () => ({ archivePath: "archive.json", hash: "hash", signature: "signature" }),
    } as unknown as AuditRouterDeps["auditRetention"],
    collector: {} as AuditRouterDeps["collector"],
    ...overrides,
  };
}

describe("audit query route Python proxy boundary", () => {
  it("maps list query filter/page results to the Python proxy success envelope", async () => {
    const queryCalls: Array<Record<string, unknown>> = [];
    const deps = makeDeps({
      query: {
        query: (filters, page) => {
          queryCalls.push({ filters, page });
          return {
            entries: [],
            total: 0,
            page,
          };
        },
        search: () => ({ entries: [], total: 0, page: { pageSize: 50, pageNum: 1 } }),
        getPermissionViolations: () => [],
        getPermissionTrail: () => [],
        getDataLineageAudit: () => [],
        getWebAigcRelatedEntries: () => [],
      } as unknown as AuditRouterDeps["query"],
    });

    await withAuditServer(deps, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/audit/events?eventType=${AuditEventType.AGENT_EXECUTED},${AuditEventType.USER_LOGIN}&actorId=agent-1&resourceType=mission&pageSize=25&pageNum=2`,
      );

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual({
        status: "ok",
        entries: [],
        total: 0,
        page: { pageSize: 25, pageNum: 2 },
      });
      expect(body.ok).toBeUndefined();
    });

    expect(queryCalls).toEqual([
      {
        filters: {
          eventType: [AuditEventType.AGENT_EXECUTED, AuditEventType.USER_LOGIN],
          actorId: "agent-1",
          resourceType: "mission",
        },
        page: { pageSize: 25, pageNum: 2 },
      },
    ]);
  });

  it("maps search results to the same Python proxy success envelope", async () => {
    const deps = makeDeps({
      query: {
        query: () => ({ entries: [], total: 0, page: { pageSize: 50, pageNum: 1 } }),
        search: (_keyword, page) => ({
          entries: [],
          total: 0,
          page,
        }),
        getPermissionViolations: () => [],
        getPermissionTrail: () => [],
        getDataLineageAudit: () => [],
        getWebAigcRelatedEntries: () => [],
      } as unknown as AuditRouterDeps["query"],
    });

    await withAuditServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/events/search?q=deploy&pageSize=999&pageNum=0`);

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toEqual({
        status: "ok",
        entries: [],
        total: 0,
        page: { pageSize: 200, pageNum: 1 },
      });
    });
  });

  it("maps query failures to error envelope instead of empty success", async () => {
    const deps = makeDeps({
      query: {
        query: () => {
          throw new Error("database path C:/private/audit-store unavailable");
        },
        search: () => ({ entries: [], total: 0, page: { pageSize: 50, pageNum: 1 } }),
        getPermissionViolations: () => [],
        getPermissionTrail: () => [],
        getDataLineageAudit: () => [],
        getWebAigcRelatedEntries: () => [],
      } as unknown as AuditRouterDeps["query"],
    });

    await withAuditServer(deps, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/audit/events?pageSize=10&pageNum=3`);

      expect(response.status).toBe(500);

      const body = await response.json();
      expect(body).toEqual({
        status: "error",
        error: {
          code: "audit_query_error",
          message: "Audit query failed",
        },
        page: { pageSize: 10, pageNum: 3 },
      });
      expect(body.entries).toBeUndefined();
      expect(body.total).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain("C:/private/audit-store");
    });
  });
});
