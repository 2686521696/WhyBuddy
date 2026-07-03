import { spawnSync } from "node:child_process";
import process from "node:process";

export const FOCUSED_GATE_COMMANDS = [
  {
    id: "appbundle-artifact-smoke",
    command: "npx vitest run client/src/lib/skills/purchaseApproval.test.ts",
  },
  {
    id: "skilltrace-datamodel",
    command: "npx vitest run client/src/lib/skills/datamodel/dataModelSkill.test.ts",
  },
  {
    id: "skilltrace-rbac",
    command: "npx vitest run client/src/lib/skills/rbac/rbacSkill.test.ts",
  },
  {
    id: "skilltrace-workflow",
    command: "npx vitest run client/src/lib/skills/workflow/workflowSkill.test.ts",
  },
  {
    id: "skilltrace-aigc",
    command: "npx vitest run client/src/lib/skills/aigc/aigcSkill.test.ts",
  },
  {
    id: "skilltrace-page",
    command: "npx vitest run client/src/lib/skills/page/pageSkill.test.ts",
  },
  {
    id: "skilltrace-appbundle-closure",
    command: "npx vitest run client/src/lib/skills/appbundle/appBundleSkill.test.ts -t \"runtime closure|publishGate|AppBundle closure|appbundle aggregate|focused vitest matrix\"",
  },
  {
    id: "appbundle-python-closure-hash",
    command: "cd slide-rule-python && python -m pytest tests/test_v5_publish_closure_response.py -q",
  },
  {
    id: "browser-evidence-projection",
    command: "npx vitest run client/src/pages/sliderule/__tests__/derive-persisted-turn.test.ts",
  },
  {
    id: "browser-drive-full-adapter",
    command: "npx vitest run client/src/pages/sliderule/__tests__/derive-status-bar.test.ts -t \"driveFullViaPython attaches\"",
  },
  {
    id: "browser-skill-runtime-visible",
    command: "npx vitest run client/src/pages/sliderule/__tests__/ArchitectureProcessPanel.test.tsx -t \"surfaces python /drive-full publishClosure\"",
  },
  {
    id: "browser-route-probe",
    command: "node agent-loop/scripts/sliderule-browser-route-probe.mjs",
  },
  {
    id: "closure-summary-surface",
    command: "npx vitest run client/src/pages/sliderule/__tests__/derive-cross-runtime-summary.test.ts",
  },
  {
    id: "report-export-closure-summary",
    command: "npx vitest run client/src/pages/sliderule/__tests__/knife-c-terminal.test.ts -t \"serializes report/export summary\"",
  },
  {
    id: "deliverables-report-export-summary",
    command: "npx vitest run client/src/pages/sliderule/__tests__/DeliverablesPanel.test.tsx",
  },
  {
    id: "closure-final-json-summary",
    command: "node --test agent-loop/src/closureFinalSummary.test.mjs",
  },
  {
    id: "drive-full-model-attachments",
    command: "cd slide-rule-python && python -m pytest tests/test_sliderule_driver_fullpath.py -k \"drive_full or result_to_dict\"",
  },
  {
    id: "drive-full-proxy-contract",
    command: "node agent-loop/src/validate-drivefull-contract.js",
  },
  {
    id: "skill-runtime-graph-model-attachments",
    command: "cd slide-rule-python && python -m pytest tests/test_v5_skill_runtime_graph.py",
  },
  {
    id: "typecheck",
    command: "node --run check",
  },
  {
    id: "diff-check",
    command: "git diff --check",
  },
];

function runCommand(command) {
  const result = spawnSync(command, {
    shell: true,
    encoding: "utf8",
    timeout: 180000,
  });
  return {
    exitCode: result.status ?? 1,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim().slice(0, 1200),
  };
}

export function runFocusedGate({ simulate = false } = {}) {
  const results = FOCUSED_GATE_COMMANDS.map((entry) => {
    if (simulate) {
      return { ...entry, exitCode: 0, ok: true, output: "simulated" };
    }
    const result = runCommand(entry.command);
    return { ...entry, ok: result.exitCode === 0, ...result };
  });
  const failed = results.filter((result) => !result.ok).length;
  return {
    ok: failed === 0,
    summary: {
      total: results.length,
      passed: results.length - failed,
      failed,
    },
    results,
  };
}

function printList() {
  console.log("SlideRule runtime closure focused gate");
  for (const entry of FOCUSED_GATE_COMMANDS) {
    console.log(`- ${entry.id}: ${entry.command}`);
  }
}

function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--list") || args.has("--help")) {
    printList();
    return;
  }
  const result = runFocusedGate({ simulate: args.has("--self-test") });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === `file:///${process.argv[1]?.replaceAll("\\", "/")}`) {
  main();
}
