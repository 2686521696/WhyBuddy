export const AGENT_IDS = ['grok', 'codex'];

export function normalizeAgentId(value, { field, fallback }) {
  const normalized = String(value ?? fallback).toLowerCase().trim();
  if (!AGENT_IDS.includes(normalized)) {
    throw new Error(`${field} must be one of: ${AGENT_IDS.join(', ')}`);
  }
  return normalized;
}

export function resolveAgentRoles(options = {}) {
  const fixAgent = normalizeAgentId(options.fixAgent, { field: 'fixAgent', fallback: 'grok' });
  const reviewAgent = options.skipReview
    ? null
    : normalizeAgentId(options.reviewAgent, { field: 'reviewAgent', fallback: 'grok' });
  return { fixAgent, reviewAgent };
}

export function requiredAgentNames(options = {}) {
  const { fixAgent, reviewAgent } = resolveAgentRoles(options);
  const names = new Set();
  if (options.autoFix) names.add(fixAgent);
  if (reviewAgent) names.add(reviewAgent);
  return [...names];
}

export function fixStatusForAgent(agent) {
  return agent === 'codex' ? 'CODEX_FIX' : 'GROK_FIX';
}

export function reviewStatusForAgent(agent) {
  return agent === 'grok' ? 'GROK_REVIEW' : 'CODEX_REVIEW';
}

export function useScopedReview(options = {}) {
  if (options.scopedReview != null) return Boolean(options.scopedReview);
  const { reviewAgent } = resolveAgentRoles(options);
  return reviewAgent === 'grok';
}

export function mirrorLegacyAgentFields(state, { fixAgent, reviewAgent }) {
  state.agentFix = state.agentFix ?? state.grokFix ?? null;
  state.agentReview = state.agentReview ?? state.codexReview ?? state.grokReview ?? null;
  state.grokFix = fixAgent === 'grok' ? state.agentFix : null;
  state.codexReview = reviewAgent === 'codex' ? state.agentReview : null;
  state.grokReview = reviewAgent === 'grok' ? state.agentReview : null;
  return state;
}