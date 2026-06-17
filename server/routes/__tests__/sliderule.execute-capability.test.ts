/**
 * Server route tests for POST /api/sliderule/execute-capability.
 * These provide the dedicated server-level regression the review asked for.
 *
 * This file lives under server/routes/__tests__/ so it is picked up by
 * vitest.config.server.ts (the __tests__ pattern in its include).
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

import * as llmClient from '../../core/llm-client.js';
import * as poolJsonLlm from '../../sliderule/pool-json-llm.js';
import * as ghAdapter from '../../sliderule/github-mcp-adapter.js';
import * as repoStaticAnalyzer from '../../sliderule/repo-static-analyzer.js';
import { withStubbedLlmKey } from './helpers/with-stubbed-llm-key.js';

// IMPORTANT: vi.mock must be declared before any static import that pulls in
// routes/sliderule.js (which does `import { callPythonSlideRule } from '../sliderule/python-delegation.js'`).
// We then use dynamic import *after* the mock so the route module receives the mocked version.
// This fixes the "mock not taking effect / real Python hit" issue reported in audit.
vi.mock('../../sliderule/python-delegation.js', () => ({
  callPythonSlideRule: vi.fn(),
}));

let slideruleRouter: any;
let pythonDelegation: any;

describe('POST /api/sliderule/execute-capability (server route)', () => {
  let app: any;
  let server: any;
  let base: string;
  let restoreLlmKey: (() => void) | undefined;

  beforeAll(async () => {
    // Dynamic import of the route *after* vi.mock registration.
    const routerModule = await import('../sliderule.js');
    slideruleRouter = routerModule.default;
    pythonDelegation = await import('../../sliderule/python-delegation.js');
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    ({ restore: restoreLlmKey } = withStubbedLlmKey());
    // Fresh app per test using the (mocked) router loaded under the vi.mock.
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/sliderule', slideruleRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/sliderule`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();
    restoreLlmKey?.();
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('returns 400 for missing required fields', async () => {
    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilityId: 'risk.analyze' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json().catch(() => ({}));
    expect(body.error).toBe('bad_request');
  });

  it('returns 400/422 for unsupported capability (not 500)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'intent.parse',
        state: { sessionId: 't1', goal: { text: 'x' } },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });
    expect([400, 422]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    expect(String(body.error || '')).toMatch(/unsupported/);

    errSpy.mockRestore();
  });

  it('returns llm_fallback template when no apiKey (no 500), without leaking secrets', async () => {
    // Legacy path test: under python backend risk/report delegate first and do not hit Node llm_fallback.
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'legacy');
    restoreLlmKey?.();
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS;
    const { resetSlideRuleCapabilityPoolCache } = await import("../../sliderule/pool-json-llm.js");
    resetSlideRuleCapabilityPoolCache();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'risk.analyze',
          state: { sessionId: 't1', goal: { text: '分析权限边界' } },
          inputArtifactIds: [],
          turnId: 't1',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json().catch(() => ({}));
      expect(body.provenance).toBe('llm_fallback');
      expect(body.degraded).toBe(true);
      expect(String(body.content || '')).toContain('权限');
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toMatch(/sk-/i);
      expect(bodyStr).not.toMatch(/OPENAI|LLM_API_KEY/i);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns raw 4-field shape on mocked success for risk.analyze', async () => {
    // Legacy path (Node LLM) test; python backend delegates report/risk to V5 RAG.
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'legacy');
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Server Risk Title',
        summary: 'server risk summary',
        content: 'server risk content with evidence',
      },
      usage: undefined,
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'risk.analyze',
        state: { sessionId: 't1', goal: { text: '权限系统' } },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Server Risk Title');
    expect(body.content).toContain('server risk content');
    expect(body.provenance).toBe('llm');
  });

  it('returns normalized usage when llm-client provides usage (Knife 11.1)', async () => {
    // Legacy Node LLM path test for usage normalization.
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'legacy');
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Risk with Usage',
        summary: 'has usage',
        content: 'risk content',
      },
      usage: {
        prompt_tokens: 120,
        completion_tokens: 80,
        total_tokens: 200,
      },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'risk.analyze',
        state: { sessionId: 't-usage', goal: { text: 'test' } },
        inputArtifactIds: [],
        turnId: 't-usage',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Risk with Usage');
    expect(body.provenance).toBe('llm');
    expect(body.usage).toEqual({
      inputTokens: 120,
      outputTokens: 80,
      totalTokens: 200,
      model: expect.any(String), // the route uses config.model
    });
  });

  it('report.write success returns content that reflects the 9-section base structure', async () => {
    // Legacy Node LLM path test (python backend now owns report.write with RAG sources).
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'legacy');
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Server Report Title',
        summary: 'server report summary',
        content: '结论：...\n支撑证据：...\n反证/挑战：...\n风险：...\n分歧：...\n收敛决策：...\n未解缺口：...\n下一步工程化分支：...\nprovenance / upstream refs：...',
      },
      usage: undefined,
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'report.write',
        state: { sessionId: 't1', goal: { text: '权限系统' }, artifacts: [] },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = body.content || '';
    expect(content).toMatch(/结论|支撑证据|反证|风险|分歧|收敛决策|未解缺口|下一步工程化|provenance/);
    expect(body.provenance).toBe('llm');
  });

  it('report.write uses pool result when pool succeeds (skips primary)', async () => {
    // Legacy pool path test only (under python backend, report.write always delegates to V5 RAG first).
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'legacy');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    vi.spyOn(poolJsonLlm, 'callPoolJsonLlm').mockResolvedValueOnce({
      json: {
        title: 'Pool Report',
        summary: 'from pool',
        content: '结论：pool\n支撑证据：pool\n反证/挑战：pool\n风险：pool\n分歧：pool\n收敛决策：pool\n未解缺口：pool\n下一步工程化分支：pool\nprovenance / upstream refs：pool',
      },
      model: 'gpt-5.4',
      poolLabel: 'default-1',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, model: 'gpt-5.4@default-1' },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'report.write',
        state: { sessionId: 't-pool', goal: { text: '权限系统' }, artifacts: [] },
        inputArtifactIds: [],
        turnId: 't-pool',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Pool Report');
    expect(body.provenance).toBe('llm');
    expect(body.summary).toContain('[pool-llm:');
    expect(primarySpy).not.toHaveBeenCalled();
  });

  it('report.write delegates to Python V5 backend when pool is configured but exhausted (migration path)', async () => {
    // Explicitly python path: only assert delegation behavior, python-rag, helper called with correct endpoint/payload, no Node LLM/pool calls.
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    vi.spyOn(poolJsonLlm, 'callPoolJsonLlm').mockResolvedValueOnce(null);

    // Use the mocked delegation module. With dynamic import of router *after* vi.mock (see beforeAll),
    // the route's import of callPythonSlideRule receives this mock (no more real Python / "RAG generated report").
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Report from Python RAG',
      summary: '检索了外部证据',
      content: '结论：权限系统采用 RBAC + 范围过滤，审计完整。',
      provenance: 'python-rag',
      sources: [{ id: 'rbac1', content: 'RBAC scoping', source: 'internal-policy' }]
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'report.write',
        state: { sessionId: 't-fb', goal: { text: '权限系统' }, artifacts: [] },
        inputArtifactIds: [],
        turnId: 't-fb',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-rag');
    expect(body.summary).toContain('检索了外部证据');
    expect(primarySpy).not.toHaveBeenCalled();  // delegation skips Node LLM path
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalled();
    // Thin proxy contract per audit request
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({ capabilityId: 'report.write', state: expect.any(Object) }),
      expect.any(String)
    );
  });

  it('intent.clarify delegates to Python V5 backend in python mode and skips Node LLM/pool', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Clarification from Python RAG',
      summary: 'Python clarified the goal with grounded questions',
      content: 'Please confirm the target users, data boundary, and acceptance criteria for the permission workflow.',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 42 },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'intent.clarify',
        state: { sessionId: 't-intent', goal: { text: 'Design an RBAC permission workflow' }, artifacts: [] },
        inputArtifactIds: ['goal-1'],
        roleId: 'clarifier',
        turnId: 't-intent',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-llm');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'intent.clarify',
        inputArtifactIds: ['goal-1'],
        roleId: 'clarifier',
        turnId: 't-intent',
        userText: 'Design an RBAC permission workflow',
      }),
      expect.any(String)
    );
  });

  it('gap.ask delegates to Python V5 backend in python mode and skips Node LLM/pool', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Gap questions',
      summary: 'Missing information',
      content: '## Missing information\n- Desk assignment rules\n## Questions\n- What triggers promotion?',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 36 },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'gap.ask',
        state: { sessionId: 't-gap', goal: { text: 'Design a pet office task assignment system' }, artifacts: [] },
        inputArtifactIds: ['goal-1'],
        roleId: 'gap-finder',
        turnId: 't-gap',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-llm');
    expect(body.content).toContain('Desk assignment');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'gap.ask',
        inputArtifactIds: ['goal-1'],
        roleId: 'gap-finder',
        turnId: 't-gap',
        userText: 'Design a pet office task assignment system',
      }),
      expect.any(String)
    );
  });

  it('critique.generate delegates to Python V5 backend in python mode and skips Node LLM/pool', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Structured critique',
      summary: 'Critique points',
      content: '## Critique points\n- Promotion rules are underspecified\n## Risks\n- Players may grind without meaningful choices',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 41 },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'critique.generate',
        state: { sessionId: 't-critique', goal: { text: 'Design a pet office progression system' }, artifacts: [] },
        inputArtifactIds: ['goal-1'],
        roleId: '挑刺',
        turnId: 't-critique',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-llm');
    expect(body.content).toContain('Promotion rules');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'critique.generate',
        inputArtifactIds: ['goal-1'],
        roleId: '挑刺',
        turnId: 't-critique',
        userText: 'Design a pet office progression system',
      }),
      expect.any(String)
    );
  });

  it('synthesis.merge delegates to Python V5 backend in python mode and skips Node LLM/pool', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Synthesis merge',
      summary: 'Synthesized conclusion',
      content: '## Synthesized conclusion\n- converged next step\n## Remaining disagreements\n- speed vs depth',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 42 },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'synthesis.merge',
        state: { sessionId: 't-synthesis.merge', goal: { text: 'Design a pet office progression system' }, artifacts: [] },
        inputArtifactIds: ['goal-1'],
        roleId: '综合',
        turnId: 't-synthesis.merge',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-llm');
    expect(body.content).toContain('converged next step');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'synthesis.merge',
        inputArtifactIds: ['goal-1'],
        roleId: '综合',
        turnId: 't-synthesis.merge',
        userText: 'Design a pet office progression system',
      }),
      expect.any(String),
    );
  });

  it('rebuttal.resolve delegates to Python V5 backend in python mode and skips Node LLM/pool', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Rebuttal resolution',
      summary: 'Response points',
      content: '## Response points\n- unresolved disagreement remains on rollout speed',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 43 },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'rebuttal.resolve',
        state: { sessionId: 't-rebuttal.resolve', goal: { text: 'Design a pet office progression system' }, artifacts: [] },
        inputArtifactIds: ['goal-1'],
        roleId: '综合',
        turnId: 't-rebuttal.resolve',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-llm');
    expect(body.content).toContain('unresolved disagreement');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'rebuttal.resolve',
        roleId: '综合',
        turnId: 't-rebuttal.resolve',
      }),
      expect.any(String),
    );
  });

  it('counter.argue delegates to Python V5 backend in python mode and skips Node LLM/pool', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Counter argument',
      summary: 'Counterpoints',
      content: '## Counterpoints\n- counterpoint evidence against the current roadmap',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 44 },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'counter.argue',
        state: { sessionId: 't-counter.argue', goal: { text: 'Design a pet office progression system' }, artifacts: [] },
        inputArtifactIds: ['goal-1'],
        roleId: '挑刺',
        turnId: 't-counter.argue',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-llm');
    expect(body.content).toContain('counterpoint evidence');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'counter.argue',
        roleId: '挑刺',
        turnId: 't-counter.argue',
      }),
      expect.any(String),
    );
  });

  const pendingPythonNativeCaps = [
    {
      capabilityId: 'report.write',
      roleId: '综合',
      goal: 'Design a pet office feasibility report',
      snippet: 'evidence-backed conclusion',
      title: 'Feasibility report',
    },
    {
      capabilityId: 'structure.decompose',
      roleId: '架构',
      goal: 'Decompose a pet office product spec tree',
      snippet: 'requirements branch',
      title: 'Structure decomposition',
    },
    {
      capabilityId: 'risk.analyze',
      roleId: '安全',
      goal: 'Analyze risks in a pet office progression system',
      snippet: 'mitigation path',
      title: 'Risk analysis',
    },
    {
      capabilityId: 'evidence.search',
      roleId: '接地',
      goal: 'Find evidence for a pet office progression system',
      snippet: 'grounding reference',
      title: 'Evidence search',
    },
  ] as const;

  for (const cap of pendingPythonNativeCaps) {
    it(`${cap.capabilityId} delegates to Python V5 backend in python mode and skips Node LLM/pool`, async () => {
      vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
      vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
      vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
      vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
      poolJsonLlm.resetSlideRuleCapabilityPoolCache();

      const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
      const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
      pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
        title: cap.title,
        summary: cap.title,
        content: `## ${cap.title}\n- ${cap.snippet}`,
        provenance: 'python-llm',
        model: 'fake-python-model',
        usage: { total_tokens: 40 },
      });

      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: cap.capabilityId,
          state: { sessionId: `t-${cap.capabilityId}`, goal: { text: cap.goal }, artifacts: [] },
          inputArtifactIds: ['goal-1'],
          roleId: cap.roleId,
          turnId: `t-${cap.capabilityId}`,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.provenance).toBe('python-llm');
      expect(body.content).toContain(cap.snippet);
      expect(primarySpy).not.toHaveBeenCalled();
      expect(poolSpy).not.toHaveBeenCalled();
      expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
        expect.stringContaining('localhost:9700'),
        '/api/sliderule/execute-capability',
        expect.objectContaining({
          capabilityId: cap.capabilityId,
          roleId: cap.roleId,
          turnId: `t-${cap.capabilityId}`,
          userText: cap.goal,
        }),
        expect.any(String),
      );
    });
  }

  it('question.expand delegates to Python V5 backend in python mode and skips Node LLM/pool', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('SLIDERULE_CAPABILITY_POOL_ENABLED', 'true');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_KEYS', 'k1');
    vi.stubEnv('BLUEPRINT_SPEC_DOCS_LLM_POOL_BASE_URL', 'https://example.test/v1');
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();

    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce({
      title: 'Expanded questions',
      summary: 'Expanded questions',
      content: '## Expanded questions\n- What onboarding milestone should unlock the first desk?\n## Why they matter\n- It affects progression pacing.',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 33 },
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'question.expand',
        state: { sessionId: 't-question', goal: { text: 'Design onboarding for a pet office sim' }, artifacts: [] },
        inputArtifactIds: ['goal-1'],
        roleId: 'question-expander',
        turnId: 't-question',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('python-llm');
    expect(body.content).toContain('onboarding milestone');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'question.expand',
        inputArtifactIds: ['goal-1'],
        roleId: 'question-expander',
        turnId: 't-question',
        userText: 'Design onboarding for a pet office sim',
      }),
      expect.any(String)
    );
  });

  // --- P0 MCP GitHub adapter tests (source/evidence via server capability seam) ---

  it('source.github.inspect returns raw 4-field shape with mcp:github provenance (success)', async () => {
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Source: facebook/react',
      summary: 'repo facebook/react · TypeScript · 200000★ · default branch main · last pushed 2026-...',
      content: JSON.stringify({
        repository: 'facebook/react',
        language: 'TypeScript',
        stars: 200000,
        license: 'MIT License',
        readmeSummary: 'A JavaScript library for building user interfaces...',
        risks: ['low recent activity'],
        source: 'mcp-github',
      }, null, 2),
      provenance: 'mcp:github',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'source.github.inspect',
        state: { sessionId: 't1', goal: { text: 'look at https://github.com/facebook/react for the UI components' } },
        inputArtifactIds: [],
        turnId: 't1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toContain('facebook/react');
    expect(body.provenance).toBe('mcp:github');
    expect(body.content).toContain('facebook/react');
    // enrichment assertions (v1)
    expect(body.content).toContain('readmeSummary');
    expect(body.content).toContain('license');
    expect(body.content).toContain('risks');

    // Prove the route used the (mock) adapter and did not hit real network
    expect(ghSpy).toHaveBeenCalledTimes(1);
    expect(ghSpy).toHaveBeenCalledWith('source.github.inspect', expect.anything(), []);
  });

  it('evidence.github.collect returns raw shape and can be referenced by report.write inputArtifactIds', async () => {
    // The github evidence "artifact" is produced by a prior capability run in real flow.
    // Here we prove the route accepts the cap (via spied adapter) and that a subsequent
    // report.write still receives the 9-section base (github artifact id carried in inputArtifactIds).

    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Evidence: vercel/next.js',
      summary: 'repo vercel/next.js · TypeScript · 100000★ ...',
      content: JSON.stringify({
        repository: 'vercel/next.js',
        url: 'https://github.com/vercel/next.js',
        license: 'MIT License',
        readmeSummary: 'The React Framework for the Web...',
        risks: [],
        source: 'mcp-github',
      }, null, 2),
      provenance: 'mcp:github',
    });

    // First call (spied — no real network).
    const ghRes = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'evidence.github.collect',
        state: { sessionId: 't2', goal: { text: 'https://github.com/vercel/next.js' } },
        inputArtifactIds: [],
        turnId: 't2',
      }),
    });
    expect(ghRes.status).toBe(200);
    const ghBody = await ghRes.json();
    expect(ghBody.provenance).toBe('mcp:github');
    // enrichment assertions (v1)
    expect(ghBody.content).toContain('readmeSummary');
    expect(ghBody.content).toContain('license');

    // Prove the route used the mock adapter (no real network)
    expect(ghSpy).toHaveBeenCalledTimes(1);
    expect(ghSpy).toHaveBeenCalledWith('evidence.github.collect', expect.anything(), []);

    // Now call report.write referencing that github evidence via inputArtifactIds.
    // Legacy path assertion (under python backend this would delegate; we force legacy here to keep the Node llm + 'llm' provenance contract test).
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'legacy');
    vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        title: 'Report with GitHub Evidence',
        summary: 'includes github evidence',
        content: '结论：...\n支撑证据：... (includes vercel/next.js github artifact)\n...',
      },
      usage: undefined,
    });

    const reportRes = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'report.write',
        state: { sessionId: 't2', goal: { text: 'summarize' }, artifacts: [{ id: 'gh1', kind: 'evidence', title: 'GitHub Evidence' }] },
        inputArtifactIds: ['gh1'],
        turnId: 't2',
      }),
    });

    expect(reportRes.status).toBe(200);
    const reportBody = await reportRes.json();
    expect(reportBody.content).toMatch(/支撑证据|结论/);
    expect(reportBody.provenance).toBe('llm');
  });

  it('graceful missing README still returns 200 with core metadata + note (enrichment v1)', async () => {
    // Simulate the inner README fetch failing (404 or error) – adapter must degrade gracefully
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Evidence: facebook/react',
      summary: 'repo facebook/react · JavaScript · 200000★ ...',
      content: JSON.stringify({
        repository: 'facebook/react',
        description: 'A declarative, efficient, and flexible JavaScript library for building user interfaces.',
        language: 'JavaScript',
        stars: 200000,
        license: null, // or 'MIT'
        readmeSummary: null,
        risks: ['missing license'],
        source: 'mcp-github',
      }, null, 2),
      provenance: 'mcp:github',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'evidence.github.collect',
        state: { sessionId: 't-missing-readme', goal: { text: 'https://github.com/facebook/react' } },
        inputArtifactIds: [],
        turnId: 't5',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('mcp:github');
    expect(body.content).toContain('facebook/react');
    // graceful: no readmeSummary, but still has core + risks note
    expect(body.content).not.toContain('readmeSummary": "'); // or check it's null
    expect(body.content).toContain('risks');

    ghSpy.mockRestore();
  });

  it('respects inputArtifactIds priority when multiple GitHub artifacts exist (Medium fix)', async () => {
    // Two artifacts in state. When inputArtifactIds: ['second'], must select vercel/next.js, not facebook/react.
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Evidence: vercel/next.js',
      summary: 'repo vercel/next.js · TypeScript · 100000★ ...',
      content: '{"repository":"vercel/next.js","url":"https://github.com/vercel/next.js"}',
      provenance: 'mcp:github',
    });

    const stateWithTwo = {
      sessionId: 't-priority',
      goal: { text: 'check facebook/react and also vercel/next.js' },
      artifacts: [
        { id: 'first', title: 'FB Repo', content: 'https://github.com/facebook/react' },
        { id: 'second', title: 'Vercel Repo', content: 'https://github.com/vercel/next.js' },
      ],
    };

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'evidence.github.collect',
        state: stateWithTwo,
        inputArtifactIds: ['second'],
        turnId: 't4',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toContain('vercel/next.js');
    expect(body.provenance).toBe('mcp:github');

    expect(ghSpy).toHaveBeenCalledTimes(1);
    expect(ghSpy).toHaveBeenCalledWith('evidence.github.collect', expect.anything(), ['second']);

    ghSpy.mockRestore();
  });

  it('github mcp capability with no usable url returns 400 (fallback path, no 500)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'source.github.inspect',
        state: { sessionId: 't3', goal: { text: 'no github link here at all' } },
        inputArtifactIds: [],
        turnId: 't3',
      }),
    });

    expect([400, 422]).toContain(res.status);
    const body = await res.json().catch(() => ({}));
    // The route catch maps adapter-thrown 400s (no url) to "unsupported_capability"
    // while preserving the original message for diagnostics.
    expect(body.error).toBe('unsupported_capability');
    expect(String(body.message || '')).toMatch(/github|url|no github/i);

    errSpy.mockRestore();
  });

  // --- Static Repo Analyzer (repo.static.inspect) tests ---

  it('repo.static.inspect returns raw 4-field shape with structured engineering evidence', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect').mockResolvedValueOnce({
      title: 'Static Repo Analysis: facebook/react',
      summary: 'Detected react, typescript with pnpm. 2 risks noted.',
      content: JSON.stringify({
        repository: 'facebook/react',
        detectedStack: ['react', 'typescript', 'vite'],
        packageManager: 'pnpm',
        scripts: { dev: 'vite', test: 'vitest', build: 'vite build' },
        ci: { hasGithubActions: true, workflowCount: 3 },
        configSignals: { hasTsconfig: true, hasDockerfile: false, hasEnvExample: true },
        risks: ['No Dockerfile found'],
        recommendedNextChecks: ['Review package.json scripts', 'Add Dockerfile'],
      }, null, 2),
      provenance: 'repo:static',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.static.inspect',
        state: { sessionId: 't-static', goal: { text: 'analyze https://github.com/facebook/react' } },
        inputArtifactIds: [],
        turnId: 't6',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('repo:static');
    expect(body.title).toContain('facebook/react');
    const content = JSON.parse(body.content || '{}');
    expect(content.detectedStack).toContain('react');
    expect(content.packageManager).toBe('pnpm');
    expect(content.risks).toContain('No Dockerfile found');
    expect(content.recommendedNextChecks.length).toBeGreaterThan(0);

    expect(staticSpy).toHaveBeenCalledTimes(1);
    expect(staticSpy).toHaveBeenCalledWith('repo.static.inspect', expect.anything(), []);
  });

  it('repo.inspect maps to static + github adapters when goal has GitHub URL (F1 B4)', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect').mockResolvedValueOnce({
      title: 'Static Repo Analysis: facebook/react',
      summary: 'Detected react stack.',
      content: JSON.stringify({
        repository: 'facebook/react',
        detectedStack: ['react', 'typescript'],
        ci: { workflowCount: 12 },
      }),
      provenance: 'repo:static',
    });

    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Source: facebook/react',
      summary: 'repo facebook/react · TypeScript · 200000★',
      content: JSON.stringify({
        repository: 'facebook/react',
        stars: 200000,
        readmeSummary: 'A JavaScript library for building user interfaces.',
        source: 'mcp-github',
      }),
      provenance: 'mcp:github',
    });

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.inspect',
        state: {
          sessionId: 't-f1',
          goal: { text: '分析 https://github.com/facebook/react 的工程结构' },
        },
        inputArtifactIds: [],
        turnId: 't-f1',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(staticSpy).toHaveBeenCalledWith('repo.static.inspect', expect.anything(), []);
    expect(ghSpy).toHaveBeenCalledWith('source.github.inspect', expect.anything(), []);
    expect(body.provenance).toBe('mcp:github');
    expect(body.content).toContain('facebook/react');
    expect(body.content).toContain('stars');
    expect(body.content).toContain('readmeSummary');
  });

  it('repo.inspect without GitHub URL degrades to rule fallback without calling adapters (F1)', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect');
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability');

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.inspect',
        state: { sessionId: 't-f1-fallback', goal: { text: '做一个权限管理系统' } },
        inputArtifactIds: [],
        turnId: 't-f1-fallback',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('ai_generated');
    expect(body.content).toMatch(/未能从目标中识别|未找到 GitHub/i);
    expect(staticSpy).not.toHaveBeenCalled();
    expect(ghSpy).not.toHaveBeenCalled();
  });

  it('repo.static.inspect respects inputArtifactIds priority and graceful missing files', async () => {
    const staticSpy = vi.spyOn(repoStaticAnalyzer, 'executeRepoStaticInspect').mockResolvedValueOnce({
      title: 'Static Repo Analysis: vercel/next.js',
      summary: 'Detected react, next, typescript with pnpm. 1 risks noted.',
      content: JSON.stringify({
        repository: 'vercel/next.js',
        detectedStack: ['react', 'next', 'typescript'],
        packageManager: 'pnpm',
        scripts: { build: 'next build' },
        ci: { hasGithubActions: true, workflowCount: 5 },
        configSignals: { hasTsconfig: true, hasDockerfile: true, hasEnvExample: false },
        risks: ['No .env.example found'],
        recommendedNextChecks: ['Add .env.example'],
      }, null, 2),
      provenance: 'repo:static',
    });

    const stateWithGitHubArtifact = {
      sessionId: 't-static-prio',
      goal: { text: 'check multiple' },
      artifacts: [
        { id: 'gh-fb', title: 'FB', content: 'https://github.com/facebook/react' },
        { id: 'gh-vercel', title: 'Vercel', content: 'https://github.com/vercel/next.js' },
      ],
    };

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        capabilityId: 'repo.static.inspect',
        state: stateWithGitHubArtifact,
        inputArtifactIds: ['gh-vercel'],
        turnId: 't7',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance).toBe('repo:static');
    expect(body.title).toContain('vercel/next.js');
    const content = JSON.parse(body.content || '{}');
    expect(content.configSignals.hasDockerfile).toBe(true);
    expect(content.risks).toContain('No .env.example found');

    expect(staticSpy).toHaveBeenCalledWith('repo.static.inspect', expect.anything(), ['gh-vercel']);

    staticSpy.mockRestore();
  });
});

// Live Node->Python delegation smoke has been moved to its own file:
// server/routes/__tests__/sliderule.live-delegation.test.ts
// Run with LIVE_NODE_TO_PYTHON_SLIDERULE=1 to exercise real delegation through the Node router.
// This keeps the main contract tests (17 passed) completely stable and isolated from live service requirements.


