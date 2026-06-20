import * as path from 'node:path';
import * as vscode from 'vscode';
import { activeAgentLabel, formatElapsed, phaseLabel } from './phaseLabels';
import type { QueueOverview, RunSnapshot } from './types';

export type DashboardView = 'overview' | 'detail';

export class DashboardPanel {
  public static current: DashboardPanel | undefined;
  public view: DashboardView = 'overview';
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => {
      switch (message?.type) {
        case 'runQueue':
          void vscode.commands.executeCommand('agentLoop.runQueue');
          return;
        case 'stopRun':
          void vscode.commands.executeCommand('agentLoop.stopRun');
          return;
        case 'refresh':
          void vscode.commands.executeCommand('agentLoop.refresh');
          return;
        case 'showOverview':
          this.view = 'overview';
          void vscode.commands.executeCommand('agentLoop.showOverview');
          return;
        case 'openTask':
          if (message.taskPath) {
            void vscode.commands.executeCommand('agentLoop.openQueueTask', { taskPath: message.taskPath });
          }
          return;
        case 'openReport':
          void vscode.commands.executeCommand('agentLoop.openFile', message.reportPath);
          return;
        case 'openState':
          void vscode.commands.executeCommand('agentLoop.openFile', message.statePath);
          return;
        default:
      }
    }, null, this.disposables);
  }

  public static show(extensionUri: vscode.Uri): DashboardPanel {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return DashboardPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'agentLoopDashboard',
      'AgentLoop 面板',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );

    DashboardPanel.current = new DashboardPanel(panel, extensionUri);
    return DashboardPanel.current;
  }

  public showOverview(overview: QueueOverview, current: RunSnapshot | null): void {
    this.view = 'overview';
    this.panel.webview.postMessage({
      type: 'overview',
      payload: {
        counts: overview.counts,
        queueRunning: overview.queueRunning,
        tasks: overview.tasks.map((task) => ({
          ...task,
          taskLabel: shortTaskLabel(task.task),
          statusLabel: task.status ? phaseLabel(task.status) : null,
          badge: badgeFor(task),
        })),
        current: current?.state
          ? {
            taskLabel: current.taskLabel,
            status: current.displayStatus ?? current.state.status ?? null,
            phaseLabel: current.phaseLabel,
            elapsedText: formatElapsed(current.elapsedMs),
            staleRun: current.staleRun,
          }
          : null,
      },
    });
  }

  public update(snapshot: RunSnapshot): void {
    this.view = 'detail';
    const state = snapshot.state;
    const displayStatus = snapshot.displayStatus ?? state?.status ?? null;
    const agentText = activeAgentLabel(displayStatus ?? undefined, state, {
      fixAgent: snapshot.fixAgent,
      reviewAgent: snapshot.reviewAgent,
    });
    const runDir = state?.artifacts?.runDir || null;

    this.panel.webview.postMessage({
      type: 'detail',
      payload: {
        taskLabel: snapshot.taskLabel,
        runId: state?.runId ?? null,
        status: displayStatus,
        rawStatus: state?.status ?? null,
        phaseLabel: snapshot.phaseLabel,
        elapsedText: formatElapsed(snapshot.elapsedMs),
        gateText: snapshot.displayGate.text,
        gateOk: snapshot.displayGate.ok,
        agentText,
        agentLogKb: snapshot.agentLogBytes ? Math.max(1, Math.round(snapshot.agentLogBytes / 1024)) : 0,
        roleText: `${snapshot.fixAgent}修${snapshot.reviewAgent ? ` + ${snapshot.reviewAgent}审` : ''}`,
        runMode: snapshot.runMode,
        pipelineSteps: snapshot.pipelineSteps,
        agentTail: snapshot.agentTail,
        details: snapshot.details,
        staleRun: snapshot.staleRun,
        iterations: summarizeIterations(state),
        reviewRounds: (state?.reviewRounds ?? []).map((round) => ({
          round: round.round ?? null,
          verdict: round.verdict ?? null,
          decision: round.decision ?? null,
          summary: round.summary ?? null,
          riskLevel: round.riskLevel ?? null,
          applyRecommendation: round.applyRecommendation ?? null,
          verifiedBoundaries: Array.isArray(round.verifiedBoundaries) ? round.verifiedBoundaries : [],
          findings: Array.isArray(round.findings) ? round.findings : [],
        })),
        halt: buildHaltInfo(state),
        landing: snapshot.landing,
        finalReport: snapshot.finalReport,
        guardPolicy: snapshot.guardPolicy,
        statePath: snapshot.statePath ?? null,
        reportPath: runDir ? path.join(runDir, 'final-report.md') : null,
        reportJsonPath: runDir ? path.join(runDir, 'final-report.json') : null,
        landingPath: runDir ? path.join(runDir, 'landing.json') : null,
      },
    });
  }

  private getHtml(extensionUri: vscode.Uri): string {
    const styleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dashboard.css'));
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dashboard.js'));
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource}; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}">
  <title>AgentLoop</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}

function summarizeIterations(state: RunSnapshot['state']): Array<{
  iteration: number;
  gateOk: boolean | null;
  failureCount: number | null;
  diffBytes: number;
  guard: boolean;
  attempts: number;
}> {
  const iterations = Array.isArray(state?.iterations) ? state!.iterations : [];
  return iterations.map((iteration) => ({
    iteration: iteration.iteration,
    gateOk: iteration.gate ? iteration.gate.ok ?? null : null,
    failureCount: iteration.gate?.failureCount ?? null,
    diffBytes: iteration.diff?.bytes ?? 0,
    guard: Boolean(iteration.diffGuard?.hasFindings),
    attempts: Array.isArray(iteration.attempts) ? iteration.attempts.length : 0,
  }));
}

function buildHaltInfo(state: RunSnapshot['state']): { status: string; reason: string | null } | null {
  const status = state?.status;
  if (!status || !status.startsWith('HALT_')) return null;
  let reason: string | null = null;
  if (status === 'HALT_NO_SUCCESS_CRITERIA') reason = state?.admission?.reason ?? 'NO_SUCCESS_CRITERIA';
  else if (state?.guardReason) reason = state.guardReason;
  else if (state?.reviewVerdict) reason = `review: ${state.reviewVerdict}`;
  return { status, reason };
}

function shortTaskLabel(taskPath: string): string {
  return (taskPath.split('/').pop() || taskPath).replace(/\.md$/, '');
}

function badgeFor(task: { running: boolean; outcome: string | null; enabled: boolean; autoDisabled: boolean }): string {
  if (task.running) return 'running';
  if (!task.enabled) return 'disabled';
  if (task.autoDisabled) return 'disabled';
  if (task.outcome) return task.outcome;
  return 'pending';
}
