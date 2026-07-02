import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

vi.mock('../../sliderule/python-delegation.js', () => ({
  callPythonSlideRule: vi.fn(),
  callPythonSlideRuleGet: vi.fn(),
  delegateToPythonSlideRule: vi.fn(),
  checkPythonSlideRuleHealth: vi.fn(async () => ({ ok: true, url: 'http://localhost:9700/health', backend: 'python' })),
  resolvePythonSlideRuleRuntimeConfig: vi.fn(() => ({
    baseUrl: 'http://localhost:9700',
    internalKey: 'dev-slide-rule-internal',
    timeoutMs: 120000,
    healthPath: '/health',
    proxyMode: 'node-fetch-env',
  })),
}));

let slideruleRouter: any;
let routerModule: any;
let delegation: any;

describe('Node sliderule routes thin proxy (sessions CRUD + execute prove no business ownership)', () => {
  let app: any;
  let server: any;
  let base: string;

  beforeAll(async () => {
    routerModule = await import('../sliderule.js');
    slideruleRouter = routerModule.default;
    delegation = await import('../../sliderule/python-delegation.js');
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
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
    if (server) {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it('exports thin delegation helpers (sessions/execute use proxy)', () => {
    expect(typeof slideruleRouter).not.toBe('undefined');
    expect(typeof routerModule.callPythonSlideRuleGet).toBe('function');
    expect(typeof routerModule.delegateToPythonSlideRule).toBe('function');
  });

  it('GET /sessions hits real route handler and delegates via callPythonSlideRuleGet (proves no local Map/persist)', async () => {
    const mockList = { sessions: [{ sessionId: 's-list-1', goal: 'thin-test' }] };
    (delegation.callPythonSlideRuleGet as any).mockResolvedValueOnce(mockList);

    const res = await fetch(`${base}/sessions`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockList);
    expect(delegation.callPythonSlideRuleGet).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/sessions',
      expect.any(String),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it('GET /sessions/:id hits real route handler and delegates via callPythonSlideRuleGet (no local lookup)', async () => {
    const mockSess = { state: { sessionId: 's-get-1' }, backend: 'python' };
    (delegation.callPythonSlideRuleGet as any).mockResolvedValueOnce(mockSess);

    const res = await fetch(`${base}/sessions/s-get-1`, { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockSess);
    expect(delegation.callPythonSlideRuleGet).toHaveBeenCalled();
  });

  it('PUT /sessions/:id + DELETE hit real route handlers and delegateToPythonSlideRule (no sanitize/replay/strip/persist in Node)', async () => {
    (delegation.delegateToPythonSlideRule as any).mockResolvedValueOnce({ ok: true, backend: 'python' });
    (delegation.delegateToPythonSlideRule as any).mockResolvedValueOnce({ ok: true, backend: 'python' });

    const putRes = await fetch(`${base}/sessions/s-put-1`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 's-put-1', goal: { text: 'p' } }),
    });
    expect(putRes.status).toBe(200);
    const putBody = await putRes.json();
    expect(putBody.ok).toBe(true);

    const delRes = await fetch(`${base}/sessions/s-put-1`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);

    expect(delegation.delegateToPythonSlideRule).toHaveBeenCalledTimes(2);
    expect(delegation.delegateToPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/sessions/s-put-1',
      'PUT',
      expect.objectContaining({ sessionId: 's-put-1' }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('execute-capability for V5 cap under python hits real route + delegates via callPythonSlideRule (legacy paths unreachable)', async () => {
    const pyResp = { title: 'r', summary: 's', content: 'c', provenance: 'python-rag', backend: 'python' };
    (delegation.callPythonSlideRule as any).mockResolvedValueOnce(pyResp);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilityId: 'report.write', turnId: 't1', state: { sessionId: 'sx', goal: { text: 'x' }, artifacts: [], capabilityRuns: [] } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pyResp);
    expect(delegation.callPythonSlideRule).toHaveBeenCalledWith(
      expect.stringContaining('localhost:9700'),
      '/api/sliderule/execute-capability',
      expect.objectContaining({ capabilityId: 'report.write' }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it('under python default, sessions routes return 502 on delegation failure (explicit, no local fallback)', async () => {
    (delegation.callPythonSlideRuleGet as any).mockRejectedValueOnce(new Error('conn refused'));
    const res = await fetch(`${base}/sessions`, { method: 'GET' });
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('python_unavailable');
    expect(body.backend).toBe('python');
  });
});
