/**
 * Dedicated live tests for true Node thin proxy -> Python delegation.
 *
 * These are intentionally in a separate file (no top-level delegation mock)
 * so the main sliderule.execute-capability.test.ts (17/0 mocked contract) remains
 * completely stable and fast.
 *
 * Prerequisites:
 *   1. Start the Python service: cd tws-ai-slide-rule-python && .\.venv\Scripts\python -m uvicorn app:app --port 9700
 *   2. Run with the flag: LIVE_NODE_TO_PYTHON_SLIDERULE=1 pnpm exec vitest run --config vitest.config.server.ts server/routes/__tests__/sliderule.live-delegation.test.ts --reporter=dot
 *
 * What it verifies (per audit):
 *   - SLIDERULE_V5_BACKEND=python
 *   - Real POST to the Node /api/sliderule/execute-capability
 *   - Goes through the real callPythonSlideRule (no mock)
 *   - Node returns Python provenance + non-template content
 *   - No Node LLM / pool code paths were exercised
 */

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

const LIVE_FLAG = 'LIVE_NODE_TO_PYTHON_SLIDERULE';
const PYTHON_BASE_URL = process.env.PYTHON_SLIDE_RULE_BASE_URL || 'http://localhost:9700';

describe.runIf(process.env[LIVE_FLAG] === '1')('live Node->Python delegation (real router + real :9700)', () => {
  it('report.write returns python-llm + V5 sections via real Node delegation (no Node LLM/pool)', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE_URL);
    vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', 'dev-slide-rule-internal');

    // Fresh import of the router in this file's context (no delegation mock declared here)
    // The router will see SLIDERULE_V5_BACKEND=python and use the real callPythonSlideRule.
    const { default: liveRouter } = await import('../sliderule.js');

    // Spy on Node LLM/pool to prove delegation skipped them
    const llmClient = await import('../../core/llm-client.js');
    const poolJsonLlm = await import('../../sliderule/pool-json-llm.js');
    const primarySpy = vi.spyOn(llmClient as any, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm as any, 'callPoolJsonLlm');

    const liveApp = express();
    liveApp.use(express.json({ limit: '2mb' }));
    liveApp.use('/api/sliderule', liveRouter);

    const liveSrv = createServer(liveApp);
    await new Promise<void>((resolve) => liveSrv.listen(0, resolve));
    const addr: any = liveSrv.address();
    const port = addr?.port || 0;
    const base = `http://127.0.0.1:${port}/api/sliderule`;

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'report.write',
          state: { sessionId: 'live-delegation', goal: { text: '权限系统 RBAC 审计' } },
          inputArtifactIds: [],
          turnId: 'live-delegation-report',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.provenance).toBe('python-llm');
      expect((body.content || '').length).toBeGreaterThan(80);
      expect(String(body.content || '')).toMatch(/结论|支撑证据|风险|收敛决策/);
      expect(String(body.content || '')).not.toMatch(/Capability .* completed with RAG evidence/i);

      // Real delegation path taken; Node-side LLM/pool never called
      expect(primarySpy).not.toHaveBeenCalled();
      expect(poolSpy).not.toHaveBeenCalled();
    } finally {
      liveSrv.close();
    }
  }, 60000);

  it('structure.decompose also works end-to-end through Node delegation', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE_URL);
    vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', 'dev-slide-rule-internal');

    const { default: liveRouter } = await import('../sliderule.js');

    const llmClient = await import('../../core/llm-client.js');
    const poolJsonLlm = await import('../../sliderule/pool-json-llm.js');
    const primarySpy = vi.spyOn(llmClient as any, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm as any, 'callPoolJsonLlm');

    const liveApp = express();
    liveApp.use(express.json({ limit: '2mb' }));
    liveApp.use('/api/sliderule', liveRouter);

    const liveSrv = createServer(liveApp);
    await new Promise<void>((resolve) => liveSrv.listen(0, resolve));
    const addr: any = liveSrv.address();
    const port = addr?.port || 0;
    const base = `http://127.0.0.1:${port}/api/sliderule`;

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'structure.decompose',
          state: { sessionId: 'live-delegation-struct', goal: { text: '设计权限矩阵' } },
          inputArtifactIds: [],
          turnId: 'live-delegation-struct',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.provenance).toMatch(/^python-/);
      expect(Array.isArray(body.sources) && body.sources.length > 0).toBe(true);

      expect(primarySpy).not.toHaveBeenCalled();
      expect(poolSpy).not.toHaveBeenCalled();
    } finally {
      liveSrv.close();
    }
  }, 60000);  // generous timeout for live RAG on structure.decompose

  it('intent.clarify also works end-to-end through Node delegation', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE_URL);
    vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', 'dev-slide-rule-internal');

    const { default: liveRouter } = await import('../sliderule.js');

    const llmClient = await import('../../core/llm-client.js');
    const poolJsonLlm = await import('../../sliderule/pool-json-llm.js');
    const primarySpy = vi.spyOn(llmClient as any, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm as any, 'callPoolJsonLlm');

    const liveApp = express();
    liveApp.use(express.json({ limit: '2mb' }));
    liveApp.use('/api/sliderule', liveRouter);

    const liveSrv = createServer(liveApp);
    await new Promise<void>((resolve) => liveSrv.listen(0, resolve));
    const addr: any = liveSrv.address();
    const port = addr?.port || 0;
    const base = `http://127.0.0.1:${port}/api/sliderule`;

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'intent.clarify',
          state: { sessionId: 'live-delegation-intent', goal: { text: '澄清 RBAC 权限工作流的验收边界' } },
          inputArtifactIds: [],
          turnId: 'live-delegation-intent',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.provenance).toMatch(/^python-/);
      expect((body.content || '').length).toBeGreaterThan(80);

      expect(primarySpy).not.toHaveBeenCalled();
      expect(poolSpy).not.toHaveBeenCalled();
    } finally {
      liveSrv.close();
    }
  }, 60000);

  it('gap.ask also works end-to-end through Node delegation', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE_URL);
    vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', 'dev-slide-rule-internal');

    const { default: liveRouter } = await import('../sliderule.js');

    const llmClient = await import('../../core/llm-client.js');
    const poolJsonLlm = await import('../../sliderule/pool-json-llm.js');
    const primarySpy = vi.spyOn(llmClient as any, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm as any, 'callPoolJsonLlm');

    const liveApp = express();
    liveApp.use(express.json({ limit: '2mb' }));
    liveApp.use('/api/sliderule', liveRouter);

    const liveSrv = createServer(liveApp);
    await new Promise<void>((resolve) => liveSrv.listen(0, resolve));
    const addr: any = liveSrv.address();
    const port = addr?.port || 0;
    const base = `http://127.0.0.1:${port}/api/sliderule`;

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'gap.ask',
          state: { sessionId: 'live-delegation-gap', goal: { text: '澄清宠物方块办公室游戏的工位任务分配缺口' } },
          inputArtifactIds: [],
          turnId: 'live-delegation-gap',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.provenance).toMatch(/^python-/);
      expect((body.content || '').length).toBeGreaterThan(80);
      expect(String(body.content || '')).not.toMatch(/RBAC|data scoping/i);

      expect(primarySpy).not.toHaveBeenCalled();
      expect(poolSpy).not.toHaveBeenCalled();
    } finally {
      liveSrv.close();
    }
  }, 60000);

  it('question.expand also works end-to-end through Node delegation', async () => {
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE_URL);
    vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', 'dev-slide-rule-internal');

    const { default: liveRouter } = await import('../sliderule.js');

    const llmClient = await import('../../core/llm-client.js');
    const poolJsonLlm = await import('../../sliderule/pool-json-llm.js');
    const primarySpy = vi.spyOn(llmClient as any, 'callLLMJsonWithUsage');
    const poolSpy = vi.spyOn(poolJsonLlm as any, 'callPoolJsonLlm');

    const liveApp = express();
    liveApp.use(express.json({ limit: '2mb' }));
    liveApp.use('/api/sliderule', liveRouter);

    const liveSrv = createServer(liveApp);
    await new Promise<void>((resolve) => liveSrv.listen(0, resolve));
    const addr: any = liveSrv.address();
    const port = addr?.port || 0;
    const base = `http://127.0.0.1:${port}/api/sliderule`;

    try {
      const res = await fetch(`${base}/execute-capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capabilityId: 'question.expand',
          state: { sessionId: 'live-delegation-question', goal: { text: '扩展宠物方块办公室游戏的新手引导问题' } },
          inputArtifactIds: [],
          turnId: 'live-delegation-question',
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.provenance).toMatch(/^python-/);
      expect((body.content || '').length).toBeGreaterThan(80);
      expect(String(body.content || '')).not.toMatch(/RBAC|data scoping/i);

      expect(primarySpy).not.toHaveBeenCalled();
      expect(poolSpy).not.toHaveBeenCalled();
    } finally {
      liveSrv.close();
    }
  }, 60000);
});
