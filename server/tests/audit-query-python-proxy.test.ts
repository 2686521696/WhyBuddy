import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  AuditQuery,
  toAuditQueryProxyError,
  toAuditQueryProxyForbidden,
  toAuditQueryProxySuccess,
} from "../audit/audit-query.js";
import { AuditChain } from "../audit/audit-chain.js";
import { AuditCollector } from "../audit/audit-collector.js";
import { TimestampProvider } from "../audit/timestamp-provider.js";
import type { AuditEvent } from "../../shared/audit/contracts.js";
import { AuditEventType } from "../../shared/audit/contracts.js";

function generateTestKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  return {
    privateKey: privateKey.export({ type: "sec1", format: "pem" }) as string,
    publicKey: publicKey.export({ type: "spki", format: "pem" }) as string,
  };
}

function makeEvent(overrides?: Partial<AuditEvent>): AuditEvent {
  return {
    eventId: `ae_proxy_${crypto.randomBytes(4).toString("hex")}`,
    eventType: AuditEventType.AGENT_EXECUTED,
    timestamp: 1000,
    actor: { type: "agent", id: "agent-1", name: "TestAgent" },
    action: "execute_task",
    resource: { type: "mission", id: "m-1", name: "TestMission" },
    result: "success",
    context: { sessionId: "sess-1" },
    ...overrides,
  };
}

function makeQuery() {
  const keys = generateTestKeys();
  const chain = new AuditChain({ privateKey: keys.privateKey, publicKey: keys.publicKey });
  const collector = new AuditCollector(chain, new TimestampProvider());
  return {
    chain,
    collector,
    query: new AuditQuery(chain, collector),
  };
}

describe("audit query Python proxy contract", () => {
  it("wraps existing audit query filter/page semantics in an ok response", () => {
    const { chain, collector, query } = makeQuery();
    try {
      chain.append(makeEvent({ actor: { type: "agent", id: "agent-1" }, timestamp: 1000 }));
      chain.append(makeEvent({ actor: { type: "agent", id: "agent-2" }, timestamp: 2000 }));
      chain.append(makeEvent({ actor: { type: "agent", id: "agent-1" }, timestamp: 3000 }));

      const nodeResult = query.query({ actorId: "agent-1" }, { pageSize: 1, pageNum: 2 });
      const proxyResult = toAuditQueryProxySuccess(nodeResult);

      expect(proxyResult.status).toBe("ok");
      expect(proxyResult.total).toBe(2);
      expect(proxyResult.page).toEqual({ pageSize: 1, pageNum: 2 });
      expect(proxyResult.entries).toHaveLength(1);
      expect(proxyResult.entries[0].event.actor.id).toBe("agent-1");
    } finally {
      collector.destroy();
    }
  });

  it("keeps empty results explicit and stable", () => {
    const proxyResult = toAuditQueryProxySuccess({
      entries: [],
      total: 0,
      page: { pageSize: 50, pageNum: 1 },
    });

    expect(proxyResult).toEqual({
      status: "ok",
      entries: [],
      total: 0,
      page: { pageSize: 50, pageNum: 1 },
    });
  });

  it("uses a distinct forbidden shape instead of pretending there are no rows", () => {
    const proxyResult = toAuditQueryProxyForbidden({ pageSize: 50, pageNum: 1 });

    expect(proxyResult.status).toBe("forbidden");
    expect(proxyResult.error.code).toBe("forbidden");
    expect("entries" in proxyResult).toBe(false);
    expect("total" in proxyResult).toBe(false);
  });

  it("uses a distinct error shape and a generic public message", () => {
    const proxyResult = toAuditQueryProxyError({ pageSize: 999, pageNum: 0 });

    expect(proxyResult).toEqual({
      status: "error",
      error: {
        code: "audit_query_error",
        message: "Audit query failed",
      },
      page: { pageSize: 200, pageNum: 1 },
    });
    expect("entries" in proxyResult).toBe(false);
    expect("total" in proxyResult).toBe(false);
  });
});
