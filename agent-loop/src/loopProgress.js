import path from 'node:path';
import { stripAnsi } from './ansi.js';
import { describeLoopSnapshot, formatElapsed } from './runQueueProgress.js';

export function shouldEmitLoopProgress(env = process.env) {
  return env.AGENT_LOOP_PROGRESS === '1' || env.AGENT_LOOP_PROGRESS === 'true';
}

export function formatLoopStateLine(state, startedAt = Date.now()) {
  const snapshot = describeLoopSnapshot(state);
  const parts = [`[agent-loop] ${snapshot.label} (${snapshot.status})`];
  if (snapshot.details.length) parts.push(snapshot.details.join(' · '));
  parts.push(`elapsed ${formatElapsed(Date.now() - startedAt)}`);
  return parts.join(' | ');
}

export function tailAgentLine(text, maxLen = 140) {
  const lines = stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1) || '';
  return last.length > maxLen ? `${last.slice(0, maxLen - 1)}…` : last;
}

export function formatAgentProgressLine({ agent, phase, tail, stderrBytes, startedAt = Date.now() }) {
  const sizeKb = stderrBytes ? `${Math.max(1, Math.round(stderrBytes / 1024))}KB` : null;
  const parts = [
    `[agent-loop] ${agent} › ${phase}`,
    tail ? tail : '等待输出…',
  ];
  if (sizeKb) parts.push(`log ${sizeKb}`);
  parts.push(`elapsed ${formatElapsed(Date.now() - startedAt)}`);
  return parts.join(' | ');
}

export function basenameFixCwd(fixCwd) {
  return fixCwd ? path.basename(fixCwd) : null;
}

export function createAgentStderrReporter({
  agent,
  phase,
  appendArtifact,
  clearArtifact,
  onProgress,
  artifactName,
  minEmitMs = 5000,
  now = () => Date.now(),
}) {
  let buffer = '';
  let lastEmitAt = 0;
  let lastTail = '';

  return {
    reset: async () => {
      buffer = '';
      lastEmitAt = 0;
      lastTail = '';
      if (clearArtifact) {
        await clearArtifact(artifactName, '');
      }
    },
    onStderr: (chunk) => {
      buffer += chunk;
      if (appendArtifact) {
        appendArtifact(artifactName, chunk).catch(() => {});
      }

      const current = now();
      const tail = tailAgentLine(buffer);
      const tailChanged = tail && tail !== lastTail;
      const due = current - lastEmitAt >= minEmitMs;
      const interesting = /succeeded in|exited|ERROR|FAIL|✔|❯|exec/.test(chunk);

      if (!onProgress || !tail) return;
      if (!due && !interesting && !tailChanged) return;

      lastEmitAt = current;
      lastTail = tail;
      onProgress({
        agent,
        phase,
        tail,
        stderrBytes: Buffer.byteLength(buffer, 'utf8'),
      });
    },
    getBuffer: () => buffer,
  };
}