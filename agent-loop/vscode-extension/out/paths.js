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
exports.getRepoRoot = getRepoRoot;
exports.getAgentLoopRoot = getAgentLoopRoot;
exports.latestDir = latestDir;
exports.latestStatePath = latestStatePath;
exports.latestReportPath = latestReportPath;
exports.runsDir = runsDir;
exports.queuePath = queuePath;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
function getRepoRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length)
        return null;
    for (const folder of folders) {
        const candidate = path.join(folder.uri.fsPath, 'agent-loop', 'package.json');
        if (existsSync(candidate))
            return folder.uri.fsPath;
    }
    return folders[0].uri.fsPath;
}
function getAgentLoopRoot(repoRoot) {
    return path.join(repoRoot, 'agent-loop');
}
function latestDir(repoRoot) {
    return path.join(repoRoot, '.agent-loop', 'latest');
}
function latestStatePath(repoRoot) {
    return path.join(latestDir(repoRoot), 'state.json');
}
function latestReportPath(repoRoot) {
    return path.join(latestDir(repoRoot), 'final-report.md');
}
function runsDir(repoRoot) {
    return path.join(repoRoot, '.agent-loop', 'runs');
}
function queuePath(repoRoot) {
    const configured = vscode.workspace.getConfiguration('agentLoop').get('queuePath')
        || 'agent-loop/scripts/migration-queue.json';
    return path.isAbsolute(configured) ? configured : path.join(repoRoot, configured);
}
function existsSync(filePath) {
    try {
        fs.accessSync(filePath);
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=paths.js.map