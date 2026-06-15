/**
 * LlmProviderSettings 组件回归测试（/sliderule → 设置 → 语言模型 配置面板）。
 *
 * 本仓库 React 组件测试约定：用 react-dom/server renderToStaticMarkup，不引入 jsdom/RTL。
 * 因此只断言「给定 draft 的初始静态渲染」，交互逻辑改测纯函数（providerStatus 等）。
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LlmProviderSettings } from "../LlmProviderSettings";
import { providerStatus, type LlmProvidersConfig } from "@/lib/sliderule-llm-providers";

function makeDraft(over?: Partial<LlmProvidersConfig>): LlmProvidersConfig {
  return {
    version: 1,
    dispatch: "least-busy",
    raceMode: false,
    providers: [
      {
        id: "openai",
        presetId: "openai",
        name: "OpenAI",
        protocol: "openai",
        apiKey: "sk-live-123",
        requiresApiKey: true,
        baseUrl: "https://api.openai.com/v1",
        enabled: true,
        models: [{ id: "gpt-4o-mini", capabilities: ["tools", "stream"], enabled: true }],
      },
      {
        id: "anthropic",
        presetId: "anthropic",
        name: "Claude",
        protocol: "anthropic",
        apiKey: "",
        requiresApiKey: true,
        baseUrl: "https://api.anthropic.com/v1",
        enabled: false,
        models: [{ id: "claude-3-5-sonnet-20241022", capabilities: ["tools", "stream"], enabled: true }],
      },
    ],
    ...over,
  };
}

const noop = () => {};

describe("providerStatus（状态点派生）", () => {
  const base = makeDraft().providers[0];
  it("enabled + 有 key → ready", () => {
    expect(providerStatus({ ...base, enabled: true, apiKey: "sk-x" })).toBe("ready");
  });
  it("requiresApiKey 但 key 空 → needs-key（即便 enabled）", () => {
    expect(providerStatus({ ...base, enabled: true, apiKey: "  " })).toBe("needs-key");
  });
  it("有 key 但未启用 → configured", () => {
    expect(providerStatus({ ...base, enabled: false, apiKey: "sk-x" })).toBe("configured");
  });
  it("本地服务（不需 key）未启用 → configured", () => {
    expect(providerStatus({ ...base, enabled: false, requiresApiKey: false, apiKey: "" })).toBe("configured");
  });
});

describe("LlmProviderSettings 视觉/布局（Aspect ①）", () => {
  it("分区卡片：连接 + 模型 两组都渲染", () => {
    const html = renderToStaticMarkup(<LlmProviderSettings draft={makeDraft()} setDraft={noop} />);
    expect(html).toContain('data-testid="sliderule-section-connection"');
    expect(html).toContain('data-testid="sliderule-section-models"');
    expect(html).toContain("连接");
  });

  it("厂商列表项带配置状态点：已配 key=ready，缺 key=needs-key", () => {
    const html = renderToStaticMarkup(<LlmProviderSettings draft={makeDraft()} setDraft={noop} />);
    expect(html).toContain('data-status="ready"'); // OpenAI: enabled + key
    expect(html).toContain('data-status="needs-key"'); // Claude: requiresApiKey + 空 key
  });

  it("当前选中厂商有 aria-current 高亮", () => {
    const html = renderToStaticMarkup(<LlmProviderSettings draft={makeDraft()} setDraft={noop} />);
    // 默认选中第一个（OpenAI）
    expect(html).toMatch(/data-provider="openai"[^>]*aria-current="true"/);
  });
});
