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
import {
  modelSuggestionsFor,
  providerStatus,
  type LlmProvidersConfig,
} from "@/lib/sliderule-llm-providers";

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

describe("LlmProviderSettings 模型管理 UX（Aspect ②）", () => {
  it("默认模型显示「默认」徽章 + 选中的单选", () => {
    const draft = makeDraft();
    draft.providers[0].defaultModelId = "gpt-4o-mini";
    const html = renderToStaticMarkup(<LlmProviderSettings draft={draft} setDraft={noop} />);
    expect(html).toContain('data-testid="sliderule-model-default-badge"');
    expect(html).toContain("默认");
    expect(html).toMatch(/data-testid="sliderule-model-default-gpt-4o-mini"[^>]*checked/);
  });

  it("能力标签是可点切换的按钮（aria-pressed 反映 on/off）", () => {
    const draft = makeDraft();
    draft.providers[0].models[0].capabilities = ["tools"]; // 有 tools，没 stream
    const html = renderToStaticMarkup(<LlmProviderSettings draft={draft} setDraft={noop} />);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="sliderule-model-cap-gpt-4o-mini-tools"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-testid="sliderule-model-cap-gpt-4o-mini-stream"/);
  });

  it("模型为空时给空态 + 「拉取模型列表」按钮", () => {
    const draft = makeDraft();
    draft.providers[0].models = [];
    const html = renderToStaticMarkup(<LlmProviderSettings draft={draft} setDraft={noop} />);
    expect(html).toContain('data-testid="sliderule-model-empty"');
    expect(html).toContain('data-testid="sliderule-model-fetch"');
    expect(html).toContain("拉取模型列表");
  });

  it("modelSuggestionsFor 给出该预设的常见模型名", () => {
    expect(modelSuggestionsFor("openai")).toContain("gpt-4o");
    expect(modelSuggestionsFor("anthropic")[0]).toMatch(/^claude-/);
    expect(modelSuggestionsFor("custom")).toEqual([]);
  });
});
