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
    id: "browser-evidence-projection",
    command: "npx vitest run client/src/pages/sliderule/__tests__/derive-persisted-turn.test.ts",
  },
  {
    id: "closure-summary-surface",
    command: "npx vitest run client/src/pages/sliderule/__tests__/derive-cross-runtime-summary.test.ts",
  },
  {
    id: "drive-full-model-attachments",
    command: "cd slide-rule-python && python -m pytest tests/test_sliderule_driver_fullpath.py -k \"drive_full or result_to_dict\"",
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
