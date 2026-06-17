import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getAgentLoopRoot } from './paths';

export class RunController implements vscode.Disposable {
  private child: ChildProcess | null = null;

  constructor(
    private readonly repoRoot: string,
    private readonly output: vscode.OutputChannel,
    private readonly onStarted: () => void,
    private readonly onFinished: (exitCode: number | null) => void,
  ) {}

  get running(): boolean {
    return this.child !== null;
  }

  async runQueue(): Promise<void> {
    if (this.child) {
      vscode.window.showWarningMessage('AgentLoop 任务队列已在运行中。');
      return;
    }

    const agentLoopRoot = getAgentLoopRoot(this.repoRoot);
    const scriptPath = path.join(agentLoopRoot, 'scripts', 'run-queue.mjs');
    this.output.show(true);
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] 启动任务队列: node ${scriptPath}`);
    await setQueueRunning(true);
    this.onStarted();

    const child = spawn(process.execPath, [scriptPath], {
      cwd: agentLoopRoot,
      env: {
        ...process.env,
        // In the VS Code extension host, process.execPath is the Electron (Code.exe) binary,
        // NOT node. Without this flag spawning it would launch VS Code instead of running the
        // queue script. ELECTRON_RUN_AS_NODE makes the same binary behave as node, and it
        // propagates to the loop.js child processes run-queue.mjs spawns (also via execPath).
        ELECTRON_RUN_AS_NODE: '1',
        AGENT_LOOP_PROGRESS: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.output.append(chunk.toString());
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.output.append(chunk.toString());
    });
    child.on('close', (code) => {
      void this.finishRun(code);
    });
    child.on('error', (error) => {
      this.output.appendLine(`任务队列启动失败: ${error.message}`);
      void this.finishRun(null);
    });
  }

  stop(): void {
    if (!this.child) {
      vscode.window.showInformationMessage('AgentLoop 当前没有运行中的任务队列。');
      return;
    }
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] 请求停止任务队列`);
    this.child.kill('SIGTERM');
  }

  private async finishRun(exitCode: number | null): Promise<void> {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] 任务队列结束，exit=${exitCode ?? 'null'}`);
    this.child = null;
    await setQueueRunning(false);
    this.onFinished(exitCode);
  }

  dispose(): void {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
      void setQueueRunning(false);
    }
  }
}

async function setQueueRunning(running: boolean): Promise<void> {
  await vscode.commands.executeCommand('setContext', 'agentLoop.queueRunning', running);
}