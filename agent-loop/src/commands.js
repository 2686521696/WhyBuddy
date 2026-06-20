export function buildCodexReviewArgs({ uncommitted = true, prompt, readPromptFromStdin = false, model = null } = {}) {
  const args = [];
  if (model) args.push('-m', model);
  args.push('review');
  if (uncommitted) args.push('--uncommitted');
  if (readPromptFromStdin) {
    args.push('-');
  } else if (prompt) {
    args.push(prompt);
  }
  return args;
}

export function buildCodexExecArgs({ cwd, readPromptFromStdin = true, model = null } = {}) {
  const args = ['exec'];
  if (model) args.push('-m', model);
  args.push('--cd', cwd, '--dangerously-bypass-approvals-and-sandbox');
  if (readPromptFromStdin) args.push('-');
  return args;
}

export function buildGrokJsonArgs({ promptFile, cwd, maxTurns = 4, model = null } = {}) {
  if (!promptFile) throw new Error('promptFile is required');
  if (!cwd) throw new Error('cwd is required');
  const args = [];
  if (model) args.push('-m', model);
  args.push(
    '--prompt-file',
    promptFile,
    '--output-format',
    'json',
    '--cwd',
    cwd,
    '--max-turns',
    String(maxTurns),
    '--no-plan',
    '--always-approve',
  );
  return args;
}
