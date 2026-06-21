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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const dashboardPanel_1 = require("./dashboardPanel");
const paths_1 = require("./paths");
const runController_1 = require("./runController");
const stateMonitor_1 = require("./stateMonitor");
const stateReader_1 = require("./stateReader");
const treeProviders_1 = require("./treeProviders");
let monitor;
let runController;
let output;
function activate(context) {
    const repoRoot = (0, paths_1.getRepoRoot)();
    if (!repoRoot) {
        vscode.window.showWarningMessage('AgentLoop: 请在包含 agent-loop/ 的仓库根目录打开工作区。');
        return;
    }
    output = vscode.window.createOutputChannel('AgentLoop');
    const currentRunTree = new treeProviders_1.CurrentRunTreeProvider();
    const queueTree = new treeProviders_1.QueueTreeProvider(repoRoot);
    const runsTree = new treeProviders_1.RunsTreeProvider(repoRoot);
    runController = new runController_1.RunController(repoRoot, output, () => {
        monitor?.markRunStarted();
        if (vscode.workspace.getConfiguration('agentLoop').get('openDashboardOnRun', true)) {
            dashboardPanel_1.DashboardPanel.show(context.extensionUri);
            void monitor?.refresh().then(() => monitor?.pushOverview());
        }
        else {
            void monitor?.refresh();
        }
    }, () => {
        void monitor?.refresh();
        queueTree.refresh();
        runsTree.refresh();
    });
    monitor = new stateMonitor_1.StateMonitor(repoRoot, context.extensionUri, output, () => runController?.running ?? false);
    monitor.onDidUpdate((snapshot) => {
        currentRunTree.refresh(snapshot);
    });
    context.subscriptions.push(output, monitor, runController, vscode.window.registerTreeDataProvider('agentLoop.currentRun', currentRunTree), vscode.window.registerTreeDataProvider('agentLoop.queue', queueTree), vscode.window.registerTreeDataProvider('agentLoop.runs', runsTree), vscode.commands.registerCommand('agentLoop.runQueue', async () => {
        await runController?.runQueue();
    }), vscode.commands.registerCommand('agentLoop.stopRun', () => {
        runController?.stop();
    }), vscode.commands.registerCommand('agentLoop.openDashboard', () => {
        dashboardPanel_1.DashboardPanel.show(context.extensionUri);
        void monitor?.pushOverview();
    }), vscode.commands.registerCommand('agentLoop.showOverview', () => {
        dashboardPanel_1.DashboardPanel.show(context.extensionUri);
        void monitor?.pushOverview();
    }), vscode.commands.registerCommand('agentLoop.openFile', async (filePath) => {
        if (!filePath)
            return;
        try {
            await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
        }
        catch {
            vscode.window.showWarningMessage(`AgentLoop: 打不开 ${filePath}`);
        }
    }), vscode.commands.registerCommand('agentLoop.openRunDashboard', async (statePath) => {
        const panel = dashboardPanel_1.DashboardPanel.show(context.extensionUri);
        const snapshot = await monitor?.showStatePathInDashboard(statePath);
        if (snapshot)
            panel.update(snapshot);
    }), vscode.commands.registerCommand('agentLoop.openQueueTask', async (item) => {
        const taskPath = item?.taskPath;
        if (!taskPath)
            return;
        const run = await (0, stateReader_1.findLatestRunForTask)(repoRoot, taskPath);
        if (!run) {
            vscode.window.showInformationMessage(`AgentLoop: ${taskPath} 暂无运行记录`);
            return;
        }
        const panel = dashboardPanel_1.DashboardPanel.show(context.extensionUri);
        const snapshot = await monitor?.showStatePathInDashboard(run.statePath);
        if (snapshot)
            panel.update(snapshot);
    }), vscode.commands.registerCommand('agentLoop.openFinalReport', async () => {
        const uri = vscode.Uri.file((0, paths_1.latestReportPath)(repoRoot));
        await vscode.window.showTextDocument(uri, { preview: false });
    }), vscode.commands.registerCommand('agentLoop.openStateJson', async () => {
        const uri = vscode.Uri.file((0, paths_1.latestStatePath)(repoRoot));
        await vscode.window.showTextDocument(uri, { preview: false });
    }), vscode.commands.registerCommand('agentLoop.refresh', () => {
        void monitor?.refresh();
        queueTree.refresh();
        runsTree.refresh();
    }), vscode.commands.registerCommand('agentLoop.reEnableTask', async (arg) => {
        const label = typeof arg === 'string' ? arg : arg?.taskId;
        if (!label)
            return;
        const result = await (0, stateReader_1.clearAutoDisable)(repoRoot, label);
        if (result.changed) {
            vscode.window.showInformationMessage(`AgentLoop: 已重开「${label}」，清除了自动禁用，下次队列会重新尝试。`);
        }
        else {
            vscode.window.showWarningMessage(`AgentLoop:「${label}」没有自动禁用记录，无需重开。`);
        }
        queueTree.refresh();
        await monitor?.pushOverview();
    }));
}
function deactivate() {
    monitor?.dispose();
    runController?.dispose();
    output?.dispose();
}
//# sourceMappingURL=extension.js.map