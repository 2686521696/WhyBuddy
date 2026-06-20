import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import express from 'express';
import { createServer } from 'node:http';

import { withStubbedLlmKey } from './helpers/with-stubbed-llm-key.js';
import {
  validatePlanStateProjection,
  validateProposedPlan,
} from '../../../shared/blueprint/sliderule-plan-validation.js';

vi.mock('../../sliderule/python-delegation.js', () => ({
  callPythonSlideRule: vi.fn(),
  resolvePythonSlideRuleRuntimeConfig: vi.fn(() => ({
    baseUrl: 'http://localhost:9700',
    internalKey: 'dev-slide-rule-internal',
    timeoutMs: 120000,
    healthPath: '/health',
    proxyMode: 'node-fetch-env',
  })),
}));

let slideruleRouter: any;
let pythonDelegation: any;

const planRequestBody = {
  capabilityId: 'orchestrate.plan',
  state: {
    sessionId: 't-orch-python-projection',
    goal: { text: 'Plan a migration boundary slice' },
    artifacts: [],
    capabilityRuns: [],
  },
  inputArtifactIds: [],
  roleId: 'planner',
  turnId: 't-orch-python-projection',
};

const partialProjection = {
  kind: 'orchestrate.plan.state_projection',
  schemaVersion: 1,
  stateAuthority: 'node',
  stateMutation: 'none',
  status: 'partial',
  phase: 'planning',
  partial: true,
  phases: [
    { id: 'phase-grounding', label: 'Grounding', status: 'active', stepIds: ['step-1-evidence-search'] },
    { id: 'phase-risk', label: 'Risk', status: 'pending', stepIds: ['step-2-risk-analyze'] },
  ],
  steps: [
    {
      id: 'step-1-evidence-search',
      capabilityId: 'evidence.search',
      roleId: 'grounding',
      status: 'pending',
      phaseId: 'phase-grounding',
      why: 'Need evidence first',
    },
    {
      id: 'step-2-risk-analyze',
      capabilityId: 'risk.analyze',
      roleId: 'safety',
      status: 'pending',
      phaseId: 'phase-risk',
      why: 'Risk-bearing goal requires risk scan',
    },
  ],
  risks: [
    {
      id: 'risk-projection-boundary',
      severity: 'medium',
      summary: 'Projection must not mutate Node-owned session state.',
      mitigation: 'Keep projection read-only and additive.',
    },
  ],
  recoveryPoints: [
    {
      id: 'recovery-replan-from-node-state',
      label: 'Replan from Node state',
      action: 'Node can rerun orchestrate.plan with the unchanged session state.',
      retryable: true,
    },
  ],
  error: null,
};

const errorProjection = {
  kind: 'orchestrate.plan.state_projection',
  schemaVersion: 1,
  stateAuthority: 'node',
  stateMutation: 'none',
  status: 'error',
  phase: 'error',
  partial: false,
  phases: [{ id: 'phase-error', label: 'Planner error', status: 'blocked', stepIds: [] }],
  steps: [],
  risks: [
    {
      id: 'risk-planner-error',
      severity: 'high',
      summary: 'Planner failed before it could produce executable steps.',
      mitigation: 'Do not treat the response as a complete plan.',
    },
  ],
  recoveryPoints: [
    {
      id: 'recovery-retry-planner',
      label: 'Retry planner',
      action: 'Retry orchestrate.plan after the planner error is resolved.',
      retryable: true,
    },
  ],
  error: {
    code: 'planner_error',
    reason: 'runtime_error',
    message: 'planner exploded while ranking candidates',
  },
};

describe('orchestrate.plan state projection contract', () => {
  let app: any;
  let server: any;
  let base: string;
  let restoreLlmKey: (() => void) | undefined;

  beforeAll(async () => {
    const routerModule = await import('../sliderule.js');
    slideruleRouter = routerModule.default;
    pythonDelegation = await import('../../sliderule/python-delegation.js');
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    ({ restore: restoreLlmKey } = withStubbedLlmKey());
    vi.stubEnv('SLIDERULE_V5_BACKEND', 'python');
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/sliderule', slideruleRouter);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    base = `http://127.0.0.1:${port}/api/sliderule`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    restoreLlmKey?.();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('passes through Python projection and keeps it compatible with shared plan validation', async () => {
    const pythonPayload = {
      selected: [
        { capabilityId: 'evidence.search', roleId: 'grounding', why: 'Need evidence first' },
        { capabilityId: 'risk.analyze', roleId: 'safety', why: 'Risk-bearing goal requires risk scan' },
      ],
      rationale: 'Evidence and risk first',
      source: 'python-rag',
      converged: false,
      planStateProjection: partialProjection,
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(pythonPayload);

    const plan = validateProposedPlan(body);
    expect(plan.valid).toBe(true);
    expect(plan.selected.map((item) => item.capabilityId)).toEqual(['evidence.search', 'risk.analyze']);

    const projection = validatePlanStateProjection(body.planStateProjection);
    expect(projection.valid).toBe(true);
    expect(projection.projection?.status).toBe('partial');
    expect(projection.projection?.stateAuthority).toBe('node');
    expect(projection.projection?.stateMutation).toBe('none');
  });

  it('reads error projection without treating it as a complete successful plan', async () => {
    const pythonPayload = {
      selected: [],
      rationale: 'Python orchestrate.plan could not produce a planner result.',
      source: 'python-rag',
      converged: false,
      degraded: true,
      error: 'planner_error',
      reason: 'runtime_error',
      fallbackAvailable: false,
      planStateProjection: errorProjection,
    };
    pythonDelegation.callPythonSlideRule.mockResolvedValueOnce(pythonPayload);

    const res = await fetch(`${base}/execute-capability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(planRequestBody),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const projection = validatePlanStateProjection(body.planStateProjection);

    expect(projection.valid).toBe(true);
    expect(projection.projection?.status).toBe('error');
    expect(projection.projection?.partial).toBe(false);
    expect(projection.projection?.error?.code).toBe('planner_error');
    expect(validateProposedPlan(body).valid).toBe(false);

    const invalidCompleteError = validatePlanStateProjection({
      ...errorProjection,
      status: 'complete',
    });
    expect(invalidCompleteError.valid).toBe(false);
  });
});
