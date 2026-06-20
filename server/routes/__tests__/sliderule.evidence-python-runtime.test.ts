/**
 * Runtime wiring tests for evidence.search in Python backend mode.
 *
 * These use a real local HTTP server as the Python runtime target. The
 * delegation helper is not mocked here, so the test proves Node performs the
 * Node -> Python runtime call instead of falling back to the old Node-only
 * evidence path.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';

import * as llmClient from '../../core/llm-client.js';
import * as poolJsonLlm from '../../sliderule/pool-json-llm.js';
import { withStubbedLlmKey } from './helpers/with-stubbed-llm-key.js';

let slideruleRouter: any;

type CapturedPythonRequest = {
  path: string;
  internalKey: string | undefined;
  body: any;
};

const evidenceRequestBody = {
  capabilityId: 'evidence.search',
  state: {
    sessionId: 't-evidence-runtime',
    goal: { text: 'Find evidence for table progression pacing' },
    artifacts: [],
  },
  inputArtifactIds: ['goal-1'],
  roleId: 'grounding',
  turnId: 't-evidence-runtime',
};

async function listen(app: any): Promise<{ server: Server; base: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function startNodeRoute(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/sliderule', slideruleRouter);
  return listen(app);
}

async function startPythonRuntime(payload: unknown, status = 200) {
  const captured: CapturedPythonRequest[] = [];
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.post('/api/sliderule/execute-capability', (req, res) => {
    captured.push({
      path: req.path,
      internalKey: req.header('X-Internal-Key'),
      body: req.body,
    });
    res.status(status).json(payload);
  });
  const runtime = await listen(app);
  return { ...runtime, captured };
}

describe('evidence.search Node -> Python runtime wiring', () => {
  let nodeServer: Server | undefined;
  let pythonServer: Server | undefined;
  let nodeBase = '';
  let restoreLlmKey: (() => void) | undefined;

  beforeAll(async () => {
    const routerModule = await import('../sliderule.js');
    slideruleRouter = routerModule.default;
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    ({ restore: restoreLlmKey } = withStubbedLlmKey());
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', 'runtime-test-key');
  });

  afterEach(async () => {
    await closeServer(nodeServer);
    await closeServer(pythonServer);
    nodeServer = undefined;
    pythonServer = undefined;
    nodeBase = '';
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    poolJsonLlm.resetSlideRuleCapabilityPoolCache();
    restoreLlmKey?.();
  });

  it('calls the Python evidence runtime and passes through retrieved provenance', async () => {
    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    const pythonPayload = {
      title: 'Evidence search',
      summary: 'Retrieved grounding references',
      content: '## Grounding references\n- table assignment evidence from playtests',
      provenance: 'python-llm',
      model: 'runtime-fake-python-model',
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
    const runtime = await startPythonRuntime(pythonPayload);
    pythonServer = runtime.server;
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', runtime.base);
    const node = await startNodeRoute();
    nodeServer = node.server;
    nodeBase = `${node.base}/api/sliderule`;

    const res = await fetch(`${nodeBase}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidenceRequestBody),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(pythonPayload);
    expect(runtime.captured).toHaveLength(1);
    expect(runtime.captured[0]).toEqual(
      expect.objectContaining({
        path: '/api/sliderule/execute-capability',
        internalKey: 'runtime-test-key',
        body: expect.objectContaining({
          capabilityId: 'evidence.search',
          roleId: 'grounding',
          turnId: 't-evidence-runtime',
          userText: 'Find evidence for table progression pacing',
        }),
      }),
    );
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
  });

  it('passes through Python fallback provenance without upgrading it to retrieved', async () => {
    const pythonPayload = {
      title: 'Evidence search',
      summary: 'No vector-backed hits',
      content: '## Grounding references\n- fallback only',
      provenance: 'python-llm',
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
    const runtime = await startPythonRuntime(pythonPayload);
    pythonServer = runtime.server;
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', runtime.base);
    const node = await startNodeRoute();
    nodeServer = node.server;
    nodeBase = `${node.base}/api/sliderule`;

    const res = await fetch(`${nodeBase}/execute-capability`, {
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
    expect(body.evidenceProvenance).not.toBe('retrieved');
    expect(runtime.captured).toHaveLength(1);
  });

  it('passes through Python degraded evidence error shape when runtime returns one', async () => {
    const pythonPayload = {
      title: 'Evidence search',
      summary: 'Evidence runtime degraded',
      content: '## Grounding references\n- runtime failure, no fake sources',
      provenance: 'python-llm',
      evidenceProvenance: 'degraded',
      fallbackReason: 'embedding_timeout; query=table progression',
      error: 'retrieval_runtime_failed',
      sources: [],
    };
    const runtime = await startPythonRuntime(pythonPayload);
    pythonServer = runtime.server;
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', runtime.base);
    const node = await startNodeRoute();
    nodeServer = node.server;
    nodeBase = `${node.base}/api/sliderule`;

    const res = await fetch(`${nodeBase}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evidenceRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.evidenceProvenance).toBe('degraded');
    expect(body.error).toBe('retrieval_runtime_failed');
    expect(body.sources).toEqual([]);
    expect(runtime.captured).toHaveLength(1);
  });

  it('returns explicit 502 when the Python runtime is unavailable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unavailable = await listen(express());
    await closeServer(unavailable.server);
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', unavailable.base);
    const node = await startNodeRoute();
    nodeServer = node.server;
    nodeBase = `${node.base}/api/sliderule`;

    const res = await fetch(`${nodeBase}/execute-capability`, {
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
