"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLogRoot = exports.resolveActiveLogPath = exports.resolveActiveLogCandidates = exports.formatAgentLogTail = exports.findNewestFixLog = void 0;
exports.readJsonFile = readJsonFile;
exports.readTextTail = readTextTail;
exports.buildRunSnapshot = buildRunSnapshot;
exports.buildRunSnapshotFromStatePath = buildRunSnapshotFromStatePath;
exports.listRecentRuns = listRecentRuns;
exports.findLatestRunForTask = findLatestRunForTask;
exports.readQueueOutcomes = readQueueOutcomes;
exports.buildQueueOverview = buildQueueOverview;
exports.snapshotStatusLine = snapshotStatusLine;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const activeLog_1 = require("./activeLog");
const gateSummary_1 = require("./gateSummary");
const phaseLabels_1 = require("./phaseLabels");
const runSummary_1 = require("./runSummary");
var activeLog_2 = require("./activeLog");
Object.defineProperty(exports, "findNewestFixLog", { enumerable: true, get: function () { return activeLog_2.findNewestFixLog; } });
Object.defineProperty(exports, "formatAgentLogTail", { enumerable: true, get: function () { return activeLog_2.formatAgentLogTail; } });
Object.defineProperty(exports, "resolveActiveLogCandidates", { enumerable: true, get: function () { return activeLog_2.resolveActiveLogCandidates; } });
Object.defineProperty(exports, "resolveActiveLogPath", { enumerable: true, get: function () { return activeLog_2.resolveActiveLogPath; } });
Object.defineProperty(exports, "resolveLogRoot", { enumerable: true, get: function () { return activeLog_2.resolveLogRoot; } });
const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const TERMINAL_STATUS_RE = /^(DONE_|HALT_|PAUSED_)/;
const ACTIVE_STATUS_RE = /^(CODEX_FIX|GROK_FIX|CODEX_REVIEW|GROK_REVIEW|BUDGET_LOOP_HEAD|REVIEW_NEEDS_CHANGES)$/;
const STALE_BUFFER_MS = 60_000;
async function readJsonFile(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function readTextTail(filePath, maxLines = 6) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const bytes = Buffer.byteLength(raw, 'utf8');
        return { tail: (0, activeLog_1.formatAgentLogTail)(raw, maxLines), bytes };
    }
    catch {
        return { tail: '', bytes: 0 };
    }
}
async function buildRunSnapshot(repoRoot, phaseStartedAt, runStartedAt, options = {}) {
    const statePath = options.statePath || path.join(defaultLatestDir(repoRoot), 'state.json');
    return buildRunSnapshotFromStatePath(repoRoot, statePath, {
        ...options,
        phaseStartedAt,
        runStartedAt,
    });
}
async function buildRunSnapshotFromStatePath(repoRoot, statePath, options = {}) {
    const state = await readJsonFile(statePath);
    const queue = await readJsonFile(options.queueFilePath || defaultQueuePath(repoRoot));
    const queueDefaults = queue?.defaults ?? null;
    const logRoot = (0, activeLog_1.resolveLogRoot)(state, repoRoot);
    const activeLogPath = await (0, activeLog_1.resolveActiveLogPath)(logRoot, state);
    let activeLog = await readTextTail(activeLogPath);
    if (!activeLog.tail) {
        activeLog = await readProgressHint(logRoot, state);
    }
    const { details, taskLabel } = (0, phaseLabels_1.describeSnapshot)(state, queueDefaults);
    const summary = state ? (0, runSummary_1.summarizeStateRun)(state, state.runId || 'latest') : null;
    const { fixAgent, reviewAgent } = (0, phaseLabels_1.resolveAgentRoles)(state, queueDefaults);
    const now = options.now?.() ?? Date.now();
    const runStartedAt = options.runStartedAt ?? inferRunStartedAt(state, now);
    const terminalEndedAt = await inferTerminalEndedAt(state, statePath);
    const staleRun = await detectStaleRun(state, statePath, now);
    const displayStatus = staleRun ? 'STALE_INTERRUPTED' : (state?.status ?? null);
    const elapsedAt = terminalEndedAt ?? (staleRun ? now - staleRun.stateAgeMs : now);
    const displayGate = (0, gateSummary_1.resolveDisplayGate)(state);
    const landing = await readRunArtifact(state, repoRoot, 'landing.json');
    const finalReport = await readRunArtifact(state, repoRoot, 'final-report.json');
    const detailsWithStale = staleRun
        ? [`运行中断: ${staleRun.status} 超过 ${(0, phaseLabels_1.formatElapsed)(staleRun.timeoutMs)} 未更新`, ...details]
        : details;
    return {
        state,
        statePath,
        queueRunning: false,
        agentTail: activeLog.tail,
        agentLogBytes: activeLog.bytes,
        taskLabel,
        phaseLabel: (0, phaseLabels_1.phaseLabel)(displayStatus ?? state?.status),
        displayStatus,
        staleRun,
        details: detailsWithStale,
        elapsedMs: Math.max(0, elapsedAt - runStartedAt),
        phaseElapsedMs: Math.max(0, now - (options.phaseStartedAt ?? runStartedAt)),
        updatedAt: now,
        pipelineSteps: (0, phaseLabels_1.buildPipelineSteps)(state, queueDefaults),
        fixAgent,
        reviewAgent,
        runMode: summary?.runMode || 'unknown',
        displayGate,
        landing,
        finalReport,
        guardPolicy: state?.guardPolicy ?? finalReport?.guardPolicy ?? null,
    };
}
async function readRunArtifact(state, repoRoot, fileName) {
    const runDir = (0, activeLog_1.resolveLogRoot)(state, repoRoot);
    return readJsonFile(path.join(runDir, fileName));
}
async function listRecentRuns(repoRoot, limit = 20) {
    const dir = path.join(repoRoot, '.agent-loop', 'runs');
    let entries = [];
    try {
        entries = await fs.readdir(dir);
    }
    catch {
        return [];
    }
    const items = [];
    for (const runId of entries) {
        const statePath = path.join(dir, runId, 'state.json');
        const state = await readJsonFile(statePath);
        if (!state)
            continue;
        let mtimeMs = 0;
        try {
            const stat = await fs.stat(statePath);
            mtimeMs = stat.mtimeMs;
        }
        catch {
            mtimeMs = 0;
        }
        const summary = (0, runSummary_1.summarizeStateRun)(state, runId);
        items.push({
            runId: summary.runId || runId,
            status: summary.status || state.status || 'UNKNOWN',
            task: summary.task || state.options?.task || '—',
            fixAgent: summary.fixAgent,
            reviewAgent: summary.reviewAgent,
            runMode: summary.runMode,
            grokRan: summary.grokRan,
            codexRan: summary.codexRan,
            iterations: summary.iterations,
            mtimeMs,
        });
    }
    return items.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}
async function findLatestRunForTask(repoRoot, taskPath) {
    const dir = path.join(repoRoot, '.agent-loop', 'runs');
    let entries = [];
    try {
        entries = await fs.readdir(dir);
    }
    catch {
        return null;
    }
    const normalizedTask = normalizeTaskPath(taskPath);
    let best = null;
    for (const runId of entries) {
        const statePath = path.join(dir, runId, 'state.json');
        const state = await readJsonFile(statePath);
        if (!state || normalizeTaskPath(state.options?.task || '') !== normalizedTask)
            continue;
        let mtimeMs = 0;
        try {
            mtimeMs = (await fs.stat(statePath)).mtimeMs;
        }
        catch {
            mtimeMs = 0;
        }
        if (!best || mtimeMs > best.mtimeMs) {
            best = { runId, statePath, mtimeMs };
        }
    }
    return best ? { runId: best.runId, statePath: best.statePath } : null;
}
async function readQueueOutcomes(repoRoot) {
    const file = await readJsonFile(path.join(repoRoot, '.agent-loop', 'queue-outcomes.json'));
    return file ?? { tasks: {} };
}
// Merge the queue definition (membership/order) with per-task queue outcomes and
// the currently-running task, into the model the overview view renders.
async function buildQueueOverview(repoRoot, options = {}) {
    const queue = await readJsonFile(options.queueFilePath || defaultQueuePath(repoRoot));
    const outcomes = await readQueueOutcomes(repoRoot);
    const runningTask = options.runningTaskPath ? normalizeTaskPath(options.runningTaskPath) : null;
    const tasks = (queue?.tasks || []).map((task) => {
        const id = task.id || task.task;
        const record = outcomes.tasks?.[id];
        const running = Boolean(options.queueRunning)
            && !options.currentRunStale
            && runningTask !== null
            && normalizeTaskPath(task.task) === runningTask;
        return {
            id,
            task: task.task,
            enabled: task.enabled !== false,
            outcome: record?.lastOutcome ?? null,
            status: record?.lastStatus ?? null,
            lastRunId: record?.lastRunId ?? null,
            autoDisabled: Boolean(record?.autoDisabled),
            running,
            stale: Boolean(options.currentRunStale)
                && runningTask !== null
                && normalizeTaskPath(task.task) === runningTask,
        };
    });
    const counts = {
        total: tasks.length,
        done: 0,
        failed: 0,
        crashed: 0,
        quarantined: 0,
        running: 0,
        pending: 0,
    };
    for (const item of tasks) {
        if (item.running) {
            counts.running += 1;
        }
        else if (item.outcome === 'done') {
            counts.done += 1;
        }
        else if (item.outcome === 'failed') {
            counts.failed += 1;
        }
        else if (item.outcome === 'crashed') {
            counts.crashed += 1;
        }
        else if (item.outcome === 'quarantined') {
            counts.quarantined += 1;
        }
        else {
            counts.pending += 1;
        }
    }
    return { tasks, counts, queueRunning: Boolean(options.queueRunning) };
}
function snapshotStatusLine(snapshot) {
    const status = snapshot.displayStatus || snapshot.state?.status || 'IDLE';
    const parts = [
        `${(0, phaseLabels_1.phaseLabel)(status)}`,
        `总耗时 ${(0, phaseLabels_1.formatElapsed)(snapshot.elapsedMs)}`,
        `模式 ${snapshot.runMode}`,
        `agent ${(0, phaseLabels_1.activeAgentLabel)(status, snapshot.state, { fixAgent: snapshot.fixAgent, reviewAgent: snapshot.reviewAgent })}`,
    ];
    if (snapshot.details.length)
        parts.push(snapshot.details.join(' · '));
    return parts.join(' | ');
}
function stripAnsi(text) {
    return text.replace(ANSI_ESCAPE_RE, '');
}
function defaultLatestDir(repoRoot) {
    return path.join(repoRoot, '.agent-loop', 'latest');
}
function defaultQueuePath(repoRoot) {
    return path.join(repoRoot, 'agent-loop', 'scripts', 'migration-queue.json');
}
function normalizeTaskPath(taskPath) {
    return taskPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^agent-loop\//, '');
}
function inferRunStartedAt(state, fallback) {
    const parsed = (0, runSummary_1.parseRunIdDate)(state?.runId);
    return parsed?.getTime() ?? fallback;
}
async function inferTerminalEndedAt(state, statePath) {
    const status = state?.status || '';
    if (!TERMINAL_STATUS_RE.test(status))
        return null;
    const candidates = collectEndedAtValues(state);
    for (const value of candidates) {
        const ms = Date.parse(value);
        if (Number.isFinite(ms))
            return ms;
    }
    try {
        return (await fs.stat(statePath)).mtimeMs;
    }
    catch {
        return null;
    }
}
async function detectStaleRun(state, statePath, now) {
    const status = state?.status || '';
    if (!ACTIVE_STATUS_RE.test(status))
        return null;
    let stateAgeMs = 0;
    try {
        const stat = await fs.stat(statePath);
        stateAgeMs = Math.max(0, now - stat.mtimeMs);
    }
    catch {
        return null;
    }
    const timeoutMs = state?.options?.timeoutMs ?? 30 * 60 * 1000;
    if (stateAgeMs <= timeoutMs + STALE_BUFFER_MS)
        return null;
    return {
        status,
        reason: 'active-state-stale',
        stateAgeMs,
        timeoutMs,
    };
}
function collectEndedAtValues(state) {
    const values = [];
    const push = (value) => {
        if (typeof value === 'string' && value)
            values.push(value);
    };
    push(state?.agentReview?.endedAt);
    push(state?.codexReview?.endedAt);
    push(state?.grokReview?.endedAt);
    push(state?.agentFix?.endedAt);
    push(state?.grokFix?.endedAt);
    const iterations = Array.isArray(state?.iterations) ? state.iterations : [];
    for (let i = iterations.length - 1; i >= 0; i -= 1) {
        const iteration = iterations[i];
        push(iteration?.agentFix?.endedAt);
        push(iteration?.grokFix?.endedAt);
        const attempts = Array.isArray(iteration?.attempts) ? iteration.attempts : [];
        for (let j = attempts.length - 1; j >= 0; j -= 1) {
            push(attempts[j]?.agentFix?.endedAt);
            push(attempts[j]?.grokFix?.endedAt);
        }
        const gateRuns = Array.isArray(iteration?.gateSnapshot?.runs) ? iteration.gateSnapshot.runs : [];
        for (let j = gateRuns.length - 1; j >= 0; j -= 1) {
            push(gateRuns[j]?.endedAt);
        }
    }
    const baselineRuns = Array.isArray(state?.baselineGateSnapshot?.runs) ? state.baselineGateSnapshot.runs : [];
    for (let i = baselineRuns.length - 1; i >= 0; i -= 1) {
        push(baselineRuns[i]?.endedAt);
    }
    return values;
}
async function readProgressHint(logRoot, state) {
    const status = state?.status || '';
    if (status === 'GROK_FIX' || status === 'CODEX_FIX' || status === 'BUDGET_LOOP_HEAD') {
        const request = await readTextTail(path.join(logRoot, 'grok-request.1.md'), 4);
        if (request.tail) {
            return { tail: `（Grok 修复中，尚无 stdout）\n${request.tail}`, bytes: request.bytes };
        }
    }
    if (status === 'BASELINE_GATE_RESULT' || status === 'WORKTREE_READY' || status === 'INIT' || status === 'PROBED') {
        const gate = await readTextTail(path.join(logRoot, 'baseline-gate-1.stdout.log'), 4);
        if (gate.tail) {
            return { tail: `（Gate 输出）\n${gate.tail}`, bytes: gate.bytes };
        }
    }
    return { tail: '', bytes: 0 };
}
//# sourceMappingURL=stateReader.js.map