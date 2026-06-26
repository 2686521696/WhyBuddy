# SlideRule V2 Skills 113.01: shared contract and kernel vocabulary

## Execution status
- Status: DONE_REVIEWED - committed 31ff137b
- Goal: establish the shared V2 Skill contract so every runtime-less Skill can declare its kernel role, dependency references, policy decisions, publish gate reports, and impact reports in one typed vocabulary.
- Required gate: `slideruleV2SkillContract113Gates`

## Context
The V2 architecture makes the five Skills behave like a lightweight product simulation kernel:

- RBAC is Kernel 1, the PDP host.
- DataModel is Kernel 2, the SSOT host.
- Workflow and Page are PEP execution points that delegate to PDP and bind to SSOT.
- AppBundle is Kernel 6, the assembly root that checks closure and pins versions.

This task creates the shared contract only. It must not implement any individual Skill behavior.

## Allowed files
- `client/src/lib/skills/skill.ts`
- `client/src/lib/skills/kernel.test.ts`
- `client/src/lib/skills/README.md`
- `agent-loop/tasks/sliderule-v2-skill-contract-113.md`
- `This task file`

## Do not
- Do not modify `client/src/pages/agent-loop/**`.
- Do not modify `docs/rbac-skill/**` V2 diagram files.
- Do not introduce database, Redis, HTTP services, or backend runtime dependencies.
- Do not add AIGC-Skill in this wave.
- Do not use `git add -A`.
- Do not weaken existing Skill test coverage.

## Implementation steps
- [ ] Add or extend shared types in `client/src/lib/skills/skill.ts`: `KernelRole`, `SkillRuntimeRole`, `DependencyRef`, `VersionPin`, `PolicyDecision`, `PublishGateReport`, `ImpactReport`, and a typed `SkillCapabilitySurface`.
- [ ] Give `SkillDefinition` an optional V2 metadata block, for example `runtimeRole`, `kernelRole`, `provides`, `delegatesTo`, and `bindsTo`.
- [ ] Keep old Skill implementations source-compatible by making new properties additive and optional where needed.
- [ ] Add tests in `client/src/lib/skills/kernel.test.ts` that prove a V2 Skill can declare PDP, SSOT, PEP, and assembly-root semantics without breaking existing `validate/project/resolve/generate`.
- [ ] Update `client/src/lib/skills/README.md` with a short glossary: PDP, PEP, SSOT, AppBundle, publish gate, impact graph.

## Required validation
- `pnpm exec vitest run client/src/lib/skills/kernel.test.ts --reporter=dot`
- `pnpm exec vitest run client/src/lib/skills --reporter=dot`
- `pnpm exec tsc --noEmit --pretty false`
- `node agent-loop/src/check-mojibake.js client/src/lib/skills/skill.ts client/src/lib/skills/kernel.test.ts client/src/lib/skills/README.md`

## Acceptance criteria
- Shared V2 vocabulary exists in one place and individual Skills can import it.
- Existing RBAC, DataModel, Workflow, Page, AppBundle tests still compile.
- No runtime dependency is introduced.
- README explains the V2 terms in product-friendly language.

