import * as vscode from 'vscode';
import { DashboardPanel } from './dashboardPanel';
import { getRepoRoot, latestReportPath, latestStatePath } from './paths';
import { RunController } from './runController';
import { StateMonitor } from './stateMonitor';
import { clearAutoDisable, findLatestRunForTask } from './stateReader';
import { CurrentRunTreeProvider, QueueTreeProvider, RunsTreeProvider } from './treeProviders';

let monitor: StateMonitor | undefined;
let runController: RunController | undefined;
let output: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const repoRoot = getRepoRoot();
  if (!repoRoot) {
    vscode.window.showWarningMessage('AgentLoop: 请在包含 agent-loop/ 的仓库根目录打开工作区。');
    return;
  }

  output = vscode.window.createOutputChannel('AgentLoop');
  const currentRunTree = new CurrentRunTreeProvider();
  const queueTree = new QueueTreeProvider(repoRoot);
  const runsTree = new RunsTreeProvider(repoRoot);

  runController = new RunController(
    repoRoot,
    output,
    () => {
      monitor?.markRunStarted();
      if (vscode.workspace.getConfiguration('agentLoop').get<boolean>('openDashboardOnRun', true)) {
        DashboardPanel.show(context.extensionUri);
        void monitor?.refresh().then(() => monitor?.pushOverview());
      } else {
        void monitor?.refresh();
      }
    },
    () => {
      void monitor?.refresh();
      queueTree.refresh();
      runsTree.refresh();
    },
  );
  monitor = new StateMonitor(repoRoot, context.extensionUri, output, () => runController?.running ?? false);

  monitor.onDidUpdate((snapshot) => {
    currentRunTree.refresh(snapshot);
  });

  context.subscriptions.push(
    output,
    monitor,
    runController,
    vscode.window.registerTreeDataProvider('agentLoop.currentRun', currentRunTree),
    vscode.window.registerTreeDataProvider('agentLoop.queue', queueTree),
    vscode.window.registerTreeDataProvider('agentLoop.runs', runsTree),
    vscode.commands.registerCommand('agentLoop.runQueue', async () => {
      await runController?.runQueue();
    }),
    vscode.commands.registerCommand('agentLoop.stopRun', () => {
      runController?.stop();
    }),
    vscode.commands.registerCommand('agentLoop.openDashboard', () => {
      DashboardPanel.show(context.extensionUri);
      void monitor?.pushOverview();
    }),
    vscode.commands.registerCommand('agentLoop.showOverview', () => {
      DashboardPanel.show(context.extensionUri);
      void monitor?.pushOverview();
    }),
    vscode.commands.registerCommand('agentLoop.openFile', async (filePath?: string) => {
      if (!filePath) return;
      try {
        await vscode.window.showTextDocument(vscode.Uri.file(filePath), { preview: false });
      } catch {
        vscode.window.showWarningMessage(`AgentLoop: 打不开 ${filePath}`);
      }
    }),
    vscode.commands.registerCommand('agentLoop.openRunDashboard', async (statePath: string) => {
      const panel = DashboardPanel.show(context.extensionUri);
      const snapshot = await monitor?.showStatePathInDashboard(statePath);
      if (snapshot) panel.update(snapshot);
    }),
    vscode.commands.registerCommand('agentLoop.openQueueTask', async (item: { taskPath?: string } | undefined) => {
      const taskPath = item?.taskPath;
      if (!taskPath) return;
      const run = await findLatestRunForTask(repoRoot, taskPath);
      if (!run) {
        vscode.window.showInformationMessage(`AgentLoop: ${taskPath} 暂无运行记录`);
        return;
      }
      const panel = DashboardPanel.show(context.extensionUri);
      const snapshot = await monitor?.showStatePathInDashboard(run.statePath);
      if (snapshot) panel.update(snapshot);
    }),
    vscode.commands.registerCommand('agentLoop.openFinalReport', async () => {
      const uri = vscode.Uri.file(latestReportPath(repoRoot));
      await vscode.window.showTextDocument(uri, { preview: false });
    }),
    vscode.commands.registerCommand('agentLoop.openStateJson', async () => {
      const uri = vscode.Uri.file(latestStatePath(repoRoot));
      await vscode.window.showTextDocument(uri, { preview: false });
    }),
    vscode.commands.registerCommand('agentLoop.refresh', () => {
      void monitor?.refresh();
      queueTree.refresh();
      runsTree.refresh();
    }),
    vscode.commands.registerCommand('agentLoop.reEnableTask', async (arg: { taskId?: string } | string | undefined) => {
      const label = typeof arg === 'string' ? arg : arg?.taskId;
      if (!label) return;
      const result = await clearAutoDisable(repoRoot, label);
      if (result.changed) {
        vscode.window.showInformationMessage(`AgentLoop: 已重开「${label}」，清除了自动禁用，下次队列会重新尝试。`);
      } else {
        vscode.window.showWarningMessage(`AgentLoop:「${label}」没有自动禁用记录，无需重开。`);
      }
      queueTree.refresh();
      await monitor?.pushOverview();
    }),
  );
}

export function deactivate(): void {
  monitor?.dispose();
  runController?.dispose();
  output?.dispose();
}
