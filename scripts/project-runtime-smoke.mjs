import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = join(root, "slide-rule-python", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) throw new Error("Project smoke requires slide-rule-python/.venv");
const result = spawnSync(python, [join(root, "scripts/project-runtime-smoke.py"), ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
