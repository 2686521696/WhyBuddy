import * as path from 'node:path';
import * as vscode from 'vscode';
import { activeAgentLabel, formatElapsed, phaseLabel } from './phaseLabels';
import { normalizeSaveSettingsPayload } from './settingsMessages';
import { extractRunEvidence } from './stateReader';
import type { QueueOverview, RunSnapshot } from './types';

export type DashboardView = 'overview' | 'detail';

export class DashboardPanel {
  public static current: DashboardPanel | undefined;
  public view: DashboardView = 'overview';
  private readonly panel: vscode.WebviewPanel;
  private secrets?: vscode.SecretStorage;
  private disposables: vscode.Disposable[] = [];
  private lastMessage: unknown = null;

  private post(message: unknown): void {
    this.lastMessage = message;
    void this.panel.webview.postMessage(message);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, secrets?: vscode.SecretStorage) {
    this.panel = panel;
    this.secrets = secrets;
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
        case 'reEnable':
          if (message.taskId) {
            void vscode.commands.executeCommand('agentLoop.reEnableTask', { taskId: message.taskId });
          }
          return;
        case 'runTask':
          if (message.task) {
            void vscode.commands.executeCommand('agentLoop.runTask', { task: message.task });
          }
          return;
        case 'previewLanding':
          void vscode.commands.executeCommand('agentLoop.previewLanding');
          return;
        case 'applyLanding':
          void vscode.commands.executeCommand('agentLoop.applyLanding');
          return;
        case 'openReport':
          void vscode.commands.executeCommand('agentLoop.openFile', message.reportPath);
          return;
        case 'openState':
          void vscode.commands.executeCommand('agentLoop.openFile', message.statePath);
          return;
        case 'getSettings':
          void this.sendSettings();
          return;
        case 'saveSettings':
          void this.handleSaveSettings(normalizeSaveSettingsPayload(message));
          return;
        default:
      }
    }, null, this.disposables);
  }

  public static show(extensionUri: vscode.Uri, secrets?: vscode.SecretStorage): DashboardPanel {
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

    DashboardPanel.current = new DashboardPanel(panel, extensionUri, secrets);
    return DashboardPanel.current;
  }

  public showOverview(overview: QueueOverview, current: RunSnapshot | null): void {
    this.view = 'overview';
    this.panel.webview.postMessage({
      type: 'overview',
      payload: {
        counts: overview.counts,
        queueRunning: overview.queueRunning,
        landing: overview.landing ?? null,
        tasks: overview.tasks.map((task) => ({
          ...task,
          taskLabel: shortTaskLabel(task.task),
          statusLabel: task.status ? phaseLabel(task.status) : null,
          badge: badgeFor(task),
          applyErrorFiles: task.applyErrorFiles ?? [],
          applyErrorKind: task.applyErrorKind ?? null,
          applyError: task.applyError ?? null,
          worktreeErrorFiles: task.worktreeErrorFiles ?? [],
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

  private async sendSettings() {
    const config = vscode.workspace.getConfiguration('agentLoop');

    const nonSensitive = {
      fixAgent: config.get<string>('fixAgent', 'grok'),
      reviewAgent: config.get<string>('reviewAgent', 'codex'),
      workerMaxTurns: config.get<number>('workerMaxTurns', 128),
      workerMaxRetries: config.get<number>('workerMaxRetries', 2),
      queuePath: config.get<string>('queuePath', 'agent-loop/scripts/migration-queue.json'),
      worktreeScope: config.get<string>('worktreeScope', 'queue'),
    };

    const keysStatus: Record<string, string> = {
      grokApiKey: '',
      openaiApiKey: '',
      anthropicApiKey: '',
    };

    if (this.secrets) {
      keysStatus.grokApiKey = (await this.secrets.get('agentLoop.grokApiKey')) ? 'configured' : '';
      keysStatus.openaiApiKey = (await this.secrets.get('agentLoop.openaiApiKey')) ? 'configured' : '';
      keysStatus.anthropicApiKey = (await this.secrets.get('agentLoop.anthropicApiKey')) ? 'configured' : '';
    }

    this.post({
      type: 'settings',
      payload: {
        nonSensitive,
        keys: keysStatus,
        baseUrl: config.get<string>('baseUrl', ''),
        injectToWorker: config.get<boolean>('injectKeysToWorker', true),
      },
    });
  }

  private async handleSaveSettings(payload: Record<string, any>) {
    const config = vscode.workspace.getConfiguration('agentLoop');
    const promises: Thenable<unknown>[] = [];

    // Non-sensitive settings -> workspace configuration
    const nonSecretKeys = ['fixAgent', 'reviewAgent', 'workerMaxTurns', 'workerMaxRetries', 'queuePath', 'worktreeScope', 'baseUrl'] as const;
    for (const key of nonSecretKeys) {
      if (payload[key] !== undefined) {
        const target = key === 'queuePath' || key === 'baseUrl' ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Workspace;
        promises.push(config.update(key as string, payload[key], target));
      }
    }
    if (payload.injectToWorker !== undefined) {
      promises.push(config.update('injectKeysToWorker', payload.injectToWorker, vscode.ConfigurationTarget.Workspace));
    }

    // Sensitive keys -> SecretStorage (never log plaintext)
    if (this.secrets) {
      if (typeof payload.grokApiKey === 'string' && payload.grokApiKey) {
        promises.push(this.secrets.store('agentLoop.grokApiKey', payload.grokApiKey));
      }
      if (typeof payload.openaiApiKey === 'string' && payload.openaiApiKey) {
        promises.push(this.secrets.store('agentLoop.openaiApiKey', payload.openaiApiKey));
      }
      if (typeof payload.anthropicApiKey === 'string' && payload.anthropicApiKey) {
        promises.push(this.secrets.store('agentLoop.anthropicApiKey', payload.anthropicApiKey));
      }
      // Support explicit clear with empty string
      if (payload.grokApiKey === '') {
        promises.push(this.secrets.delete('agentLoop.grokApiKey'));
      }
      if (payload.openaiApiKey === '') {
        promises.push(this.secrets.delete('agentLoop.openaiApiKey'));
      }
      if (payload.anthropicApiKey === '') {
        promises.push(this.secrets.delete('agentLoop.anthropicApiKey'));
      }
    }

    await Promise.all(promises);

    // Refresh UI with latest
    await this.sendSettings();
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
    const evidence = extractRunEvidence(state);

    this.panel.webview.postMessage({
      type: 'detail',
      payload: {
        taskPath: state?.options?.task ?? null,
        diffText: evidence.diffText,
        diffTruncated: evidence.diffTruncated,
        hasDiff: evidence.hasDiff,
        gateFailure: evidence.gateFailure,
        gateFailureTruncated: evidence.gateFailureTruncated,
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
        fixAgent: snapshot.fixAgent,
        reviewAgent: snapshot.reviewAgent,
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
        events: (snapshot.events ?? []).map((event) => ({
          status: event.status,
          label: phaseLabel(event.status),
          timeText: formatClock(event.ts),
          iteration: event.iteration,
        })),
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
    const bundleStyleUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dashboard.bundle.css'));
    const bundleScriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dashboard.bundle.js'));
    const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'dashboard.js'));
    const brandUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sliderule-brand.svg'));
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${this.panel.webview.cspSource} data:; style-src ${this.panel.webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}">
  <link rel="stylesheet" href="${bundleStyleUri}">
  <title>AgentLoop</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.__AGENT_LOOP_ASSETS__ = { brandLogo: ${JSON.stringify(String(brandUri))} }; window.__AGENT_LOOP_CSP_NONCE__ = ${JSON.stringify(nonce)};</script>
  <script nonce="${nonce}" src="${bundleScriptUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
  <!-- Theme sync for robust --vscode-* variable bridging.
       VS Code updates body classes on theme change, so main CSS rules (body.vscode-*) react automatically.
       The data attr is a small helper for attribute-based rules. A full MutationObserver is overkill for now. -->
  <script nonce="${nonce}">(function(){try{var k=document.body.className.match(/vscode-(light|dark|high-contrast)/);if(k)document.documentElement.setAttribute('data-vscode-theme-kind',k[0]);}catch(e){}})();</script>
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

function formatClock(ts: string | null): string {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function shortTaskLabel(taskPath: string): string {
  return (taskPath.split('/').pop() || taskPath).replace(/\.md$/, '');
}

function badgeFor(task: {
  running: boolean;
  outcome: string | null;
  outcomeGroup?: string | null;
  enabled: boolean;
  autoDisabled: boolean;
}): string {
  if (task.running) return 'running';
  if (!task.enabled) return 'disabled';
  if (task.autoDisabled) return 'disabled';
  if (task.outcomeGroup) return task.outcomeGroup;
  if (task.outcome) return task.outcome;
  return 'pending';
}
