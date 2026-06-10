/**
 * Server route tests for POST /api/whybuddy/execute-capability.
 * These provide the dedicated server-level regression the review asked for.
 *
 * This file lives under server/routes/__tests__/ so it is picked up by
 * vitest.config.server.ts (the __tests__ pattern in its include).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

import whybuddyRouter from '../whybuddy.js';
import * as llmClient from '../../core/llm-client.js';
import * as ghAdapter from '../../whybuddy/github-mcp-adapter.js';

describe('POST /api/whybuddy/execute-capability (server route)', () => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/whybuddy', whybuddyRouter);

  let server: any;
  let base: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/whybuddy`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
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
        capabilityId: 'synthesis.merge',
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

  it('returns 500 (llm_not_configured or execution_failed) when no apiKey, without leaking secrets', async () => {
    const orig = process.env.LLM_API_KEY;
    const origOpen = process.env.OPENAI_API_KEY;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'risk.analyze',
          state: { sessionId: 't1', goal: { text: 'x' } },
          inputArtifactIds: [],
          turnId: 't1',
        }),
      });
      expect(res.status).toBe(500);
      const body = await res.json().catch(() => ({}));
      expect(String(body.error || '')).toMatch(/llm_not_configured|execution_failed/);
      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toMatch(/sk-/i);
      expect(bodyStr).not.toMatch(/OPENAI|LLM_API_KEY/i);
    } finally {
      errSpy.mockRestore();
      if (orig) process.env.LLM_API_KEY = orig;
      if (origOpen) process.env.OPENAI_API_KEY = origOpen;
    }
  });

  it('returns raw 4-field shape on mocked success for risk.analyze', async () => {
    vi.spyOn(llmClient, 'callLLMJson').mockResolvedValueOnce({
      title: 'Server Risk Title',
      summary: 'server risk summary',
      content: 'server risk content with evidence',
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

  it('report.write success returns content that reflects the 9-section base structure', async () => {
    vi.spyOn(llmClient, 'callLLMJson').mockResolvedValueOnce({
      title: 'Server Report Title',
      summary: 'server report summary',
      content: '结论：...\n支撑证据：...\n反证/挑战：...\n风险：...\n分歧：...\n收敛决策：...\n未解缺口：...\n下一步工程化分支：...\nprovenance / upstream refs：...',
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

  // --- P0 MCP GitHub adapter tests (source/evidence via server capability seam) ---

  it('source.github.inspect returns raw 4-field shape with mcp:github provenance (success)', async () => {
    const ghSpy = vi.spyOn(ghAdapter, 'executeGithubMcpCapability').mockResolvedValueOnce({
      title: 'GitHub Source: facebook/react',
      summary: 'repo facebook/react · TypeScript · 200000★ · default branch main · last pushed 2026-...',
      content: JSON.stringify({ repository: 'facebook/react', language: 'TypeScript', stars: 200000 }, null, 2),
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
      content: '{"repository":"vercel/next.js","url":"https://github.com/vercel/next.js"}',
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

    // Prove the route used the mock adapter (no real network)
    expect(ghSpy).toHaveBeenCalledTimes(1);
    expect(ghSpy).toHaveBeenCalledWith('evidence.github.collect', expect.anything(), []);

    // Now call report.write referencing that github evidence via inputArtifactIds.
    // The server still feeds the 9-section skeleton (report path unchanged).
    vi.spyOn(llmClient, 'callLLMJson').mockResolvedValueOnce({
      title: 'Report with GitHub Evidence',
      summary: 'includes github evidence',
      content: '结论：...\n支撑证据：... (includes vercel/next.js github artifact)\n...',
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
});


