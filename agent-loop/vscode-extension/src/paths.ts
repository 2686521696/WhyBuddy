import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export function getRepoRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return null;

  for (const folder of folders) {
    const candidate = path.join(folder.uri.fsPath, 'agent-loop', 'package.json');
    if (existsSync(candidate)) return folder.uri.fsPath;
  }

  return folders[0].uri.fsPath;
}

export function getAgentLoopRoot(repoRoot: string): string {
  return path.join(repoRoot, 'agent-loop');
}

export function latestDir(repoRoot: string): string {
  return path.join(repoRoot, '.agent-loop', 'latest');
}

export function latestStatePath(repoRoot: string): string {
  return path.join(latestDir(repoRoot), 'state.json');
}

export function latestReportPath(repoRoot: string): string {
  return path.join(latestDir(repoRoot), 'final-report.md');
}

export function runsDir(repoRoot: string): string {
  return path.join(repoRoot, '.agent-loop', 'runs');
}

export function queuePath(repoRoot: string): string {
  const configured = vscode.workspace.getConfiguration('agentLoop').get<string>('queuePath')
    || 'agent-loop/scripts/migration-queue.json';
  return path.isAbsolute(configured) ? configured : path.join(repoRoot, configured);
}

function existsSync(filePath: string): boolean {
  try {
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}