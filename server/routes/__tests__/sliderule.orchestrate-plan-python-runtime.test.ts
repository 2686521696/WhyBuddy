import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';

const INTERNAL_KEY = 'dev-slide-rule-internal';

type RuntimeCall = {
  path: string;
  body: any;
  internalKey: string | undefined;
};

async function closeServer(server: Server | undefined) {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('server did not expose a TCP address');
  }
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

async function startPythonRuntime(status = 200): Promise<{
  server: Server;
  baseUrl: string;
  calls: RuntimeCall[];
}> {
  const calls: RuntimeCall[] = [];
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.post('/api/sliderule/orchestrate-plan', (req, res) => {
    calls.push({
      path: req.path,
      body: req.body,
      internalKey: req.header('X-Internal-Key'),
    });

    if (req.header('X-Internal-Key') !== INTERNAL_KEY) {
      res.status(403).json({ error: 'invalid internal key' });
      return;
    }

    if (status !== 200) {
      res.status(status).json({ error: 'planner runtime unavailable' });
      return;
    }

    res.json({
      selected: [
        {
          capabilityId: 'evidence.search',
          roleId: 'grounding',
          why: 'Python runtime received the orchestrate.plan request',
        },
      ],
      rationale: `Runtime planned for: ${req.body.userText}`,
      source: 'python-rag',
      converged: false,
    });
  });

  app.post('/api/sliderule/execute-capability', (_req, res) => {
    res.status(418).json({ error: 'orchestrate.plan used the wrong Python endpoint' });
  });

  const server = await listen(app);
  return { ...server, calls };
}

async function startNodeRouter(pythonBaseUrl: string): Promise<{ server: Server; baseUrl: string }> {
  vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
  vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', pythonBaseUrl);
  vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', INTERNAL_KEY);
  vi.stubEnv('PYTHON_SLIDE_RULE_TIMEOUT_MS', '5000');

  const { default: slideruleRouter } = await import('../sliderule.js');
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/sliderule', slideruleRouter);
  return listen(app);
}

function planRequest(userText = 'Use explicit runtime user text for Python planning.') {
  return {
    capabilityId: 'orchestrate.plan',
    state: {
      sessionId: 'node-to-python-orch-runtime',
      goal: { text: 'Fallback goal text should not replace explicit userText.' },
      artifacts: [],
      capabilityRuns: [],
    },
    inputArtifactIds: [],
    roleId: 'planner',
    turnId: 'turn-node-to-python-orch-runtime',
    userText,
  };
}

describe('orchestrate.plan Python runtime route', () => {
  let pythonRuntime: { server: Server; baseUrl: string; calls: RuntimeCall[] } | undefined;
  let nodeRouter: { server: Server; baseUrl: string } | undefined;

  afterEach(async () => {
    await closeServer(nodeRouter?.server);
    await closeServer(pythonRuntime?.server);
    nodeRouter = undefined;
    pythonRuntime = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('delegates orchestrate.plan through the real Node -> Python HTTP route', async () => {
    pythonRuntime = await startPythonRuntime();
    nodeRouter = await startNodeRouter(pythonRuntime.baseUrl);

    const llmClient = await import('../../core/llm-client.js');
    const poolJsonLlm = await import('../../sliderule/pool-json-llm.js');
    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    const explicitUserText = 'Use explicit runtime user text for Python planning.';

    const response = await fetch(`${nodeRouter.baseUrl}/api/sliderule/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequest(explicitUserText)),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      selected: [
        {
          capabilityId: 'evidence.search',
          roleId: 'grounding',
          why: 'Python runtime received the orchestrate.plan request',
        },
      ],
      rationale: `Runtime planned for: ${explicitUserText}`,
      source: 'python-rag',
      converged: false,
    });

    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
    expect(pythonRuntime.calls).toHaveLength(1);
    expect(pythonRuntime.calls[0]).toEqual({
      path: '/api/sliderule/orchestrate-plan',
      internalKey: INTERNAL_KEY,
      body: expect.objectContaining({
        capabilityId: 'orchestrate.plan',
        inputArtifactIds: [],
        roleId: 'planner',
        turnId: 'turn-node-to-python-orch-runtime',
        userText: explicitUserText,
        state: expect.objectContaining({
          sessionId: 'node-to-python-orch-runtime',
        }),
      }),
    });
  });

  it('keeps explicit delegated-failed semantics when the Python route returns an error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pythonRuntime = await startPythonRuntime(503);
    nodeRouter = await startNodeRouter(pythonRuntime.baseUrl);

    const response = await fetch(`${nodeRouter.baseUrl}/api/sliderule/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequest()),
    });

    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        degraded: true,
        provenance: 'python-delegated-failed',
        error: 'python_unavailable',
      }),
    );
    expect(body.selected).toBeUndefined();
    expect(body.reason).not.toBe('no_api_key');
    expect(pythonRuntime.calls).toHaveLength(1);
    expect(pythonRuntime.calls[0].path).toBe('/api/sliderule/orchestrate-plan');
    warnSpy.mockRestore();
  });
});
