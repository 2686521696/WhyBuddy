/**
 * Collaboration Replay REST API 路由
 *
 * GET  /api/replay/:missionId           — 获取时间轴元数据
 * GET  /api/replay/:missionId/events    — 查询事件（支持过滤参数）
 * GET  /api/replay/:missionId/export    — 导出事件流（format=json|csv）
 * POST /api/replay/:missionId/verify    — 验证数据完整性
 * GET  /api/replay/:missionId/audit     — 查询审计日志
 * POST /api/replay/:missionId/snapshots — 创建快照
 * GET  /api/replay/:missionId/snapshots — 获取快照列表
 *
 * Requirements: 6.2, 6.5, 6.6, 14.1, 20.1, 20.2, 20.3, 20.4
 */

import { Router } from 'express';
import { resolve, join } from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { ServerReplayStore } from '../replay/replay-store.js';
import { ReplayAuditLogger } from '../replay/audit-logger.js';
import { replayAccessControl } from '../replay/access-control.js';
import type {
  ExecutionEvent,
  ReplayEventType,
  ReplaySnapshot,
} from '../../shared/replay/contracts.js';

const router = Router();
const store = new ServerReplayStore();
const auditLogger = new ReplayAuditLogger();

const SNAPSHOTS_BASE = resolve('data/replay');

type ReplayRelationIndexSummary = {
  traceIds: string[];
  decisionIds: string[];
  nodeIds: string[];
  stages: string[];
  eventKeys: string[];
};

function snapshotsPath(missionId: string): string {
  return join(SNAPSHOTS_BASE, missionId, 'snapshots.jsonl');
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function firstDefinedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = readString(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readNestedValue(record: Record<string, unknown> | undefined, path: string[]): unknown {
  let current: unknown = record;
  for (const key of path) {
    const nested = readRecord(current);
    if (!nested || !(key in nested)) {
      return undefined;
    }
    current = nested[key];
  }
  return current;
}

function readQueryValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => readQueryValues(item));
  }
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

function readEventData(event: ExecutionEvent): Record<string, unknown> {
  return readRecord(event.eventData) ?? {};
}

function readEventMetadata(event: ExecutionEvent): Record<string, unknown> {
  return readRecord(event.metadata) ?? {};
}

function resolveEventTraceId(event: ExecutionEvent): string | undefined {
  const eventData = readEventData(event);
  const metadata = readEventMetadata(event);
  return firstDefinedString(
    eventData.traceId,
    metadata.traceId,
    readNestedValue(metadata, ['audit', 'traceId']),
    readNestedValue(eventData, ['context', 'traceId']),
  );
}

function resolveEventDecisionId(event: ExecutionEvent): string | undefined {
  const eventData = readEventData(event);
  const metadata = readEventMetadata(event);
  return firstDefinedString(
    eventData.decisionId,
    metadata.decisionId,
    readNestedValue(metadata, ['audit', 'decisionId']),
    readNestedValue(eventData, ['decision', 'decisionId']),
  );
}

function resolveEventNodeId(event: ExecutionEvent): string | undefined {
  const eventData = readEventData(event);
  const metadata = readEventMetadata(event);
  return firstDefinedString(
    eventData.nodeId,
    metadata.nodeId,
    readNestedValue(metadata, ['node', 'id']),
    readNestedValue(eventData, ['node', 'id']),
  );
}

function resolveEventStage(event: ExecutionEvent): string | undefined {
  const eventData = readEventData(event);
  const metadata = readEventMetadata(event);
  return firstDefinedString(
    metadata.stageKey,
    eventData.stage,
    metadata.phase,
    readNestedValue(eventData, ['context', 'stage']),
  );
}

function resolveEventEventKey(event: ExecutionEvent): string | undefined {
  const eventData = readEventData(event);
  const metadata = readEventMetadata(event);
  return firstDefinedString(
    eventData.eventKey,
    metadata.eventKey,
    readNestedValue(eventData, ['telemetry', 'eventKey']),
  );
}

function matchesOptionalFilter(
  actualValue: string | undefined,
  expectedValues: string[],
): boolean {
  if (expectedValues.length === 0) {
    return true;
  }
  if (!actualValue) {
    return false;
  }
  return expectedValues.includes(actualValue);
}

function buildRelationIndexSummary(events: ExecutionEvent[]): ReplayRelationIndexSummary {
  const traceIds = new Set<string>();
  const decisionIds = new Set<string>();
  const nodeIds = new Set<string>();
  const stages = new Set<string>();
  const eventKeys = new Set<string>();

  for (const event of events) {
    const traceId = resolveEventTraceId(event);
    if (traceId) {
      traceIds.add(traceId);
    }

    const decisionId = resolveEventDecisionId(event);
    if (decisionId) {
      decisionIds.add(decisionId);
    }

    const nodeId = resolveEventNodeId(event);
    if (nodeId) {
      nodeIds.add(nodeId);
    }

    const stage = resolveEventStage(event);
    if (stage) {
      stages.add(stage);
    }

    const eventKey = resolveEventEventKey(event);
    if (eventKey) {
      eventKeys.add(eventKey);
    }
  }

  return {
    traceIds: Array.from(traceIds).sort(),
    decisionIds: Array.from(decisionIds).sort(),
    nodeIds: Array.from(nodeIds).sort(),
    stages: Array.from(stages).sort(),
    eventKeys: Array.from(eventKeys).sort(),
  };
}

// Apply access control middleware to all replay routes
router.use('/:missionId', replayAccessControl);

// GET /:missionId — 获取时间轴元数据（不含 events 数组，提升性能）
router.get('/:missionId', async (req, res) => {
  try {
    const timeline = await store.getTimeline(req.params.missionId);
    // Exclude the events array for performance — clients use /events endpoint
    const { events: _events, indices: _indices, ...metadata } = timeline;
    res.json({
      ...metadata,
      replayId: timeline.missionId,
      relationIndex: buildRelationIndexSummary(timeline.events),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load timeline' });
  }
});

// GET /:missionId/events — 查询事件（支持 agentId、eventType、timeRange、limit、offset）
router.get('/:missionId/events', async (req, res) => {
  try {
    const {
      agentId,
      eventType,
      startTime,
      endTime,
      limit,
      offset,
      traceId,
      decisionId,
      nodeId,
      stage,
      eventKey,
    } = req.query;

    const baseEvents = await store.queryEvents({
      missionId: req.params.missionId,
      agentIds: readQueryValues(agentId),
      eventTypes: readQueryValues(eventType) as ReplayEventType[],
      timeRange:
        startTime && endTime
          ? { start: Number(startTime), end: Number(endTime) }
          : undefined,
    });

    const traceIds = readQueryValues(traceId);
    const decisionIds = readQueryValues(decisionId);
    const nodeIds = readQueryValues(nodeId);
    const stages = readQueryValues(stage);
    const eventKeys = readQueryValues(eventKey);

    const filteredEvents = baseEvents.filter(event => {
      if (!matchesOptionalFilter(resolveEventTraceId(event), traceIds)) {
        return false;
      }
      if (!matchesOptionalFilter(resolveEventDecisionId(event), decisionIds)) {
        return false;
      }
      if (!matchesOptionalFilter(resolveEventNodeId(event), nodeIds)) {
        return false;
      }
      if (!matchesOptionalFilter(resolveEventStage(event), stages)) {
        return false;
      }
      if (!matchesOptionalFilter(resolveEventEventKey(event), eventKeys)) {
        return false;
      }
      return true;
    });

    const normalizedOffset = offset ? Math.max(Number(offset), 0) : 0;
    const normalizedLimit = limit ? Math.max(Number(limit), 0) : undefined;
    const paginatedEvents =
      normalizedLimit === undefined
        ? filteredEvents.slice(normalizedOffset)
        : filteredEvents.slice(normalizedOffset, normalizedOffset + normalizedLimit);

    res.json(paginatedEvents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to query events' });
  }
});

// GET /:missionId/export — 导出事件流（format=json|csv）
router.get('/:missionId/export', async (req, res) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const data = await store.exportEvents(req.params.missionId, format);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="replay-${req.params.missionId}.csv"`,
      );
    } else {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="replay-${req.params.missionId}.json"`,
      );
    }

    res.send(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to export events' });
  }
});

// POST /:missionId/verify — 验证数据完整性
router.post('/:missionId/verify', async (req, res) => {
  try {
    const valid = await store.verifyIntegrity(req.params.missionId);
    res.json({ valid });
  } catch (error) {
    res.status(500).json({ error: 'Failed to verify integrity' });
  }
});

// GET /:missionId/audit — 查询审计日志 (Requirements: 20.1, 20.2)
router.get('/:missionId/audit', async (req, res) => {
  try {
    const { userId, startTime, endTime } = req.query;
    const entries = await auditLogger.queryAuditLog({
      missionId: req.params.missionId,
      userId: userId ? String(userId) : undefined,
      startTime: startTime ? Number(startTime) : undefined,
      endTime: endTime ? Number(endTime) : undefined,
    });
    res.json(entries);
  } catch (error) {
    res.status(500).json({ error: 'Failed to query audit log' });
  }
});

// POST /:missionId/snapshots — 创建快照 (Requirements: 14.1)
router.post('/:missionId/snapshots', async (req, res) => {
  try {
    const { missionId } = req.params;
    const body = req.body as Partial<ReplaySnapshot>;

    const snapshot: ReplaySnapshot = {
      snapshotId: randomUUID(),
      missionId,
      timestamp: body.timestamp ?? Date.now(),
      createdAt: Date.now(),
      label: body.label ?? 'Untitled',
      note: body.note,
      version: body.version ?? 1,
      state: body.state ?? {
        eventCursorIndex: 0,
        filters: {},
        cameraPosition: [0, 0, 0],
        cameraTarget: [0, 0, 0],
        speed: 1,
      },
    };

    const dir = join(SNAPSHOTS_BASE, missionId);
    await mkdir(dir, { recursive: true });
    await appendFile(snapshotsPath(missionId), JSON.stringify(snapshot) + '\n', 'utf-8');

    // Audit the snapshot creation
    const userId = (req.headers['x-user-id'] as string) || 'anonymous';
    await auditLogger.logAction(userId, missionId, 'snapshot', { snapshotId: snapshot.snapshotId });

    res.status(201).json(snapshot);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create snapshot' });
  }
});

// GET /:missionId/snapshots — 获取快照列表 (Requirements: 14.1)
router.get('/:missionId/snapshots', async (req, res) => {
  try {
    const filePath = snapshotsPath(req.params.missionId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch {
      res.json([]);
      return;
    }

    const snapshots: ReplaySnapshot[] = raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as ReplaySnapshot);

    res.json(snapshots);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load snapshots' });
  }
});

export default router;
