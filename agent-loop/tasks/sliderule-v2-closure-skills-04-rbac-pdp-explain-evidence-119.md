# sliderule-v2-closure-skills-04-rbac-pdp-explain-evidence-119

## Execution status
- Status: DONE_REVIEWED
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Expose deterministic RBAC PDP allow/deny/fail-closed explanation evidence for downstream closure.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on one Skill boundary at a time. Add deterministic positive and fail-closed negative evidence paths.

## Reference sources
- `agent-loop/tasks/sliderule-v2-cross-*-118.md`
- `agent-loop/scripts/sliderule-v2-cross-runtime-118-shard-*-queue.json`
- `.worktrees/sliderule-v2-cross-runtime-118-shard-*-run`
- Current main commits around AppBundle runtime closure and Skill linkage.

## Allowed files
- `client/src/lib/skills/**`
- `client/src/pages/sliderule/**`
- `client/src/pages/SlideRule.tsx`
- `slide-rule-python/**`
- `server/routes/sliderule.ts`
- `server/sliderule/**`
- `agent-loop/tasks/**`
- `agent-loop/scripts/**`

## Do not
- Do not edit `.env`, credentials, lockfiles, or unrelated runtime artifacts.
- Do not weaken existing tests, gates, or fail-closed semantics.
- Do not apply a raw 480-task patch wholesale.
- Do not mark done with markdown-only changes.
- Do not make network, DB, Redis, provider, or browser calls from pure Skill helpers.

## Required implementation
- [x] Add or update executable code, typed schema, fixture, adapter, or focused tests for the objective.
- [x] Preserve deterministic local behavior.
- [x] Include both positive evidence and fail-closed negative behavior where applicable.
- [x] Keep public API names stable or document any migration in the final report.
- [x] Add a concise final report listing changed files, exported symbols, and validation commands.

## Acceptance criteria
- The result is useful as candidate material for Codex review and main landing.
- The changed code is scoped to the objective and theme.
- Focused tests are added or updated when practical.
- Existing AppBundle publish/runtime closure semantics are not weakened.
- AgentLoop final report explains how this task advances publish/runtime closure.

## Final report (concise)
Changed files:
- client/src/lib/skills/rbac/rbacSkill.ts
- client/src/lib/skills/rbac/rbacSkill.test.ts
- client/src/lib/skills/appbundle/appBundleSkill.ts
- client/src/lib/skills/appbundle/appBundleSkill.test.ts
- agent-loop/tasks/sliderule-v2-closure-skills-04-rbac-pdp-explain-evidence-119.md

Exported symbols (stable, no rename):
- RBAC_PDP_EXPLAIN_EVIDENCE (const, from rbacModel + re-export)
- createRbacPdpExplainEvidence(model, request): RbacPdpExplainEvidence  (now yields evidenceKey ending :allow | :deny | :fail-closed)
- RbacPdpExplainEvidence (typed schema in rbacModel.ts)
- Related: decideRbacPolicy (unchanged), evaluateRbacRuntimePolicy (unchanged compat)

Validation commands:
- npx vitest run client/src/lib/skills/rbac/rbacSkill.test.ts
- npx vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts
- node -e "const fs=require('fs'); const t=fs.readFileSync('agent-loop/tasks/sliderule-v2-closure-skills-04-rbac-pdp-explain-evidence-119.md','utf8'); for(const n of ['119-appbundle-runtime-closure','## Required implementation','## Acceptance criteria','codex-reviewed-only','Final report']) { if(!t.includes(n)) throw new Error('missing '+n); }"
- node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-skills-04-rbac-pdp-explain-evidence-119.md

This task advances publish/runtime closure by hardening RBAC PDP deterministic explanation evidence (positive allow + negative deny/fail-closed) so AppBundle closure collector (hasRbacPdpExplain + perSkillEvidence.rbacPdpDecisions) can consume both paths without ignoring fail-closed evidence. Focused tests cover the three outcomes and end-to-end closure recognition. Public APIs stable. Scoped to skills + task doc.

## Codex Review Landing

Reviewed and landed as part of the Skill linkage closure batch. RBAC PDP allow/deny/fail-closed explanation evidence is covered by RBAC tests and consumed by AppBundle runtime closure tests.

Validation:
- `npx vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts client/src/lib/skills/rbac/rbacSkill.test.ts client/src/lib/skills/workflow/workflowSkill.test.ts client/src/lib/skills/page/pageSkill.test.ts client/src/lib/skills/aigc/aigcSkill.test.ts client/src/lib/skills/appbundle/appBundleSkill.test.ts client/src/lib/skills/purchaseApproval.test.ts --reporter=dot` -> 7 files / 470 tests passed.
