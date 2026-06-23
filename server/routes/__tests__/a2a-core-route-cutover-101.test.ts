/**
 * A2A core route cutover 101 (Node consumption).
 *
 * Verifies:
 * - Python cutover decision is consumable for registry/session/stream/cancel/chat/report
 * - Bridge correctly maps python decision (ready/blocked/skipped etc)
 * - Thin bridges for stream/cancel remain non-ownership (skipped-live by default)
 * - Existing contract/invoke/stream compatibility preserved (no protocol change)
 * - Does not claim full A2A takeover
 */

import { describe, expect, it, vi } from "vitest";

import {
  validateA2ACoreRouteCutover,
  type A2ACoreRouteCutoverResult,
  A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
  runA2ACoreRouteCutover,
  getA2ARouteOwnershipDecision,
} from "../a2a-python-runtime.js";

describe("a2a-core-route-cutover-101 - node consumption", () => {
  it("validates python cutover readiness and distinguishes states for all core components", () => {
    const ready = validateA2ACoreRouteCutover({
      status: "ready",
      contractVersion: A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
      provenance: "python-a2a-core-route-cutover",
      ok: true,
      runtime: { owner: "python", mode: "cutover_readiness" },
      cutoverSummary: {
        status: "ready",
        components: {
          registry: "ready",
          session: "ready",
          stream: "skipped-live",
          cancel: "skipped-live",
          chat: "skipped-live",
          report: "skipped-live",
        },
        metadata: { traceId: "c-101" },
      },
    });
    expect(ready.status).toBe("ready");
    expect(ready.ok).toBe(true);
    expect(ready.cutoverSummary?.components.registry).toBe("ready");
    expect(ready.cutoverSummary?.components.stream).toBe("skipped-live");
    expect(ready.cutoverSummary?.components.chat).toBe("skipped-live");
    expect(ready.cutoverSummary?.components.report).toBe("skipped-live");

    const blocked = validateA2ACoreRouteCutover({ status: "blocked" });
    expect(blocked.status).toBe("blocked");
    expect(blocked.ok).toBe(false);

    const degraded = validateA2ACoreRouteCutover({ status: "degraded" });
    expect(degraded.status).toBe("degraded");
    expect(degraded.ok).toBe(false);

    const skipped = validateA2ACoreRouteCutover({ status: "skipped-live" });
    expect(skipped.status).toBe("skipped-live");
    expect(skipped.ok).toBe(false);
  });

  it("a2a python runtime bridge consumes cutover readiness via runA2ACoreRouteCutover", async () => {
    const pythonCutover = {
      execute: vi.fn(async (p: any) => ({
        status: "ready",
        contractVersion: A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
        provenance: "python-a2a-core-route-cutover",
        ok: true,
        runtime: { owner: "python", mode: "cutover_readiness" },
        cutoverSummary: {
          status: "ready",
          components: {
            registry: "ready",
            session: "ready",
            stream: "skipped-live",
            cancel: "skipped-live",
            chat: "skipped-live",
            report: "skipped-live",
          },
          metadata: { source: p?.metadata?.source },
        },
      })),
    };

    const result = await runA2ACoreRouteCutover(pythonCutover as any, { metadata: { source: "node-a2a-test" } });
    expect(result.status).toBe("ready");
    expect(result.cutoverSummary?.components.registry).toBe("ready");
    expect(result.cutoverSummary?.components.report).toBe("skipped-live");
    expect(pythonCutover.execute).toHaveBeenCalled();
  });

  it("falls back to explicit non-ready (skipped-live) when no python cutover wired", async () => {
    const result = await runA2ACoreRouteCutover(undefined as any, { metadata: {} });
    expect(result.status).toBe("skipped-live");
    expect(result.ok).toBe(false);
    expect(result.cutoverSummary?.components.stream).toBe("node");
    expect(result.cutoverSummary?.metadata?.note).toContain("python not wired");
  });

  it("cutover decision preserves boundaries and never claims full stream/invoke/chat takeover", () => {
    const cut = validateA2ACoreRouteCutover({
      status: "ready",
      contractVersion: A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
      provenance: "python-a2a-core-route-cutover",
      ok: true,
      runtime: { owner: "python", mode: "cutover_readiness" },
      cutoverSummary: {
        status: "ready",
        components: {
          registry: "ready",
          session: "ready",
          stream: "skipped-live",
          cancel: "skipped-live",
          chat: "skipped-live",
          report: "skipped-live",
        },
        metadata: { policy: "node", stream: "node-thin-bridge", chat: "node" },
      },
    });
    expect(cut.cutoverSummary?.metadata?.stream).toBe("node-thin-bridge");
    expect(cut.status).toBe("ready");
    // stream/chat/report must not be advertised as ready for production ownership
    expect(cut.cutoverSummary?.components.stream).not.toBe("ready");
    expect(cut.cutoverSummary?.components.chat).not.toBe("ready");
    expect(cut.cutoverSummary?.components.report).not.toBe("ready");
  });

  it("getA2ARouteOwnershipDecision maps components correctly without affecting protocol", () => {
    const cut = validateA2ACoreRouteCutover({
      status: "ready",
      contractVersion: A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION,
      provenance: "python-a2a-core-route-cutover",
      ok: true,
      runtime: { owner: "python", mode: "cutover_readiness" },
      cutoverSummary: {
        status: "ready",
        components: { registry: "ready", session: "ready", stream: "skipped-live", cancel: "skipped-live", chat: "skipped-live", report: "skipped-live" },
      },
    });
    expect(getA2ARouteOwnershipDecision(cut, "registry")).toBe("ready");
    expect(getA2ARouteOwnershipDecision(cut, "stream")).toBe("skipped-live");
    expect(getA2ARouteOwnershipDecision(cut, "chat")).toBe("skipped-live");
    expect(getA2ARouteOwnershipDecision(cut, "report")).toBe("skipped-live");
    expect(getA2ARouteOwnershipDecision(cut, "unknown-comp")).toBe("skipped-live");
  });

  it("retaining existing A2A error semantics and contract compatibility", () => {
    const invalid = validateA2ACoreRouteCutover({ foo: "bar" });
    expect(invalid.ok).toBe(false);
    expect(invalid.status).not.toBe("ready");

    // must not mutate protocol error codes
    expect(A2A_CORE_ROUTE_CUTOVER_CONTRACT_VERSION).toContain("core-route-cutover");
  });
});
