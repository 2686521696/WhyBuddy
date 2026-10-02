/**
 * Node thin proxy contract for evidence.search -> Python evidence retrieval.
 * Locks provenance, sources, fallbackReason passthrough and degraded failure shape.
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

import * as llmClient from '../../core/llm-client.js';
import * as poolJsonLlm from '../../sliderule/pool-json-llm.js';
import { withStubbedLlmKey } from './helpers/with-stubbed-llm-key.js';

// ⚠ 2026-10-02：工厂是全量替换，漏一个导出调用点就拿到 undefined——2026-09-13 execute-capability
//   那份补了 viewerHeadersFrom，这份没跟上，报的是「python V5 delegation failed」502。
//   改成保留真实导出、只替换要桩的两个：产线再加导出也不会让这份静默过期。
vi.mock('../../sliderule/python-delegation.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../../sliderule/python-delegation.js')>()),
  callPythonSlideRule: vi.fn(),
  resolvePythonSlideRuleRuntimeConfig: vi.fn(() => ({
    baseUrl: 'http://localhost:9700',
    internalKey: 'dev-slide-rule-internal',
    timeoutMs: 120000,
    healthPath: '/health',
    proxyMode: 'node-fetch-env',
  })),
}));

let slideruleRouter: any;
let pythonDelegation: any;

const evidenceRequestBody = {
  capabilityId: 'evidence.search',
  state: {
    sessionId: 't-evidence-proxy',
    goal: { text: 'Find evidence for table progression pacing' },
    artifacts: [],
  },
  inputArtifactIds: ['goal-1'],
  roleId: 'grounding',
  turnId: 't-evidence-proxy',
};

describe('evidence.search Node -> Python proxy contract', () => {
  let app: any;
  let server: any;
  let base: string;
  let restoreLlmKey: (() => void) | undefined;

  beforeAll(async () => {
    const routerModule = await import('../sliderule.js');
    slideruleRouter = routerModule.default;
    pythonDelegation = await import('../../sliderule/python-delegation.js');
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    ({ restore: restoreLlmKey } = withStubbedLlmKey());
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
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

  it('passes through retrieved provenance and sources without altering fields', async () => {
    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    const pythonPayload = {
      title: 'Evidence search',
      summary: 'Retrieved grounding references',
      content: '## Grounding references\n- table assignment evidence from playtests',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 42 },
      evidenceProvenance: 'retrieved',
      sources: [
        {
          title: 'Playtest notes',
          snippet: 'table assignment evidence',
          provenance: 'retrieved',
          sourceId: 'doc-1',
          score: 0.93,
        },
      ],
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidenceRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.evidenceProvenance).toBe('retrieved');
    expect(body.fallbackReason).toBeUndefined();
    expect(body.sources[0].provenance).toBe('retrieved');
    expect(body.sources[0].sourceId).toBe('doc-1');
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({
        capabilityId: 'evidence.search',
        roleId: 'grounding',
        turnId: 't-evidence-proxy',
        userText: 'Find evidence for table progression pacing',
      }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('passes through fallback provenance, fallbackReason, and fallback-marked sources', async () => {
    const pythonPayload = {
      title: 'Evidence search',
      summary: 'No vector-backed hits',
      content: '## Grounding references\n- fallback only, not real RAG',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 31 },
      evidenceProvenance: 'fallback',
      fallbackReason: 'no_retrieval_hits',
      sources: [
        {
          title: 'Fallback evidence',
          snippet: 'no vector-backed evidence was retrieved',
          provenance: 'fallback',
          fallbackReason: 'no_retrieval_hits',
        },
      ],
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidenceRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.evidenceProvenance).toBe('fallback');
    expect(body.fallbackReason).toBe('no_retrieval_hits');
    expect(body.sources[0].provenance).toBe('fallback');
    expect(body.sources[0].fallbackReason).toBe('no_retrieval_hits');
    expect(body.evidenceProvenance).not.toBe('retrieved');
  });

  it('passes through generated sources with llm_prose_only fallbackReason', async () => {
    const pythonPayload = {
      title: 'Evidence search',
      summary: 'Generated grounding references',
      content: '## Grounding references\n- generated planning reference from model prose',
      provenance: 'python-llm',
      model: 'fake-python-model',
      usage: { total_tokens: 28 },
      evidenceProvenance: 'generated',
      fallbackReason: 'llm_prose_only',
      sources: [
        {
          title: 'Grounding references',
          snippet: 'generated planning reference from model prose',
          provenance: 'generated',
          fallbackReason: 'llm_prose_only',
        },
      ],
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidenceRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.evidenceProvenance).toBe('generated');
    expect(body.fallbackReason).toBe('llm_prose_only');
    expect(body.sources[0].provenance).toBe('generated');
    expect(body.evidenceProvenance).not.toBe('retrieved');
  });

  it('returns 502 degraded shape when Python delegation fails (no pseudo-success)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pythonDelegation.callPythonSlideRule.mockRejectedValueOnce(new Error('connection refused'));

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidenceRequestBody),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.provenance).toBe('python-delegated-failed');
    expect(body.error).toBe('python_unavailable');
    expect(body.sources).toBeUndefined();
    expect(body.evidenceProvenance).toBeUndefined();
    expect(body.fallbackReason).toBeUndefined();
    warnSpy.mockRestore();
  });
});
