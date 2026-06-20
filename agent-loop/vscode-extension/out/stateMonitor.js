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
exports.StateMonitor = void 0;
const vscode = __importStar(require("vscode"));
const dashboardPanel_1 = require("./dashboardPanel");
const phaseLabels_1 = require("./phaseLabels");
const paths_1 = require("./paths");
const stateReader_1 = require("./stateReader");
class StateMonitor {
    repoRoot;
    extensionUri;
    output;
    isQueueRunning;
    listeners = new Set();
    disposables = [];
    pollTimer;
    runStartedAt = Date.now();
    phaseStartedAt = Date.now();
    lastStatus;
    latestSnapshot = null;
    dashboardStatePath = null;
    statusBarItem;
    constructor(repoRoot, extensionUri, output, isQueueRunning = () => false) {
        this.repoRoot = repoRoot;
        this.extensionUri = extensionUri;
        this.output = output;
        this.isQueueRunning = isQueueRunning;
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.statusBarItem.command = 'agentLoop.openDashboard';
        this.statusBarItem.show();
        this.disposables.push(this.statusBarItem);
        const latest = (0, paths_1.latestDir)(repoRoot);
        const patterns = [
            new vscode.RelativePattern(latest, 'state.json'),
            new vscode.RelativePattern(latest, 'codex-review.stdout.log'),
            new vscode.RelativePattern(latest, 'codex-review.stderr.log'),
            new vscode.RelativePattern(latest, 'review-output.grok.stdout.log'),
            new vscode.RelativePattern(latest, 'review-output.grok.stderr.log'),
            new vscode.RelativePattern(latest, 'grok-output.*.stdout.log'),
            new vscode.RelativePattern(latest, 'grok-output.*.stderr.log'),
            new vscode.RelativePattern(latest, 'fix-output.codex.*.stdout.log'),
            new vscode.RelativePattern(latest, 'fix-output.codex.*.stderr.log'),
            new vscode.RelativePattern(latest, 'final-report.md'),
        ];
        for (const pattern of patterns) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);
            watcher.onDidChange(() => this.refresh().catch(() => { }));
            watcher.onDidCreate(() => this.refresh().catch(() => { }));
            this.disposables.push(watcher);
        }
        this.startPolling();
        this.refresh().catch(() => { });
    }
    onDidUpdate(listener) {
        this.listeners.add(listener);
        if (this.latestSnapshot)
            listener(this.latestSnapshot);
        return new vscode.Disposable(() => this.listeners.delete(listener));
    }
    getSnapshot() {
        return this.latestSnapshot;
    }
    markRunStarted() {
        this.dashboardStatePath = null;
        this.runStartedAt = Date.now();
        this.phaseStartedAt = Date.now();
        this.lastStatus = undefined;
    }
    showLatestInDashboard() {
        this.dashboardStatePath = null;
        if (this.latestSnapshot && dashboardPanel_1.DashboardPanel.current) {
            dashboardPanel_1.DashboardPanel.current.update(this.latestSnapshot);
        }
    }
    async pushOverview() {
        if (!dashboardPanel_1.DashboardPanel.current)
            return;
        this.dashboardStatePath = null;
        const overview = await (0, stateReader_1.buildQueueOverview)(this.repoRoot, {
            queueFilePath: (0, paths_1.queuePath)(this.repoRoot),
            runningTaskPath: this.latestSnapshot?.state?.options?.task ?? null,
            queueRunning: this.isQueueRunning(),
            currentRunStale: Boolean(this.latestSnapshot?.staleRun),
        });
        dashboardPanel_1.DashboardPanel.current.showOverview(overview, this.latestSnapshot);
    }
    async showStatePathInDashboard(statePath) {
        this.dashboardStatePath = statePath;
        const snapshot = this.enrichSnapshot(await (0, stateReader_1.buildRunSnapshot)(this.repoRoot, this.phaseStartedAt, this.runStartedAt, { statePath, queueFilePath: (0, paths_1.queuePath)(this.repoRoot) }));
        if (dashboardPanel_1.DashboardPanel.current) {
            dashboardPanel_1.DashboardPanel.current.update(snapshot);
        }
        return snapshot;
    }
    async refresh() {
        const snapshot = this.enrichSnapshot(await (0, stateReader_1.buildRunSnapshot)(this.repoRoot, this.phaseStartedAt, this.runStartedAt, { queueFilePath: (0, paths_1.queuePath)(this.repoRoot) }));
        const status = snapshot.displayStatus ?? snapshot.state?.status;
        if (status && status !== this.lastStatus) {
            this.lastStatus = status;
            this.phaseStartedAt = Date.now();
            this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${(0, stateReader_1.snapshotStatusLine)(snapshot)}`);
        }
        this.latestSnapshot = snapshot;
        this.updateChrome(snapshot);
        for (const listener of this.listeners)
            listener(snapshot);
        await this.updateDashboard(snapshot);
        return snapshot;
    }
    updateChrome(snapshot) {
        const status = snapshot.displayStatus ?? snapshot.state?.status;
        const icon = (0, phaseLabels_1.statusIcon)(status);
        const text = status
            ? `${icon} AgentLoop: ${(0, phaseLabels_1.phaseLabel)(status)} (${(0, phaseLabels_1.formatElapsed)(snapshot.elapsedMs)})`
            : '$(circle-outline) AgentLoop: 空闲';
        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = snapshot.details.join('\n') || '打开 AgentLoop 面板';
    }
    enrichSnapshot(snapshot) {
        return { ...snapshot, queueRunning: this.isQueueRunning() };
    }
    async updateDashboard(latestSnapshot) {
        if (!dashboardPanel_1.DashboardPanel.current)
            return;
        if (dashboardPanel_1.DashboardPanel.current.view === 'overview') {
            await this.pushOverview();
            return;
        }
        if (!this.dashboardStatePath) {
            dashboardPanel_1.DashboardPanel.current.update(latestSnapshot);
            return;
        }
        const selected = this.enrichSnapshot(await (0, stateReader_1.buildRunSnapshot)(this.repoRoot, this.phaseStartedAt, this.runStartedAt, { statePath: this.dashboardStatePath, queueFilePath: (0, paths_1.queuePath)(this.repoRoot) }));
        dashboardPanel_1.DashboardPanel.current.update(selected);
    }
    startPolling() {
        const interval = vscode.workspace.getConfiguration('agentLoop').get('pollIntervalMs', 1500);
        this.pollTimer = setInterval(() => {
            this.refresh().catch(() => { });
        }, interval);
    }
    dispose() {
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
        this.statusBarItem.dispose();
    }
}
exports.StateMonitor = StateMonitor;
//# sourceMappingURL=stateMonitor.js.map