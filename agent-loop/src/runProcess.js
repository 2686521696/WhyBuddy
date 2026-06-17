import { spawn } from 'node:child_process';

export function runProcess(command, args, options = {}) {
  const {
    cwd,
    timeoutMs = 120000,
    env = process.env,
    input,
    onStdout,
    onStderr,
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

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      onStdout?.(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      onStderr?.(text);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd,
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        timedOut,
        spawnError: error.message,
        stdout,
        stderr,
      });
    });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        command,
        args,
        cwd,
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode,
        signal,
        timedOut,
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
