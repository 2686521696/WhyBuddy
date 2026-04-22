import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import replayRouter from "../routes/replay.js";
import { registerMissionOwner } from "../replay/access-control.js";
import { ServerReplayStore } from "../replay/replay-store.js";
import type { ExecutionEvent } from "../../shared/replay/contracts.js";
import { MissionRuntime } from "../tasks/mission-runtime.js";
import { MissionStore } from "../tasks/mission-store.js";
import { createTaskRouter } from "../routes/tasks.js";
import { EventCollector } from "../replay/event-collector.js";
import { installMissionInterceptor } from "../replay/interceptors.js";

const BASE_DIR = resolve("data/replay");
const createdMissionIds: string[] = [];

function uniqueMissionId(prefix = "replay-route"): string {
  const missionId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  createdMissionIds.push(missionId);
  return missionId;
}

function makeEvent(
  missionId: string,
  overrides: Partial<ExecutionEvent> = {},
): ExecutionEvent {
  return {
    eventId: overrides.eventId ?? `evt-${Math.random().toString(36).slice(2, 10)}`,
    missionId,
    timestamp: overrides.timestamp ?? Date.now(),
    eventType: overrides.eventType ?? "AGENT_STARTED",
    sourceAgent: overrides.sourceAgent ?? "agent-alpha",
    targetAgent: overrides.targetAgent,
    eventData: overrides.eventData ?? {},
    metadata: overrides.metadata,
  };
}

async function seedMissionEvents(
  missionId: string,
  events: ExecutionEvent[],
): Promise<void> {
  const store = new ServerReplayStore();
  await store.appendEvents(missionId, events);
}

async function withServer(
  missionId: string,
  handler: (baseUrl: string) => Promise<void>,
  options?: {
    ownerId?: string;
    userId?: string;
    userRole?: string;
  },
): Promise<void> {
  const ownerId = options?.ownerId ?? "user-owner";
  registerMissionOwner(missionId, ownerId);

  const app = express();
  app.use(express.json());
  app.use("/api/replay", replayRouter);

  const server = createServer(app);
  await new Promise<void>((resolvePromise, reject) => {
    server.listen(0, "127.0.0.1", (error?: Error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await handler(baseUrl);
  } finally {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => (error ? reject(error) : resolvePromise()));
    });
  }
}

function authHeaders(options?: {
  userId?: string;
  userRole?: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-user-id": options?.userId ?? "user-owner",
    ...(options?.userRole ? { "x-user-role": options.userRole } : {}),
  };
}

afterEach(async () => {
  for (const missionId of createdMissionIds) {
    const dir = resolve(BASE_DIR, missionId);
    if (existsSync(dir)) {
      await rm(dir, { recursive: true, force: true });
    }
  }
  createdMissionIds.length = 0;
});

describe("replay routes", () => {
  it("GET /api/replay/:missionId returns timeline metadata without raw events", async () => {
    const missionId = uniqueMissionId("timeline");
    await seedMissionEvents(missionId, [
      makeEvent(missionId, {
        timestamp: 1_710_000_000_000,
        eventType: "AGENT_STARTED",
        sourceAgent: "agent-alpha",
      }),
      makeEvent(missionId, {
        timestamp: 1_710_000_005_000,
        eventType: "MESSAGE_SENT",
        sourceAgent: "agent-beta",
      }),
    ]);

    await withServer(missionId, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/replay/${missionId}`, {
        headers: authHeaders(),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.missionId).toBe(missionId);
      expect(body.eventCount).toBe(2);
      expect(body.startTime).toBe(1_710_000_000_000);
      expect(body.endTime).toBe(1_710_000_005_000);
      expect(body.totalDuration).toBe(5_000);
      expect(body.events).toBeUndefined();
      expect(body.indices).toBeUndefined();
      expect(typeof body.version).toBe("number");
      expect(typeof body.checksum).toBe("string");
    });
  });

  it("GET /api/replay/:missionId/events filters by agentId with limit and offset", async () => {
    const missionId = uniqueMissionId("events");
    await seedMissionEvents(missionId, [
      makeEvent(missionId, {
        timestamp: 1_710_000_000_000,
        eventType: "AGENT_STARTED",
        sourceAgent: "agent-alpha",
      }),
      makeEvent(missionId, {
        timestamp: 1_710_000_001_000,
        eventType: "MESSAGE_SENT",
        sourceAgent: "agent-beta",
        targetAgent: "agent-alpha",
      }),
      makeEvent(missionId, {
        timestamp: 1_710_000_002_000,
        eventType: "MESSAGE_RECEIVED",
        sourceAgent: "agent-alpha",
      }),
      makeEvent(missionId, {
        timestamp: 1_710_000_003_000,
        eventType: "ERROR_OCCURRED",
        sourceAgent: "agent-gamma",
      }),
    ]);

    await withServer(missionId, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/replay/${missionId}/events?agentId=agent-alpha&limit=1&offset=1`,
        {
          headers: authHeaders(),
        },
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as ExecutionEvent[];
      expect(body).toHaveLength(1);
      expect(body[0]?.eventType).toBe("MESSAGE_SENT");
      expect(body[0]?.targetAgent).toBe("agent-alpha");
    });
  });

  it("GET /api/replay/:missionId/export supports json and csv exports", async () => {
    const missionId = uniqueMissionId("export");
    await seedMissionEvents(missionId, [
      makeEvent(missionId, {
        timestamp: 1_710_000_010_000,
        eventType: "RESOURCE_ACCESSED",
        sourceAgent: "agent-alpha",
        eventData: {
          resourceId: "doc-1",
        },
      }),
      makeEvent(missionId, {
        timestamp: 1_710_000_011_000,
        eventType: "DECISION_MADE",
        sourceAgent: "agent-beta",
      }),
    ]);

    await withServer(missionId, async (baseUrl) => {
      const jsonResponse = await fetch(
        `${baseUrl}/api/replay/${missionId}/export?format=json`,
        {
          headers: {
            "x-user-id": "user-owner",
          },
        },
      );
      expect(jsonResponse.status).toBe(200);
      expect(jsonResponse.headers.get("content-type")).toContain("application/json");
      expect(jsonResponse.headers.get("content-disposition")).toContain(
        `replay-${missionId}.json`,
      );
      const jsonBody = JSON.parse(await jsonResponse.text()) as ExecutionEvent[];
      expect(jsonBody).toHaveLength(2);
      expect(jsonBody[0]?.eventType).toBe("RESOURCE_ACCESSED");

      const csvResponse = await fetch(
        `${baseUrl}/api/replay/${missionId}/export?format=csv`,
        {
          headers: {
            "x-user-id": "user-owner",
          },
        },
      );
      expect(csvResponse.status).toBe(200);
      expect(csvResponse.headers.get("content-type")).toContain("text/csv");
      expect(csvResponse.headers.get("content-disposition")).toContain(
        `replay-${missionId}.csv`,
      );
      const csvBody = await csvResponse.text();
      expect(csvBody).toContain(
        "eventId,missionId,timestamp,eventType,sourceAgent,targetAgent",
      );
      expect(csvBody).toContain("RESOURCE_ACCESSED");
      expect(csvBody).toContain("DECISION_MADE");
    });
  });

  it("POST /api/replay/:missionId/verify reflects timeline checksum validity", async () => {
    const missionId = uniqueMissionId("verify");
    await seedMissionEvents(missionId, [
      makeEvent(missionId, {
        timestamp: 1_710_000_020_000,
        eventType: "AGENT_STARTED",
        sourceAgent: "agent-alpha",
      }),
    ]);

    await withServer(missionId, async (baseUrl) => {
      const validResponse = await fetch(`${baseUrl}/api/replay/${missionId}/verify`, {
        method: "POST",
        headers: authHeaders(),
      });
      expect(validResponse.status).toBe(200);
      expect(await validResponse.json()).toEqual({ valid: true });

      const eventsFile = join(BASE_DIR, missionId, "events.jsonl");
      const original = await readFile(eventsFile, "utf-8");
      await mkdir(join(BASE_DIR, missionId), { recursive: true });
      await writeFile(
        eventsFile,
        `${original}${JSON.stringify(
          makeEvent(missionId, {
            eventId: "evt-tampered",
            timestamp: 1_710_000_021_000,
            eventType: "ERROR_OCCURRED",
            sourceAgent: "agent-beta",
          }),
        )}\n`,
        "utf-8",
      );

      const invalidResponse = await fetch(`${baseUrl}/api/replay/${missionId}/verify`, {
        method: "POST",
        headers: authHeaders(),
      });
      expect(invalidResponse.status).toBe(200);
      expect(await invalidResponse.json()).toEqual({ valid: false });
    });
  });

  it("POST/GET /api/replay/:missionId/snapshots writes snapshot and audit entry", async () => {
    const missionId = uniqueMissionId("snapshot");

    await withServer(missionId, async (baseUrl) => {
      const createResponse = await fetch(`${baseUrl}/api/replay/${missionId}/snapshots`, {
        method: "POST",
        headers: authHeaders({ userId: "user-owner" }),
        body: JSON.stringify({
          label: "Checkpoint A",
          note: "first interesting state",
          timestamp: 1_710_000_030_000,
          state: {
            eventCursorIndex: 2,
            filters: {
              agentIds: ["agent-alpha"],
            },
            cameraPosition: [1, 2, 3],
            cameraTarget: [4, 5, 6],
            speed: 2,
          },
        }),
      });

      expect(createResponse.status).toBe(201);
      const createdSnapshot = await createResponse.json();
      expect(createdSnapshot.missionId).toBe(missionId);
      expect(createdSnapshot.label).toBe("Checkpoint A");
      expect(createdSnapshot.note).toBe("first interesting state");
      expect(createdSnapshot.state.eventCursorIndex).toBe(2);
      expect(createdSnapshot.snapshotId).toBeTruthy();

      const listResponse = await fetch(`${baseUrl}/api/replay/${missionId}/snapshots`, {
        headers: {
          "x-user-id": "user-owner",
        },
      });
      expect(listResponse.status).toBe(200);
      const snapshots = await listResponse.json();
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.snapshotId).toBe(createdSnapshot.snapshotId);

      const auditResponse = await fetch(`${baseUrl}/api/replay/${missionId}/audit`, {
        headers: {
          "x-user-id": "user-owner",
        },
      });
      expect(auditResponse.status).toBe(200);
      const auditEntries = await auditResponse.json();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0]?.userId).toBe("user-owner");
      expect(auditEntries[0]?.action).toBe("snapshot");
      expect(auditEntries[0]?.details?.snapshotId).toBe(createdSnapshot.snapshotId);
    });
  });

  it("reuses mission projection replayId to resolve replay timeline metadata", async () => {
    const replayId = uniqueMissionId("projection-replay");
    registerMissionOwner(replayId, "user-owner");

    const runtime = new MissionRuntime({
      store: new MissionStore(),
      autoRecover: false,
    });
    const replayStore = new ServerReplayStore();
    const collector = new EventCollector(replayStore, {
      flushIntervalMs: 100_000,
    });
    installMissionInterceptor(runtime, collector);

    const task = runtime.createTask({
      kind: "chat",
      title: "Replay projection task",
      sourceText: "Validate mission projection replay link",
      topicId: "session-projection",
      projection: {
        workflowId: replayId,
        instanceId: replayId,
        replayId,
        sessionId: "session-projection",
        sourceApp: "web-aigc",
      },
      stageLabels: [{ key: "execute", label: "Execute" }],
    });
    runtime.markMissionRunning(
      task.id,
      "execute",
      "Projection replay timeline is active",
      40,
      "brain",
    );
    await collector.flush();

    const app = express();
    app.use(express.json());
    app.use("/api/tasks", createTaskRouter(runtime));
    app.use("/api/replay", replayRouter);

    const server = createServer(app);
    await new Promise<void>((resolvePromise, reject) => {
      server.listen(0, "127.0.0.1", (error?: Error) => {
        if (error) reject(error);
        else resolvePromise();
      });
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const projectionResponse = await fetch(`${baseUrl}/api/tasks/${task.id}/projection`);
      expect(projectionResponse.status).toBe(200);
      const projectionBody = await projectionResponse.json();
      expect(projectionBody.projection?.links?.replayId).toBe(replayId);

      const replayResponse = await fetch(`${baseUrl}/api/replay/${projectionBody.projection.links.replayId}`, {
        headers: authHeaders(),
      });
      expect(replayResponse.status).toBe(200);
      const replayBody = await replayResponse.json();
      expect(replayBody.missionId).toBe(replayId);
      expect(replayBody.eventCount).toBeGreaterThanOrEqual(1);
    } finally {
      collector.destroy();
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => (error ? reject(error) : resolvePromise()));
      });
    }
  });
});
