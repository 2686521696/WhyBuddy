/**
 * Synchronous fast-path assembly for nodes whose batch LLM result is complete.
 *
 * Preconditions (asserted by call site, NOT re-checked here):
 * - `args.llmOutput.generationSource === "llm"`
 * - For every `type` in `args.targetTypes`, `pickSpecDocsLlmMarkdownForType(args.llmOutput, type)`
 *   returns a non-empty string.
 *
 * This helper mirrors the LLM short-circuit branch inside `buildSpecDocument`
 * but produces all documents for a node in one synchronous call, eliminating the
 * `Promise.race + Promise.all` overhead for the 24-node happy path.
 *
 * @module assemble-spec-documents-from-llm-cache
 */

import { randomUUID } from "node:crypto";

import type {
  BlueprintClarificationSession,
  BlueprintGenerationJob,
  BlueprintProjectDomainContext,
  BlueprintRoleTimelineEntry,
  BlueprintRouteCandidate,
  BlueprintSpecDocument,
  BlueprintSpecDocumentType,
  BlueprintSpecTree,
  BlueprintSpecTreeNode,
} from "../../../shared/blueprint/contracts.js";
import type { SpecDocsLlmNodeOutput } from "./spec-docs-llm-generation.js";

// ---------------------------------------------------------------------------
// Internal utilities (mirrors of helpers in blueprint.ts, kept minimal)
// ---------------------------------------------------------------------------

function createId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}

function collectRoleFindingIds(
  findings: BlueprintRoleTimelineEntry[],
): string[] {
  return uniqueStrings(findings.map((f) => f.id));
}

function collectRoleFindingRoleIds(
  findings: BlueprintRoleTimelineEntry[],
): string[] {
  return uniqueStrings(findings.map((f) => f.roleId));
}

function collectRoleFindingEvidenceIds(
  findings: BlueprintRoleTimelineEntry[],
): string[] {
  return uniqueStrings(
    findings.flatMap((f) =>
      [
        f.evidenceId,
        ...(f.sourceIds.capabilityEvidenceIds ?? []),
      ].filter(isNonEmptyString),
    ),
  );
}

/**
 * Picks the cached markdown for a given document type from the LLM node output.
 * Returns `undefined` if the output is missing, not from LLM source, or the
 * corresponding field is empty.
 */
export function pickSpecDocsLlmMarkdownForType(
  output: SpecDocsLlmNodeOutput | undefined,
  type: BlueprintSpecDocumentType,
): string | undefined {
  if (output === undefined) return undefined;
  if (output.generationSource !== "llm") return undefined;
  switch (type) {
    case "requirements":
      return output.requirements;
    case "design":
      return output.design;
    case "tasks":
      return output.tasks;
    default:
      return undefined;
  }
}

function buildSpecDocumentHeading(
  type: BlueprintSpecDocumentType,
  nodeTitle: string,
): string {
  const label =
    type === "requirements"
      ? "Requirements"
      : type === "design"
        ? "Design"
        : "Tasks";
  return `${label}: ${nodeTitle}`;
}

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Synchronous fast-path assembly for nodes whose batch LLM result is complete.
 *
 * Preconditions (asserted by call site, NOT re-checked here):
 * - `args.llmOutput.generationSource === "llm"`
 * - For every `type` in `args.targetTypes`, `pickSpecDocsLlmMarkdownForType(args.llmOutput, type)`
 *   returns a non-empty string.
 *
 * This helper mirrors the LLM short-circuit branch at `buildSpecDocument`
 * but produces all documents for a node in one synchronous call, eliminating the
 * `Promise.race + Promise.all` overhead for the 24-node happy path.
 */
export function assembleSpecDocumentsFromLlmCache(args: {
  job: BlueprintGenerationJob;
  specTree: BlueprintSpecTree;
  node: BlueprintSpecTreeNode;
  llmOutput: SpecDocsLlmNodeOutput;
  primaryRoute: BlueprintRouteCandidate | undefined;
  createdAt: string;
  previousRoleFindings: BlueprintRoleTimelineEntry[] | undefined;
  clarificationSession: BlueprintClarificationSession | undefined;
  domainContext: BlueprintProjectDomainContext | undefined;
  targetTypes: ReadonlyArray<BlueprintSpecDocumentType>;
}): BlueprintSpecDocument[] {
  return args.targetTypes.map((type) => {
    const content = pickSpecDocsLlmMarkdownForType(args.llmOutput, type)!;
    const id = createId("blueprint-spec-document");
    const title = buildSpecDocumentHeading(type, args.node.title);

    return {
      id,
      jobId: args.job.id,
      treeId: args.specTree.id,
      nodeId: args.node.id,
      type,
      status: "draft",
      version: 1,
      sourceDocumentId: id,
      title,
      summary: args.node.summary,
      content,
      format: "markdown",
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
      provenance: {
        jobId: args.job.id,
        projectId: args.job.projectId,
        sourceId: args.job.sourceId,
        targetText: args.job.request.targetText,
        githubUrls: args.job.request.githubUrls ?? [],
        treeVersion: args.specTree.version,
        nodeType: args.node.type,
        nodeTitle: args.node.title,
        nodeSummary: args.node.summary,
        dependencies: [...args.node.dependencies],
        outputs: [...args.node.outputs],
        reusedRoleFindingIds: collectRoleFindingIds(
          args.previousRoleFindings ?? [],
        ),
        reusedRoleIds: collectRoleFindingRoleIds(
          args.previousRoleFindings ?? [],
        ),
        reusedEvidenceIds: collectRoleFindingEvidenceIds(
          args.previousRoleFindings ?? [],
        ),
        generationSource: "llm",
        promptId: args.llmOutput.promptId,
        model: args.llmOutput.model,
        promptFingerprint: args.llmOutput.promptFingerprint,
        responseDigest: args.llmOutput.responseDigest,
      },
    } as BlueprintSpecDocument;
  });
}
