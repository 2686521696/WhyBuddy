export function resolveAgentInvocation(agent, args) {
  if (Array.isArray(agent)) {
    const [command, ...prefixArgs] = agent;
    return {
      command,
      args: [...prefixArgs, ...args],
    };
  }

  return {
    command: agent,
    args,
  };
}
