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
exports.listRecentRuns = listRecentRuns;
exports.snapshotStatusLine = snapshotStatusLine;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const activeLog_1 = require("./activeLog");
const phaseLabels_1 = require("./phaseLabels");
const paths_1 = require("./paths");
const runSummary_1 = require("./runSummary");
var activeLog_2 = require("./activeLog");
Object.defineProperty(exports, "findNewestFixLog", { enumerable: true, get: function () { return activeLog_2.findNewestFixLog; } });
Object.defineProperty(exports, "formatAgentLogTail", { enumerable: true, get: function () { return activeLog_2.formatAgentLogTail; } });
Object.defineProperty(exports, "resolveActiveLogCandidates", { enumerable: true, get: function () { return activeLog_2.resolveActiveLogCandidates; } });
Object.defineProperty(exports, "resolveActiveLogPath", { enumerable: true, get: function () { return activeLog_2.resolveActiveLogPath; } });
Object.defineProperty(exports, "resolveLogRoot", { enumerable: true, get: function () { return activeLog_2.resolveLogRoot; } });
const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
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
async function buildRunSnapshot(repoRoot, phaseStartedAt, runStartedAt) {
    const state = await readJsonFile(path.join((0, paths_1.latestDir)(repoRoot), 'state.json'));
    const queue = await readJsonFile((0, paths_1.queuePath)(repoRoot));
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
    const now = Date.now();
    return {
        state,
        queueRunning: false,
        agentTail: activeLog.tail,
        agentLogBytes: activeLog.bytes,
        taskLabel,
        phaseLabel: (0, phaseLabels_1.phaseLabel)(state?.status),
        details,
        elapsedMs: now - runStartedAt,
        phaseElapsedMs: now - phaseStartedAt,
        updatedAt: now,
        pipelineSteps: (0, phaseLabels_1.buildPipelineSteps)(state, queueDefaults),
        fixAgent,
        reviewAgent,
        runMode: summary?.runMode || 'unknown',
    };
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
function snapshotStatusLine(snapshot) {
    const status = snapshot.state?.status || 'IDLE';
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