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
exports.resolveLogRoot = resolveLogRoot;
exports.resolveActiveLogPath = resolveActiveLogPath;
exports.resolveActiveLogCandidates = resolveActiveLogCandidates;
exports.findNewestFixLog = findNewestFixLog;
exports.formatAgentLogTail = formatAgentLogTail;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const phaseLabels_1 = require("./phaseLabels");
function resolveLogRoot(state, repoRoot) {
    const runDir = state?.artifacts?.runDir;
    if (runDir) {
        return path.isAbsolute(runDir) ? runDir : path.resolve(repoRoot, runDir);
    }
    return path.join(repoRoot, '.agent-loop', 'latest');
}
const TERMINAL_STATUSES = new Set([
    'DONE_REVIEWED',
    'DONE_FIXED',
    'DONE_GATE_ONLY',
    'HALT_HUMAN',
    'HALT_NO_CHANGES',
    'HALT_NO_PROGRESS',
    'HALT_BUDGET',
]);
async function resolveActiveLogPath(latestRoot, state) {
    const candidates = await resolveActiveLogCandidates(latestRoot, state);
    const fallback = candidates[0] || path.join(latestRoot, 'review-output.grok.stdout.log');
    return pickFirstReadableLog(candidates, fallback);
}
async function resolveActiveLogCandidates(latestRoot, state) {
    const status = state?.status;
    const { fixAgent, reviewAgent } = (0, phaseLabels_1.resolveAgentRoles)(state);
    const candidates = [];
    if (status === 'GROK_REVIEW' || status === 'CODEX_REVIEW') {
        pushReviewLogs(candidates, latestRoot, reviewAgent);
        return candidates;
    }
    const inFixPhase = status === 'GROK_FIX'
        || status === 'CODEX_FIX'
        || status === 'BUDGET_LOOP_HEAD';
    if (inFixPhase) {
        await pushFixLogs(candidates, latestRoot, fixAgent, state);
        return candidates;
    }
    if (status && TERMINAL_STATUSES.has(status)) {
        if (reviewAgentRan(state)) {
            pushReviewLogs(candidates, latestRoot, reviewAgent);
        }
        if (fixAgentRan(state)) {
            await pushFixLogs(candidates, latestRoot, fixAgent, state);
        }
        if (candidates.length)
            return candidates;
    }
    pushReviewLogs(candidates, latestRoot, reviewAgent);
    await pushFixLogs(candidates, latestRoot, fixAgent, state);
    return candidates;
}
async function findNewestFixLog(latestRoot, prefix, iteration) {
    let entries = [];
    try {
        entries = await fs.readdir(latestRoot);
    }
    catch {
        return null;
    }
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const detailedPattern = new RegExp(`^${escapedPrefix}\\.${iteration}\\.(\\d+)\\.stderr\\.log$`);
    const aliasPattern = new RegExp(`^${escapedPrefix}\\.${iteration}\\.stderr\\.log$`);
    const candidates = [];
    for (const name of entries) {
        const detailedMatch = detailedPattern.exec(name);
        const aliasMatch = !detailedMatch ? aliasPattern.exec(name) : null;
        if (!detailedMatch && !aliasMatch)
            continue;
        const filePath = path.join(latestRoot, name);
        let mtimeMs = 0;
        try {
            const stat = await fs.stat(filePath);
            mtimeMs = stat.mtimeMs;
        }
        catch {
            continue;
        }
        candidates.push({
            filePath,
            attempt: detailedMatch ? Number.parseInt(detailedMatch[1], 10) : 0,
            detailed: Boolean(detailedMatch),
            mtimeMs,
        });
    }
    if (!candidates.length)
        return null;
    candidates.sort((a, b) => {
        if (a.detailed !== b.detailed)
            return a.detailed ? -1 : 1;
        if (a.attempt !== b.attempt)
            return b.attempt - a.attempt;
        return b.mtimeMs - a.mtimeMs;
    });
    return candidates[0].filePath;
}
async function pickFirstReadableLog(candidates, fallback) {
    for (const candidate of candidates) {
        if (await fileHasContent(candidate))
            return candidate;
    }
    return fallback;
}
async function fileHasContent(filePath) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        return raw.trim().length > 0;
    }
    catch {
        return false;
    }
}
function pushReviewLogs(candidates, latestRoot, reviewAgent) {
    if (reviewAgent === 'grok') {
        candidates.push(path.join(latestRoot, 'review-output.grok.stdout.log'), path.join(latestRoot, 'review-output.grok.stderr.log'));
        return;
    }
    if (reviewAgent === 'codex') {
        candidates.push(path.join(latestRoot, 'codex-review.stdout.log'), path.join(latestRoot, 'codex-review.stderr.log'));
    }
}
async function pushFixLogs(candidates, latestRoot, fixAgent, state) {
    const iteration = state?.currentIteration
        || state?.iterations?.at(-1)?.iteration
        || 1;
    const prefix = fixAgent === 'codex' ? 'fix-output.codex' : 'grok-output';
    const resolved = await findNewestFixLog(latestRoot, prefix, iteration);
    if (resolved) {
        candidates.push(resolved, swapLogStream(resolved, 'stdout'));
        return;
    }
    candidates.push(path.join(latestRoot, `${prefix}.${iteration}.stderr.log`), path.join(latestRoot, `${prefix}.${iteration}.stdout.log`));
}
function swapLogStream(filePath, stream) {
    return filePath.replace(/\.(stderr|stdout)\.log$/, `.${stream}.log`);
}
function reviewAgentRan(state) {
    return Boolean(state?.grokReview || state?.codexReview || state?.agentReview);
}
function fixAgentRan(state) {
    return Boolean(state?.iterations?.length
        || state?.grokFix
        || state?.agentFix
        || state?.currentIteration);
}
const ANSI_ESCAPE_RE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
function formatAgentLogTail(raw, maxLines = 6) {
    const trimmed = stripAnsi(raw).trim();
    if (!trimmed)
        return '';
    try {
        const outer = JSON.parse(trimmed);
        if (typeof outer.text === 'string' && outer.text.trim()) {
            try {
                const inner = JSON.parse(outer.text);
                return JSON.stringify(inner, null, 2);
            }
            catch {
                return outer.text.trim();
            }
        }
        return JSON.stringify(outer, null, 2);
    }
    catch {
        // fall through to plain-text tail
    }
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines.slice(-maxLines).join('\n');
}
function stripAnsi(text) {
    return text.replace(ANSI_ESCAPE_RE, '');
}
//# sourceMappingURL=activeLog.js.map