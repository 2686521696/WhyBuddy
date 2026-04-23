import { describe, expect, it } from "vitest";

import { executeRobotReplyNode } from "../routes/node-adapters/robot-reply-node-adapter.js";

describe("executeRobotReplyNode", () => {
  it("formats a direct robot reply with citations and tool summaries, and persists workflow/session links", async () => {
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

    const result = await executeRobotReplyNode(
      {
        nodeType: "robot_reply",
        input: {
          content: "已为你整理完今天的执行结论。",
          prompt: "请给用户一个最终答复",
          workflowId: "wf-robot-reply-1",
          sessionId: "session-robot-1",
          missionId: "mission-robot-1",
          agentId: "robot-reply-agent-1",
          stage: "robot_reply_final",
          citations: ["知识库 A", "知识库 B"],
          toolCalls: [
            {
              name: "document_search",
              arguments: { query: "今日执行结论" },
              result: "命中 2 条文档摘要。",
            },
          ],
        },
      },
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
    );

    expect(result.output.reply).toEqual({
      role: "assistant",
      content: "已为你整理完今天的执行结论。",
      citations: ["知识库 A", "知识库 B"],
      toolSummaries: ["1. document_search: 命中 2 条文档摘要。"],
    });
    expect(result.output.toolCalls).toEqual([
      {
        name: "document_search",
        arguments: '{\n  "query": "今日执行结论"\n}',
        result: "命中 2 条文档摘要。",
      },
    ]);
    expect(result.output.observability).toEqual({
      workflowId: "wf-robot-reply-1",
      sessionId: "session-robot-1",
      missionId: "mission-robot-1",
      agentId: "robot-reply-agent-1",
      stage: "robot_reply_final",
      persistedToWorkflow: true,
      persistedToSession: true,
      citations: ["知识库 A", "知识库 B"],
      toolCalls: [
        {
          name: "document_search",
          arguments: '{\n  "query": "今日执行结论"\n}',
          result: "命中 2 条文档摘要。",
        },
      ],
    });

    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0]).toMatchObject({
      workflow_id: "wf-robot-reply-1",
      from_agent: "robot-reply-agent-1",
      to_agent: "workflow-user",
      stage: "robot_reply_final",
      content: "已为你整理完今天的执行结论。",
    });
    expect(storedMessages[0]?.metadata).toMatchObject({
      nodeType: "robot_reply",
      sessionId: "session-robot-1",
      missionId: "mission-robot-1",
      agentId: "robot-reply-agent-1",
      stage: "robot_reply_final",
      citations: ["知识库 A", "知识库 B"],
    });

    expect(sessionExchanges).toHaveLength(1);
    expect(sessionExchanges[0]).toMatchObject({
      agentId: "robot-reply-agent-1",
      workflowId: "wf-robot-reply-1",
      stage: "robot_reply_final",
      prompt: "请给用户一个最终答复",
      response: "已为你整理完今天的执行结论。",
    });
  });

  it("can inherit dialogue output and observability fields as the robot reply source", async () => {
    const sessionExchanges: Array<{
      agentId: string;
      workflowId?: string;
      stage?: string;
      prompt: string;
      response: string;
      metadata?: Record<string, unknown> | null;
    }> = [];

    const result = await executeRobotReplyNode(
      {
        nodeType: "robot_reply",
        input: {
          upstream: {
            nodeType: "dialogue",
            output: {
              content: "这是对话节点整理出的最终答复。",
              reply: {
                role: "assistant",
                content: "这是对话节点整理出的最终答复。",
              },
              messages: [
                { role: "user", content: "帮我汇总今天的推进情况" },
                { role: "assistant", content: "中间推理内容" },
              ],
              observability: {
                workflowId: "wf-dialogue-upstream-1",
                sessionId: "session-dialogue-upstream-1",
                missionId: "mission-dialogue-upstream-1",
                agentId: "dialogue-agent-1",
                stage: "dialogue_runtime",
                citations: ["引用 A"],
                toolCalls: [
                  {
                    name: "document_search",
                    arguments: '{\n  "query": "推进情况"\n}',
                    result: "命中 1 条文档。",
                  },
                ],
              },
            },
          },
        },
      },
      {
        messageStore: null,
        sessionStore: {
          appendLLMExchange(agentId, options) {
            sessionExchanges.push({ agentId, ...options });
          },
        },
      },
    );

    expect(result.output.content).toBe("这是对话节点整理出的最终答复。");
    expect(result.output.citations).toEqual(["引用 A"]);
    expect(result.output.toolSummaries).toEqual([
      "1. document_search: 命中 1 条文档。",
    ]);
    expect(result.output.observability).toMatchObject({
      workflowId: "wf-dialogue-upstream-1",
      sessionId: "session-dialogue-upstream-1",
      missionId: "mission-dialogue-upstream-1",
      agentId: "dialogue-agent-1",
      stage: "dialogue_runtime",
      persistedToWorkflow: false,
      persistedToSession: true,
      upstreamNodeType: "dialogue",
    });

    expect(sessionExchanges).toHaveLength(1);
    expect(sessionExchanges[0]).toMatchObject({
      agentId: "dialogue-agent-1",
      workflowId: "wf-dialogue-upstream-1",
      stage: "dialogue_runtime",
      prompt: "帮我汇总今天的推进情况",
      response: "这是对话节点整理出的最终答复。",
    });
    expect(sessionExchanges[0]?.metadata).toMatchObject({
      nodeType: "robot_reply",
      upstreamNodeType: "dialogue",
      citations: ["引用 A"],
    });
  });

  it("rejects robot reply execution when no content source is available", async () => {
    await expect(
      executeRobotReplyNode({
        nodeType: "robot_reply",
        input: {
          workflowId: "wf-empty-1",
        },
      }),
    ).rejects.toThrow(/requires content, reply\.content, or upstream output content/i);
  });
});
