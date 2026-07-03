# sliderule-v2-closure-python-07-frontend-prefer-python-closure-over-preview-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: python
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Prefer Python-produced closure evidence in the page and fall back to TS preview only when absent.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on Python /drive-full schema and pass-through. Preserve degraded/error states and avoid provider calls.

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

## Implementation report (for review)
- Files changed (scoped):
  - client/src/pages/SlideRule.tsx (core selection logic + comments for prefer python / fallback preview + fail-closed)
  - client/src/pages/sliderule/__tests__/derive-cross-runtime-summary.test.ts (positive prefer test + negative/fail-closed fallback tests)
- Executable: selectPublishClosureSummary (public, stable), derivePublishClosureSummary (stable), PublishClosureSummary type.
- Python pass-through /drive-full unchanged (as reviewed).
- Validation: `npx vitest run src/pages/sliderule/__tests__/derive-cross-runtime-summary.test.ts` (all pass)
- Positive: when python present + preview, selects python (from session/python drive-full)
- Fail-closed negative: python absent -> preview; both absent -> null (no fabrication)
- How advances: ensures page (SlideRule.tsx) uses Python-produced AppBundle runtime closure evidence preferentially over TS preview per 119 objective, with tests proving both behaviors. Thin proxy + schema pass-through preserved.
