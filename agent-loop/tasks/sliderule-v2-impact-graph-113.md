# SlideRule V2 Skills 113.14: global impact graph

## Execution status
- Status: pending
- Goal: implement a global dependency and impact graph so a changed role, field, workflow, or page can report all affected downstream surfaces and AppBundles.
- Required gate: `slideruleV2ImpactGraph113Gates`

## Context
V2 architecture diagrams repeatedly point to a global dependency graph. This task makes that graph real in the runtime-less Skill layer. The product value is impact analysis: if a field changes, which pages, workflows, and applications are affected?

## Allowed files
- `client/src/lib/skills/impact.ts`
- `client/src/lib/skills/impact.test.ts`
- `client/src/lib/skills/orchestrator.ts`
- `client/src/lib/skills/orchestrator.test.ts`
- `client/src/lib/skills/skill.ts` only for additive `ImpactReport` type fixes
- `agent-loop/tasks/sliderule-v2-impact-graph-113.md`
- `This task file`

## Do not
- Do not use a graph database or external package unless already present.
- Do not scan source text to infer dependencies; use Skill resolver/cross-ref surfaces.
- Do not make impact analysis mutate the models.
- Do not add AIGC impact in this wave.

## Implementation steps
- [ ] Add tests for field impact: DataModel field -> Page binding -> AppBundle.
- [ ] Add tests for role impact: RBAC role -> Workflow approval/Page render/Menu or permission -> AppBundle.
- [ ] Add tests for workflow impact: Workflow -> AppBundle.
- [ ] Add tests for page impact: Page -> AppBundle.
- [ ] Implement `buildDependencyGraph()` from orchestrator Skill outputs and cross refs.
- [ ] Implement `impact(ref)` returning direct and multi-hop affected nodes with paths.
- [ ] Ensure diagrams or debug output can include impact paths without changing normal projection.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/impact.test.ts client/src/lib/skills/orchestrator.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/impact.ts client/src/lib/skills/impact.test.ts client/src/lib/skills/orchestrator.ts client/src/lib/skills/orchestrator.test.ts`

## Acceptance criteria
- Impact analysis supports role, field, workflow, page, and app-level refs.
- Output includes multi-hop paths, not just a flat affected list.
- No runtime dependencies are introduced.

