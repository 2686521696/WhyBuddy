import { fetchJsonSafe } from "./api-client";

export interface AutopilotPromptOptimizationInput {
  text: string;
  locale: string;
  projectName?: string | null;
  projectStatus?: string | null;
  currentSpecTitle?: string | null;
  currentRouteTitle?: string | null;
  activeTaskTitle?: string | null;
  runtimeMode?: string | null;
  attachmentCount?: number;
  activeMissionCount?: number;
  recentMessages?: Array<{
    content: string;
    kind?: string | null;
  }>;
}

export interface AutopilotPromptOptimizationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function isZhLocale(locale: string) {
  return locale === "zh-CN";
}

function compactRecentMessages(
  messages: AutopilotPromptOptimizationInput["recentMessages"]
) {
  return (messages ?? []).slice(-4).map(message => ({
    kind: message.kind ?? "message",
    content: message.content.slice(0, 240),
  }));
}

export function buildAutopilotPromptOptimizationMessages(
  input: AutopilotPromptOptimizationInput
): AutopilotPromptOptimizationMessage[] {
  const isZh = isZhLocale(input.locale);
  const languageHint = isZh ? "Simplified Chinese" : "English";
  const projectContext = {
    projectName: input.projectName ?? null,
    projectStatus: input.projectStatus ?? null,
    currentSpecTitle: input.currentSpecTitle ?? null,
    currentRouteTitle: input.currentRouteTitle ?? null,
    activeTaskTitle: input.activeTaskTitle ?? null,
    runtimeMode: input.runtimeMode ?? null,
    attachmentCount: input.attachmentCount ?? 0,
    activeMissionCount: input.activeMissionCount ?? 0,
    recentMessages: compactRecentMessages(input.recentMessages),
  };

  return [
    {
      role: "system",
      content: [
        "You are a senior AI agent task planner and prompt editor.",
        "Rewrite the user's rough Autopilot instruction into a clearer executable command.",
        "Preserve the user's intent, language, priority, and boundaries.",
        "Make the command actionable for an AI Agent runtime: include objective, scope, deliverables, constraints, success criteria, and decision points when useful.",
        "Do not invent concrete facts, credentials, dates, file paths, or business rules.",
        "If key information is missing, express it as a short clarification point inside the optimized command instead of fabricating an answer.",
        "Return only the optimized prompt text. Do not return JSON, Markdown fences, headings, commentary, or explanations.",
        `Write the optimized prompt in ${languageHint}.`,
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          roughInstruction: input.text.trim(),
          projectContext,
          targetStyle: isZh
            ? "清晰、可执行、适合自动驾驶任务入口直接提交"
            : "clear, executable, and ready to submit through the Autopilot launcher",
        },
        null,
        2
      ),
    },
  ];
}

export function normalizeOptimizedAutopilotPrompt(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";

  const fenced =
    trimmed.match(/```(?:text|markdown|md)?\s*([\s\S]*?)```/i)?.[1]?.trim() ??
    trimmed;

  return fenced
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim()
    .replace(/^(?:优化后的?提示词|优化提示词|optimized prompt)\s*[:：]\s*/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
}

export async function optimizeAutopilotPrompt(
  input: AutopilotPromptOptimizationInput
): Promise<string> {
  const rawText = input.text.trim();
  const isZh = isZhLocale(input.locale);

  if (!rawText) {
    throw new Error(
      isZh ? "先输入一点任务想法再优化。" : "Add a task idea first."
    );
  }

  const result = await fetchJsonSafe<{ content?: string }>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: buildAutopilotPromptOptimizationMessages({
        ...input,
        text: rawText,
      }),
      maxTokens: 900,
      temperature: 0.25,
    }),
  });

  if (!result.ok) {
    throw new Error(result.error.message || result.error.detail);
  }

  const optimized = normalizeOptimizedAutopilotPrompt(
    result.data.content ?? ""
  );
  if (!optimized) {
    throw new Error(
      isZh
        ? "LLM 没有返回可用的优化结果。"
        : "The LLM did not return a usable optimization."
    );
  }

  return optimized;
}
