# sliderule-v2-closure-skills-09-page-permission-render-closure-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: skills
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Close Page permission rendering evidence against RBAC policy surfaces.

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
- [ ] Add or update executable code, typed schema, fixture, adapter, or focused tests for the objective.
- [ ] Preserve deterministic local behavior.
- [ ] Include both positive evidence and fail-closed negative behavior where applicable.
- [ ] Keep public API names stable or document any migration in the final report.
- [ ] Add a concise final report listing changed files, exported symbols, and validation commands.

## Acceptance criteria
- The result is useful as candidate material for Codex review and main landing.
- The changed code is scoped to the objective and theme.
- Focused tests are added or updated when practical.
- Existing AppBundle publish/runtime closure semantics are not weakened.
- AgentLoop final report explains how this task advances publish/runtime closure.

## Final Report (page-permission-render-closure-119)
Changed files:
- client/src/lib/skills/appbundle/appBundleSkill.ts (added pageRbacPermissionEvidence computation for page skill in evaluateAppBundleRuntimeClosure using createPageRbacRuntimeEvidence + real rbac upstream surface; wired into rbacPdpDecisions, evidencePresent, perSkillEvidence record and interface)
- client/src/lib/skills/page/pageSkill.test.ts (added focused describe "pageSkill — Page permission render evidence closure against RBAC policy surfaces (119)" with 4 tests: direct positive/negative for createPageRbac..., and via slideRule.publishGate positive allowed + fail-closed blocked)
- agent-loop/tasks/sliderule-v2-closure-skills-09-page-permission-render-closure-119.md (this report)

Exported symbols exercised/added: createPageRbacRuntimeEvidence (existing public), createPageCrossRuntimeEvidence (used), pageRbacPermissionEvidence (new closure field in runtime report, optional/compat), pageSkill.resolve / rbacSkill.resolve (surfaces). No public API rename.

Validation commands:
- npx vitest run client/src/lib/skills/page/pageSkill.test.ts -t "Page permission render evidence closure"
- npx vitest run client/src/lib/skills/page/pageSkill.test.ts
- npx vitest run client/src/lib/skills/purchaseApproval.test.ts
- node -e "
  const {deriveApplication, slideRule} = require('./client/src/lib/skills/slideRule');
  deriveApplication('请假申请').then(r => { const g=slideRule.publishGate(r.spec.skills); const p=g.runtimeClosure?.perSkillEvidence?.page; console.log('publishable:',g.publishable,'pagePermEv:',p&&p.pageRbacPermissionEvidence&&p.pageRbacPermissionEvidence.state); });
"
- tsc --noEmit -p tsconfig.json (client types)

How this task advances publish/runtime closure: Parallels the field-binding closure (08) for the Page<->RBAC boundary: now evaluateAppBundleRuntimeClosure explicitly materializes Page permission rendering evidence (PermissionRender role+perm refs) as pageRbacPermissionEvidence with deterministic positive (allowed+refs on real RBAC surface) and fail-closed negative (blocked on absent). Tests cover direct create fn + end-to-end publishGate path. Existing fail-closed PDP/render semantics untouched. Enables AppBundle runtimeClosure to prove Page permission render surface against RBAC policy for 119 wave, usable for codex review/landing. Scoped to allowed files.
