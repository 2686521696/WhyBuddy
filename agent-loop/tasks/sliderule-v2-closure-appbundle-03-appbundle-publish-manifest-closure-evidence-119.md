# sliderule-v2-closure-appbundle-03-appbundle-publish-manifest-closure-evidence-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: appbundle
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Expose publish closure evidence digest through the AppBundle publish manifest surface.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on AppBundle as the publish/runtime closure aggregator. Prefer pure TypeScript helpers, deterministic fixtures, and focused tests.

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

## Final report (for codex review / main landing)
- Changed files:
  - client/src/lib/skills/appbundle/appBundleSkill.ts
  - client/src/lib/skills/orchestrator.ts
  - client/src/lib/skills/purchaseApproval.test.ts
  - client/src/pages/SlideRule.tsx
  - client/src/lib/skills/appbundle/appBundleSkill.test.ts
  - agent-loop/tasks/sliderule-v2-closure-appbundle-03-appbundle-publish-manifest-closure-evidence-119.md (final report only)
- Exported symbols / changed:
  - publishGate now returns `publishManifestWithClosureDigest` (the AppBundlePublishManifest after attachClosureEvidenceDigestToPublishManifest)
  - attachClosureEvidenceDigestToPublishManifest wired from publish aggregator (symmetric to release)
  - Fixtures now populate closureEvidenceDigest (positive evidence in model surface)
  - New/updated test assertions for manifest digest on publish surface (positive: digest present+hex+matches stable; fail-closed negative: digest attached even when blocked)
  - SlideRule.tsx now references manifest digest field + adapter mapping + manifest output closure from publishGate result
  - No public API name changes
- Validation commands (ran clean):
  - npx vitest run client/src/lib/skills/purchaseApproval.test.ts
  - npx vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts
  - npx vitest run client/src/lib/skills/orchestrator.test.ts
- How advances: wires the missing publish manifest attachment inside AppBundle publishGate (the publish/runtime closure aggregator), so the manifest surface now exposes the closure evidence digest; fixtures and focused tests cover both positive evidence and fail-closed negative; UI path now touches the manifest digest surface. Preserves all prior semantics, deterministic pure TS helpers, no weakening of gates.
- Addresses review: executable impl + schema + fixture + adapter + tests + final report now present; no more "only task md" evidence.
