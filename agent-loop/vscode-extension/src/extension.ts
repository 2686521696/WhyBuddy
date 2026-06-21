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
    vscode.commands.registerCommand('agentLoop.previewLanding', async () => {
      const code = await runController?.runScript('land-queue.mjs', ['--repo', repoRoot, '--check']);
      if (code === 0) {
        vscode.window.showInformationMessage('AgentLoop: 预演通过，队列改动可以干净落地到 main。');
      } else {
        vscode.window.showWarningMessage('AgentLoop: 预演发现冲突或无可落地内容，详见 AgentLoop 输出面板。');
      }
    }),
    vscode.commands.registerCommand('agentLoop.applyLanding', async () => {
      const choice = await vscode.window.showWarningMessage(
        '落地到 main？会把队列合并 diff 应用到当前 main 工作树（不自动 commit，落地后请自行检查并提交）。',
        { modal: true },
        '落地到 main',
      );
      if (choice !== '落地到 main') return;
      const code = await runController?.runScript('land-queue.mjs', ['--repo', repoRoot]);
      if (code === 0) {
        vscode.window.showInformationMessage('AgentLoop: 已落地到 main，请检查 git 改动后再 commit。');
        await monitor?.pushOverview();
      } else {
        vscode.window.showErrorMessage('AgentLoop: 落地失败（可能有冲突），main 未改动，详见输出面板。');
      }
    }),
    vscode.commands.registerCommand('agentLoop.runTask', async (arg: { task?: string } | string | undefined) => {
      const target = typeof arg === 'string' ? arg : arg?.task;
      if (!target) return;
      const short = target.split('/').pop()?.replace(/\.md$/, '') || target;
      const choice = await vscode.window.showWarningMessage(
        `单跑「${short}」？会启动一次修复/审查运行（创建 worktree、调用 agent，不改动 main）。`,
        { modal: true },
        '单跑',
      );
      if (choice !== '单跑') return;
      await runController?.runQueue(['--only', target]);
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
