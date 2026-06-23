import { getAIConfig } from "./ai-config.js";
import { webAigcRuntimeEngine } from "./workflow-runtime-engine.js";
import { serverRuntime } from "../runtime/server-runtime.js";
import type { KnowledgeService } from "../knowledge/knowledge-service.js";
import {
  executeAiPptNode,
  type AiPptNodeAdapterDeps,
} from "../routes/node-adapters/ai-ppt-node-adapter.js";
import {
  executeAudioRecognitionNode,
  type AudioRecognitionNodeAdapterDeps,
} from "../routes/node-adapters/audio-recognition-node-adapter.js";
import {
  executeDynamicChartNode,
} from "../routes/node-adapters/dynamic-chart-node-adapter.js";
import {
  executeExcelReadNode,
} from "../routes/node-adapters/excel-read-node-adapter.js";
import {
  executeFileGenerationNode,
} from "../routes/node-adapters/file-generation-node-adapter.js";
import {
  executeFileSlicingNode,
} from "../routes/node-adapters/file-slicing-node-adapter.js";
import {
  executeFileTranslationNode,
  type FileTranslationNodeAdapterDeps,
} from "../routes/node-adapters/file-translation-node-adapter.js";
import {
  executeGetDeviceInfoNode,
  type GetDeviceInfoNodeAdapterDeps,
} from "../routes/node-adapters/get-device-info-node-adapter.js";
import {
  type FileGenerationNodeAdapterDeps,
} from "../routes/node-adapters/file-generation-node-adapter.js";
import {
  executeGetLocationInfoNode,
} from "../routes/node-adapters/get-location-info-node-adapter.js";
import {
  executeGraphSearchNode,
  type GraphSearchNodeAdapterDeps,
} from "../routes/node-adapters/graph-search-node-adapter.js";
import {
  executeImageSearchNode,
  type ImageSearchNodeAdapterDeps,
} from "../routes/node-adapters/image-search-node-adapter.js";
import {
  executeIntentRecognitionNode,
} from "../routes/node-adapters/intent-recognition-node-adapter.js";
import {
  executeKnowledgeNode,
} from "../routes/node-adapters/knowledge-node-adapter.js";
import {
  executeLongTextExtractionNode,
} from "../routes/node-adapters/long-text-extraction-node-adapter.js";
import {
  executeMcpNode,
  type McpNodeAdapterDeps,
} from "../routes/node-adapters/mcp-node-adapter.js";
import {
  executeOcrRecognitionNode,
  type OcrRecognitionNodeAdapterDeps,
} from "../routes/node-adapters/ocr-recognition-node-adapter.js";
import {
  executeOrchestrationRecognitionJumpNode,
  type OrchestrationRecognitionJumpNodeAdapterDeps,
} from "../routes/node-adapters/orchestration-recognition-jump-node-adapter.js";
import {
  executeSimilarityMatchNode,
} from "../routes/node-adapters/similarity-match-node-adapter.js";
import {
  executeStaticWebpageReadNode,
  type StaticWebpageReadNodeAdapterDeps,
} from "../routes/node-adapters/static-webpage-read-node-adapter.js";
import {
  executeTransactionFlowNode,
  type TransactionFlowNodeAdapterDeps,
} from "../routes/node-adapters/transaction-flow-node-adapter.js";
import {
  executeWebQaNode,
  type WebQaNodeAdapterDeps,
} from "../routes/node-adapters/web-qa-node-adapter.js";
import {
  executeWebSearchNode,
  type WebSearchNodeAdapterDeps,
} from "../routes/node-adapters/web-search-node-adapter.js";
import type {
  WorkflowNodeAdapter,
  WorkflowNodeAdapterResult,
  WorkflowNodeExecutionContext,
} from "../../shared/workflow-runtime-engine.js";
import type {
  UnifiedKnowledgeResult,
  UnifiedQueryOptions,
} from "../../shared/knowledge/types.js";
import type { SourceType } from "../../shared/rag/contracts.js";
import type {
  WebAigcDocumentSearchResponse,
  WebAigcSearchRequest,
} from "../../shared/rag/web-aigc-search.js";
import type { WebAigcRealProviderReadinessMatrix } from "../../shared/telemetry/contracts.js";
import { recordWebAigcProviderReadiness } from "./web-aigc-runtime-observability.js";
import type { TransactionFlowAction } from "../../shared/web-aigc-transaction-flow.js";
import type {
  WebAigcOrchestrationRecognitionJumpCandidate,
  WebAigcOrchestrationRecognitionJumpFallbackTarget,
} from "../../shared/web-aigc-orchestration-recognition-jump.js";
import type { WebAigcOcrRecognitionImageInput } from "../../shared/web-aigc-ocr-recognition.js";

type RuntimeDocumentSearch = (
  request: WebAigcSearchRequest,
) => Promise<WebAigcDocumentSearchResponse>;

type RuntimeKnowledgeService = {
  query(
    question: string,
    projectId: string,
    options?: Partial<UnifiedQueryOptions>,
  ): Promise<UnifiedKnowledgeResult>;
};

export interface InstallWebAigcRuntimeExtraAdaptersDeps {
  documentSearch?: RuntimeDocumentSearch;
  knowledgeService?: RuntimeKnowledgeService;
  executeMcp?: McpNodeAdapterDeps["executeMcp"];
  queryService?: GraphSearchNodeAdapterDeps["queryService"];
  permissionEngine?: WebQaNodeAdapterDeps["permissionEngine"];
  executeWebSearch?: WebSearchNodeAdapterDeps["executeWebSearch"];
  executeImageSearch?: ImageSearchNodeAdapterDeps["executeImageSearch"];
  deviceRuntime?: GetDeviceInfoNodeAdapterDeps;
  audioRecognitionRuntime?: Pick<
    AudioRecognitionNodeAdapterDeps,
    "recognizeAudio" | "loadAudioFromUrl" | "getNow"
  >;
  ocrRecognitionRuntime?: Pick<
    OcrRecognitionNodeAdapterDeps,
    "recognizeImages" | "persistArtifacts" | "now"
  >;
  fetchStaticWebpageHtml?: StaticWebpageReadNodeAdapterDeps["fetchHtml"];
  fileGenerationRuntime?: Pick<
    FileGenerationNodeAdapterDeps,
    "writeArtifactFile" | "readArtifactPreview"
  >;
  fileTranslationRuntime?: Pick<
    FileTranslationNodeAdapterDeps,
    "translateSegment" | "now"
  >;
  orchestrationRecognitionJumpRuntime?: Pick<
    OrchestrationRecognitionJumpNodeAdapterDeps,
    "permissionEngine" | "auditLogger"
  >;
  aiPptRuntime?: Pick<
    AiPptNodeAdapterDeps,
    "generateDeck" | "persistOutput" | "now" | "createOutputId"
  >;
  transactionFlowRuntime?: Pick<
    TransactionFlowNodeAdapterDeps,
    "permissionEngine" | "auditLogger" | "now" | "createId"
  >;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function toWorkflowOutput(value: unknown): Record<string, unknown> {
  return cloneValue(value) as Record<string, unknown>;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized || undefined;
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map(item => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function getPathValue(source: unknown, path: string): unknown {
  const segments = path
    .split(".")
    .map(segment => segment.trim())
    .filter(Boolean);

  let current = source;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }

    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function resolveTemplateValue(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "@variables") {
      return cloneValue(variables);
    }
    if (trimmed.startsWith("$.")) {
      const resolved = getPathValue(variables, trimmed.slice(2));
      return resolved === undefined ? undefined : cloneValue(resolved);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(item => resolveTemplateValue(item, variables));
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveTemplateValue(item, variables),
      ]),
    );
  }

  return value;
}

function getNodeConfigValue(
  context: WorkflowNodeExecutionContext,
  key: string,
): unknown {
  const configEntry = context.node.config.find(item => item.key === key);
  return resolveTemplateValue(configEntry?.defaultValue, context.variables);
}

function pickRuntimeNodeField(
  context: WorkflowNodeExecutionContext,
  key: string,
): unknown {
  const configValue = getNodeConfigValue(context, key);
  if (configValue !== undefined) {
    return configValue;
  }

  const inputRecord = normalizeObject(context.input);
  if (key in inputRecord) {
    return inputRecord[key];
  }

  const variablesRecord = normalizeObject(context.variables);
  if (key in variablesRecord) {
    return variablesRecord[key];
  }

  return undefined;
}

function buildRuntimeContext(
  context: WorkflowNodeExecutionContext,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const base = normalizeObject(pickRuntimeNodeField(context, "context"));
  return {
    ...base,
    ...extra,
    workflowId:
      normalizeString(base.workflowId) ||
      context.instance.links.workflowId ||
      context.definition.links.workflowId,
    missionId:
      normalizeString(base.missionId) ||
      context.instance.links.missionId ||
      context.definition.links.missionId,
    sessionId:
      normalizeString(base.sessionId) ||
      context.instance.links.sessionId ||
      context.definition.links.sessionId,
    nodeId: context.node.id,
    nodeType: context.node.type,
  };
}

function mergeSearchScopeProjectId(
  context: WorkflowNodeExecutionContext,
  search: Record<string, unknown>,
): Record<string, unknown> {
  const scope = normalizeObject(search.scope);
  const projectId =
    normalizeString(scope.projectId) ||
    normalizeString(pickRuntimeNodeField(context, "projectId")) ||
    normalizeString(getPathValue(context.variables, "scope.projectId"));

  if (!projectId) {
    return search;
  }

  return {
    ...search,
    scope: {
      ...scope,
      projectId,
    },
  };
}

class WebSearchRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "web_search";

  constructor(
    private readonly deps: Pick<WebSearchNodeAdapterDeps, "executeWebSearch"> = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const options = normalizeObject(pickRuntimeNodeField(context, "options"));
    const runtimeContext = buildRuntimeContext(context);
    const result = await executeWebSearchNode(
      {
        nodeType: "web_search",
        input: {
          query: normalizeString(pickRuntimeNodeField(context, "query")),
          options: {
            ...(typeof normalizeNumber(options.topK) === "number"
              ? { topK: normalizeNumber(options.topK) }
              : {}),
            ...(normalizeString(options.mode)
              ? { mode: normalizeString(options.mode) as "mock" | "hybrid" }
              : {}),
          },
        },
      },
      this.deps,
    );

    const output = toWorkflowOutput(result.output);
    output.metadata = {
      query: result.output.query,
      resultCount: result.output.results.length,
      ...(typeof normalizeNumber(options.topK) === "number"
        ? { topK: normalizeNumber(options.topK) }
        : {}),
      downstreamConsumers: ["web_qa", "static_webpage_read", "end"],
      runtime: runtimeContext,
    };
    output.handoff = {
      webQa: {
        question: result.output.query,
        citations: result.output.citations,
        summaries: result.output.summaries,
      },
      staticWebpageRead: {
        urls: result.output.results.map((item) => item.url),
      },
    };

    return {
      kind: "advance",
      output,
    };
  }
}

class WebQaRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "web_qa";

  constructor(private readonly deps: InstallWebAigcRuntimeExtraAdaptersDeps) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const runtimeContext = buildRuntimeContext(context);
    const search = mergeSearchScopeProjectId(
      context,
      normalizeObject(pickRuntimeNodeField(context, "search")),
    );
    const fallback = normalizeObject(pickRuntimeNodeField(context, "knowledgeFallback"));
    const fallbackProjectId =
      normalizeString(fallback.projectId) ||
      normalizeString(normalizeObject(search.scope).projectId);
    const pages = pickRuntimeNodeField(context, "pages");

    const result = await executeWebQaNode(
      {
        nodeType: "web_qa",
        input: {
          question: normalizeString(pickRuntimeNodeField(context, "question")),
          pages: Array.isArray(pages)
            ? cloneValue(pages as Array<Record<string, unknown>>)
            : undefined,
          ...(Object.keys(search).length > 0 ? { search } : {}),
          ...(Object.keys(fallback).length > 0 || fallbackProjectId
            ? {
                knowledgeFallback: {
                  ...fallback,
                  ...(fallbackProjectId ? { projectId: fallbackProjectId } : {}),
                },
              }
            : {}),
          systemPrompt: normalizeString(pickRuntimeNodeField(context, "systemPrompt")),
          answerStyle: normalizeString(pickRuntimeNodeField(context, "answerStyle")),
          workflowId:
            context.instance.links.workflowId || context.definition.links.workflowId,
          sessionId:
            context.instance.links.sessionId || context.definition.links.sessionId,
          missionId:
            context.instance.links.missionId || context.definition.links.missionId,
          agentId: context.node.agentId || normalizeString(pickRuntimeNodeField(context, "agentId")),
          stage: context.node.stageKey || context.node.type,
        },
      },
      {
        ...(this.deps.documentSearch ? { documentSearch: this.deps.documentSearch } : {}),
        ...(this.deps.knowledgeService
          ? { knowledgeService: this.deps.knowledgeService }
          : {}),
        permissionEngine: this.deps.permissionEngine,
        executeLLM: (messages, options) =>
          serverRuntime.llmProvider.call(messages, options),
        getConfig: getAIConfig,
      },
    );

    const output = toWorkflowOutput(result.output);
    output.observability = {
      eventKey: "external.web_qa",
      nodeType: "web_qa",
      strategy: result.output.strategy,
      question: result.output.metadata.question,
      ...(result.output.metadata.projectId
        ? { projectId: result.output.metadata.projectId }
        : {}),
      pageCount: result.output.metadata.pageCount,
      sourceCount: result.output.metadata.sourceCount,
      searchUsed:
        typeof result.output.metadata.searchQuery === "string" &&
        result.output.metadata.searchQuery.length > 0,
      ...(result.output.metadata.searchQuery
        ? { searchQuery: result.output.metadata.searchQuery }
        : {}),
      ...(typeof result.output.metadata.searchResultCount === "number"
        ? { searchResultCount: result.output.metadata.searchResultCount }
        : {}),
      fallbackUsed: result.output.fallbackUsed,
      ...(result.output.fallbackReason
        ? { fallbackReason: result.output.fallbackReason }
        : {}),
      runtime: runtimeContext,
      ...(isRecord(result.output.observability) ? result.output.observability : {}),
    };

    return {
      kind: "advance",
      output,
    };
  }
}

class GetLocationInfoRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "get_location_info";

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const coarseLocation = pickRuntimeNodeField(context, "coarseLocation");
    const authorization = pickRuntimeNodeField(context, "authorization");
    const privacy = pickRuntimeNodeField(context, "privacy");
    const result = await executeGetLocationInfoNode({
      nodeType: "get_location_info",
      input: {
        coarseLocation: isRecord(coarseLocation)
          ? cloneValue(coarseLocation)
          : undefined,
        timezone: normalizeString(pickRuntimeNodeField(context, "timezone")),
        locale: normalizeString(pickRuntimeNodeField(context, "locale")),
        authorization: isRecord(authorization)
          ? cloneValue(authorization)
          : undefined,
        privacy: isRecord(privacy)
          ? cloneValue(privacy)
          : undefined,
        requestedPrecision:
          normalizeString(pickRuntimeNodeField(context, "requestedPrecision")) === "precise"
            ? "precise"
            : "coarse",
        context: buildRuntimeContext(context),
      },
    });

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class GetDeviceInfoRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "get_device_info";

  constructor(
    private readonly deps: Pick<InstallWebAigcRuntimeExtraAdaptersDeps, "deviceRuntime"> = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const clientHints = pickRuntimeNodeField(context, "clientHints");
    const privacy = pickRuntimeNodeField(context, "privacy");
    const result = await executeGetDeviceInfoNode(
      {
        nodeType: "get_device_info",
        input: {
          clientHints: isRecord(clientHints)
            ? cloneValue(clientHints)
            : undefined,
          privacy: isRecord(privacy)
            ? cloneValue(privacy)
            : undefined,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.deviceRuntime,
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class AudioRecognitionRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "audio_recognition";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "audioRecognitionRuntime"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const source = pickRuntimeNodeField(context, "source");
    const writeback = pickRuntimeNodeField(context, "writeback");
    const result = await executeAudioRecognitionNode(
      {
        nodeType: "audio_recognition",
        input: {
          source: isRecord(source) ? cloneValue(source) : undefined,
          languageHint: normalizeString(pickRuntimeNodeField(context, "languageHint")),
          writeback: isRecord(writeback) ? cloneValue(writeback) : undefined,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.audioRecognitionRuntime,
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class GraphSearchRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "graph_search";

  constructor(private readonly deps: InstallWebAigcRuntimeExtraAdaptersDeps) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    if (!this.deps.queryService) {
      throw new Error("Graph search runtime adapter requires queryService.");
    }

    const result = await executeGraphSearchNode(
      {
        nodeType: "graph_search",
        input: {
          projectId: normalizeString(pickRuntimeNodeField(context, "projectId")),
          query: normalizeString(pickRuntimeNodeField(context, "query")),
          mode: normalizeString(pickRuntimeNodeField(context, "mode")) as
            | "neighbors"
            | "path"
            | "subgraph"
            | "natural_language"
            | undefined,
          entityId: normalizeString(pickRuntimeNodeField(context, "entityId")),
          sourceEntityId: normalizeString(
            pickRuntimeNodeField(context, "sourceEntityId"),
          ),
          targetEntityId: normalizeString(
            pickRuntimeNodeField(context, "targetEntityId"),
          ),
          entityIds: normalizeStringArray(pickRuntimeNodeField(context, "entityIds")),
          relationTypes: normalizeStringArray(
            pickRuntimeNodeField(context, "relationTypes"),
          ),
          depth: normalizeNumber(pickRuntimeNodeField(context, "depth")),
          includeAnswerDraft:
            pickRuntimeNodeField(context, "includeAnswerDraft") === true,
          answerQuestion: normalizeString(
            pickRuntimeNodeField(context, "answerQuestion"),
          ),
          context: buildRuntimeContext(context),
        },
      },
      {
        queryService: this.deps.queryService,
        knowledgeService: this.deps.knowledgeService as unknown as KnowledgeService,
      },
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class KnowledgeRuntimeAdapter implements WorkflowNodeAdapter {
  constructor(
    readonly type: "knowledge_qa" | "qa_search",
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "knowledgeService"
    >,
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    if (!this.deps.knowledgeService) {
      throw new Error(
        `Knowledge runtime adapter requires knowledgeService for ${this.type}.`,
      );
    }

    const options = pickRuntimeNodeField(context, "options");
    const result = await executeKnowledgeNode(
      {
        nodeType: this.type,
        input: {
          question:
            normalizeString(pickRuntimeNodeField(context, "question")) ||
            normalizeString(pickRuntimeNodeField(context, "query")) ||
            normalizeString(pickRuntimeNodeField(context, "prompt")),
          projectId: normalizeString(pickRuntimeNodeField(context, "projectId")),
          options: isRecord(options)
            ? cloneValue(options as Partial<UnifiedQueryOptions>)
            : undefined,
          maxResults: normalizeNumber(pickRuntimeNodeField(context, "maxResults")),
        },
      },
      {
        knowledgeService: this.deps.knowledgeService as unknown as KnowledgeService,
      },
    );

    const output = {
      nodeType: result.nodeType,
      ...toWorkflowOutput(result.output),
      metadata: {
        ...(isRecord(result.output.metadata) ? result.output.metadata : {}),
        runtime: buildRuntimeContext(context),
      },
    };

    return {
      kind: "advance",
      output,
    };
  }
}

class McpRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "mcp";

  constructor(
    private readonly deps: Pick<InstallWebAigcRuntimeExtraAdaptersDeps, "executeMcp">,
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    if (!this.deps.executeMcp) {
      throw new Error("MCP runtime adapter requires executeMcp.");
    }

    const input = this.buildRequestInput(context);
    const result = await executeMcpNode(
      {
        nodeType: "mcp",
        input,
      },
      {
        executeMcp: this.deps.executeMcp,
      },
    );

    if (result.output.status === "approval_required") {
      return {
        kind: "wait",
        waitingFor: `请审批 MCP 工具调用：${result.output.targetLabel}`,
        output: {
          nodeType: "mcp",
          ...toWorkflowOutput(result.output),
          audit: {
            eventKey: "node.waiting_input",
          },
        },
        inputSchema: [
          {
            key: "decision",
            label: "Approval decision",
            valueType: "string",
            required: true,
            description: "Enter approved or rejected",
          },
          {
            key: "actorId",
            label: "Approver",
            valueType: "string",
            required: true,
          },
          {
            key: "comment",
            label: "Approval comment",
            valueType: "string",
            required: false,
          },
          {
            key: "ticketId",
            label: "Approval ticket",
            valueType: "string",
            required: false,
          },
        ],
        checkpointData: {
          nodeType: "mcp",
          request: input,
          escalationId: result.output.escalationId,
          targetLabel: result.output.targetLabel,
          resource: result.output.resource,
        },
      };
    }

    if (result.output.status === "denied") {
      return {
        kind: "error",
        message: result.output.error || "MCP tool call was denied.",
        output: {
          nodeType: "mcp",
          ...toWorkflowOutput(result.output),
        },
      };
    }

    if (result.output.status === "failed") {
      return {
        kind: "error",
        message: result.output.error || "MCP tool call failed.",
        output: {
          nodeType: "mcp",
          ...toWorkflowOutput(result.output),
        },
      };
    }

    return {
      kind: "advance",
      output: {
        nodeType: "mcp",
        ...toWorkflowOutput(result.output),
      },
    };
  }

  async resume(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    if (!this.deps.executeMcp) {
      throw new Error("MCP runtime adapter requires executeMcp.");
    }

    const decision = normalizeString(context.resumePayload?.decision);
    const actorId = normalizeString(context.resumePayload?.actorId);
    const comment = normalizeString(context.resumePayload?.comment);
    const ticketId = normalizeString(context.resumePayload?.ticketId);
    const checkpoint = normalizeObject(context.instance.checkpoint?.payload);
    const checkpointRequest = normalizeObject(checkpoint.request);
    const targetLabel =
      normalizeString(checkpoint.targetLabel) ||
      normalizeString(checkpointRequest.targetLabel) ||
      "MCP 宸ュ叿璋冪敤";
    const escalationId = normalizeString(checkpoint.escalationId);

    if (decision === "rejected") {
      return {
        kind: "error",
        message: "MCP tool approval was rejected.",
        output: {
          nodeType: "mcp",
          status: "denied",
          error: "MCP tool approval was rejected.",
          targetLabel,
          escalationId,
          approval: {
            decision: "rejected",
            actorId,
            comment,
            ticketId,
          },
          audit: {
            eventKey: "human.rejected",
          },
        },
      };
    }

    const baseRequest = this.buildRequestInput(context, checkpointRequest);
    const existingMetadata = isRecord(baseRequest.metadata)
      ? cloneValue(baseRequest.metadata)
      : {};
    const approvalMetadata = {
      ...existingMetadata,
      approval: {
        decision: "approved",
        actorId,
        comment,
        ticketId,
        escalationId,
      },
    };
    const result = await executeMcpNode(
      {
        nodeType: "mcp",
        input: {
          ...baseRequest,
          metadata: approvalMetadata,
          requireApproval: false,
        },
      },
      {
        executeMcp: this.deps.executeMcp,
      },
    );

    if (result.output.status !== "completed") {
      return {
        kind: "error",
        message:
          result.output.error ||
          `MCP tool approval could not be completed for ${targetLabel}.`,
        output: {
          nodeType: "mcp",
          ...toWorkflowOutput(result.output),
          approval: {
            decision: "approved",
            actorId,
            comment,
            ticketId,
            escalationId,
          },
          audit: {
            eventKey: "human.approved",
          },
        },
      };
    }

    return {
      kind: "advance",
      output: {
        nodeType: "mcp",
        ...toWorkflowOutput(result.output),
        approval: {
          decision: "approved",
          actorId,
          comment,
          ticketId,
          escalationId,
        },
        audit: {
          eventKey: "human.approved",
        },
      },
    };
  }

  private buildRequestInput(
    context: WorkflowNodeExecutionContext,
    checkpointRequest: Record<string, unknown> = {},
  ) {
    const argumentsValue =
      checkpointRequest.arguments ?? pickRuntimeNodeField(context, "arguments");
    const metadataValue =
      checkpointRequest.metadata ?? pickRuntimeNodeField(context, "metadata");
    const contextValue =
      checkpointRequest.context ?? pickRuntimeNodeField(context, "context");
    const approverListValue =
      checkpointRequest.approverList ?? pickRuntimeNodeField(context, "approverList");
    const normalizedContext =
      typeof contextValue === "string" || Array.isArray(contextValue)
        ? cloneValue(contextValue)
        : undefined;

    return {
      serverId:
        normalizeString(checkpointRequest.serverId) ||
        normalizeString(pickRuntimeNodeField(context, "serverId")),
      toolName:
        normalizeString(checkpointRequest.toolName) ||
        normalizeString(pickRuntimeNodeField(context, "toolName")),
      arguments: isRecord(argumentsValue)
        ? cloneValue(argumentsValue)
        : undefined,
      input:
        normalizeString(checkpointRequest.input) ||
        normalizeString(pickRuntimeNodeField(context, "input")) ||
        normalizeString(pickRuntimeNodeField(context, "prompt")),
      context: normalizedContext,
      workflowId:
        normalizeString(checkpointRequest.workflowId) ||
        context.instance.links.workflowId ||
        context.definition.links.workflowId,
      stage:
        normalizeString(checkpointRequest.stage) ||
        context.node.stageKey ||
        context.node.type,
      metadata: isRecord(metadataValue) ? cloneValue(metadataValue) : undefined,
      agentId:
        normalizeString(checkpointRequest.agentId) ||
        context.node.agentId ||
        normalizeString(pickRuntimeNodeField(context, "agentId")),
      token:
        normalizeString(checkpointRequest.token) ||
        normalizeString(pickRuntimeNodeField(context, "token")),
      timeoutMs:
        normalizeNumber(checkpointRequest.timeoutMs) ||
        normalizeNumber(pickRuntimeNodeField(context, "timeoutMs")),
      requireApproval:
        typeof checkpointRequest.requireApproval === "boolean"
          ? checkpointRequest.requireApproval
          : typeof pickRuntimeNodeField(context, "requireApproval") === "boolean"
            ? (pickRuntimeNodeField(context, "requireApproval") as boolean)
            : undefined,
      approverList: normalizeStringArray(approverListValue),
    };
  }
}

class StaticWebpageReadRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "static_webpage_read";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "fetchStaticWebpageHtml"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const extraction = pickRuntimeNodeField(context, "extraction");
    const fallback = pickRuntimeNodeField(context, "fallback");
    const result = await executeStaticWebpageReadNode(
      {
        nodeType: "static_webpage_read",
        input: {
          url: normalizeString(pickRuntimeNodeField(context, "url")),
          html: normalizeString(pickRuntimeNodeField(context, "html")),
          titleHint: normalizeString(pickRuntimeNodeField(context, "titleHint")),
          extraction: isRecord(extraction) ? cloneValue(extraction) : undefined,
          fallback: isRecord(fallback) ? cloneValue(fallback) : undefined,
          context: buildRuntimeContext(context),
        },
      },
      {
        fetchHtml: this.deps.fetchStaticWebpageHtml,
      },
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class IntentRecognitionRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "intent_recognition";

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const timeframe = pickRuntimeNodeField(context, "timeframe");
    const constraints = pickRuntimeNodeField(context, "constraints");
    const objectives = pickRuntimeNodeField(context, "objectives");
    const result = await executeIntentRecognitionNode({
      nodeType: "intent_recognition",
      input: {
        commandId: normalizeString(pickRuntimeNodeField(context, "commandId")),
        commandText: normalizeString(pickRuntimeNodeField(context, "commandText")),
        userId: normalizeString(pickRuntimeNodeField(context, "userId")),
        priority: normalizeString(pickRuntimeNodeField(context, "priority")) as
          | "low"
          | "medium"
          | "high"
          | "critical"
          | undefined,
        locale: normalizeString(pickRuntimeNodeField(context, "locale")) as
          | "zh-CN"
          | "en-US"
          | undefined,
        planId: normalizeString(pickRuntimeNodeField(context, "planId")),
        timeframe: isRecord(timeframe) ? cloneValue(timeframe) : undefined,
        constraints: Array.isArray(constraints)
          ? cloneValue(constraints)
          : undefined,
        objectives: normalizeStringArray(objectives),
        context: buildRuntimeContext(context),
      },
    });

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class LongTextExtractionRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "long_text_extraction";

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const result = await executeLongTextExtractionNode({
      nodeType: "long_text_extraction",
      input: {
        text: normalizeString(pickRuntimeNodeField(context, "text")),
        title: normalizeString(pickRuntimeNodeField(context, "title")),
        mode: normalizeString(pickRuntimeNodeField(context, "mode")) as
          | "balanced"
          | "summary_first"
          | "fragments_first"
          | undefined,
        maxInputChars: normalizeNumber(pickRuntimeNodeField(context, "maxInputChars")),
        maxSummaryChars: normalizeNumber(
          pickRuntimeNodeField(context, "maxSummaryChars"),
        ),
        maxKeywords: normalizeNumber(pickRuntimeNodeField(context, "maxKeywords")),
        maxFragments: normalizeNumber(pickRuntimeNodeField(context, "maxFragments")),
        fragmentCharLimit: normalizeNumber(
          pickRuntimeNodeField(context, "fragmentCharLimit"),
        ),
        context: buildRuntimeContext(context),
      },
    });

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class AiPptRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "ai_ppt";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "aiPptRuntime"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const artifact = pickRuntimeNodeField(context, "artifact");
    const result = await executeAiPptNode(
      {
        nodeType: "ai_ppt",
        input: {
          topic: normalizeString(pickRuntimeNodeField(context, "topic")),
          brief: normalizeString(pickRuntimeNodeField(context, "brief")),
          sourceText: normalizeString(pickRuntimeNodeField(context, "sourceText")),
          audience: normalizeString(pickRuntimeNodeField(context, "audience")),
          locale: normalizeString(pickRuntimeNodeField(context, "locale")),
          slideCount: normalizeNumber(pickRuntimeNodeField(context, "slideCount")),
          artifact: isRecord(artifact) ? cloneValue(artifact) : undefined,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.aiPptRuntime,
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class ExcelReadRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "excel_read";

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const result = await executeExcelReadNode({
      nodeType: "excel_read",
      input: {
        workbookBase64: normalizeString(pickRuntimeNodeField(context, "workbookBase64")),
        fileName: normalizeString(pickRuntimeNodeField(context, "fileName")),
        sheetName: normalizeString(pickRuntimeNodeField(context, "sheetName")),
        sheetIndex: normalizeNumber(pickRuntimeNodeField(context, "sheetIndex")),
        range: normalizeString(pickRuntimeNodeField(context, "range")),
        headerRow: normalizeNumber(pickRuntimeNodeField(context, "headerRow")),
        dataStartRow: normalizeNumber(pickRuntimeNodeField(context, "dataStartRow")),
        useHeaderRow:
          typeof pickRuntimeNodeField(context, "useHeaderRow") === "boolean"
            ? (pickRuntimeNodeField(context, "useHeaderRow") as boolean)
            : undefined,
        maxRows: normalizeNumber(pickRuntimeNodeField(context, "maxRows")),
        context: buildRuntimeContext(context),
      },
    });

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class TransactionFlowRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "transaction_flow";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "transactionFlowRuntime"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const transaction = pickRuntimeNodeField(context, "transaction");
    const compensation = pickRuntimeNodeField(context, "compensation");
    const metadata = pickRuntimeNodeField(context, "metadata");
    const result = await executeTransactionFlowNode(
      {
        nodeType: "transaction_flow",
        input: {
          agentId: normalizeString(pickRuntimeNodeField(context, "agentId")),
          token: normalizeString(pickRuntimeNodeField(context, "token")),
          transaction: isRecord(transaction)
            ? (cloneValue(transaction) as unknown as TransactionFlowAction)
            : undefined,
          compensation: isRecord(compensation) ? cloneValue(compensation) : undefined,
          metadata: isRecord(metadata) ? cloneValue(metadata) : undefined,
          requireApproval:
            typeof pickRuntimeNodeField(context, "requireApproval") === "boolean"
              ? (pickRuntimeNodeField(context, "requireApproval") as boolean)
              : true,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.transactionFlowRuntime,
    );

    if (result.output.status === "approval_required") {
      return {
        kind: "wait",
        waitingFor: result.output.approval.prompt,
        output: toWorkflowOutput(result.output),
        inputSchema: [
          {
            key: "decision",
            label: "Approval decision",
            valueType: "string",
            required: true,
            description: "Enter approved or rejected",
          },
          {
            key: "actorId",
            label: "Approver",
            valueType: "string",
            required: true,
          },
          {
            key: "comment",
            label: "Approval comment",
            valueType: "string",
            required: false,
          },
          {
            key: "ticketId",
            label: "Approval ticket",
            valueType: "string",
            required: false,
          },
        ],
        checkpointData: {
          nodeType: "transaction_flow",
          transaction: result.output.transaction,
          compensation: result.output.compensation,
          decisionId: result.output.approval.decisionId,
          prompt: result.output.approval.prompt,
        },
      };
    }

    if (result.output.status === "failed") {
      return {
        kind: "error",
        message: result.output.error || "Transaction flow failed.",
        output: toWorkflowOutput(result.output),
      };
    }

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }

  async resume(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const checkpoint = normalizeObject(context.instance.checkpoint?.payload);
    const transaction = pickRuntimeNodeField(context, "transaction");
    const compensation = pickRuntimeNodeField(context, "compensation");
    const approvalState = normalizeObject(getPathValue(context.variables, "approval"));
    const metadata = pickRuntimeNodeField(context, "metadata");
    const result = await executeTransactionFlowNode(
      {
        nodeType: "transaction_flow",
        input: {
          agentId: normalizeString(pickRuntimeNodeField(context, "agentId")),
          token: normalizeString(pickRuntimeNodeField(context, "token")),
          transaction: isRecord(transaction)
            ? (cloneValue(transaction) as unknown as TransactionFlowAction)
            : undefined,
          compensation: isRecord(compensation)
            ? cloneValue(compensation)
            : undefined,
          metadata: isRecord(metadata) ? cloneValue(metadata) : undefined,
          approval: {
            decision:
              normalizeString(context.resumePayload?.decision) === "rejected"
                ? "rejected"
                : "approved",
            actorId: normalizeString(context.resumePayload?.actorId),
            comment: normalizeString(context.resumePayload?.comment),
            ticketId: normalizeString(context.resumePayload?.ticketId),
            decisionId:
              normalizeString(checkpoint.decisionId) ||
              normalizeString(approvalState.decisionId),
          },
          requireApproval: true,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.transactionFlowRuntime,
    );

    if (result.output.status === "failed") {
      return {
        kind: "error",
        message: result.output.error || "Transaction flow failed.",
        output: toWorkflowOutput(result.output),
      };
    }

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class DynamicChartRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "dynamic_chart";

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const dataset = pickRuntimeNodeField(context, "dataset");
    const artifact = pickRuntimeNodeField(context, "artifact");
    const result = await executeDynamicChartNode({
      nodeType: "dynamic_chart",
      input: {
        chartType: normalizeString(pickRuntimeNodeField(context, "chartType")) as
          | "auto"
          | "bar"
          | "line"
          | "area"
          | "pie"
          | undefined,
        title: normalizeString(pickRuntimeNodeField(context, "title")),
        description: normalizeString(pickRuntimeNodeField(context, "description")),
        dataset: isRecord(dataset) ? cloneValue(dataset) : undefined,
        artifact: isRecord(artifact) ? cloneValue(artifact) : undefined,
        context: buildRuntimeContext(context),
      },
    });

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class ImageSearchRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "image_search";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "executeImageSearch"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const referenceImage = pickRuntimeNodeField(context, "referenceImage");
    const options = pickRuntimeNodeField(context, "options");
    const result = await executeImageSearchNode(
      {
        nodeType: "image_search",
        input: {
          query: normalizeString(pickRuntimeNodeField(context, "query")),
          tags: normalizeStringArray(pickRuntimeNodeField(context, "tags")),
          referenceImage: isRecord(referenceImage)
            ? cloneValue(referenceImage)
            : undefined,
          options: isRecord(options) ? cloneValue(options) : undefined,
          context: buildRuntimeContext(context),
        },
      },
      {
        executeImageSearch: this.deps.executeImageSearch,
      },
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class OrchestrationRecognitionJumpRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "orchestration_recognition_jump";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "orchestrationRecognitionJumpRuntime"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const candidates = pickRuntimeNodeField(context, "candidates");
    const fallbackTarget = pickRuntimeNodeField(context, "fallbackTarget");
    const result = await executeOrchestrationRecognitionJumpNode(
      {
        nodeType: "orchestration_recognition_jump",
        input: {
          query:
            normalizeString(pickRuntimeNodeField(context, "query")) ||
            normalizeString(pickRuntimeNodeField(context, "text")) ||
            normalizeString(pickRuntimeNodeField(context, "commandText")),
          agentId:
            context.node.agentId ||
            normalizeString(pickRuntimeNodeField(context, "agentId")),
          token: normalizeString(pickRuntimeNodeField(context, "token")),
          candidates: Array.isArray(candidates)
            ? (cloneValue(
                candidates as Array<Record<string, unknown>>,
              ) as unknown as WebAigcOrchestrationRecognitionJumpCandidate[])
            : undefined,
          fallbackTarget: isRecord(fallbackTarget)
            ? (cloneValue(
                fallbackTarget,
              ) as unknown as WebAigcOrchestrationRecognitionJumpFallbackTarget)
            : undefined,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.orchestrationRecognitionJumpRuntime,
    );

    if (!result.ok || result.output.status === "denied") {
      return {
        kind: "error",
        message:
          result.output.error || "Orchestration recognition jump was denied.",
        output: toWorkflowOutput(result.output),
      };
    }

    const targetNodeId = result.output.jumpTargetNodeId;
    if (!targetNodeId) {
      return {
        kind: "error",
        message:
          `Orchestration recognition jump node ${context.node.id} did not resolve a target.`,
        output: toWorkflowOutput(result.output),
      };
    }

    const jumpEdge = context.definition.edgeSchemas.find(
      edge =>
        edge.fromNodeId === context.node.id &&
        edge.toNodeId === targetNodeId &&
        edge.kind === "jump",
    );
    if (!jumpEdge) {
      return {
        kind: "error",
        message:
          `Orchestration recognition jump node ${context.node.id} cannot jump to ${targetNodeId} ` +
          "without an explicit jump edge.",
        output: {
          ...toWorkflowOutput(result.output),
          requestedTargetNodeId: targetNodeId,
          jumpValidated: false,
        },
      };
    }

    return {
      kind: "advance",
      nextNodeId: targetNodeId,
      output: {
        ...toWorkflowOutput(result.output),
        jumpTargetNodeId: targetNodeId,
        jumpEdgeId: jumpEdge.id,
        jumpValidated: true,
      },
    };
  }
}

class FileSlicingRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "file_slicing";

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const strategy = pickRuntimeNodeField(context, "strategy");
    const metadata = pickRuntimeNodeField(context, "metadata");
    const result = await executeFileSlicingNode({
      nodeType: "file_slicing",
      input: {
        sourceType: normalizeString(pickRuntimeNodeField(context, "sourceType")) as
          | SourceType
          | undefined,
        sourceId: normalizeString(pickRuntimeNodeField(context, "sourceId")),
        projectId: normalizeString(pickRuntimeNodeField(context, "projectId")),
        fileName: normalizeString(pickRuntimeNodeField(context, "fileName")),
        fileType: normalizeString(pickRuntimeNodeField(context, "fileType")) as
          | "text"
          | "markdown"
          | "json"
          | "log"
          | "html"
          | undefined,
        content: normalizeString(pickRuntimeNodeField(context, "content")),
        strategy: isRecord(strategy) ? cloneValue(strategy) : undefined,
        metadata: isRecord(metadata)
          ? {
              ...cloneValue(metadata),
              ...buildRuntimeContext(context),
            }
          : buildRuntimeContext(context),
      },
    });

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class FileTranslationRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "file_translation";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "fileTranslationRuntime"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const file = pickRuntimeNodeField(context, "file");
    const document = pickRuntimeNodeField(context, "document");
    const artifact = pickRuntimeNodeField(context, "artifact");
    const limits = pickRuntimeNodeField(context, "limits");
    const result = await executeFileTranslationNode(
      {
        nodeType: "file_translation",
        input: {
          file: isRecord(file) ? cloneValue(file) : undefined,
          document: isRecord(document) ? cloneValue(document) : undefined,
          content: normalizeString(pickRuntimeNodeField(context, "content")),
          sourceLanguage: normalizeString(
            pickRuntimeNodeField(context, "sourceLanguage"),
          ),
          targetLanguage: normalizeString(
            pickRuntimeNodeField(context, "targetLanguage"),
          ),
          preserveStructure:
            typeof pickRuntimeNodeField(context, "preserveStructure") === "boolean"
              ? (pickRuntimeNodeField(context, "preserveStructure") as boolean)
              : undefined,
          artifact: isRecord(artifact) ? cloneValue(artifact) : undefined,
          limits: isRecord(limits) ? cloneValue(limits) : undefined,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.fileTranslationRuntime,
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class FileGenerationRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "file_generation";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "fileGenerationRuntime"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const structuredContent = pickRuntimeNodeField(context, "structuredContent");
    const result = await executeFileGenerationNode(
      {
        nodeType: "file_generation",
        input: {
          title: normalizeString(pickRuntimeNodeField(context, "title")),
          filename: normalizeString(pickRuntimeNodeField(context, "filename")),
          format: normalizeString(pickRuntimeNodeField(context, "format")) as
            | "txt"
            | "md"
            | "json"
            | undefined,
          content: normalizeString(pickRuntimeNodeField(context, "content")),
          structuredContent:
            structuredContent !== undefined ? cloneValue(structuredContent) : undefined,
          template: normalizeString(pickRuntimeNodeField(context, "template")),
          outputId: normalizeString(pickRuntimeNodeField(context, "outputId")),
          context: buildRuntimeContext(context),
        },
      },
      this.deps.fileGenerationRuntime,
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class OcrRecognitionRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "ocr_recognition";

  constructor(
    private readonly deps: Pick<
      InstallWebAigcRuntimeExtraAdaptersDeps,
      "ocrRecognitionRuntime"
    > = {},
  ) {}

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const artifact = pickRuntimeNodeField(context, "artifact");
    const images = pickRuntimeNodeField(context, "images");
    const result = await executeOcrRecognitionNode(
      {
        nodeType: "ocr_recognition",
        input: {
          images: Array.isArray(images)
            ? (cloneValue(
                images as Array<Record<string, unknown>>,
              ) as unknown as WebAigcOcrRecognitionImageInput[])
            : undefined,
          prompt: normalizeString(pickRuntimeNodeField(context, "prompt")),
          artifact: isRecord(artifact) ? cloneValue(artifact) : undefined,
          context: buildRuntimeContext(context),
        },
      },
      this.deps.ocrRecognitionRuntime,
    );

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

class SimilarityMatchRuntimeAdapter implements WorkflowNodeAdapter {
  readonly type = "similarity_match";

  async execute(context: WorkflowNodeExecutionContext): Promise<WorkflowNodeAdapterResult> {
    const candidates = pickRuntimeNodeField(context, "candidates");
    const options = pickRuntimeNodeField(context, "options");
    const result = await executeSimilarityMatchNode({
      nodeType: "similarity_match",
      input: {
        query: normalizeString(pickRuntimeNodeField(context, "query")),
        queryVector: Array.isArray(pickRuntimeNodeField(context, "queryVector"))
          ? cloneValue(pickRuntimeNodeField(context, "queryVector") as number[])
          : undefined,
        candidates: Array.isArray(candidates)
          ? cloneValue(candidates as Array<Record<string, unknown>>)
          : undefined,
        options: isRecord(options) ? cloneValue(options) : undefined,
        context: buildRuntimeContext(context),
      },
    });

    return {
      kind: "advance",
      output: toWorkflowOutput(result.output),
    };
  }
}

// Web AIGC real provider readiness 101: Node bridge for python matrix.
// consume distinguishes ready/skipped-live/blocked/degraded/unsupported.
// skipped-live never counts as real external provider takeover.
export function consumeWebAigcRealProviderReadinessMatrix(
  matrix: Partial<WebAigcRealProviderReadinessMatrix> | undefined,
) {
  // delegates to observability record (which uses summarize for full classification)
  return recordWebAigcProviderReadiness(matrix);
}

export function installWebAigcRuntimeExtraAdapters(
  engine: { registerAdapter(adapter: WorkflowNodeAdapter): void },
  deps: InstallWebAigcRuntimeExtraAdaptersDeps = {},
): void {
  engine.registerAdapter(new KnowledgeRuntimeAdapter("knowledge_qa", deps));
  engine.registerAdapter(new KnowledgeRuntimeAdapter("qa_search", deps));
  engine.registerAdapter(
    new McpRuntimeAdapter({
      executeMcp: deps.executeMcp,
    }),
  );
  engine.registerAdapter(
    new WebSearchRuntimeAdapter({
      executeWebSearch: deps.executeWebSearch,
    }),
  );
  engine.registerAdapter(new WebQaRuntimeAdapter(deps));
  engine.registerAdapter(new GetLocationInfoRuntimeAdapter());
  engine.registerAdapter(
    new GetDeviceInfoRuntimeAdapter({
      deviceRuntime: deps.deviceRuntime,
    }),
  );
  engine.registerAdapter(
    new AudioRecognitionRuntimeAdapter({
      audioRecognitionRuntime: deps.audioRecognitionRuntime,
    }),
  );
  engine.registerAdapter(new GraphSearchRuntimeAdapter(deps));
  engine.registerAdapter(
    new StaticWebpageReadRuntimeAdapter({
      fetchStaticWebpageHtml: deps.fetchStaticWebpageHtml,
    }),
  );
  engine.registerAdapter(new IntentRecognitionRuntimeAdapter());
  engine.registerAdapter(new LongTextExtractionRuntimeAdapter());
  engine.registerAdapter(
    new AiPptRuntimeAdapter({
      aiPptRuntime: deps.aiPptRuntime,
    }),
  );
  engine.registerAdapter(new ExcelReadRuntimeAdapter());
  engine.registerAdapter(
    new TransactionFlowRuntimeAdapter({
      transactionFlowRuntime: deps.transactionFlowRuntime,
    }),
  );
  engine.registerAdapter(new DynamicChartRuntimeAdapter());
  engine.registerAdapter(
    new ImageSearchRuntimeAdapter({
      executeImageSearch: deps.executeImageSearch,
    }),
  );
  engine.registerAdapter(
    new OrchestrationRecognitionJumpRuntimeAdapter({
      orchestrationRecognitionJumpRuntime:
        deps.orchestrationRecognitionJumpRuntime,
    }),
  );
  engine.registerAdapter(new FileSlicingRuntimeAdapter());
  engine.registerAdapter(
    new FileTranslationRuntimeAdapter({
      fileTranslationRuntime: deps.fileTranslationRuntime,
    }),
  );
  engine.registerAdapter(
    new FileGenerationRuntimeAdapter({
      fileGenerationRuntime: deps.fileGenerationRuntime,
    }),
  );
  engine.registerAdapter(
    new OcrRecognitionRuntimeAdapter({
      ocrRecognitionRuntime: deps.ocrRecognitionRuntime,
    }),
  );
  engine.registerAdapter(new SimilarityMatchRuntimeAdapter());
}

export function registerWebAigcRuntimeExtraAdapters(
  deps: InstallWebAigcRuntimeExtraAdaptersDeps = {},
): void {
  installWebAigcRuntimeExtraAdapters(webAigcRuntimeEngine, deps);
}
