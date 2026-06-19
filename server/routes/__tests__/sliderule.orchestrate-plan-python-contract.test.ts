import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import { withStubbedLlmKey } from './helpers/with-stubbed-llm-key.js';
import * as llmClient from '../../core/llm-client.js';

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

const planRequestBody = {
  capabilityId: 'orchestrate.plan',
  state: {
    sessionId: 't-orch-python-proxy',
    goal: { text: 'Plan a migration boundary slice' },
    artifacts: [],
    capabilityRuns: [],
  },
  inputArtifactIds: [],
  roleId: 'planner',
  turnId: 't-orch-python-proxy',
};

const goldenFixture = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), 'tws-ai-slide-rule-python/tests/fixtures/orchestrate_plan_golden.json'),
    'utf8',
  ),
);

describe('orchestrate.plan Node -> Python proxy contract', () => {
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
    restoreLlmKey?.();
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('delegates orchestrate.plan to Python orchestrate-plan endpoint and passes through plan shape', async () => {
    const pythonPayload = {
      selected: [{ capabilityId: 'evidence.search', roleId: 'grounding', why: 'Need evidence first' }],
      rationale: 'Evidence boundary first',
      source: 'python-rag',
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/orchestrate-plan',
      expect.objectContaining({
        capabilityId: 'orchestrate.plan',
        turnId: 't-orch-python-proxy',
        userText: 'Plan a migration boundary slice',
      }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('keeps direct orchestrate-plan owned by Node while execute-capability proxies only the planner fragment', async () => {
    const nodeLlmSpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage').mockResolvedValueOnce({
      json: {
        selected: [{ capabilityId: 'risk.analyze', roleId: '安全', why: 'Node owns main planning' }],
        rationale: 'Node orchestrator result',
      },
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    } as any);
    const pythonPayload = {
      selected: [{ capabilityId: 'evidence.search', roleId: 'grounding', why: 'Python thin planner fragment' }],
      rationale: 'Python fragment only',
      source: 'python-rag',
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const directPlan = await fetch(`${base}/orchestrate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          ...planRequestBody.state,
          goal: { text: 'Audit one migration risk' },
        },
        turnId: planRequestBody.turnId,
        userText: 'Audit one migration risk',
      }),
    });

    expect(directPlan.status).toBe(200);
    const directBody = await directPlan.json();
    expect(directBody.source).toBe('llm');
    expect(directBody.selected[0].capabilityId).toBe('risk.analyze');
    expect(nodeLlmSpy).toHaveBeenCalledTimes(1);
    expect(pythonDelegation.callPythonSlideRule).not.toHaveBeenCalled();

    const proxiedFragment = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(proxiedFragment.status).toBe(200);
    const fragmentBody = await proxiedFragment.json();
    expect(fragmentBody).toEqual(pythonPayload);
    expect(fragmentBody.state).toBeUndefined();
    expect(fragmentBody.artifacts).toBeUndefined();
    expect(fragmentBody.capabilityRuns).toBeUndefined();
    expect(fragmentBody.coverageGate).toBeUndefined();
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.any(String),
      '/api/sliderule/orchestrate-plan',
      expect.objectContaining({ capabilityId: 'orchestrate.plan' }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('returns explicit degraded 502 when Python delegation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pythonDelegation.callPythonSlideRule.mockRejectedValueOnce(new Error('connection refused'));

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.provenance).toBe('python-delegated-failed');
    expect(body.error).toBe('python_unavailable');
    expect(body.selected).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('classifies Python bad JSON as delegated failure without planner fallback', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pythonDelegation.callPythonSlideRule.mockRejectedValueOnce(
      new Error('python /api/sliderule/orchestrate-plan invalid json: Unexpected token <'),
    );

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.provenance).toBe('python-delegated-failed');
    expect(body.error).toBe('python_unavailable');
    expect(body.reason).not.toBe('no_api_key');
    expect(body.reason).not.toBe('fallback');
    expect(body.selected).toBeUndefined();
    warnSpy.mockRestore();
  });

  it('passes through Python planner runtime error classification', async () => {
    const pythonPayload = {
      selected: [],
      rationale: 'Python orchestrate.plan could not produce a planner result.',
      source: 'python-rag',
      converged: false,
      degraded: true,
      error: 'planner_error',
      reason: 'runtime_error',
      message: 'planner exploded while ranking candidates',
      fallbackAvailable: false,
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.error).toBe('planner_error');
    expect(body.reason).toBe('runtime_error');
    expect(body.reason).not.toBe('no_api_key');
    expect(body.fallbackAvailable).toBe(false);
  });

  it('passes through Python planner config-missing classification separately', async () => {
    const pythonPayload = {
      selected: [],
      rationale: 'Python orchestrate.plan could not produce a planner result.',
      source: 'python-rag',
      converged: false,
      degraded: true,
      error: 'planner_config_missing',
      reason: 'config_missing',
      message: 'LLM not configured (no api_key)',
      fallbackAvailable: false,
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.error).toBe('planner_config_missing');
    expect(body.reason).toBe('config_missing');
    expect(body.fallbackAvailable).toBe(false);
  });

  it('accepts the shared golden Python plan fixture shape', async () => {
    const pythonPayload = {
      selected: goldenFixture.expected.requiredCapabilityIds.map((capabilityId: string) => ({
        capabilityId,
        roleId: 'grounding',
        why: 'Golden fixture capability',
      })),
      rationale: 'Golden fixture plan',
      source: goldenFixture.expected.source,
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...planRequestBody,
        state: goldenFixture.request.state,
        turnId: goldenFixture.request.turnId,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('python-rag');
    for (const key of goldenFixture.expected.forbiddenTopLevelKeys) {
      expect(body[key]).toBeUndefined();
    }
    for (const capId of goldenFixture.expected.requiredCapabilityIds) {
      expect(body.selected.some((item: any) => item.capabilityId === capId)).toBe(true);
    }
  });
});
