# sliderule-v2-runtime-closure-gate-12-gate-doc-and-focused-tests-120

## Execution status
- Status: PENDING
- Phase: 120-runtime-closure-e2e
- Theme: gate
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 119 closure wave plus 118 cross-runtime candidates

## Objective
Add docs and focused tests for the gate script without introducing broad runtime dependencies.

## Context
This task belongs to the 120 runtime closure end-to-end wave. The previous 119 wave produced reviewed closure primitives; this wave must connect them into verifiable runtime behavior.

Bundle the closure checks into one repeatable gate that Codex can run before claiming the wave is ready to land.

## Reference sources
- `agent-loop/tasks/sliderule-v2-closure-*-119.md`
- `agent-loop/scripts/sliderule-v2-closure-*-119-queue.json`
- `agent-loop/tasks/sliderule-v2-cross-*-118.md`
- Current main code in SlideRule Python, AppBundle Skill, Skill orchestrator, report/export, and /agent-loop/sliderule UI.

## Allowed files
- `client/src/lib/skills/**`
- `client/src/lib/sliderule-marathon-driver.ts`
- `client/src/pages/SlideRule.tsx`
- `client/src/pages/sliderule/**`
- `slide-rule-python/**`
- `server/routes/sliderule.ts`
- `server/sliderule/**`
- `agent-loop/tasks/**`
- `agent-loop/scripts/**`
- `agent-loop/src/**`

## Do not
- Do not edit `.env`, credentials, lockfiles, generated dependency folders, or unrelated runtime artifacts.
- Do not apply any large raw patch from prior worktrees directly to main.
- Do not mark the task done with markdown-only changes unless this is a gate/report task whose deliverable is documentation plus executable checks.
- Do not weaken existing fail-closed semantics, proxy behavior, or focused tests.
- Do not add network, DB, Redis, or provider calls to pure Skill helpers or deterministic tests.

## Required implementation
- [ ] Add or update executable code, typed schema, fixture, adapter, smoke script, or focused tests for the objective.
- [ ] Include both a positive closed path and a fail-closed or degraded negative path when the objective touches runtime behavior.
- [ ] Preserve old session compatibility and existing public API names unless the final report explicitly justifies a migration.
- [ ] Keep the diff small enough for Codex to review and land as one closure slice.
- [ ] Add a final report listing changed files, exported symbols, validation commands, and any intentionally deferred risks.

## Acceptance criteria
- Grok produces candidate material that Codex can review without applying a broad patch blindly.
- The task advances one visible end-to-end closure path: Python /drive-full, AppBundle artifact, six-Skill trace, browser smoke, or one-key gate.
- Focused tests or executable checks accompany code changes where practical.
- The task preserves deterministic local behavior and does not depend on live providers.
- AgentLoop outcome distinguishes implemented code from review-only notes.
