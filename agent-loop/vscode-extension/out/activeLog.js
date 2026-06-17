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
exports.resolveActiveLogPath = resolveActiveLogPath;
exports.findNewestFixLog = findNewestFixLog;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const phaseLabels_1 = require("./phaseLabels");
async function resolveActiveLogPath(latestRoot, state) {
    const status = state?.status;
    const { fixAgent } = (0, phaseLabels_1.resolveAgentRoles)(state);
    if (status === 'GROK_REVIEW') {
        return path.join(latestRoot, 'review-output.grok.stderr.log');
    }
    if (status === 'CODEX_REVIEW') {
        return path.join(latestRoot, 'codex-review.stderr.log');
    }
    const inFixPhase = status === 'GROK_FIX'
        || status === 'CODEX_FIX'
        || status === 'BUDGET_LOOP_HEAD';
    if (inFixPhase) {
        const iteration = state?.currentIteration
            || state?.iterations?.at(-1)?.iteration
            || 1;
        const prefix = fixAgent === 'codex' ? 'fix-output.codex' : 'grok-output';
        const resolved = await findNewestFixLog(latestRoot, prefix, iteration);
        if (resolved)
            return resolved;
        return path.join(latestRoot, `${prefix}.${iteration}.stderr.log`);
    }
    return path.join(latestRoot, 'codex-review.stderr.log');
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
//# sourceMappingURL=activeLog.js.map