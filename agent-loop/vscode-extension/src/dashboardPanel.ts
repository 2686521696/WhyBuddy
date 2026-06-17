import * as vscode from 'vscode';
import { activeAgentLabel, formatElapsed } from './phaseLabels';
import type { RunSnapshot } from './types';

export class DashboardPanel {
  public static current: DashboardPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml(extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.type === 'ready') {
        return;
      }
      if (message?.type === 'runQueue') {
        void vscode.commands.executeCommand('agentLoop.runQueue');
        return;
      }
      if (message?.type === 'stopRun') {
        vscode.commands.executeCommand('agentLoop.stopRun');
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
      'AgentLoop 运行面板',
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

  public update(snapshot: RunSnapshot): void {
    const gateOk = snapshot.state?.baselineGate?.ok;
    const gateText = gateOk === true
      ? '绿灯'
      : gateOk === false
        ? `红灯 (${snapshot.state?.baselineGate?.failureCount ?? '?'})`
        : '未运行';

    const agentText = activeAgentLabel(snapshot.state?.status, snapshot.state, {
      fixAgent: snapshot.fixAgent,
      reviewAgent: snapshot.reviewAgent,
    });
    const agentSuffix = snapshot.agentLogBytes
      ? ` · log ${Math.max(1, Math.round(snapshot.agentLogBytes / 1024))}KB`
      : '';

    this.panel.webview.postMessage({
      type: 'snapshot',
      payload: {
        ...snapshot,
        elapsedText: formatElapsed(snapshot.elapsedMs),
        gateText,
        gateOk,
        agentText: `${agentText}${agentSuffix}`,
        pipelineSteps: snapshot.pipelineSteps,
        roleText: `${snapshot.fixAgent}修${snapshot.reviewAgent ? ` + ${snapshot.reviewAgent}审` : ''}`,
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
  <title>AgentLoop Dashboard</title>
</head>
<body>
  <div class="header">
    <div>
      <h1 id="title">AgentLoop</h1>
      <div class="subtitle" id="subtitle">等待运行</div>
    </div>
    <div class="toolbar" id="toolbar">
      <button class="action" id="runBtn" type="button">运行任务队列</button>
      <button class="action danger" id="stopBtn" type="button">停止</button>
    </div>
  </div>
  <div class="roles" id="roles"></div>
  <div class="pipeline" id="pipeline"></div>
  <div class="grid">
    <div class="card"><h2>阶段</h2><div class="value" id="status">—</div></div>
    <div class="card"><h2>状态码</h2><div class="value" id="phase">—</div></div>
    <div class="card"><h2>总耗时</h2><div class="value" id="elapsed">—</div></div>
    <div class="card"><h2>Gate</h2><div class="value" id="gate">—</div></div>
    <div class="card"><h2>Agent</h2><div class="value" id="agent">—</div></div>
  </div>
  <h2>Agent 最新输出</h2>
  <div class="log" id="log">暂无输出</div>
  <div class="meta" id="meta"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    DashboardPanel.current = undefined;
    while (this.disposables.length) {
      const item = this.disposables.pop();
      item?.dispose();
    }
    this.panel.dispose();
  }
}