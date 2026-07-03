import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const tasksDir = path.join(root, "agent-loop", "tasks");
const scriptsDir = path.join(root, "agent-loop", "scripts");

const phase = "120-runtime-closure-e2e";
const queuePrefix = "sliderule-v2-runtime-closure";

const themes = [
  {
    key: "drivefull",
    queue: `${queuePrefix}-drivefull-120-queue.json`,
    worktree: `${queuePrefix}-drivefull-120-run`,
    note:
      "Make Python /drive-full the authoritative closure producer for normal page commands, while preserving fail-closed and degraded states.",
    tasks: [
      ["drive-full-response-contract-fixture", "Add a deterministic /drive-full response fixture that includes command, skillRuntimeGraph, publishClosure, report, and degraded fields."],
      ["drive-full-page-command-adapter", "Route a normal SlideRule page command through the Python /drive-full response adapter without losing existing session fields."],
      ["drive-full-model-dump-deep-compat", "Harden nested ExecuteCapabilityResult model_dump and dict compatibility for closure-producing capability results."],
      ["drive-full-proxy-passthrough-contract", "Lock Node thin proxy pass-through for skillRuntimeGraph, publishClosure, and closureWarnings fields."],
      ["drive-full-session-merge-order", "Ensure Python-produced closure evidence wins over TypeScript preview evidence during persisted turn merge."],
      ["drive-full-blocked-evidence-negative", "Add a blocked /drive-full case where missing Skill evidence cannot produce a closed publishClosure."],
      ["drive-full-degraded-evidence-negative", "Add a degraded /drive-full case where capability errors are visible in closure diagnostics."],
      ["drive-full-report-appendix-source", "Mark report appendix closure sections with Python source metadata when produced by /drive-full."],
      ["drive-full-legacy-session-compat", "Keep old sessions without closure fields renderable after the Python adapter is enabled."],
      ["drive-full-command-id-stability", "Preserve stable command/turn ids across proxy, session store, and UI closure surfaces."],
      ["drive-full-focused-python-tests", "Add focused Python tests proving happy, blocked, and degraded /drive-full closure behavior."],
      ["drive-full-focused-vitest-tests", "Add focused frontend/proxy tests proving /drive-full closure fields reach page state."],
    ],
  },
  {
    key: "appbundle",
    queue: `${queuePrefix}-appbundle-120-queue.json`,
    worktree: `${queuePrefix}-appbundle-120-run`,
    note:
      "Turn AppBundle publish/runtime closure from summary metadata into real artifact evidence that can be inspected, hashed, rolled back, and blocked.",
    tasks: [
      ["publish-artifact-runtime-fixture", "Add a closed AppBundle publish artifact fixture with runtimeClosure, manifest digest, and per-skill evidence refs."],
      ["publish-artifact-blocked-fixture", "Add a blocked AppBundle publish artifact fixture with blocker taxonomy and affected Skill refs."],
      ["manifest-runtime-closure-digest", "Make publish manifest evidence include a stable runtime closure digest and checked input refs."],
      ["manifest-skill-ref-index", "Index DataModel, RBAC, Workflow, Page, AIGC, and AppBundle evidence refs in the publish manifest."],
      ["artifact-hash-regression-test", "Add regression tests proving stable closure hash output for unchanged publish inputs."],
      ["rollback-closure-diff-evidence", "Expose rollback closure diff evidence between current and target publish artifacts."],
      ["runtime-artifact-fail-closed", "Fail closed when a publish artifact claims closed status but lacks required per-skill evidence."],
      ["runtime-artifact-summary-ui-data", "Produce compact UI summary data for publish artifact closure without adding a broad layout rewrite."],
      ["runtime-artifact-report-data", "Produce report/export summary data from the same publish artifact closure shape."],
      ["purchase-approval-artifact-smoke", "Keep the purchase approval sample green with real AppBundle closure artifact evidence."],
      ["leave-request-artifact-smoke", "Keep the leave request sample green with real AppBundle closure artifact evidence."],
      ["appbundle-artifact-focused-tests", "Add focused AppBundle tests covering closed, blocked, hash, manifest, and rollback closure paths."],
    ],
  },
  {
    key: "skilltrace",
    queue: `${queuePrefix}-skilltrace-120-queue.json`,
    worktree: `${queuePrefix}-skilltrace-120-run`,
    note:
      "Build end-to-end examples where the six Skills produce cross-skill trace evidence, not isolated summaries.",
    tasks: [
      ["trace-datamodel-to-rbac", "Create a cross-skill trace from DataModel entity/field evidence to RBAC policy impact evidence."],
      ["trace-datamodel-to-page", "Create a cross-skill trace from DataModel field evidence to Page binding evidence."],
      ["trace-datamodel-to-workflow", "Create a cross-skill trace from DataModel field evidence to Workflow condition/form evidence."],
      ["trace-rbac-to-page", "Create a cross-skill trace from RBAC allow/deny evidence to Page render permission evidence."],
      ["trace-rbac-to-workflow", "Create a cross-skill trace from RBAC policy evidence to Workflow assignee/task evidence."],
      ["trace-workflow-to-page", "Create a cross-skill trace from Workflow task state evidence to Page task surface evidence."],
      ["trace-aigc-to-datamodel", "Create a cross-skill trace from AIGC positive sample evidence to DataModel schema evidence."],
      ["trace-aigc-to-rbac-negative", "Create a negative trace where AIGC proposed access fails closed against RBAC evidence."],
      ["trace-page-to-appbundle", "Create a trace from Page route/binding evidence into AppBundle publish closure evidence."],
      ["trace-workflow-to-appbundle", "Create a trace from Workflow runtime evidence into AppBundle publish closure evidence."],
      ["trace-all-skills-positive-sample", "Add one positive sample that traverses all six Skills and ends in a closed publishClosure."],
      ["trace-all-skills-negative-sample", "Add one negative sample that traverses multiple Skills and ends in blocked publishClosure."],
    ],
  },
  {
    key: "browser",
    queue: `${queuePrefix}-browser-120-queue.json`,
    worktree: `${queuePrefix}-browser-120-run`,
    note:
      "Make /agent-loop/sliderule verifiable from the browser: command submission, Python-backed closure evidence, visible status, and reset behavior.",
    tasks: [
      ["browser-command-submit-smoke", "Add a browser smoke path that submits a normal command on /agent-loop/sliderule and observes a completed turn."],
      ["browser-python-closure-visible", "Assert Python-produced publishClosure or blocked diagnostics are visible in the page after command completion."],
      ["browser-skill-linkage-visible", "Assert six-skill linkage evidence renders stable labels and click targets after a command."],
      ["browser-report-summary-visible", "Assert delivery/report closure summary is visible or exported from the page state."],
      ["browser-reset-session-contract", "Fix or lock reset-session behavior so it calls a supported Python/session endpoint and visibly resets state."],
      ["browser-no-question-mark-cards", "Remove or test against placeholder question-mark cards in the closure surfaces."],
      ["browser-loading-timeout-state", "Expose a deterministic loading/timeout state when Python /drive-full is unavailable."],
      ["browser-degraded-state-visible", "Expose degraded closure diagnostics without making the page look closed."],
      ["browser-persisted-session-reload", "Assert closure evidence survives page reload through persisted session state."],
      ["browser-old-session-compat", "Assert old sessions without closure evidence still render without broken cards."],
      ["browser-visual-smoke-script", "Add a lightweight script or test command for the /agent-loop/sliderule closure browser smoke."],
      ["browser-smoke-doc-evidence", "Record exact browser smoke command and expected evidence fields in the final report."],
    ],
  },
  {
    key: "gate",
    queue: `${queuePrefix}-gate-120-queue.json`,
    worktree: `${queuePrefix}-gate-120-run`,
    note:
      "Bundle the closure checks into one repeatable gate that Codex can run before claiming the wave is ready to land.",
    tasks: [
      ["gate-command-wrapper", "Create a small closure precheck wrapper command that runs the focused frontend, server, and Python closure matrices."],
      ["gate-vitest-matrix", "Make the gate include focused Skill/AppBundle/UI/report vitest matrices with readable output."],
      ["gate-python-matrix", "Make the gate include Python /drive-full and publish closure pytest matrices using the project venv."],
      ["gate-server-proxy-matrix", "Make the gate include Node thin proxy pass-through contract tests."],
      ["gate-browser-smoke-hook", "Make the gate optionally run browser smoke when the dev server is reachable."],
      ["gate-diff-check", "Make the gate include git diff --check and explain CRLF warnings versus actual failures."],
      ["gate-secret-scan", "Make the gate include secret-scan self-test and changed-diff scan when a diff exists."],
      ["gate-task-status-audit", "Make the gate summarize AgentLoop task statuses and distinguish DONE_REVIEWED from verified landing."],
      ["gate-main-clean-audit", "Make the gate fail or warn clearly when main is dirty before queue worktree setup."],
      ["gate-final-json-summary", "Emit a compact JSON summary suitable for final reports and Workbench display."],
      ["gate-final-markdown-summary", "Emit a concise markdown summary with commands, pass counts, and residual risks."],
      ["gate-doc-and-focused-tests", "Add docs and focused tests for the gate script without introducing broad runtime dependencies."],
    ],
  },
];

const commonAllowedFiles = [
  "client/src/lib/skills/**",
  "client/src/lib/sliderule-marathon-driver.ts",
  "client/src/pages/SlideRule.tsx",
  "client/src/pages/sliderule/**",
  "slide-rule-python/**",
  "server/routes/sliderule.ts",
  "server/sliderule/**",
  "agent-loop/tasks/**",
  "agent-loop/scripts/**",
  "agent-loop/src/**",
];

function taskMarkdown(theme, index, slug, objective) {
  const id = `${queuePrefix}-${theme.key}-${String(index).padStart(2, "0")}-${slug}-120`;
  return {
    id,
    path: path.join(tasksDir, `${id}.md`),
    content: `# ${id}

## Execution status
- Status: PENDING
- Phase: ${phase}
- Theme: ${theme.key}
- Owner: grok
- Reviewer: codex
- Landing: codex-reviewed-only
- Reference wave: 119 closure wave plus 118 cross-runtime candidates

## Objective
${objective}

## Context
This task belongs to the 120 runtime closure end-to-end wave. The previous 119 wave produced reviewed closure primitives; this wave must connect them into verifiable runtime behavior.

${theme.note}

## Reference sources
- \`agent-loop/tasks/sliderule-v2-closure-*-119.md\`
- \`agent-loop/scripts/sliderule-v2-closure-*-119-queue.json\`
- \`agent-loop/tasks/sliderule-v2-cross-*-118.md\`
- Current main code in SlideRule Python, AppBundle Skill, Skill orchestrator, report/export, and /agent-loop/sliderule UI.

## Allowed files
${commonAllowedFiles.map((file) => `- \`${file}\``).join("\n")}

## Do not
- Do not edit \`.env\`, credentials, lockfiles, generated dependency folders, or unrelated runtime artifacts.
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
`,
  };
}

function queueJson(theme, tasks) {
  return {
    cwd: "..",
    defaults: {
      useWorktree: true,
      worktreeScope: "queue",
      queueWorktreeName: theme.worktree,
      autoFix: true,
      skipReview: false,
      fixAgent: "grok",
      fixModel: "grok-build",
      reviewAgent: "codex",
      reviewModel: "gpt-5.5",
      scopedReview: true,
      workerMaxTurns: 512,
      workerMaxRetries: 1,
      grokMaxTurns: 512,
      grokMaxRetries: 1,
      reviewMaxTurns: 4,
      guardTests: false,
      maxIterations: 12,
      agentIdleTimeoutMs: 1200000,
      agentTimeoutMs: 2400000,
      noSyncTaskStatus: false,
      autoDisableOnNoChanges: false,
      cleanupWorktree: false,
      timeoutMs: 3600000,
      lang: "zh-CN",
      pythonExe: "slide-rule-python/.venv/Scripts/python.exe",
      workerEnv: {
        HTTP_PROXY: "http://127.0.0.1:7890",
        HTTPS_PROXY: "http://127.0.0.1:7890",
        ALL_PROXY: "http://127.0.0.1:7890",
        NO_PROXY: "localhost,127.0.0.1,::1",
      },
    },
    gates: ["node agent-loop/src/check-mojibake.js {{taskFile}}"],
    tasks: tasks.map((task) => ({
      id: task.id,
      task: `agent-loop/tasks/${path.basename(task.path)}`,
      enabled: true,
      gates: [
        `node -e "const fs=require('fs'); const task=fs.readFileSync(process.argv[1],'utf8'); for (const needle of ['${phase}','## Required implementation','## Acceptance criteria','codex-reviewed-only']) { if(!task.includes(needle)) throw new Error('task missing marker: '+needle); }" {{taskFile}}`,
        "node agent-loop/src/check-mojibake.js {{taskFile}}",
      ],
      workerMaxTurns: 512,
      maxIterations: 12,
      fixAgent: "grok",
      fixModel: "grok-build",
      reviewAgent: "codex",
      reviewModel: "gpt-5.5",
      scopedReview: true,
      skipReview: false,
    })),
  };
}

fs.mkdirSync(tasksDir, { recursive: true });
fs.mkdirSync(scriptsDir, { recursive: true });

const generated = [];
for (const theme of themes) {
  const taskFiles = theme.tasks.map(([slug, objective], index) => taskMarkdown(theme, index + 1, slug, objective));
  for (const task of taskFiles) {
    fs.writeFileSync(task.path, task.content, "utf8");
    generated.push(path.relative(root, task.path));
  }
  const queuePath = path.join(scriptsDir, theme.queue);
  fs.writeFileSync(queuePath, `${JSON.stringify(queueJson(theme, taskFiles), null, 2)}\n`, "utf8");
  generated.push(path.relative(root, queuePath));
}

console.log(`Generated ${generated.length} files`);
for (const file of generated) {
  console.log(file.replace(/\\/g, "/"));
}
