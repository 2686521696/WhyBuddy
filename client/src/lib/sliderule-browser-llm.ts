/**
 * B3 · browser-llm provider（替代 deprecated 原型）。
 *
 * 消费 B1 同源 prompt。
 * 按 preset 适配信封。
 * 通过 B6 dispatcher 租约执行。
 * 失败 throw 触发既有 PilotReal fallback。
 * 生产 baseline 显式（由调用方在 B4 切换时传）。
 *
 * key 零信任：仅在闭包 + fetch header，绝不泄露。
 *
 * B5 CORS/错误矩阵（手动验证建议）：
 * - anthropic: 需 header "anthropic-dangerous-direct-browser-access: true" + version；浏览器直连支持但需特殊头。
 * - openrouter: 官方支持浏览器直连，无额外头。
 * - deepseek / openai: 标准 OpenAI 兼容，通常支持，但部分地区/CORS 策略可能需 custom 或换厂商。
 * - 不默认包含的厂商（许多国内模型服务无浏览器 CORS）：不在预设；用户可用 custom 自担风险（或自建代理，但 spec non-goal）。
 * 失败时提供可行动提示（CORS、key、rate）。
 */

import type { V5SessionState } from "@shared/blueprint/v5-reasoning-state";
import { buildCapabilityPrompt } from "@shared/blueprint/sliderule-capability-prompts";
import type { ByokPoolDispatcher, ByokLease } from "./sliderule-byok-dispatcher";
import { createByokDispatcher } from "./sliderule-byok-dispatcher";
import type { ByokKeyEntry } from "./sliderule-byok-config";
import type { LlmCapabilityProvider } from "./sliderule-runtime";

export function createBrowserLlmCapabilityProvider(dispatcher?: ByokPoolDispatcher): LlmCapabilityProvider {
  const pool = dispatcher || createByokDispatcher();

  async function doFetch(lease: ByokLease, systemPrompt: string, userPrompt: string, maxTokens: number, temperature: number) {
    const entry = lease.entry;
    const isAnthropic = entry.presetId === "anthropic";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
      let res: Response;
      if (isAnthropic) {
        // Anthropic messages API
        const body = {
          model: entry.model,
          max_tokens: maxTokens,
          messages: [
            { role: "user", content: `${systemPrompt}\n\n${userPrompt}` },
          ],
          temperature,
        };
        res = await fetch(entry.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": entry.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
            ...(entry.extraHeaders || {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } else {
        // OpenAI compatible
        const body = {
          model: entry.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
        };
        res = await fetch(entry.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${entry.apiKey}`,
            ...(entry.extraHeaders || {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      }

      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        if (res.status === 429) throw new Error(`http_429 ${text.slice(0,100)}`);
        if (res.status === 401 || res.status === 403) throw new Error(`http_401 ${text.slice(0,100)}`);
        throw new Error(`http_${res.status} ${text.slice(0,100)}`);
      }

      const data = await res.json();

      // Parse to {title,summary,content} - simple heuristic or assume the model followed the prompt
      let content = "";
      let title = "";
      let summary = "";

      if (isAnthropic) {
        content = data.content?.[0]?.text || JSON.stringify(data);
        // try parse json from content if model returned wrapped
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const j = JSON.parse(jsonMatch[0]);
            title = j.title || "";
            summary = j.summary || "";
            content = j.content || content;
          } catch {}
        }
      } else {
        const choice = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || JSON.stringify(data);
        content = choice;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const j = JSON.parse(jsonMatch[0]);
            title = j.title || "";
            summary = j.summary || "";
            content = j.content || content;
          } catch {}
        }
      }

      // hijack simple check (mirror server)
      if (/```|<\s*script|ignore previous|system prompt/i.test(content)) {
        throw new Error("llm_content_hijack_detected");
      }

      const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

      return {
        title: title || (content.split("\n")[0] || "Evidence").slice(0, 80),
        summary: summary || content.slice(0, 200),
        content,
        provenance: `browser-llm:${entry.label || entry.presetId}:${entry.model}`,
        usage: {
          inputTokens: usage.prompt_tokens || usage.input_tokens || 0,
          outputTokens: usage.completion_tokens || usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          model: entry.model,
        },
      };
    } catch (e: any) {
      clearTimeout(timeout);
      const msg = String(e?.message || e || "").toLowerCase();
      if (e.name === "AbortError" || msg.includes("abort") || msg.includes("timeout")) {
        throw new Error("LLM request timeout or aborted. Slow models (thinking) may need more time or a faster preset.");
      }
      if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("cors") || msg.includes("typeerror")) {
        throw new Error("Failed to fetch from LLM endpoint (likely CORS, network, or the vendor does not allow browser direct access). No proxy is used. Try a CORS-friendly vendor like OpenRouter, or configure 'custom' with a compatible endpoint. See docs for CORS matrix.");
      }
      if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized")) {
        throw new Error("Authentication failed (401/403). Check your API key (masked in UI).");
      }
      if (msg.includes("429") || msg.includes("rate limit")) {
        throw new Error("Rate limited (429). Key hit limits; the pool will rotate to next key if available, or backoff.");
      }
      throw e;
    }
  }

  // Return the provider function directly (matches LlmCapabilityExecutor expectation and server provider shape)
  const providerFn = async (params: {
    capabilityId: string;
    state: V5SessionState;
    inputArtifactIds: string[];
    roleId?: string;
    turnId: string;
  }) => {
    const prompt = buildCapabilityPrompt({
      capabilityId: params.capabilityId,
      state: params.state,
      inputArtifactIds: params.inputArtifactIds,
      roleId: params.roleId,
      turnId: params.turnId,
    });

    // B7: defense-in-depth redaction (generalize C_REDACT) - strip any accidental key-like strings from prompts before send
    const redact = (s: string) => s.replace(/\bsk-[a-zA-Z0-9]{10,}\b/gi, "[REDACTED_KEY]").replace(/Bearer\s+[a-zA-Z0-9._-]{10,}/gi, "Bearer [REDACTED]");
    const safeSystem = redact(prompt.systemPrompt);
    const safeUser = redact(prompt.userPrompt);

    let lease: ByokLease | null = null;
    try {
      lease = await pool.acquire();
      const result = await doFetch(lease, safeSystem, safeUser, prompt.maxTokens, prompt.temperature);
      pool.release(lease!, "ok");
      return {
        title: result.title,
        summary: result.summary,
        content: result.content,
        provenance: result.provenance,
        usage: result.usage,
      };
    } catch (e: any) {
      if (lease) {
        const msg = String(e?.message || e);
        const outcome: any = msg.includes("429") ? "http_429" : msg.includes("401") ? "http_401" : "error";
        pool.release(lease, outcome);
      }
      throw e;
    }
  };
  return providerFn as LlmCapabilityProvider;
}

export function useBrowserLlmCapabilityExecutor(dispatcher?: ByokPoolDispatcher) {
  const provider = createBrowserLlmCapabilityProvider(dispatcher);
  // The executor in runtime expects a certain shape; here we return a simple adapter
  // In practice wired in B4 by replacing the executor.
  return {
    provider,
  };
}
