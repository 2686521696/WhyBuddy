import type { AddressInfo } from 'node:net';

import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTaskRouter } from '../routes/tasks.js';
import { MissionRuntime } from '../tasks/mission-runtime.js';
import { MissionStore } from '../tasks/mission-store.js';

async function startServer(
  runtime: MissionRuntime,
  fetchImpl?: typeof fetch,
  schedulerBaseUrl?: string,
) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/tasks',
    createTaskRouter(runtime, {
      fetchImpl,
      taskSchedulerRuntimeTakeoverBaseUrl: schedulerBaseUrl,
    }),
  );

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const { port } = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
  };
}

describe('task scheduler runtime takeover 104 - Node boundary safety', () => {
  let runtime: MissionRuntime;
  let server: ReturnType<express.Express['listen']> | null = null;
  let baseUrl = '';

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  beforeEach(() => {
    runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });
  });

  it('cancel behavior remains safe when Python scheduler decision slice is consulted (cancelled)', async () => {
    const mission = runtime.createChatTask('Scheduler cancel safety');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 10);

    const pythonDecision = {
      decision: 'cancelled',
      action: 'no-op',
      owner: 'python-slice',
      note: 'node retains full cancel semantics and scheduler ownership',
      denominator: 'decision-slice-only',
    };

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(pythonDecision), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const started = await startServer(runtime, fetchImpl as any, 'http://python-slice.test');
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'Scheduler slice test cancel', requestedBy: 'tester' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.task?.status).toBe('cancelled');
    expect(body.task?.cancelReason).toBe('Scheduler slice test cancel');
    // Proof that scheduler slice was bridged (response includes it or was called)
    // Even if python returned cancelled decision, Node still performed the cancel
    expect(body.schedulerRuntimeTakeover || body.task).toBeTruthy();
    // Call happened for scheduler slice
    const calledScheduler = fetchImpl.mock.calls.some((c: any) =>
      String(c[0]).includes('/scheduler/runtime-takeover'),
    );
    expect(calledScheduler).toBe(true);
  });

  it('retry behavior remains safe with Python scheduler decision slice', async () => {
    const mission = runtime.createChatTask('Scheduler retry safety');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 5);
    runtime.failMission(mission.id, 'transient failure for retry test');

    const pythonRetryDecision = {
      decision: 'retry',
      action: 'schedule_retry',
      owner: 'python-slice',
      retries: 1,
      note: 'python computes retry decision (slice); node owns scheduling',
      denominator: 'decision-slice-only',
    };

    const fetchImpl = vi.fn(async (input: any) => {
      if (String(input).includes('/scheduler/runtime-takeover')) {
        return new Response(JSON.stringify(pythonRetryDecision), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      // For other calls like dispatch etc, simulate ok but no real effect in unit
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const started = await startServer(runtime, fetchImpl as any, 'http://python-slice.test');
    server = started.server;
    baseUrl = started.baseUrl;

    const response = await fetch(`${baseUrl}/api/tasks/${mission.id}/operator-actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'retry', detail: 'retry via slice test' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok || body.action).toBeTruthy();
    // Scheduler slice was invoked for retry path
    const schedulerCalls = fetchImpl.mock.calls.filter((c: any) =>
      String(c[0]).includes('scheduler/runtime-takeover'),
    );
    expect(schedulerCalls.length).toBeGreaterThan(0);
  });

  it('replay behavior remains safe alongside scheduler decision slice', async () => {
    const mission = runtime.createChatTask('Scheduler replay safety');
    runtime.markMissionRunning(mission.id, 'execute', 'Running', 3);

    // Direct runtime replay apply (Node path) must remain safe regardless of slice
    const result = runtime.applyEventReplayResult(mission.id, {
      ok: true,
      task: { status: 'running' },
      replay: { seq: 1 },
      metadata: { source: 'test' },
    });

    expect(result?.id).toBe(mission.id);
    expect(result?.status).toBe('running');

    // Python decision for replay state (via mock)
    const pythonReplayDecision = {
      decision: 'replay_safe',
      action: 'consult',
      owner: 'python-slice',
      note: 'python slice for replay decision only',
      denominator: 'decision-slice-only',
    };

    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(pythonReplayDecision), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const started = await startServer(runtime, fetchImpl as any, 'http://python-slice.test');
    server = started.server;
    baseUrl = started.baseUrl;

    // Trigger a cancel (or any) to force slice consult in route while replay state was applied
    const cancelResp = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'replay safety', requestedBy: 'replay-tester' }),
    });
    expect(cancelResp.status).toBe(200);
    const body = await cancelResp.json();
    expect(body.task?.status).toBe('cancelled');
    // Replay applied earlier did not corrupt cancel semantics
  });

  it('scheduler decision slice is denominator only - does not own full scheduler', async () => {
    // This test exercises realistic mission state decision computation boundary via route
    const mission = runtime.createChatTask('Denominator evidence');
    runtime.markMissionRunning(mission.id, 'execute', 'Running');

    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          decision: 'continue',
          action: 'keep',
          owner: 'python-slice',
          note: 'python decision slice only - node retains full scheduler responsibilities',
          denominator: 'decision-slice-only',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const started = await startServer(runtime, fetchImpl as any, 'http://python-slice.test');
    server = started.server;
    baseUrl = started.baseUrl;

    const resp = await fetch(`${baseUrl}/api/tasks/${mission.id}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'denom', requestedBy: 'd' }),
    });
    const body = await resp.json();
    expect(resp.status).toBe(200);
    expect(body.task).toBeTruthy();
    // Evidence that slice did not replace Node scheduler: cancel still executed by runtime
    expect(body.task.status).toBe('cancelled');
  });
});
