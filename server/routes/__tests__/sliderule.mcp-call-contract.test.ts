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

const mcpRequestBody = {
  capabilityId: 'mcp.call',
  state: {
    sessionId: 't-mcp-proxy',
    goal: { text: 'Call a tool for migration evidence' },
    artifacts: [],
  },
  inputArtifactIds: ['goal-1'],
  roleId: 'grounding',
  turnId: 't-mcp-proxy',
};

describe('mcp.call Node -> Python proxy contract', () => {
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

  it('passes through fallback provenance without claiming real MCP runtime', async () => {
    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    const pythonPayload = {
      title: 'mcp.call via stable RAG',
      summary: 'Fallback evidence, not a real MCP tool call',
      content: 'Keyword evidence only',
      provenance: 'python-rag',
      toolName: 'mcp.call',
      sources: [{ title: 'Stub knowledge', provenance: 'fallback' }],
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.provenance).toBe('python-rag');
    expect(body.provenance).not.toMatch(/^mcp:/);
    expect(body.toolName).toBe('mcp.call');
    expect(body.serverId).toBeUndefined();
    expect(body.toolResult).toBeUndefined();
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
  });

  it('passes through fake MCP runtime provenance without claiming production mcp:*', async () => {
    const primarySpy = vi.spyOn(llmClient, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm, 'callPoolJsonLlm');
    const pythonPayload = {
      title: 'mcp.call search',
      summary: 'Fake MCP adapter returned a deterministic tool result',
      content: 'fixture hit for migration boundaries',
      provenance: 'python-fake-mcp',
      degraded: false,
      toolName: 'search',
      serverId: 'fake-server',
      arguments: { query: 'migration boundaries' },
      toolResult: { hits: ['doc-runtime-1'], serverId: 'fake-server' },
      sources: [],
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);
    expect(body.provenance).toBe('python-fake-mcp');
    expect(body.provenance).not.toBe('python-rag');
    expect(body.provenance).not.toMatch(/^mcp:/);
    expect(body.toolResult).toEqual({
      hits: ['doc-runtime-1'],
      serverId: 'fake-server',
    });
    expect(primarySpy).not.toHaveBeenCalled();
    expect(poolSpy).not.toHaveBeenCalled();
  });

  it('returns explicit degraded 502 when Python delegation fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    pythonDelegation.callPythonSlideRule.mockRejectedValueOnce(new Error('connection refused'));

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcpRequestBody),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.provenance).toBe('python-delegated-failed');
    expect(body.error).toBe('python_unavailable');
    expect(body.provenance).not.toMatch(/^mcp:/);
    warnSpy.mockRestore();
  });
});
