// Two orthogonal properties per failure:
//   retryable     – should we retry the SAME agent call (transient: rate limit / network)?
//   agentUnstable – is the agent layer itself unhealthy, so we must NOT keep looping on a
//                   red gate (rate limit / auth / network / timeout / spawn)? Halt for human.
// max_turns / nonzero_exit / none are agent-stable: the gate stays the judge (progress + budget).
export function classifyAgentFailure(result) {
  if (result?.spawnError) return { kind: 'spawn_error', retryable: false, agentUnstable: true };
  if (result?.idleTimedOut) return { kind: 'idle_timeout', retryable: false, agentUnstable: true };
  if (result?.timedOut) return { kind: 'timeout', retryable: false, agentUnstable: true };
  if (result?.exitCode === 0) return { kind: 'none', retryable: false, agentUnstable: false };

  const text = `${result?.stderr || ''}\n${result?.stdout || ''}`.toLowerCase();
  if (/\b(rate limit|too many requests|429|quota|temporarily unavailable|overloaded)\b/.test(text)) {
    return { kind: 'rate_limit', retryable: true, agentUnstable: true };
  }
  // Auth failures (bad/expired key, 401/403) are persistent — retrying wastes a call, but the
  // agent is still "unstable" for this run, so halt for human (check key/session) rather than loop.
  // Only STRONG signals: bare `auth` / `api key` / `authentication` matched business code & task
  // text (e.g. "auth module test failed"), causing false agent-auth halts on real repos.
  if (/\b(401|403|unauthorized|forbidden|invalid api key|authentication failed|not authenticated)\b/.test(text)) {
    return { kind: 'auth', retryable: false, agentUnstable: true };
  }
  if (/\b(fetch failed|network|econnreset|econnrefused|etimedout|timeout while connecting|dns|enotfound|socket|tls)\b/.test(text)) {
    return { kind: 'network', retryable: true, agentUnstable: true };
  }
  if (/\bmax turns reached\b/.test(text)) {
    return { kind: 'max_turns', retryable: false, agentUnstable: false };
  }
  return { kind: 'nonzero_exit', retryable: false, agentUnstable: false };
}

export function isRetryableAgentFailure(result) {
  return classifyAgentFailure(result).retryable;
}

export function isAgentUnstableFailure(result) {
  return classifyAgentFailure(result).agentUnstable;
}
