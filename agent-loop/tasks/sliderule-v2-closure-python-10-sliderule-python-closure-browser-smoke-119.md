# sliderule-v2-closure-python-10-sliderule-python-closure-browser-smoke-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: python
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Add or update browser smoke coverage for closure visibility after a /agent-loop/sliderule command.

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

## Concise final report
Changed files:
- client/src/pages/SlideRule.tsx (added data-testid="sliderule-root"; seeded initial crossRuntimeGraph/publishClosure from pythonPublishClosure extracted from sessionState for sync visibility of /drive-full pass-through at mount)
- client/src/pages/sliderule/__tests__/ArchitectureProcessPanel.test.tsx (updated browser smoke describe to wrap renders under sliderule-root; added full <SlideRule embedded /> root renders asserting testid + python publishClosure content)
- agent-loop/tasks/sliderule-v2-closure-python-10-sliderule-python-closure-browser-smoke-119.md (this report)

Exported symbols / key ids (stable): data-testid="sliderule-root", data-testid="sliderule-cross-runtime-graph", data-testid="sliderule-publish-closure"; ArchitectureProcessPanel props: crossRuntimeGraph, publishClosure (python shape); selectPublishClosureSummary / derive* (unchanged); useSlideRuleSession preservePublishClosure adapter (unchanged).

Validation commands:
- node -e "const fs=require('fs'); const task=fs.readFileSync('agent-loop/tasks/sliderule-v2-closure-python-10-sliderule-python-closure-browser-smoke-119.md','utf8'); for (const needle of ['119-appbundle-runtime-closure','## Required implementation','## Acceptance criteria','codex-reviewed-only','Concise final report']) { if(!task.includes(needle)) throw new Error('task missing marker: '+needle); }"
- npx vitest run client/src/pages/sliderule/__tests__/ArchitectureProcessPanel.test.tsx
- (covers: root render for /agent-loop/sliderule embedded + positive/negative python closure pass-through visibility)
