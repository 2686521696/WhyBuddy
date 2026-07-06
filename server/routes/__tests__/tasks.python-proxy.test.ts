/**
 * Node -> Python thin proxy for the mission-record CRUD core slice
 * (slide-rule-python routes/tasks.py) behind TASKS_PYTHON_PROXY (default ON,
 * vitest stays on the Node path unless the flag is explicitly "true").
 *
 * Style follows blueprint.review-export-python-proxy.test.ts: stub global
 * fetch, run the real router on a loopback server, assert delegation
 * url/headers/payload, business-4xx passthrough, infra-failure fallback to the
 * Node implementation, and flag-off Node path.
 */

import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTaskRouter } from '../tasks.js';
import { MissionRuntime } from '../../tasks/mission-runtime.js';
import { MissionStore } from '../../tasks/mission-store.js';

const PYTHON_BASE = 'http://python-tasks.test';
const INTERNAL_KEY = 'internal-tasks';

function makeRuntime(): MissionRuntime {
  return new MissionRuntime({ store: new MissionStore(), autoRecover: false });
}

async function withServer(
  runtime: MissionRuntime,
  handler: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/tasks', createTaskRouter(runtime));

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => (error ? reject(error) : resolve()));
  });
  const address = server.address() as AddressInfo;
  try {
    await handler(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function stubPythonFetch(
  reply: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const originalFetch = globalThis.fetch.bind(globalThis);
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('http://127.0.0.1:')) {
      return originalFetch(input as RequestInfo, init);
    }
    return reply(url, init as RequestInit);
  });
}

function pythonCalls(fetchSpy: ReturnType<typeof stubPythonFetch>) {
  return fetchSpy.mock.calls.filter(
    ([url]) => !String(url instanceof Request ? url.url : url).startsWith('http://127.0.0.1:'),
  );
}

describe('tasks Python thin proxy (TASKS_PYTHON_PROXY)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('delegates create/list/get/events/cancel to Python with the internal key when enabled', async () => {
    vi.stubEnv('TASKS_PYTHON_PROXY', 'true');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', `${PYTHON_BASE}/`);
    vi.stubEnv('PYTHON_SLIDE_RULE_INTERNAL_KEY', INTERNAL_KEY);

    const pyTask = {
      id: 'py-task-1',
      kind: 'chat',
      title: 'Python owned task',
      status: 'running',
    };
    const fetchSpy = stubPythonFetch(async (url, init) => {
      const method = init?.method ?? 'GET';
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      if (method === 'POST' && url === `${PYTHON_BASE}/api/tasks`) {
        return json({ ok: true, task: pyTask, lifecycle: { ok: true, action: 'create' } }, 201);
      }
      if (method === 'GET' && url === `${PYTHON_BASE}/api/tasks?limit=5`) {
        return json({ ok: true, tasks: [pyTask] });
      }
      if (method === 'GET' && url === `${PYTHON_BASE}/api/tasks/py-task-1`) {
        return json({ ok: true, task: pyTask });
      }
      if (method === 'GET' && url === `${PYTHON_BASE}/api/tasks/py-task-1/events?limit=3`) {
        return json({ ok: true, missionId: 'py-task-1', events: [{ type: 'log' }] });
      }
      if (method === 'POST' && url === `${PYTHON_BASE}/api/tasks/py-task-1/cancel`) {
        return json({
          ok: true,
          alreadyFinal: false,
          executorForwarded: false,
          task: { ...pyTask, status: 'cancelled' },
        });
      }
      throw new Error(`unexpected python call: ${method} ${url}`);
    });

    const runtime = makeRuntime();
    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Python owned task', sourceText: 'delegate me' }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Record<string, any>;
      expect(created.ok).toBe(true);
      expect(created.task.id).toBe('py-task-1');
      expect(created.lifecycle).toMatchObject({ ok: true, action: 'create' });

      const listResponse = await fetch(`${baseUrl}/api/tasks?limit=5`);
      expect(listResponse.status).toBe(200);
      expect(((await listResponse.json()) as Record<string, any>).tasks).toHaveLength(1);

      const getResponse = await fetch(`${baseUrl}/api/tasks/py-task-1`);
      expect(getResponse.status).toBe(200);
      expect(((await getResponse.json()) as Record<string, any>).task.id).toBe('py-task-1');

      const eventsResponse = await fetch(`${baseUrl}/api/tasks/py-task-1/events?limit=3`);
      expect(eventsResponse.status).toBe(200);
      expect(((await eventsResponse.json()) as Record<string, any>).missionId).toBe('py-task-1');

      const cancelResponse = await fetch(`${baseUrl}/api/tasks/py-task-1/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'user requested' }),
      });
      expect(cancelResponse.status).toBe(200);
      const cancelled = (await cancelResponse.json()) as Record<string, any>;
      expect(cancelled.task.status).toBe('cancelled');
      expect(cancelled.executorForwarded).toBe(false);
    });

    const calls = pythonCalls(fetchSpy);
    expect(calls).toHaveLength(5);
    for (const [, init] of calls) {
      expect((init as RequestInit).headers).toMatchObject({
        'X-Internal-Key': INTERNAL_KEY,
      });
    }
    const [createUrl, createInit] = calls[0];
    expect(String(createUrl)).toBe(`${PYTHON_BASE}/api/tasks`);
    expect(JSON.parse(String((createInit as RequestInit).body))).toMatchObject({
      title: 'Python owned task',
      sourceText: 'delegate me',
    });
    const [, cancelInit] = calls[4];
    expect(JSON.parse(String((cancelInit as RequestInit).body))).toMatchObject({
      reason: 'user requested',
    });

    // Node store never touched on the delegated path.
    expect(makeRuntimeTaskCount(runtime)).toBe(0);
  });

  it('passes Python business 404 responses through verbatim', async () => {
    vi.stubEnv('TASKS_PYTHON_PROXY', 'true');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE);
    stubPythonFetch(
      async () =>
        new Response(JSON.stringify({ error: 'Task not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    await withServer(makeRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tasks/missing-id`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'Task not found' });
    });
  });

  it('falls back to the Node implementation when Python is unreachable', async () => {
    vi.stubEnv('TASKS_PYTHON_PROXY', 'true');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE);
    stubPythonFetch(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:9700');
    });

    const runtime = makeRuntime();
    await withServer(runtime, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Node fallback task' }),
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as Record<string, any>;
      expect(created.ok).toBe(true);
      expect(created.task.title).toBe('Node fallback task');

      const listResponse = await fetch(`${baseUrl}/api/tasks`);
      const listed = (await listResponse.json()) as Record<string, any>;
      expect(listed.tasks).toHaveLength(1);
      expect(listed.tasks[0].id).toBe(created.task.id);
    });
    expect(makeRuntimeTaskCount(runtime)).toBe(1);
  });

  it('falls back to the Node implementation on Python 5xx', async () => {
    vi.stubEnv('TASKS_PYTHON_PROXY', 'true');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE);
    stubPythonFetch(
      async () =>
        new Response(JSON.stringify({ error: 'store failure' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const runtime = makeRuntime();
    runtime.createTask({ kind: 'chat', title: 'Node listed task' });
    await withServer(runtime, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tasks`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, any>;
      expect(body.ok).toBe(true);
      expect(body.tasks).toHaveLength(1);
      expect(body.tasks[0].title).toBe('Node listed task');
    });
  });

  it('keeps project-scoped creates on the Node path (project auth is Node-owned)', async () => {
    vi.stubEnv('TASKS_PYTHON_PROXY', 'true');
    vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE);
    const fetchSpy = stubPythonFetch(async () => {
      throw new Error('python must not be called for project-scoped creates');
    });

    await withServer(makeRuntime(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Scoped', projectId: 'project-1' }),
      });
      // Router built without requireAuth/projects wiring -> existing Node contract.
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: 'Project owner validation is not configured',
      });
    });
    expect(pythonCalls(fetchSpy)).toHaveLength(0);
  });

  it('stays on the Node path when the flag is unset (vitest guard) or explicitly "false"', async () => {
    for (const flagValue of [undefined, 'false'] as const) {
      if (flagValue === undefined) {
        vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE);
      } else {
        vi.stubEnv('TASKS_PYTHON_PROXY', flagValue);
        vi.stubEnv('PYTHON_SLIDE_RULE_BASE_URL', PYTHON_BASE);
      }
      const fetchSpy = stubPythonFetch(async () => {
        throw new Error('python must not be called when the proxy is disabled');
      });

      const runtime = makeRuntime();
      await withServer(runtime, async (baseUrl) => {
        const createResponse = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Node only task' }),
        });
        expect(createResponse.status).toBe(201);

        const listResponse = await fetch(`${baseUrl}/api/tasks`);
        expect(((await listResponse.json()) as Record<string, any>).tasks).toHaveLength(1);
      });
      expect(pythonCalls(fetchSpy)).toHaveLength(0);
      expect(makeRuntimeTaskCount(runtime)).toBe(1);

      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
});

function makeRuntimeTaskCount(runtime: MissionRuntime): number {
  return runtime.listTasks(200).length;
}
