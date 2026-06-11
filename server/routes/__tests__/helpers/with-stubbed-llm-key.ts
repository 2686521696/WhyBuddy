/**
 * Route tests that mock callLLM still need a configured key — otherwise handlers
 * short-circuit to no_api_key before the mock runs.
 */
export function withStubbedLlmKey(): { restore: () => void } {
  const origKey = process.env.LLM_API_KEY;
  const origOpen = process.env.OPENAI_API_KEY;
  process.env.LLM_API_KEY = process.env.LLM_API_KEY || "test-key";

  return {
    restore: () => {
      if (origKey !== undefined) process.env.LLM_API_KEY = origKey;
      else delete process.env.LLM_API_KEY;
      if (origOpen !== undefined) process.env.OPENAI_API_KEY = origOpen;
      else delete process.env.OPENAI_API_KEY;
    },
  };
}