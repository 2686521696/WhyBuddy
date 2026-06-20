import { spawn } from 'node:child_process';

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = 120000,
    env = process.env,
    input,
    onStdout,
    onStderr,
    signal,
    idleTimeoutMs = null,
  } = options;

  return new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let idleTimedOut = false;
    let aborted = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    let idleTimer = null;
    const resetIdleTimer = () => {
      if (!idleTimeoutMs) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        child.kill('SIGTERM');
      }, idleTimeoutMs);
    };
    resetIdleTimer();

    const abort = () => {
      aborted = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled && !child.killed) child.kill('SIGKILL');
      }, 2000).unref?.();
    };
    if (signal?.aborted) {
      abort();
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      signal?.removeEventListener('abort', abort);
    };

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
      resetIdleTimer();
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
      resetIdleTimer();
    });
    child.on('error', (error) => {
      cleanup();
      resolve({
        command,
        args,
        cwd,
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        timedOut,
        idleTimedOut,
        aborted,
        spawnError: error.message,
        stdout,
        stderr,
      });
    });
    child.on('close', (exitCode, signal) => {
      cleanup();
      resolve({
        command,
        args,
        cwd,
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode,
        signal,
        timedOut,
        idleTimedOut,
        aborted,
        stdout,
        stderr,
      });
    });

    if (input) {
      child.stdin?.write(input);
      child.stdin?.end();
    }
  });
}
