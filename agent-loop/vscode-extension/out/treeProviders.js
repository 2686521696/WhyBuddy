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
exports.RunsTreeProvider = exports.QueueTreeProvider = exports.CurrentRunTreeProvider = void 0;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const phaseLabels_1 = require("./phaseLabels");
const paths_1 = require("./paths");
const stateReader_1 = require("./stateReader");
class BaseNode extends vscode.TreeItem {
    key;
    constructor(key, label, collapsibleState) {
        super(label, collapsibleState);
        this.key = key;
        this.id = key;
    }
}
class CurrentRunNode extends BaseNode {
    constructor(snapshot) {
        const status = snapshot?.state?.status;
        const label = status ? `${(0, phaseLabels_1.phaseLabel)(status)} · ${snapshot?.taskLabel}` : '暂无活动运行';
        super('current-run', label, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon((0, phaseLabels_1.statusIcon)(status).replace(/^\$\((.+)\)$/, '$1'));
        this.description = snapshot?.state?.runId || '';
        this.tooltip = [
            snapshot?.phaseLabel || '空闲',
            ...(snapshot?.details || []),
            snapshot?.agentTail ? `\n---\n${snapshot.agentTail}` : '',
        ].join('\n');
        this.contextValue = 'currentRun';
        this.command = {
            command: 'agentLoop.openDashboard',
            title: '打开面板',
        };
    }
}
class QueueRootNode extends BaseNode {
    constructor(count) {
        super('queue-root', `任务队列 (${count})`, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('list-tree');
    }
}
class QueueTaskNode extends BaseNode {
    taskId;
    taskPath;
    constructor(taskId, taskPath, enabled) {
        super(`queue-${taskId}`, taskId, vscode.TreeItemCollapsibleState.None);
        this.taskId = taskId;
        this.taskPath = taskPath;
        this.description = enabled ? '' : 'disabled';
        this.iconPath = new vscode.ThemeIcon(enabled ? 'circle-outline' : 'circle-slash');
        this.tooltip = taskPath;
    }
}
class RunsRootNode extends BaseNode {
    constructor(count) {
        super('runs-root', `最近运行 (${count})`, vscode.TreeItemCollapsibleState.Expanded);
        this.iconPath = new vscode.ThemeIcon('history');
    }
}
class RunHistoryNode extends BaseNode {
    run;
    constructor(run) {
        const shortTask = run.task.split('/').pop() || run.task;
        super(`run-${run.runId}`, shortTask, vscode.TreeItemCollapsibleState.None);
        this.run = run;
        this.description = run.status;
        this.iconPath = new vscode.ThemeIcon((0, phaseLabels_1.statusIcon)(run.status).replace(/^\$\((.+)\)$/, '$1'));
        this.tooltip = [
            run.runId,
            `模式: ${run.runMode}`,
            `工人: ${run.fixAgent} · 审查: ${run.reviewAgent || '—'}`,
            `Grok: ${run.grokRan ? '是' : '否'} · Codex: ${run.codexRan ? '是' : '否'}`,
            `迭代: ${run.iterations}`,
        ].join('\n');
        this.command = {
            command: 'vscode.open',
            title: '打开运行 state.json',
            arguments: [vscode.Uri.file(run.stateUri)],
        };
    }
}
class CurrentRunTreeProvider {
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    snapshot = null;
    refresh(snapshot) {
        this.snapshot = snapshot;
        this.emitter.fire();
    }
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element)
            return [];
        return [new CurrentRunNode(this.snapshot)];
    }
}
exports.CurrentRunTreeProvider = CurrentRunTreeProvider;
class QueueTreeProvider {
    repoRoot;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    constructor(repoRoot) {
        this.repoRoot = repoRoot;
    }
    refresh() {
        this.emitter.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof QueueRootNode) {
            const queue = await (0, stateReader_1.readJsonFile)((0, paths_1.queuePath)(this.repoRoot));
            const tasks = (queue?.tasks || []).filter((task) => task.enabled !== false);
            return tasks.map((task) => new QueueTaskNode(task.id || task.task, task.task, task.enabled !== false));
        }
        if (!element) {
            const queue = await (0, stateReader_1.readJsonFile)((0, paths_1.queuePath)(this.repoRoot));
            const tasks = (queue?.tasks || []).filter((task) => task.enabled !== false);
            return [new QueueRootNode(tasks.length)];
        }
        return [];
    }
}
exports.QueueTreeProvider = QueueTreeProvider;
class RunsTreeProvider {
    repoRoot;
    emitter = new vscode.EventEmitter();
    onDidChangeTreeData = this.emitter.event;
    constructor(repoRoot) {
        this.repoRoot = repoRoot;
    }
    refresh() {
        this.emitter.fire();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (element instanceof RunsRootNode) {
            const runs = await this.loadRuns();
            return runs.map((run) => new RunHistoryNode(run));
        }
        if (!element) {
            const runs = await this.loadRuns();
            return [new RunsRootNode(runs.length)];
        }
        return [];
    }
    async loadRuns() {
        const runs = await (0, stateReader_1.listRecentRuns)(this.repoRoot, 15);
        return runs.map((run) => ({
            ...run,
            stateUri: path.join((0, paths_1.runsDir)(this.repoRoot), run.runId, 'state.json'),
        }));
    }
}
exports.RunsTreeProvider = RunsTreeProvider;
//# sourceMappingURL=treeProviders.js.map