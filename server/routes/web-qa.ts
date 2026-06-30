import { Router } from "express";

import type { UnifiedQueryOptions, UnifiedKnowledgeResult } from "../../shared/knowledge/types.js";
import type { WebAigcDocumentSearchResponse, WebAigcSearchRequest } from "../../shared/rag/web-aigc-search.js";
import type { ChatNodeAdapterDeps } from "./node-adapters/chat-node-adapter.js";
import type { OpenPageNodeAdapterDeps } from "./node-adapters/open-page-node-adapter.js";
import {
  executeWebQaNode,
  isWebQaNodeType,
  type WebQaNodeAdapterDeps,
} from "./node-adapters/web-qa-node-adapter.js";

export interface WebQaRouterDeps {
  documentSearch?: (
    request: WebAigcSearchRequest,
  ) => Promise<WebAigcDocumentSearchResponse>;
  knowledgeService?: {
    query(
      question: string,
      projectId: string,
      options?: Partial<UnifiedQueryOptions>,
    ): Promise<UnifiedKnowledgeResult>;
  };
  executeLLM?: ChatNodeAdapterDeps["executeLLM"];
  getConfig?: ChatNodeAdapterDeps["getConfig"];
  now?: ChatNodeAdapterDeps["now"];
  permissionEngine?: OpenPageNodeAdapterDeps["permissionEngine"];
  executePythonRuntime?: WebQaNodeAdapterDeps["executePythonRuntime"];
}

function mapStatusToHttpStatus(status: string | undefined): number {
  if (status === "failed") {
    return 500;
  }
  return 200;
}

function normalizeWebQaRouteResult(
  result: Awaited<ReturnType<typeof executeWebQaNode>>,
) {
  const output = result.output;
  const metadata = output.metadata;
  const observability = {
    eventKey: "external.web_qa" as const,
    nodeType: "web_qa" as const,
    strategy: output.strategy,
    question: metadata.question,
    ...(metadata.projectId ? { projectId: metadata.projectId } : {}),
    pageCount: metadata.pageCount,
    sourceCount: metadata.sourceCount,
    searchUsed: typeof metadata.searchQuery === "string" && metadata.searchQuery.length > 0,
    ...(metadata.searchQuery ? { searchQuery: metadata.searchQuery } : {}),
    ...(typeof metadata.searchResultCount === "number"
      ? { searchResultCount: metadata.searchResultCount }
      : {}),
    fallbackUsed: output.fallbackUsed,
    ...(output.fallbackReason ? { fallbackReason: output.fallbackReason } : {}),
    ...(output.observability ?? {}),
  };

  return {
    ...result,
    output: {
      ...output,
      observability,
    },
  };
}

export function createWebQaRouter(
  deps: WebQaRouterDeps = {},
): Router {
  const router = Router();

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;
    if (!isWebQaNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be web_qa" });
    }

    try {
      const result = await executeWebQaNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );

      const normalizedResult = normalizeWebQaRouteResult(result);
      return res.status(mapStatusToHttpStatus(normalizedResult.output.status)).json(normalizedResult);
    } catch (error: any) {
      const message = error?.message || "Web QA node execution failed.";
      const status =
        /requires question/i.test(message) ||
        /scope\.projectid is required/i.test(message) ||
        /knowledge fallback requires projectid/i.test(message) ||
        /knowledge fallback requires knowledgeservice/i.test(message) ||
        /documentsearch executor is not available/i.test(message)
          ? 400
          : 500;
      return res.status(status).json({ error: message });
    }
  });

  return router;
}

const router = createWebQaRouter();

export default router;
