import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

import * as llmClient from '../../core/llm-client.js';
import * as poolJsonLlm from '../../sliderule/pool-json-llm.js';
import { withStubbedLlmKey } from './helpers/with-stubbed-llm-key.js';

vi.mock('../../sliderule/python-delegation.js', () => ({
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

const skillRequestBody = {
  capabilityId: 'skill.invoke',
  state: {
    sessionId: 't-skill-proxy',
    goal: { text: 'Invoke a skill for migration evidence' },
    artifacts: [],
  },
  inputArtifactIds: ['goal-1'],
  roleId: 'grounding',
  turnId: 't-skill-proxy',
};

describe('skill.invoke Node -> Python proxy contract', () => {
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

  it('passes through fallback provenance without claiming real skill runtime', async () => {
    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    const pythonPayload = {
      title: 'skill.invoke via stable RAG',
      summary: 'Fallback evidence, not a real skill registry call',
      content: 'Keyword evidence only',
      provenance: 'python-rag',
      skillName: 'skill.invoke',
      sources: [{ title: 'Stub knowledge', provenance: 'fallback' }],
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skillRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.provenance).toBe('python-rag');
    expect(body.provenance).not.toMatch(/^skill:/);
    expect(body.skillName).toBe('skill.invoke');
    expect(body.skillId).toBeUndefined();
    expect(body.skillResult).toBeUndefined();
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
  });

  it('returns explicit degraded 502 when Python delegation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pythonDelegation.callPythonSlideRule.mockRejectedValueOnce(new Error('connection refused'));

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skillRequestBody),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.provenance).toBe('python-delegated-failed');
    expect(body.error).toBe('python_unavailable');
    expect(body.provenance).not.toMatch(/^skill:/);
    warnSpy.mockRestore();
  });
});
