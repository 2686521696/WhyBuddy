// === Python-first frontend API routing (backend-python-total-cutover-105) ===
// Local dev and frontend API calls prefer Python where a Python route exists (listed owned prefixes).
// Default is Python-first for /api/sliderule, /api/blueprint/spec-documents (and always /api/agent-loop);
// explicit Node legacy fallback for other /api/* (Node thin proxy / compat shell).
// Set VITE_PYTHON_FIRST_API=false (or FRONTEND_PYTHON_FIRST=false etc) to opt out for owned prefixes.
// PYTHON_API_TARGET overrides target. resolveApiTarget(path) is executable guard (importable for tests/verif).
//
// 独立成模块（不放 vite.config.ts）：测试/脚本引用它时不应连带拉起
// tailwind/react 插件链——那会把 vite.config 的重依赖灌进每个测试 worker，
// 且 @tailwindcss/node 的 module.register 在 vmThreads 测试池里不可用。
const PYTHON_DEFAULT_TARGET = "http://localhost:9700";
const NODE_DEFAULT_TARGET = "http://localhost:3001";

export function resolveApiTarget(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const pyTarget = env.PYTHON_API_TARGET || env.AGENT_LOOP_API_TARGET || PYTHON_DEFAULT_TARGET;
  if (path.startsWith("/api/agent-loop")) {
    return pyTarget; // explicit Python-owned (baseline, always)
  }
  if (path === "/api/health" || path.startsWith("/api/health/") || path === "/health" || path === "/ready") {
    return pyTarget; // health/readiness unified to Python per foundation task 04 + task 05 Vite default proxy
  }
  const hasExplicitDisable =
    env.VITE_PYTHON_FIRST_API === "false" ||
    env.FRONTEND_PYTHON_FIRST === "false" ||
    env.PYTHON_FIRST_PROXY === "false";
  const hasExplicitEnable =
    env.VITE_PYTHON_FIRST_API === "true" ||
    env.FRONTEND_PYTHON_FIRST === "true" ||
    env.PYTHON_FIRST_PROXY === "true" ||
    !!env.PYTHON_API_TARGET;
  const pythonFirstEnabled = hasExplicitEnable || !hasExplicitDisable;
  const pythonOwnedPrefixes = [
    "/api/sliderule",
    "/api/blueprint/spec-documents",
    "/api/health",
    // health/readiness unified under Python (task 04). Vite dev routing defaults Python for owned (task 05).
    // Non-listed /api/* stay Node explicit thin compat per policy.
  ];
  if (pythonFirstEnabled && pythonOwnedPrefixes.some((p) => path.startsWith(p))) {
    return pyTarget;
  }
  return NODE_DEFAULT_TARGET;
}
