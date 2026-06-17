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
exports.DashboardPanel = void 0;
const vscode = __importStar(require("vscode"));
const phaseLabels_1 = require("./phaseLabels");
class DashboardPanel {
    static current;
    panel;
    disposables = [];
    constructor(panel, extensionUri) {
        this.panel = panel;
        this.panel.webview.html = this.getHtml(extensionUri);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage((message) => {
            if (message?.type === 'ready') {
                // no-op; host pushes snapshots
            }
        }, null, this.disposables);
    }
    static show(extensionUri) {
        if (DashboardPanel.current) {
            DashboardPanel.current.panel.reveal(vscode.ViewColumn.Beside);
            return DashboardPanel.current;
        }
        const panel = vscode.window.createWebviewPanel('agentLoopDashboard', 'AgentLoop 运行面板', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        });
        DashboardPanel.current = new DashboardPanel(panel, extensionUri);
        return DashboardPanel.current;
    }
    update(snapshot) {
        const gateOk = snapshot.state?.baselineGate?.ok;
        const gateText = gateOk === true
            ? '绿灯'
            : gateOk === false
                ? `红灯 (${snapshot.state?.baselineGate?.failureCount ?? '?'})`
                : '未运行';
        const agentText = (0, phaseLabels_1.activeAgentLabel)(snapshot.state?.status, snapshot.state, {
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
                elapsedText: (0, phaseLabels_1.formatElapsed)(snapshot.elapsedMs),
                gateText,
                gateOk,
                agentText: `${agentText}${agentSuffix}`,
                pipelineSteps: snapshot.pipelineSteps,
                roleText: `${snapshot.fixAgent}修${snapshot.reviewAgent ? ` + ${snapshot.reviewAgent}审` : ''}`,
            },
        });
    }
    getHtml(extensionUri) {
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
  <h1 id="title">AgentLoop</h1>
  <div class="subtitle" id="subtitle">等待运行</div>
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
    dispose() {
        DashboardPanel.current = undefined;
        while (this.disposables.length) {
            const item = this.disposables.pop();
            item?.dispose();
        }
        this.panel.dispose();
    }
}
exports.DashboardPanel = DashboardPanel;
//# sourceMappingURL=dashboardPanel.js.map