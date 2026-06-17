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
      vscode.window.showWarningMessage('AgentLoop 队列已在运行中。');
      return;
    }

    const agentLoopRoot = getAgentLoopRoot(this.repoRoot);
    const scriptPath = path.join(agentLoopRoot, 'scripts', 'run-queue.mjs');
    this.output.show(true);
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] 启动 run-queue: node ${scriptPath}`);
    this.onStarted();

    const child = spawn(process.execPath, [scriptPath], {
      cwd: agentLoopRoot,
      env: {
        ...process.env,
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
      this.output.appendLine(`[${new Date().toLocaleTimeString()}] run-queue 结束，exit=${code ?? 'null'}`);
      this.child = null;
      this.onFinished(code);
    });
    child.on('error', (error) => {
      this.output.appendLine(`run-queue 启动失败: ${error.message}`);
      this.child = null;
      this.onFinished(null);
    });
  }

  stop(): void {
    if (!this.child) return;
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] 请求停止 run-queue`);
    this.child.kill('SIGTERM');
  }

  dispose(): void {
    this.stop();
  }
}