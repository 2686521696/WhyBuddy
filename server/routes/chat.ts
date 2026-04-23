import { Router } from "express";

import { getAIConfig } from "../core/ai-config.js";
import { callLLM } from "../core/llm-client.js";
import {
  executeChatNode,
  isChatNodeType,
  type ChatNodeAdapterDeps,
} from "./node-adapters/chat-node-adapter.js";

export interface ChatRouterDeps extends ChatNodeAdapterDeps {}

function normalizeLegacyMessages(rawMessages: unknown) {
  return Array.isArray(rawMessages)
    ? rawMessages
        .filter(
          (message) =>
            message &&
            typeof message === "object" &&
            ["system", "user", "assistant"].includes(
              (message as Record<string, unknown>).role as string,
            ) &&
            typeof (message as Record<string, unknown>).content === "string",
        )
        .map((message) => ({
          role: (message as { role: "system" | "user" | "assistant" }).role,
          content: (message as { content: string }).content,
        }))
    : [];
}

function clampTemperature(value: unknown): number {
  return Math.max(0, Math.min(2, Number(value) || 0.7));
}

function clampMaxTokens(value: unknown): number {
  return Math.max(64, Math.min(4000, Number(value) || 400));
}

export function createChatRouter(deps: ChatRouterDeps = {}): Router {
  const router = Router();
  const executeLLM = deps.executeLLM ?? callLLM;
  const getConfigValue = deps.getConfig ?? getAIConfig;

  router.post("/", async (req, res) => {
    const messages = normalizeLegacyMessages(req.body?.messages);

    if (messages.length === 0) {
      return res.status(400).json({ error: "messages is required" });
    }

    const temperature = clampTemperature(req.body?.temperature);
    const maxTokens = clampMaxTokens(req.body?.maxTokens);

    try {
      const config = getConfigValue();
      const response = await executeLLM(messages, {
        model: config.model,
        temperature,
        maxTokens,
      });

      res.json({
        content: response.content,
        usage: response.usage,
        model: config.model,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Chat request failed." });
    }
  });

  router.post("/nodes/execute", async (req, res) => {
    const nodeType = req.body?.nodeType;

    if (!isChatNodeType(nodeType)) {
      return res.status(400).json({ error: "nodeType must be llm or dialogue" });
    }

    try {
      const result = await executeChatNode(
        {
          nodeType,
          input: req.body?.input,
        },
        deps,
      );

      res.json(result);
    } catch (error: any) {
      const message = error?.message || "Chat node execution failed.";
      const status =
        /requires prompt or messages/i.test(message) ||
        /documentsearch.*requires query/i.test(message) ||
        /documentsearch\.scope\.projectid is required/i.test(message)
          ? 400
          : 500;
      res.status(status).json({ error: message });
    }
  });

  return router;
}

const router = createChatRouter();

export default router;
