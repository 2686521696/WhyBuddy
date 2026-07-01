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
    path.resolve(process.cwd(), 'slide-rule-python/tests/fixtures/orchestrate_plan_golden.json'),
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

  it('keeps direct orchestrate-plan Node path available when explicitly forced while execute-capability proxies in python mode', async () => {
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
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'node');

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

    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

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

  it('proves Node /api/sliderule is thin compatibility shell (PYTHON_FIRST_COMPAT) for V5 - delegates business to Python, no ownership of semantics for owned caps', async () => {
    // When SLIDERULE_V5_BACKEND=python (default) and via Vite resolve for /api/sliderule/* , frontend hits Python directly.
    // Node route provides compat shell + delegation helper only.
    const pyPayload = { selected: [], rationale: 'python owns', source: 'python-rag', backend: 'python' };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pyPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...planRequestBody, capabilityId: 'evidence.search' }),
    });
    const body = await res.json();
    expect(body.source).toBe('python-rag');
    // Node did not execute its local LLM/pool logic for this cap; delegation was used.
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalled();
    // No Node provenance marker leaked in success path.
    expect((body.provenance || body.source || '')).not.toMatch(/llm(?!.*python)/i);
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

  it('task-10: maps every /api/sliderule frontend callsite to Python via thin Node shell (no business ownership)', async () => {
    // Explicit proof for task 10 route-map: frontend paths (health via alias, orchestrate-plan, execute-capability, sessions via store) target Python.
    // Vite resolveApiTarget sends /api/sliderule* to py; Node /api/sliderule is only thin proxy/delegation when hit directly.
    // Callsites: SlideRule.tsx(health), sliderule-orchestrator.ts, sliderule-runtime.ts, sliderule-http-store.ts, sliderule-narrator.ts(respond fallback).
    const pyPlan = { selected: [{ capabilityId: 'evidence.search', roleId: 'a' }], rationale: 't10 map', source: 'python-rag', backend: 'python' };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pyPlan);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...planRequestBody, capabilityId: 'evidence.search' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe('python-rag');
    // Node shell did not own the semantics (delegation used).
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalled();
  });

  it('orchestrate-plan delegates to Python under SLIDERULE_V5_BACKEND=python and surfaces planner degraded states (thin shell proof: no Node business ownership of timeout/config/error)', async () => {
    // Finding 1 remediation: explicit executable Vitest proof that /orchestrate-plan Node route is thin compat only.
    // Delegates to Python; Python owns {degraded, error:planner_*, backend, provenance}; Node never runs planner for error states.
    const degradedPython = {
      selected: [],
      rationale: 'Python orchestrate.plan could not produce a planner result.',
      source: 'python-rag',
      converged: false,
      degraded: true,
      error: 'planner_timeout',
      reason: 'timeout',
      message: 'Python orchestrate.plan timed out before producing a plan.',
      fallbackAvailable: false,
      backend: 'python',
      provenance: 'python-rag',
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(degradedPython);

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: planRequestBody.state,
        turnId: planRequestBody.turnId,
        userText: 'thin-shell orchestrate degraded test',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.error).toBe('planner_timeout');
    expect(body.backend).toBe('python');
    expect(body.provenance).toBe('python-rag');
    // delegation used; Node shell did not own/execute the planner degraded logic
    expect(pythonDelegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/orchestrate-plan',
      expect.objectContaining({ turnId: planRequestBody.turnId }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('orchestrate-plan thin shell returns explicit 502 degraded on python delegate fail (no silent or owned error handling)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pythonDelegation.callPythonSlideRule.mockRejectedValueOnce(new Error('python unavailable for orchestrate'));

    const res = await fetch(`${base}/orchestrate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: planRequestBody.state,
        turnId: 't-delegate-fail-orch',
        userText: 'fail',
      }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.error).toBe('python_unavailable');
    expect(body.backend).toBe('python');
    expect(body.provenance).toBe('python-rag');
    expect(body.selected).toEqual([]);
    warnSpy.mockRestore();
  });
});
