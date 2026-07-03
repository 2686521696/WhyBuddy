# sliderule-v2-closure-precheck-04-closure-no-secret-scan-119

## Execution status
- Status: PENDING
- Phase: 119-appbundle-runtime-closure
- Theme: precheck
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 480-task 118 cross-runtime outputs

## Objective
Scan closure landing diff for secrets and runtime artifacts before main landing.

## Context
This task is part of the 50-task AppBundle publish/runtime closure integration wave. Use the prior 118 cross-runtime task files, queue outcomes, and shard worktrees as reference material, but do not blindly apply generated patches. Grok may implement candidate code in the shard worktree; Codex will review, extract, test, and land only clean slices to main.

Focus on validation, landing evidence, and queue hygiene. Do not add broad feature code here.

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

## Worker final report
- Status: changed (addressing review_needs_changes: fixed fail-open on bad --diff-file (now nonzero+error), removed unreferenced __tmp_bad.patch, corrected report symbols)
- Commands run (validation for closure landing diff scan + positive/negative + fail-closed):
  - node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['119-appbundle-runtime-closure','## Required implementation','## Acceptance criteria','codex-reviewed-only']) { if(!task.includes(needle)) throw new Error('task missing marker: '+needle); }\" agent-loop/tasks/sliderule-v2-closure-precheck-04-closure-no-secret-scan-119.md  => markers OK
  - node agent-loop/src/check-mojibake.js agent-loop/tasks/sliderule-v2-closure-precheck-04-closure-no-secret-scan-119.md  => clean
  - node agent-loop/scripts/secret-scan.mjs --self-test  => positiveClean.ok=true; negativeSecret.ok=false (blocker openai key); negativeArtifact.ok=false (blocker .agent-loop artifact)
  - node agent-loop/scripts/secret-scan.mjs --diff-file nonexistent-missing-for-test.patch 2>&1; echo "ERR_EXIT_WAS:$?"  => errors + nonzero (fail-closed)
- Files changed (relative, scoped to allowed; stray temp removed for hygiene):
  - agent-loop/scripts/secret-scan.mjs
  - agent-loop/tasks/sliderule-v2-closure-precheck-04-closure-no-secret-scan-119.md
  - (removed: agent-loop/scripts/__tmp_bad.patch)
- Exported symbols (new in scan script for closure precheck):
  - scanClosureLandingDiff(diffText)
- Internal (not exported): summarizeClosureScan, RUNTIME_ARTIFACT_PATTERNS (report corrected to match impl per review)
- Validation commands (prove secret + runtime artifact scan on landing diffs):
  - node agent-loop/scripts/secret-scan.mjs --self-test
  - node agent-loop/scripts/secret-scan.mjs agent-loop/scripts/secret-scan.mjs   (re-scan own source)
  - node -e "
    import('./agent-loop/scripts/secret-scan.mjs').then(m => {
      const clean = 'diff --git a/x.ts b/x.ts\n+++ b/x.ts\n+const a=1;';
      const bad = 'diff --git a/c.ts b/c.ts\n+++ b/c.ts\n+const k=\"sk-abc12345678901234567890\";';
      console.log('clean-ok:', m.scanClosureLandingDiff(clean).ok);
      console.log('secret-block:', !m.scanClosureLandingDiff(bad).ok);
    });
  "
  - node -e "
    const cp=require('child_process');
    const r1=cp.spawnSync(process.execPath, ['agent-loop/scripts/secret-scan.mjs','--diff-file','nonexistent-foo.patch'],{encoding:'utf8'});
    console.log('missing-diff-exit:', r1.status);
    console.log('has-error-msg:', /Failed to read/.test(r1.stderr||r1.stdout));
  "
- How this advances publish/runtime closure: This precheck supplies the executable closure-diff scan (secretScan on +lines + runtime artifact path detection with fail-closed) inside allowed scripts/. Previously only marker/mojibake gates existed with zero scan evidence. Now --self-test and scanClosureLandingDiff prove positive (clean diff -> ok) + fail-closed negative (secret key or .agent-loop/.env artifact in diff -> !ok) behavior per Required/Acceptance. Fixed review blocker so missing/unreadable landing diff errors instead of ok=true. Removed stray temp secret-like patch. Provides clean candidate for codex without touching gates, tests outside scope, or weakening any closure semantics. All scoped to precheck objective and queue hygiene.
