import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";

import { createRobotReplyRouter } from "../routes/robot-reply.js";
import type {
  ChatNodeMessageStore,
  ChatNodeSessionStore,
} from "../routes/node-adapters/chat-node-adapter.js";

async function withServer(
  deps: {
    messageStore?: ChatNodeMessageStore;
    sessionStore?: ChatNodeSessionStore;
  } = {},
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use("/api/robot-reply", createRobotReplyRouter(deps));
  const server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

describe("POST /api/robot-reply/nodes/execute", () => {
  it("rejects unsupported node types", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/robot-reply/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "dialogue",
          input: {
            content: "not-used",
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("nodeType must be robot_reply");
    });
  });

  it("executes robot_reply and persists workflow/session traces", async () => {
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

    await withServer(
      {
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
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/robot-reply/nodes/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeType: "robot_reply",
            input: {
              upstream: {
                nodeType: "dialogue",
                output: {
                  content: "机器人已整理出最终答复。",
                  reply: {
                    role: "assistant",
                    content: "机器人已整理出最终答复。",
                  },
                  messages: [
                    { role: "user", content: "请输出最终面向用户的回复" },
                  ],
                  observability: {
                    workflowId: "wf-robot-route-1",
                    sessionId: "session-robot-route-1",
                    missionId: "mission-robot-route-1",
                    agentId: "robot-agent-route-1",
                    stage: "robot_reply_delivery",
                    citations: ["引用 1"],
                    toolCalls: [
                      {
                        name: "document_search",
                        arguments: '{\n  "query": "最终答复"\n}',
                        result: "命中 3 条候选。",
                      },
                    ],
                  },
                },
              },
            },
          }),
        });

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.ok).toBe(true);
        expect(body.nodeType).toBe("robot_reply");
        expect(body.output.reply).toEqual({
          role: "assistant",
          content: "机器人已整理出最终答复。",
          citations: ["引用 1"],
          toolSummaries: ["1. document_search: 命中 3 条候选。"],
        });
        expect(body.output.observability).toEqual({
          workflowId: "wf-robot-route-1",
          sessionId: "session-robot-route-1",
          missionId: "mission-robot-route-1",
          agentId: "robot-agent-route-1",
          stage: "robot_reply_delivery",
          persistedToWorkflow: true,
          persistedToSession: true,
          citations: ["引用 1"],
          toolCalls: [
            {
              name: "document_search",
              arguments: '{\n  "query": "最终答复"\n}',
              result: "命中 3 条候选。",
            },
          ],
          upstreamNodeType: "dialogue",
        });
      },
    );

    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0]).toMatchObject({
      workflow_id: "wf-robot-route-1",
      from_agent: "robot-agent-route-1",
      to_agent: "workflow-user",
      stage: "robot_reply_delivery",
      content: "机器人已整理出最终答复。",
    });

    expect(sessionExchanges).toHaveLength(1);
    expect(sessionExchanges[0]).toMatchObject({
      agentId: "robot-agent-route-1",
      workflowId: "wf-robot-route-1",
      stage: "robot_reply_delivery",
      prompt: "请输出最终面向用户的回复",
      response: "机器人已整理出最终答复。",
    });
  });

  it("returns 400 when robot_reply has no usable content source", async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/robot-reply/nodes/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeType: "robot_reply",
          input: {
            upstream: {
              nodeType: "dialogue",
              output: {
                observability: {
                  workflowId: "wf-empty-route-1",
                },
              },
            },
          },
        }),
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("requires content");
    });
  });
});
