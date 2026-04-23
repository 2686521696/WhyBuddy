import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { executeChatNode, type ChatNodeDocumentSearchResult } from "../routes/node-adapters/chat-node-adapter.js";
import { createChatRouter } from "../routes/chat.js";

async function withChatServer(
  deps: Parameters<typeof createChatRouter>[0],
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/chat", createChatRouter(deps));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  try {
    const address = server.address() as AddressInfo;
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

afterEach(() => {
  // Node 18+ fetch keeps connections alive briefly; closing the server is enough,
  // but we keep the suite shape consistent with other route tests.
});

describe("executeChatNode documentSearch", () => {
  it("lets dialogue nodes actively retrieve documents and project them into context, citations, and tool calls", async () => {
    const calls: Array<{ query: string; projectId: string }> = [];
    const llmMessages: Array<Array<{ role: string; content: string }>> = [];

    const result = await executeChatNode(
      {
        nodeType: "dialogue",
        input: {
          prompt: "请基于知识库总结订单异常排查步骤",
          workflowId: "wf-doc-search-1",
          sessionId: "session-doc-search-1",
          missionId: "mission-doc-search-1",
          agentId: "dialogue-agent-doc-search",
          stage: "dialogue_document_search",
          documentSearch: {
            scope: {
              projectId: "proj-doc-search",
              documentIds: ["doc-ops-1", "doc-ops-2"],
            },
            options: {
              topK: 2,
              mode: "hybrid",
            },
          },
        },
      },
      {
        documentSearch: async (request) => {
          calls.push({
            query: request.query,
            projectId: request.scope.projectId,
          });

          const response: ChatNodeDocumentSearchResult = {
            query: request.query,
            totalCandidates: 2,
            latencyMs: 12,
            mode: "hybrid",
            results: [
              {
                documentId: "doc-ops-1",
                sourceType: "document",
                score: 0.92,
                summary: "订单异常先核对支付结果，再检查履约状态与回调日志。",
                highlights: ["支付结果", "履约状态"],
                fragments: [],
              },
              {
                documentId: "doc-ops-2",
                sourceType: "document",
                score: 0.88,
                summary: "若回调缺失，需要补查网关重试与下游消费记录。",
                highlights: ["回调缺失", "网关重试"],
                fragments: [],
              },
            ],
          };

          return response;
        },
        executeLLM: async (messages) => {
          llmMessages.push(messages.map((message) => ({ ...message })));
          return {
            content: "mock:已根据知识库给出排查建议",
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          };
        },
        getConfig: () => ({
          apiKey: "",
          baseUrl: "https://example.test/v1",
          model: "mock-model",
          modelReasoningEffort: "medium",
          maxContext: 128000,
          providerName: "example.test",
          wireApi: "chat_completions",
          timeoutMs: 1000,
          stream: false,
        }),
        now: (() => {
          let current = 1000;
          return () => {
            current += 20;
            return current;
          };
        })(),
      },
    );

    expect(calls).toEqual([
      {
        query: "请基于知识库总结订单异常排查步骤",
        projectId: "proj-doc-search",
      },
    ]);

    const systemMessage = llmMessages[0]?.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("Retrieved citations");
    expect(systemMessage?.content).toContain("Tool results");
    expect(systemMessage?.content).toContain("documentSearch");
    expect(systemMessage?.content).toContain("doc-ops-1");
    expect(result.output.messages[0]?.content).toContain("documentSearch");
    expect(result.output.messages[0]?.content).toContain("doc-ops-1");

    expect(result.output.observability?.citations).toEqual([
      "doc-ops-1: 订单异常先核对支付结果，再检查履约状态与回调日志。 [支付结果 | 履约状态]",
      "doc-ops-2: 若回调缺失，需要补查网关重试与下游消费记录。 [回调缺失 | 网关重试]",
    ]);
    expect(result.output.observability?.toolCalls).toEqual([
      {
        name: "document_search",
        arguments:
          '{\n' +
          '  "query": "请基于知识库总结订单异常排查步骤",\n' +
          '  "scope": {\n' +
          '    "projectId": "proj-doc-search",\n' +
          '    "documentIds": [\n' +
          '      "doc-ops-1",\n' +
          '      "doc-ops-2"\n' +
          "    ]\n" +
          "  },\n" +
          '  "options": {\n' +
          '    "topK": 2,\n' +
          '    "mode": "hybrid"\n' +
          "  }\n" +
          "}",
        result: "Matched 2 documents in 12ms. Mode: hybrid. Top hits: doc-ops-1(0.92), doc-ops-2(0.88).",
      },
    ]);
  });

  it("falls back to the latest user message for documentSearch and persists merged retrieval metadata", async () => {
    const calls: Array<{
      query: string;
      projectId: string;
      documentIds?: string[];
    }> = [];
    const llmMessages: Array<Array<{ role: string; content: string }>> = [];
    const storedMessages: Array<{
      workflow_id: string;
      from_agent: string;
      to_agent: string;
      stage: string;
      content: string;
      metadata: Record<string, unknown> | null;
    }> = [];
    const sessionExchanges: Array<{
      agentId: string;
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: Record<string, unknown> | null;
    }> = [];

    const result = await executeChatNode(
      {
        nodeType: "dialogue",
        input: {
          workflowId: "wf-doc-search-2",
          sessionId: "session-doc-search-2",
          missionId: "mission-doc-search-2",
          agentId: "dialogue-agent-doc-search-2",
          stage: "dialogue_document_search_merge",
          messages: [
            {
              role: "assistant",
              content: "我会先结合现有知识，再补充文档证据。",
            },
            {
              role: "user",
              content: "请结合文档说明支付失败排查路径",
            },
          ],
          citations: ["上游知识引用 A"],
          toolCalls: [
            {
              name: "knowledge_qa",
              arguments: {
                question: "支付失败怎么排查",
              },
              result: "先核对支付状态，再检查回调与履约日志。",
            },
          ],
          thinking: "优先整合知识问答与文档检索结果。",
          documentSearch: {
            scope: {
              projectId: "proj-doc-search",
              documentIds: ["doc-rule-1"],
            },
            options: {
              topK: 1,
              mode: "semantic",
            },
          },
        },
      },
      {
        documentSearch: async (request) => {
          calls.push({
            query: request.query,
            projectId: request.scope.projectId,
            documentIds: request.scope.documentIds,
          });

          const response: ChatNodeDocumentSearchResult = {
            query: request.query,
            totalCandidates: 1,
            latencyMs: 9,
            mode: "semantic",
            results: [
              {
                documentId: "doc-rule-1",
                sourceType: "document",
                score: 0.97,
                summary: "支付失败先确认网关状态，再核对回调补偿链路。",
                highlights: ["网关状态"],
                fragments: [],
              },
            ],
          };

          return response;
        },
        executeLLM: async (messages) => {
          llmMessages.push(messages.map((message) => ({ ...message })));
          return {
            content: "mock:已整合上游知识与检索结果",
            usage: {
              prompt_tokens: 28,
              completion_tokens: 12,
              total_tokens: 40,
            },
          };
        },
        getConfig: () => ({
          apiKey: "",
          baseUrl: "https://example.test/v1",
          model: "mock-model",
          modelReasoningEffort: "medium",
          maxContext: 128000,
          providerName: "example.test",
          wireApi: "chat_completions",
          timeoutMs: 1000,
          stream: false,
        }),
        now: (() => {
          let current = 2000;
          return () => {
            current += 15;
            return current;
          };
        })(),
        messageStore: {
          createMessage(message) {
            storedMessages.push(message);
            return {
              id: storedMessages.length,
              created_at: "2026-04-23T00:00:00.000Z",
            };
          },
        },
        sessionStore: {
          appendLLMExchange(agentId, options) {
            sessionExchanges.push({ agentId, ...options });
          },
        },
      },
    );

    expect(calls).toEqual([
      {
        query: "请结合文档说明支付失败排查路径",
        projectId: "proj-doc-search",
        documentIds: ["doc-rule-1"],
      },
    ]);

    const systemMessage = llmMessages[0]?.find((message) => message.role === "system");
    expect(systemMessage?.content).toContain("上游知识引用 A");
    expect(systemMessage?.content).toContain("knowledge_qa");
    expect(systemMessage?.content).toContain("document_search");
    expect(systemMessage?.content).toContain("doc-rule-1");
    expect(result.output.messages[0]?.content).toContain("上游知识引用 A");
    expect(result.output.messages[0]?.content).toContain("doc-rule-1");

    expect(result.output.observability).toMatchObject({
      workflowId: "wf-doc-search-2",
      sessionId: "session-doc-search-2",
      missionId: "mission-doc-search-2",
      agentId: "dialogue-agent-doc-search-2",
      stage: "dialogue_document_search_merge",
      persistedToWorkflow: true,
      persistedToSession: true,
      thinking: "优先整合知识问答与文档检索结果。",
      citations: [
        "上游知识引用 A",
        "doc-rule-1: 支付失败先确认网关状态，再核对回调补偿链路。 [网关状态]",
      ],
    });
    expect(result.output.observability?.toolCalls).toEqual([
      {
        name: "knowledge_qa",
        arguments: '{\n  "question": "支付失败怎么排查"\n}',
        result: "先核对支付状态，再检查回调与履约日志。",
      },
      {
        name: "document_search",
        arguments:
          '{\n' +
          '  "query": "请结合文档说明支付失败排查路径",\n' +
          '  "scope": {\n' +
          '    "projectId": "proj-doc-search",\n' +
          '    "documentIds": [\n' +
          '      "doc-rule-1"\n' +
          "    ]\n" +
          "  },\n" +
          '  "options": {\n' +
          '    "topK": 1,\n' +
          '    "mode": "semantic"\n' +
          "  }\n" +
          "}",
        result: "Matched 1 documents in 9ms. Mode: semantic. Top hits: doc-rule-1(0.97).",
      },
    ]);

    expect(storedMessages).toHaveLength(2);
    expect(storedMessages[0]).toMatchObject({
      workflow_id: "wf-doc-search-2",
      from_agent: "workflow-user",
      to_agent: "dialogue-agent-doc-search-2",
      stage: "dialogue_document_search_merge",
      content: "请结合文档说明支付失败排查路径",
      metadata: {
        nodeType: "dialogue",
        role: "user",
        workflowId: "wf-doc-search-2",
        sessionId: "session-doc-search-2",
        missionId: "mission-doc-search-2",
        agentId: "dialogue-agent-doc-search-2",
        stage: "dialogue_document_search_merge",
      },
    });
    expect(storedMessages[1]).toMatchObject({
      workflow_id: "wf-doc-search-2",
      from_agent: "dialogue-agent-doc-search-2",
      to_agent: "workflow-user",
      stage: "dialogue_document_search_merge",
      content: "mock:已整合上游知识与检索结果",
      metadata: {
        nodeType: "dialogue",
        workflowId: "wf-doc-search-2",
        sessionId: "session-doc-search-2",
        missionId: "mission-doc-search-2",
        agentId: "dialogue-agent-doc-search-2",
        stage: "dialogue_document_search_merge",
        thinking: "优先整合知识问答与文档检索结果。",
        citations: [
          "上游知识引用 A",
          "doc-rule-1: 支付失败先确认网关状态，再核对回调补偿链路。 [网关状态]",
        ],
        toolCalls: [
          {
            name: "knowledge_qa",
            arguments: '{\n  "question": "支付失败怎么排查"\n}',
            result: "先核对支付状态，再检查回调与履约日志。",
          },
          {
            name: "document_search",
            arguments:
              '{\n' +
              '  "query": "请结合文档说明支付失败排查路径",\n' +
              '  "scope": {\n' +
              '    "projectId": "proj-doc-search",\n' +
              '    "documentIds": [\n' +
              '      "doc-rule-1"\n' +
              "    ]\n" +
              "  },\n" +
              '  "options": {\n' +
              '    "topK": 1,\n' +
              '    "mode": "semantic"\n' +
              "  }\n" +
              "}",
            result: "Matched 1 documents in 9ms. Mode: semantic. Top hits: doc-rule-1(0.97).",
          },
        ],
      },
    });

    expect(sessionExchanges).toHaveLength(1);
    expect(sessionExchanges[0]).toMatchObject({
      agentId: "dialogue-agent-doc-search-2",
      workflowId: "wf-doc-search-2",
      stage: "dialogue_document_search_merge",
      prompt: "请结合文档说明支付失败排查路径",
      response: "mock:已整合上游知识与检索结果",
      metadata: storedMessages[1]?.metadata,
    });
  });

  it("preserves structured tool call results across output, workflow messages, and session exchanges", async () => {
    const storedMessages: Array<{
      workflow_id: string;
      from_agent: string;
      to_agent: string;
      stage: string;
      content: string;
      metadata: Record<string, unknown> | null;
    }> = [];
    const sessionExchanges: Array<{
      agentId: string;
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: Record<string, unknown> | null;
    }> = [];

    const result = await executeChatNode(
      {
        nodeType: "dialogue",
        input: {
          workflowId: "wf-dialogue-tool-result",
          sessionId: "session-dialogue-tool-result",
          missionId: "mission-dialogue-tool-result",
          agentId: "dialogue-agent-tool-result",
          stage: "dialogue_tool_result",
          prompt: "请整理检索和工具执行摘要",
          toolCalls: [
            {
              name: "knowledge_qa",
              arguments: {
                question: "支付失败如何排查",
              },
              result: {
                answer: "先核对支付状态，再检查回调。",
                confidence: 0.92,
              },
            },
          ],
          thinking: "先整理工具证据，再生成回复。",
        },
      },
      {
        executeLLM: async () => ({
          content: "mock:已整理工具执行摘要",
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        }),
        getConfig: () => ({
          apiKey: "",
          baseUrl: "https://example.test/v1",
          model: "mock-model",
          modelReasoningEffort: "medium",
          maxContext: 128000,
          providerName: "example.test",
          wireApi: "chat_completions",
          timeoutMs: 1000,
          stream: false,
        }),
        messageStore: {
          createMessage(message) {
            storedMessages.push(message);
            return { id: storedMessages.length };
          },
        },
        sessionStore: {
          appendLLMExchange(agentId, options) {
            sessionExchanges.push({ agentId, ...options });
          },
        },
      },
    );

    expect(result.output.observability).toMatchObject({
      workflowId: "wf-dialogue-tool-result",
      sessionId: "session-dialogue-tool-result",
      missionId: "mission-dialogue-tool-result",
      agentId: "dialogue-agent-tool-result",
      stage: "dialogue_tool_result",
      thinking: "先整理工具证据，再生成回复。",
      toolCalls: [
        {
          name: "knowledge_qa",
          arguments: '{\n  "question": "支付失败如何排查"\n}',
          result:
            '{\n' +
            '  "answer": "先核对支付状态，再检查回调。",\n' +
            '  "confidence": 0.92\n' +
            '}',
        },
      ],
    });
    expect(storedMessages[1]?.metadata).toMatchObject({
      workflowId: "wf-dialogue-tool-result",
      toolCalls: result.output.observability?.toolCalls,
      thinking: "先整理工具证据，再生成回复。",
    });
    expect(sessionExchanges[0]).toMatchObject({
      agentId: "dialogue-agent-tool-result",
      workflowId: "wf-dialogue-tool-result",
      stage: "dialogue_tool_result",
      response: "mock:已整理工具执行摘要",
      metadata: storedMessages[1]?.metadata,
    });
  });

  it("uses router-level documentSearch injection for dialogue node execution", async () => {
    const calls: Array<{ query: string; projectId: string }> = [];

    await withChatServer(
      {
        executeLLM: async () => ({
          content: "mock:已结合文档回答",
          usage: {
            prompt_tokens: 18,
            completion_tokens: 9,
            total_tokens: 27,
          },
        }),
        getConfig: () => ({
          apiKey: "",
          baseUrl: "https://example.test/v1",
          model: "mock-model",
          modelReasoningEffort: "medium",
          maxContext: 128000,
          providerName: "example.test",
          wireApi: "chat_completions",
          timeoutMs: 1000,
          stream: false,
        }),
        documentSearch: async (request) => {
          calls.push({
            query: request.query,
            projectId: request.scope.projectId,
          });

          return {
            query: request.query,
            totalCandidates: 1,
            latencyMs: 6,
            mode: "hybrid",
            results: [
              {
                documentId: "doc-route-1",
                sourceType: "document",
                score: 0.91,
                summary: "先确认订单状态，再核对支付与回调链路。",
                highlights: ["订单状态", "回调链路"],
                fragments: [],
              },
            ],
          } satisfies ChatNodeDocumentSearchResult;
        },
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/chat/nodes/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "dialogue",
            input: {
              prompt: "请结合文档总结支付排查路径",
              documentSearch: {
                scope: {
                  projectId: "proj-route-doc-search",
                },
                options: {
                  topK: 1,
                  mode: "hybrid",
                },
              },
            },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();

        expect(calls).toEqual([
          {
            query: "请结合文档总结支付排查路径",
            projectId: "proj-route-doc-search",
          },
        ]);
        expect(body.output.messages[0].content).toContain("Retrieved citations");
        expect(body.output.messages[0].content).toContain("doc-route-1");
        expect(body.output.observability).toMatchObject({
          persistedToWorkflow: false,
          persistedToSession: false,
          citations: [
            "doc-route-1: 先确认订单状态，再核对支付与回调链路。 [订单状态 | 回调链路]",
          ],
          toolCalls: [
            {
              name: "document_search",
              result: "Matched 1 documents in 6ms. Mode: hybrid. Top hits: doc-route-1(0.91).",
            },
          ],
        });
      },
    );
  });

  it("rejects dialogue documentSearch when no query source is available", async () => {
    await expect(
      executeChatNode(
        {
          nodeType: "dialogue",
          input: {
            documentSearch: {
              scope: {
                projectId: "proj-doc-search",
              },
            },
          },
        },
        {
          documentSearch: async () => ({
            query: "",
            results: [],
            totalCandidates: 0,
            latencyMs: 0,
            mode: "hybrid",
          }),
        },
      ),
    ).rejects.toThrow(/requires query, prompt, or user message/i);
  });
});
