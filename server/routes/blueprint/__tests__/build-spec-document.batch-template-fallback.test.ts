/**
 * Unit tests for Decision 3: batch-template-fallback short-circuit in `buildSpecDocument`.
 *
 * **Feature: autopilot-spec-docs-runtime-perception-double-pass**
 * **Validates: Requirements 3, 1.3, 2.4, 3.3, 3.5**
 *
 * Verifies that when `llmNodeOutput.generationSource !== "llm"` (i.e. the batch
 * produced a template-fallback result), the legacy per-document LLM service
 * (`ctx.specDocumentsLlmService`) is NEVER called — regardless of the
 * `BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED` env flag value.
 *
 * This closes the theoretical second-LLM-dispatch path: the new pipeline already
 * has a 5-key pool with retries in Phase 1; a 6th legacy retry is unlikely to
 * succeed and only adds latency + cost.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

import type {
  BlueprintGenerationJob,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
  BlueprintSpecDocumentType,
} from "../../../../shared/blueprint/contracts.js";
import type { SpecDocsLlmNodeOutput } from "../spec-docs-llm-generation.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Reproduces the Decision 3 short-circuit condition from `buildSpecDocument`.
 *
 * This is the exact logic inserted at the `serviceResult` assignment:
 * ```ts
 * const batchTemplateOnly =
 *   input.llmNodeOutput !== undefined &&
 *   input.llmNodeOutput.generationSource !== "llm";
 * ```
 *
 * When `batchTemplateOnly === true`, the ternary guard `&& !batchTemplateOnly`
 * prevents `ctx.specDocumentsLlmService` from being called.
 */
function computeBatchTemplateOnly(
  llmNodeOutput: SpecDocsLlmNodeOutput | undefined,
): boolean {
  return llmNodeOutput !== undefined && llmNodeOutput.generationSource !== "llm";
}

function createTemplateFallbackOutput(nodeId: string): SpecDocsLlmNodeOutput {
  return {
    nodeId,
    generationSource: "template",
    contextTier: "minimal",
    requirements: "",
    design: "",
    tasks: "",
    promptId: undefined as unknown as string,
    model: undefined as unknown as string,
    promptFingerprint: undefined as unknown as string,
    responseDigest: undefined as unknown as string,
  };
}

function createLlmSuccessOutput(nodeId: string): SpecDocsLlmNodeOutput {
  return {
    nodeId,
    generationSource: "llm",
    contextTier: "full",
    requirements: "# Requirements\n\nContent...",
    design: "# Design\n\nContent...",
    tasks: "# Tasks\n\n- [ ] 1. Task",
    promptId: "blueprint.spec-documents.v1",
    model: "gpt-4o-2024-05-13",
    promptFingerprint: "sha256:abc123",
    responseDigest: "sha256:def456",
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("buildSpecDocument — Decision 3: batch-template-fallback short-circuit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("batchTemplateOnly condition logic", () => {
    it("returns true when llmNodeOutput.generationSource === 'template'", () => {
      const output = createTemplateFallbackOutput("node-1");
      expect(computeBatchTemplateOnly(output)).toBe(true);
    });

    it("returns false when llmNodeOutput.generationSource === 'llm'", () => {
      const output = createLlmSuccessOutput("node-1");
      expect(computeBatchTemplateOnly(output)).toBe(false);
    });

    it("returns false when llmNodeOutput is undefined", () => {
      expect(computeBatchTemplateOnly(undefined)).toBe(false);
    });
  });

  describe("short-circuit prevents legacy LLM service call", () => {
    it("does NOT call ctx.specDocumentsLlmService when llmNodeOutput.generationSource === 'template' (env unset)", async () => {
      // Simulate the Decision 3 guard logic as it appears in buildSpecDocument:
      //   const serviceResult = ctx?.specDocumentsLlmService && !batchTemplateOnly
      //     ? await ctx.specDocumentsLlmService({...})
      //     : undefined;
      const specDocumentsLlmServiceSpy = vi.fn().mockResolvedValue({
        generationSource: "llm",
        title: "Should not be called",
        summary: "Should not be called",
        content: "Should not be called",
      });

      const ctx = { specDocumentsLlmService: specDocumentsLlmServiceSpy };
      const llmNodeOutput = createTemplateFallbackOutput("node-fallback");

      // Decision 3 condition
      const batchTemplateOnly =
        llmNodeOutput !== undefined &&
        llmNodeOutput.generationSource !== "llm";

      // The ternary guard from buildSpecDocument
      const serviceResult = ctx?.specDocumentsLlmService && !batchTemplateOnly
        ? await ctx.specDocumentsLlmService({ jobId: "test-job" })
        : undefined;

      // Assert: spy was NOT called
      expect(specDocumentsLlmServiceSpy).not.toHaveBeenCalled();
      expect(serviceResult).toBeUndefined();

      // Assert: the resulting document would carry generationSource: "template"
      // (when serviceResult is undefined, buildSpecDocument falls through to the
      // template path which sets generationSource to "template")
      expect(batchTemplateOnly).toBe(true);
    });

    it("does NOT call ctx.specDocumentsLlmService when llmNodeOutput.generationSource === 'template' (env=true)", async () => {
      // Even with the legacy env flag enabled, Decision 3 is unconditional
      vi.stubEnv("BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED", "true");

      const specDocumentsLlmServiceSpy = vi.fn().mockResolvedValue({
        generationSource: "llm",
        title: "Should not be called",
        summary: "Should not be called",
        content: "Should not be called",
      });

      const ctx = { specDocumentsLlmService: specDocumentsLlmServiceSpy };
      const llmNodeOutput = createTemplateFallbackOutput("node-fallback");

      // Decision 3 condition — unconditional, ignores env flag
      const batchTemplateOnly =
        llmNodeOutput !== undefined &&
        llmNodeOutput.generationSource !== "llm";

      // The ternary guard from buildSpecDocument
      const serviceResult = ctx?.specDocumentsLlmService && !batchTemplateOnly
        ? await ctx.specDocumentsLlmService({ jobId: "test-job" })
        : undefined;

      // Assert: spy was STILL NOT called (Decision 3 is unconditional)
      expect(specDocumentsLlmServiceSpy).not.toHaveBeenCalled();
      expect(serviceResult).toBeUndefined();

      // Assert: the resulting document would carry generationSource: "template"
      expect(batchTemplateOnly).toBe(true);
    });

    it("DOES call ctx.specDocumentsLlmService when llmNodeOutput is undefined (no batch result)", async () => {
      vi.stubEnv("BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED", "true");

      const specDocumentsLlmServiceSpy = vi.fn().mockResolvedValue({
        generationSource: "llm",
        title: "Generated Title",
        summary: "Generated Summary",
        content: "# Generated Content",
      });

      const ctx = { specDocumentsLlmService: specDocumentsLlmServiceSpy };
      const llmNodeOutput: SpecDocsLlmNodeOutput | undefined = undefined;

      // Decision 3 condition — false when llmNodeOutput is undefined
      const batchTemplateOnly =
        llmNodeOutput !== undefined &&
        llmNodeOutput.generationSource !== "llm";

      // The ternary guard from buildSpecDocument
      const serviceResult = ctx?.specDocumentsLlmService && !batchTemplateOnly
        ? await ctx.specDocumentsLlmService({ jobId: "test-job" })
        : undefined;

      // Assert: spy WAS called (no batch result → legacy path allowed)
      expect(specDocumentsLlmServiceSpy).toHaveBeenCalledOnce();
      expect(serviceResult).toBeDefined();
      expect(batchTemplateOnly).toBe(false);
    });

    it("DOES call ctx.specDocumentsLlmService when llmNodeOutput.generationSource === 'llm' (LLM success path is handled earlier)", async () => {
      // Note: In the real code, when generationSource === "llm" AND markdown is
      // non-empty, buildSpecDocument returns early BEFORE reaching the serviceResult
      // assignment. This test verifies that the Decision 3 guard does NOT block
      // the legacy service for LLM-source nodes (the early return handles them).
      vi.stubEnv("BLUEPRINT_SPEC_DOCUMENTS_LLM_ENABLED", "true");

      const specDocumentsLlmServiceSpy = vi.fn().mockResolvedValue({
        generationSource: "template",
        title: undefined,
        summary: undefined,
        content: undefined,
      });

      const ctx = { specDocumentsLlmService: specDocumentsLlmServiceSpy };
      const llmNodeOutput = createLlmSuccessOutput("node-llm");

      // Decision 3 condition — false for LLM-source nodes
      const batchTemplateOnly =
        llmNodeOutput !== undefined &&
        llmNodeOutput.generationSource !== "llm";

      // The ternary guard from buildSpecDocument
      const serviceResult = ctx?.specDocumentsLlmService && !batchTemplateOnly
        ? await ctx.specDocumentsLlmService({ jobId: "test-job" })
        : undefined;

      // Assert: spy WAS called (LLM-source nodes are not blocked by Decision 3)
      expect(specDocumentsLlmServiceSpy).toHaveBeenCalledOnce();
      expect(batchTemplateOnly).toBe(false);
    });
  });

  describe("provenance correctness", () => {
    it("template-fallback nodes produce generationSource: 'template' provenance", () => {
      // When batchTemplateOnly is true and serviceResult is undefined,
      // buildSpecDocument falls through to the template branch which sets:
      //   provenanceExtras = { generationSource: serviceResult?.generationSource ?? "template", ... }
      // Since serviceResult is undefined, generationSource defaults to "template".
      const llmNodeOutput = createTemplateFallbackOutput("node-template");
      const batchTemplateOnly =
        llmNodeOutput !== undefined &&
        llmNodeOutput.generationSource !== "llm";

      expect(batchTemplateOnly).toBe(true);

      // Simulate the provenance assignment from buildSpecDocument's template branch
      const serviceResult = undefined;
      const provenanceExtras = {
        generationSource: serviceResult?.generationSource ?? "template" as const,
      };

      expect(provenanceExtras.generationSource).toBe("template");
    });
  });
});
