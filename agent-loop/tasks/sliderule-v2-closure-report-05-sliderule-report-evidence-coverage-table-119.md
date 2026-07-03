# sliderule-v2-closure-report-05-sliderule-report-evidence-coverage-table-119

## Execution status
- Status: DONE_REVIEWED
- Phase: 119-appbundle-runtime-closure
- Theme: report
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Render a stable per-skill evidence coverage table for DataModel/RBAC/Workflow/Page/AIGC/AppBundle.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on delivery/report serialization. Do not change core runtime semantics unless a focused test proves the need.

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

## Final Report

Changed files:
- `client/src/pages/sliderule/serialize-sliderule-delivery-md.ts`
- `client/src/pages/sliderule/__tests__/knife-c-terminal.test.ts`
- `agent-loop/tasks/sliderule-v2-closure-report-05-sliderule-report-evidence-coverage-table-119.md`

Exported/updated symbols:
- `renderPerSkillEvidenceCoverageTable`
- `deriveAppBundleClosureRender`

Validation commands:
- `npx vitest run client/src/pages/sliderule/__tests__/knife-c-terminal.test.ts client/src/pages/sliderule/__tests__/derive-cross-runtime-summary.test.ts --reporter=dot`
- `node --run check`
- `git diff --check`

This lands the stable per-skill evidence coverage table in delivery markdown for DataModel, RBAC, Workflow, Page, AIGC, and AppBundle. The focused serializer tests cover the direct publishClosure path and the exported table helper, including present/missing evidence states without changing runtime closure semantics.
