import * as vscode from 'vscode';
import { DashboardPanel } from './dashboardPanel';
import { getRepoRoot, latestReportPath, latestStatePath } from './paths';
import { RunController } from './runController';
import { StateMonitor } from './stateMonitor';
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
        const panel = DashboardPanel.show(context.extensionUri);
        void monitor?.refresh().then((snapshot) => panel.update(snapshot));
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
      const panel = DashboardPanel.show(context.extensionUri);
      const snapshot = monitor?.getSnapshot();
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
  );
}

export function deactivate(): void {
  monitor?.dispose();
  runController?.dispose();
  output?.dispose();
}