import * as path from 'node:path';
import * as vscode from 'vscode';
import { phaseLabel, statusIcon } from './phaseLabels';
import { queuePath, runsDir } from './paths';
import { readJsonFile, listRecentRuns } from './stateReader';
import type { QueueFile, RunSnapshot, RunSummaryItem } from './types';

type TreeNode = CurrentRunNode | QueueRootNode | QueueTaskNode | RunsRootNode | RunHistoryNode;

abstract class BaseNode extends vscode.TreeItem {
  constructor(
    public readonly key: string,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.id = key;
  }
}

class CurrentRunNode extends BaseNode {
  constructor(snapshot: RunSnapshot | null) {
    const status = snapshot?.displayStatus ?? snapshot?.state?.status;
    const label = status ? `${phaseLabel(status)} / ${snapshot?.taskLabel}` : '暂无活动运行';
    super('current-run', label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(statusIcon(status).replace(/^\$\((.+)\)$/, '$1'));
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
  constructor(count: number) {
    super('queue-root', `任务队列 (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('list-tree');
  }
}

class QueueTaskNode extends BaseNode {
  constructor(
    public readonly taskId: string,
    public readonly taskPath: string,
    enabled: boolean,
  ) {
    super(`queue-${taskId}`, taskId, vscode.TreeItemCollapsibleState.None);
    this.description = enabled ? '' : 'disabled';
    this.iconPath = new vscode.ThemeIcon(enabled ? 'circle-outline' : 'circle-slash');
    this.tooltip = taskPath;
    this.command = {
      command: 'agentLoop.openQueueTask',
      title: '打开任务运行面板',
      arguments: [{ taskId, taskPath }],
    };
  }
}

class RunsRootNode extends BaseNode {
  constructor(count: number) {
    super('runs-root', `最近运行 (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('history');
  }
}

class RunHistoryNode extends BaseNode {
  constructor(public readonly run: RunSummaryItem & { stateUri: string }) {
    const shortTask = run.task.split('/').pop() || run.task;
    super(`run-${run.runId}`, shortTask, vscode.TreeItemCollapsibleState.None);
    this.description = run.status;
    this.iconPath = new vscode.ThemeIcon(statusIcon(run.status).replace(/^\$\((.+)\)$/, '$1'));
    this.tooltip = [
      run.runId,
      `模式: ${run.runMode}`,
      `工人: ${run.fixAgent} / 审查: ${run.reviewAgent || '-'}`,
      `Grok: ${run.grokRan ? '是' : '否'} / Codex: ${run.codexRan ? '是' : '否'}`,
      `迭代: ${run.iterations}`,
    ].join('\n');
    this.command = {
      command: 'agentLoop.openRunDashboard',
      title: '打开运行 state.json',
      arguments: [run.stateUri],
    };
  }
}

export class CurrentRunTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private snapshot: RunSnapshot | null = null;

  refresh(snapshot: RunSnapshot | null): void {
    this.snapshot = snapshot;
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element) return [];
    return [new CurrentRunNode(this.snapshot)];
  }
}

export class QueueTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly repoRoot: string) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    if (element instanceof QueueRootNode) {
      const queue = await readJsonFile<QueueFile>(queuePath(this.repoRoot));
      const tasks = (queue?.tasks || []).filter((task) => task.enabled !== false);
      return tasks.map((task) => new QueueTaskNode(task.id || task.task, task.task, task.enabled !== false));
    }
    if (!element) {
      const queue = await readJsonFile<QueueFile>(queuePath(this.repoRoot));
      const tasks = (queue?.tasks || []).filter((task) => task.enabled !== false);
      return [new QueueRootNode(tasks.length)];
    }
    return [];
  }
}

export class RunsTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly repoRoot: string) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
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

  private async loadRuns(): Promise<Array<RunSummaryItem & { stateUri: string }>> {
    const runs = await listRecentRuns(this.repoRoot, 15);
    return runs.map((run) => ({
      ...run,
      stateUri: path.join(runsDir(this.repoRoot), run.runId, 'state.json'),
    }));
  }
}
