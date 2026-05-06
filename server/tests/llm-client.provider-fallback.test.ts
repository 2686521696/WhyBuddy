import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { costTracker } from "../core/cost-tracker.js";
import { callLLMJson } from "../core/llm-client.js";

describe("callLLMJson provider fallback", () => {
  let savedEnv: Record<string, string | undefined>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    savedEnv = { ...process.env };
    originalFetch = globalThis.fetch;
    costTracker.resetCurrentMission();

    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_WIRE_API;

    process.env.LLM_API_KEY = "primary-key";
    process.env.LLM_BASE_URL = "https://primary.example.com/codex/v1";
    process.env.LLM_MODEL = "gpt-5.4";
    process.env.LLM_WIRE_API = "responses";
    process.env.LLM_RETRIES = "1";
    process.env.LLM_STREAM = "false";

    process.env.FALLBACK_LLM_API_KEY = "fallback-key";
    process.env.FALLBACK_LLM_BASE_URL = "https://fallback.example.com/api/paas/v4";
    process.env.FALLBACK_LLM_MODEL = "glm-5-turbo";
    process.env.FALLBACK_LLM_WIRE_API = "chat_completions";
    process.env.FALLBACK_LLM_FORCE_MODEL = "true";
    process.env.FALLBACK_LLM_RETRIES = "1";
    process.env.FALLBACK_LLM_STREAM = "false";
  });

  afterEach(() => {
    costTracker.resetCurrentMission();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();

    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, savedEnv);
  });

  it("tries the fallback provider when the primary endpoint rejects the downgraded model", async () => {
    vi.spyOn(costTracker, "getEffectiveModel").mockReturnValue("glm-4.6");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "Model not enabled for /codex: glm-4.6",
            },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    needsClarification: true,
                    questions: [
                      {
                        questionId: "timeline",
                        text: "What deadline should we optimize for?",
                        type: "single_choice",
                        options: ["today", "this week", "flexible"],
                      },
                    ],
                  }),
                },
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 18,
              total_tokens: 30,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const result = await callLLMJson<{
      needsClarification: boolean;
      questions: Array<{
        questionId: string;
        text: string;
        type: string;
        options: string[];
      }>;
    }>([{ role: "user", content: "Generate clarification questions." }], {
      model: "gpt-5.4",
      maxTokens: 256,
    });

    expect(result).toEqual({
      needsClarification: true,
      questions: [
        {
          questionId: "timeline",
          text: "What deadline should we optimize for?",
          type: "single_choice",
          options: ["today", "this week", "flexible"],
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [primaryUrl, primaryInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(primaryUrl).toBe("https://primary.example.com/codex/v1/responses");
    expect(JSON.parse(primaryInit.body as string)).toMatchObject({
      model: "glm-4.6",
      stream: true,
    });

    const [fallbackUrl, fallbackInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(fallbackUrl).toBe(
      "https://fallback.example.com/api/paas/v4/chat/completions",
    );
    expect(JSON.parse(fallbackInit.body as string)).toMatchObject({
      model: "glm-5-turbo",
      stream: false,
    });
  });

  it("does not downgrade unlimited gpt-5.5 calls", async () => {
    process.env.LLM_MODEL = "gpt-5.5";
    process.env.LLM_UNLIMITED_MODELS = "gpt-5.5";
    const getEffectiveModelSpy = vi
      .spyOn(costTracker, "getEffectiveModel")
      .mockReturnValue("glm-4.6");

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({ ok: true }),
          usage: {
            input_tokens: 1000,
            output_tokens: 2000,
            total_tokens: 3000,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    globalThis.fetch = fetchMock as typeof globalThis.fetch;

    const result = await callLLMJson<{ ok: boolean }>(
      [{ role: "user", content: "Use the configured unlimited model." }],
      { maxTokens: 256 },
    );

    expect(result).toEqual({ ok: true });
    expect(getEffectiveModelSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [primaryUrl, primaryInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(primaryUrl).toBe("https://primary.example.com/codex/v1/responses");
    expect(JSON.parse(primaryInit.body as string)).toMatchObject({
      model: "gpt-5.5",
      stream: true,
    });
    expect(costTracker.getRecords()).toHaveLength(0);
    expect(costTracker.getDowngradeLevel()).toBe("none");
  });
});
