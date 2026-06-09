/**
 * Source-level contract tests for spec-docs failure, timeout, and writeback
 * error handling in AutopilotRightRail.
 *
 * The relevant callback is private to the component and depends on async
 * Promise.race / state behavior, so these tests guard the source-level shape
 * plus store-level behavior for timeout progress convergence.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  FRONTEND_TIMEOUT_MARKER,
  useBlueprintRealtimeStore,
} from "@/lib/blueprint-realtime-store";

async function readSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(
    path.resolve(__dirname, "../AutopilotRightRail.tsx"),
    "utf8"
  );
}

describe("AutopilotRightRail spec-docs failure and timeout contracts", () => {
  describe("API failure mapping", () => {
    it("maps failed API results to specDocsError and toast detail/message fallback", async () => {
      const source = await readSource();
      expect(source).toContain("setSpecDocsError(result.error);");
      expect(source).toMatch(
        /description:\s*[\r\n\s]*result\.error\.detail\s*\|\|[\r\n\s]*result\.error\.message\s*\|\|/
      );
    });

    it("keeps the existing sonner toast channel and English fallback text", async () => {
      const source = await readSource();
      expect(source).toContain('import { toast as showToast } from "sonner";');
      expect(source).toContain("showToast.error(");
      expect(source).toContain("Spec document generation failed");
      expect(source).toContain(
        "Check the LLM service config (LLM_BASE_URL / LLM_MODEL / LLM_API_KEY) and retry."
      );
    });
  });

  describe("60s timeout mapping", () => {
    it("keeps a 60000ms timeout sentinel in the Promise.race path", async () => {
      const source = await readSource();
      expect(source).toMatch(/const SPEC_DOCS_GENERATION_TIMEOUT_MS = 60000;/);
      expect(source).toMatch(/Promise\.race\(\[/);
      expect(source).toMatch(
        /setTimeout\([\s\S]*?SPEC_DOCS_GENERATION_TIMEOUT_MS/
      );
    });

    it("releases the CTA lock, records timeout error, toasts honestly, and converges live progress", async () => {
      const source = await readSource();
      const timeoutBranch = source.indexOf("if (raceResult === TIMEOUT) {");
      expect(timeoutBranch).toBeGreaterThan(-1);

      const tail = source.slice(timeoutBranch);
      const branchEnd = tail.indexOf("return;");
      expect(branchEnd).toBeGreaterThan(-1);
      const branch = tail.slice(0, branchEnd);

      expect(branch).toContain("setSpecDocsGenerating(null);");
      expect(branch).toContain("setSpecDocsError(timeoutError);");
      expect(branch).toContain("showToast.error(");
      expect(branch).toContain(
        "Spec document generation request timed out (backend may still be running)"
      );
      expect(branch).toContain("failSpecDocsProgress(FRONTEND_TIMEOUT_MARKER)");
    });

    it("does not write partial timeout results to the job truth source", async () => {
      const source = await readSource();
      const timeoutBranch = source.indexOf("if (raceResult === TIMEOUT) {");
      const tail = source.slice(timeoutBranch);
      const branch = tail.slice(0, tail.indexOf("return;"));
      expect(branch).not.toMatch(/onSpecDocumentsGenerated\s*\??\.?\s*\(/);
    });
  });

  describe("writeback failure mapping", () => {
    it("wraps onSpecDocumentsGenerated in try/catch", async () => {
      const source = await readSource();
      expect(source).toMatch(
        /try\s*\{[\s\S]*?props\.onSpecDocumentsGenerated\?\.\(result\.data\);[\s\S]*?\}\s*catch\s*\(writebackError\)/
      );
    });

    it("maps writeback errors to specDocsError and a toast", async () => {
      const source = await readSource();
      const catchIdx = source.indexOf("catch (writebackError)");
      expect(catchIdx).toBeGreaterThan(-1);
      const catchBody = source.slice(catchIdx, catchIdx + 1200);
      expect(catchBody).toContain("setSpecDocsError(mappedError);");
      expect(catchBody).toContain("showToast.error(");
      expect(catchBody).toContain("Failed to apply generated spec documents");
    });

    it("does not recursively call onSpecDocumentsGenerated from the catch block", async () => {
      const source = await readSource();
      const catchIdx = source.indexOf("catch (writebackError)");
      const catchBody = source.slice(catchIdx, catchIdx + 1200);
      expect(catchBody).not.toContain("onSpecDocumentsGenerated");
    });
  });

  describe("in-flight lock and writeback anchor", () => {
    it("releases the in-flight lock on success/failure/timeout paths", async () => {
      const source = await readSource();
      const releases = source.match(/setSpecDocsGenerating\(null\)/g) ?? [];
      expect(releases.length).toBeGreaterThanOrEqual(2);
    });

    it("keeps triggerSpecDocsGeneration as the single truth-source writeback anchor", async () => {
      const source = await readSource();
      expect(source).toContain(
        "props.onSpecDocumentsGenerated?.(result.data);"
      );
    });
  });
});

describe("failSpecDocsProgress + backend success override behavior", () => {
  beforeEach(() => {
    useBlueprintRealtimeStore.getState().reset();
  });

  it("marks active pending/processing nodes failed and finishes the batch", () => {
    const store = useBlueprintRealtimeStore;
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "batch_init",
        totalCount: 2,
        nodeIds: ["n1", "n2"],
      },
    } as any);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "node_started",
        nodeId: "n1",
        nodeTitle: "Node 1",
      },
    } as any);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "node_completed",
        nodeId: "n1",
        completedCount: 1,
      },
    } as any);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "node_started",
        nodeId: "n2",
        nodeTitle: "Node 2",
      },
    } as any);

    store.getState().failSpecDocsProgress(FRONTEND_TIMEOUT_MARKER);

    const progress = store.getState().specDocsProgress;
    expect(progress.batchStatus).toBe("finished");
    expect(progress.nodes["n2"]?.status).toBe("failed");
    expect(progress.nodes["n2"]?.errorSummary).toBe(FRONTEND_TIMEOUT_MARKER);
  });

  it("lets later backend success override frontend-timeout failed nodes", () => {
    const store = useBlueprintRealtimeStore;
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "batch_init",
        totalCount: 2,
        nodeIds: ["n1", "n2"],
      },
    } as any);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "node_started",
        nodeId: "n2",
      },
    } as any);

    store.getState().failSpecDocsProgress(FRONTEND_TIMEOUT_MARKER);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "node_completed",
        nodeId: "n2",
        completedCount: 2,
      },
    } as any);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "batch_finished",
        completedCount: 2,
        failedCount: 0,
      },
    } as any);

    const progress = store.getState().specDocsProgress;
    expect(progress.batchStatus).toBe("finished");
    expect(progress.nodes["n2"]?.status).toBe("assembled");
    expect(progress.nodes["n2"]?.errorSummary).toBeFalsy();
  });

  it("does not treat real backend timeout failures as frontend-timeout markers", () => {
    const store = useBlueprintRealtimeStore;
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "batch_init",
        totalCount: 1,
        nodeIds: ["n1"],
      },
    } as any);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "node_started",
        nodeId: "n1",
      },
    } as any);

    store.getState().failSpecDocsProgress("agent timeout");
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "node_completed",
        nodeId: "n1",
        completedCount: 1,
      },
    } as any);
    store.getState().dispatchEvent({
      type: "blueprint:event",
      payload: {
        stageId: "spec_docs",
        progressAction: "batch_finished",
        completedCount: 1,
        failedCount: 0,
      },
    } as any);

    const progress = store.getState().specDocsProgress;
    expect(progress.nodes["n1"]?.status).toBe("failed");
    expect(progress.nodes["n1"]?.errorSummary).toContain("agent timeout");
  });
});
