#!/usr/bin/env node
/**
 * check-no-node-backend-api.mjs
 *
 * Regression guard for backend-python-api-cutover-no-node-105 (task 59, Retirement).
 *
 * Fails (exit 1) when new Node-owned backend APIs are introduced:
 * - Scans server/index.ts for mounted /api/* surfaces (app.use + direct app.get/post... literals) vs REGISTERED_SURFACES.
 * - Scans server/index.ts direct app.* /api literals: total decl count + complete literal "method:path" set frozen.
 *   (prevents bypass via normalizePath folding of e.g. /api/tasks/:id/* into registered prefix)
 * - Scans all server/routes/*.ts for router handler declarations using TOTAL router.*( call count
 *   + full literal "method:path" sets frozen for EVERY module with extractable literals.
 * - Any new mount not registered, or decl count > frozen, or any new literal method:path (any module or direct in index),
 *   or new route module with handlers -> FAIL.
 * - For PYTHON_FIRST_COMPAT surfaces, asserts thin proxy markers in Node shell.
 *
 * This guard must be run as part of release/test gates to protect the cutover progress.
 * It does not remove existing Node ownership; it prevents *new* ones.
 *
 * Usage:
 *   node scripts/check-no-node-backend-api.mjs
 *   node --run guard:no-node-backend-api
 *   (automatically run as part of: node --run test:release for regression)
 *
 * Required in final report of task 59: run this + mojibake + relevant smallest py/node cmds.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

// Frozen snapshot of registered /api surfaces at task 59 time.
// Any mount discovered at runtime not present here (after normalization) = NEW Node-owned API -> FAIL.
// This list locks the denominator and prevents expansion of Node backend API ownership.
const REGISTERED_SURFACES = [
  "/api",
  "/api/a2a",
  "/api/admin",
  "/api/admin/knowledge",
  "/api/agents",
  "/api/agents/guest",
  "/api/ai-ppt",
  "/api/analytics",
  "/api/audio-recognition",
  "/api/audit",
  "/api/auth",
  "/api/blueprint",
  "/api/chat",
  "/api/config",
  "/api/cost",
  "/api/decision-templates",
  "/api/dynamic-chart",
  "/api/excel-read",
  "/api/executor/events",
  "/api/export",
  "/api/feishu",
  "/api/file-generation",
  "/api/file-slicing",
  "/api/file-translation",
  "/api/format-output",
  "/api/get-device-info",
  "/api/get-location-info",
  "/api/graph-search",
  "/api/health",
  "/api/health/persistence",
  "/api/image-search",
  "/api/intent-recognition",
  "/api/knowledge",
  "/api/lineage",
  "/api/long-text-extraction",
  "/api/mcp",
  "/api/nl-command",
  "/api/ocr-recognition",
  "/api/open-dashboard",
  "/api/open-page",
  "/api/orchestration-recognition-jump",
  "/api/permissions",
  "/api/planets",
  "/api/projects",
  "/api/rag",
  "/api/rag/risk-actions",
  "/api/replay",
  "/api/reports",
  "/api/robot-reply",
  "/api/similarity-match",
  "/api/skills",
  "/api/sliderule",
  "/api/static-webpage-read",
  "/api/tasks",
  "/api/tasks/smoke/dispatch",
  "/api/tasks/smoke/seed-running",
  "/api/telemetry",
  "/api/transaction-flow",
  "/api/v1",
  "/api/v1/",
  "/api/vector-delete",
  "/api/vector-update",
  "/api/vision",
  "/api/voice",
  "/api/web-qa",
  "/api/web-search",
  "/api/whybuddy",
  "/api/workflows",
];

// PYTHON_FIRST_COMPAT surfaces (Node may mount thin proxy only; Python owns semantics).
// Only include surfaces with explicit thin proxy implementation + marker from prior cutover tasks.
// /api/blueprint remains primarily ACTIVE_NODE_BUSINESS (only /spec-documents slice cut over).
const PYTHON_FIRST_COMPAT_SURFACES = [
  "/api/sliderule",
  "/api/whybuddy",
  "/api/agent-loop",
  "/api/health",
];

// Map surface -> route module that should be thin shell for PYTHON_FIRST
const THIN_PROXY_FILES = {
  "/api/sliderule": "server/routes/sliderule.ts",
  "/api/whybuddy": "server/routes/sliderule.ts",
  "/api/agent-loop": "server/routes/agent-loop.ts",
  "/api/health": "server/routes/health.ts",
};

// Frozen counts of router handler *declarations* (each router.get/post/put/delete/patch/use/all call)
// inside each server/routes/*.ts at baseline (task 59).
// Count uses total number of router.XXX( invocations (broad match), so:
// - same subpath + new HTTP method increments (e.g. post + get on "/")
// - dynamic handlers like router.post(expr, ...) or router.get(stripPrefix(x)) also counted
// If cur > frozen for a listed file, or new module declares any -> FAIL (catches dynamics and net adds).
const FROZEN_HANDLER_COUNTS = {
  "server/routes/a2a.ts": 10,
  "server/routes/admin.ts": 10,
  "server/routes/agent-loop.ts": 18,
  "server/routes/agents.ts": 8,
  "server/routes/ai-ppt.ts": 2,
  "server/routes/aigc-monitoring.ts": 4,
  "server/routes/analytics.ts": 1,
  "server/routes/audio-recognition.ts": 1,
  "server/routes/auth.ts": 14,
  "server/routes/blueprint.ts": 63,
  "server/routes/chat.ts": 2,
  "server/routes/config.ts": 3,
  "server/routes/cost.ts": 5,
  "server/routes/dynamic-chart.ts": 1,
  "server/routes/excel-read.ts": 1,
  "server/routes/export.ts": 1,
  "server/routes/file-generation.ts": 3,
  "server/routes/file-slicing.ts": 1,
  "server/routes/file-translation.ts": 2,
  "server/routes/format-output.ts": 1,
  "server/routes/get-device-info.ts": 1,
  "server/routes/get-location-info.ts": 1,
  "server/routes/graph-search.ts": 1,
  "server/routes/guest-agents.ts": 4,
  "server/routes/intent-recognition.ts": 1,
  "server/routes/knowledge-admin.ts": 5,
  "server/routes/knowledge.ts": 5,
  "server/routes/lineage.ts": 15,
  "server/routes/long-text-extraction.ts": 1,
  "server/routes/mcp.ts": 1,
  "server/routes/nl-command.ts": 26,
  "server/routes/ocr-recognition.ts": 1,
  "server/routes/open-dashboard.ts": 2,
  "server/routes/open-page.ts": 1,
  "server/routes/open-report.ts": 1,
  "server/routes/orchestration-recognition-jump.ts": 1,
  "server/routes/planets.ts": 3,
  "server/routes/projects.ts": 14,
  "server/routes/rag.ts": 15,
  "server/routes/replay.ts": 8,
  "server/routes/reports.ts": 5,
  "server/routes/reputation.ts": 6,
  "server/routes/robot-reply.ts": 1,
  "server/routes/similarity-match.ts": 1,
  "server/routes/skills.ts": 7,
  "server/routes/sliderule.ts": 11,
  "server/routes/static-webpage-read.ts": 1,
  "server/routes/tasks.ts": 14,
  "server/routes/telemetry.ts": 3,
  "server/routes/transaction-flow.ts": 1,
  "server/routes/ue.ts": 3,
  "server/routes/vision.ts": 3,
  "server/routes/voice.ts": 3,
  "server/routes/web-aigc-risk-actions.ts": 3,
  "server/routes/web-qa.ts": 1,
  "server/routes/web-search.ts": 1,
  "server/routes/workflows.ts": 19,
  // Baseline route modules with 0 (or current) router decls (prevent adding new handlers even via dynamic exprs)
  "server/routes/audit.ts": 18,
  "server/routes/feishu.ts": 0,
  "server/routes/health.ts": 0,
  "server/routes/image-search.ts": 1,
  "server/routes/permissions.ts": 23,
  "server/routes/persistence-health.ts": 1,
  "server/routes/vector-delete.ts": 1,
  "server/routes/vector-update.ts": 1,
};

// Freeze the COMPLETE set of literal "method:path" declarations for EVERY baseline module
// that declares any literal router.*( "..." ) handlers (extracted at task 59 baseline).
// This ensures that adding ANY new literal Node-owned endpoint (new path or additional method on
// existing path) causes a violation even if an old handler was removed/merged (count would stay flat).
// Dynamic/non-literal handlers are caught by FROZEN_HANDLER_COUNTS total decl > check.
const FROZEN_METHOD_PATHS = {
  "server/routes/a2a.ts": [
    "get:/agents",
    "get:/analytics",
    "get:/sessions",
    "post:/analytics/inc",
    "post:/auto-agent",
    "post:/cancel",
    "post:/chat",
    "post:/invoke",
    "post:/report",
    "post:/stream"
  ],
  "server/routes/admin.ts": [
    "get:/audit",
    "get:/failures",
    "get:/projects",
    "get:/projects/:projectId",
    "get:/runs",
    "get:/summary",
    "get:/users",
    "get:/users/:userId"
  ],
  "server/routes/agent-loop.ts": [
    "get:/capabilities",
    "get:/health",
    "get:/provider-health",
    "get:/queue/overview",
    "get:/runs",
    "get:/runs/:runId",
    "get:/runs/:runId/artifacts/:name",
    "get:/runs/:runId/events",
    "get:/runs/:runId/events/stream",
    "get:/runs/:runId/events/stream/v2",
    "get:/runs/:runId/snapshot",
    "get:/runs/overview",
    "get:/settings",
    "post:/cancel",
    "post:/queue/run",
    "post:/rerun",
    "post:/settings",
    "post:/task/run"
  ],
  "server/routes/agents.ts": [
    "get:/",
    "get:/:id",
    "get:/:id/heartbeat",
    "get:/:id/memory/recent",
    "get:/:id/memory/search",
    "get:/:id/soul",
    "get:/department/:dept",
    "get:/org/tree"
  ],
  "server/routes/ai-ppt.ts": [
    "get:/outputs/:outputId/:filename",
    "post:/nodes/execute"
  ],
  "server/routes/aigc-monitoring.ts": [
    "get:/instances",
    "get:/instances/:instanceId",
    "get:/instances/:instanceId/session",
    "post:/instances/:instanceId/terminate"
  ],
  "server/routes/analytics.ts": [
    "get:/roles"
  ],
  "server/routes/audio-recognition.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/auth.ts": [
    "get:/__internal/auth-audit-closure",
    "get:/__internal/auth-mailer-user-store-scope",
    "get:/__internal/auth-production-ownership-closure",
    "get:/__internal/auth-session-repository-takeover",
    "get:/__internal/auth-session-token-boundary",
    "get:/__internal/auth-token-issuance-takeover",
    "get:/__internal/auth-token-mailer-session-cutover",
    "get:/me",
    "post:/email-code/login",
    "post:/email-code/send",
    "post:/login",
    "post:/logout",
    "post:/refresh",
    "post:/register"
  ],
  "server/routes/blueprint.ts": [
    "delete:/generations/:jobId/route-selection",
    "delete:/jobs/:jobId/route-selection",
    "get:/capabilities",
    "get:/clarifications/:sessionId",
    "get:/diagnostics",
    "get:/generations/:jobId",
    "get:/generations/:jobId/events",
    "get:/generations/:jobId/events/stream",
    "get:/image-settings",
    "get:/intake/:intakeId",
    "get:/jobs",
    "get:/jobs/:jobId",
    "get:/jobs/:jobId/agent-crew",
    "get:/jobs/:jobId/artifact-ledger",
    "get:/jobs/:jobId/artifact-replays",
    "get:/jobs/:jobId/brainstorm-evidence",
    "get:/jobs/:jobId/capabilities",
    "get:/jobs/:jobId/capability-evidence",
    "get:/jobs/:jobId/capability-invocations",
    "get:/jobs/:jobId/checks-ledger",
    "get:/jobs/:jobId/companion-challenges",
    "get:/jobs/:jobId/effect-previews",
    "get:/jobs/:jobId/engineering-landing",
    "get:/jobs/:jobId/engineering-runs",
    "get:/jobs/:jobId/events",
    "get:/jobs/:jobId/events/stream",
    "get:/jobs/:jobId/family",
    "get:/jobs/:jobId/preview-audit-trail",
    "get:/jobs/:jobId/prompt-packages",
    "get:/jobs/:jobId/role-timelines",
    "get:/jobs/:jobId/sandbox-derivation-jobs",
    "get:/jobs/:jobId/spec-documents",
    "get:/jobs/:jobId/spec-documents/export",
    "get:/jobs/:jobId/spec-tree",
    "get:/jobs/:jobId/stale-artifacts",
    "get:/jobs/:jobId/traceability-matrix",
    "get:/jobs/latest",
    "get:/projects/:projectId/context",
    "get:/specs",
    "patch:/clarifications/:sessionId/answers",
    "patch:/intake/:intakeId",
    "patch:/jobs/:jobId/spec-documents/:documentId/review",
    "patch:/jobs/:jobId/spec-tree/nodes/:nodeId",
    "post:/clarifications/:sessionId/answers",
    "post:/generations",
    "post:/intake",
    "post:/intake/:intakeId/clarifications",
    "post:/jobs",
    "post:/jobs/:jobId/artifact-diff",
    "post:/jobs/:jobId/artifact-feedback",
    "post:/jobs/:jobId/artifact-replay",
    "post:/jobs/:jobId/capability-invocations",
    "post:/jobs/:jobId/effect-previews",
    "post:/jobs/:jobId/engineering-landing",
    "post:/jobs/:jobId/engineering-runs",
    "post:/jobs/:jobId/prompt-packages",
    "post:/jobs/:jobId/replan",
    "post:/jobs/:jobId/route-selection",
    "post:/jobs/:jobId/sandbox-derivation-jobs",
    "post:/jobs/:jobId/spec-documents",
    "post:/jobs/:jobId/spec-documents/:documentId/versions",
    "post:/jobs/:jobId/spec-tree/actions",
    "post:/jobs/:jobId/spec-tree/versions"
  ],
  "server/routes/chat.ts": [
    "post:/",
    "post:/nodes/execute"
  ],
  "server/routes/config.ts": [
    "get:/ai",
    "get:/stages",
    "get:/stats"
  ],
  "server/routes/cost.ts": [
    "get:/budget",
    "get:/history",
    "get:/live",
    "post:/downgrade/release",
    "put:/budget"
  ],
  "server/routes/dynamic-chart.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/excel-read.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/export.ts": [
    "post:/"
  ],
  "server/routes/file-generation.ts": [
    "get:/outputs/:outputId/:filename",
    "get:/outputs/:outputId/:filename/preview",
    "post:/nodes/execute"
  ],
  "server/routes/file-slicing.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/file-translation.ts": [
    "get:/outputs/:outputId/:filename",
    "post:/nodes/execute"
  ],
  "server/routes/format-output.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/get-device-info.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/get-location-info.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/graph-search.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/guest-agents.ts": [
    "delete:/:id",
    "get:/",
    "post:/",
    "post:/:id/execute"
  ],
  "server/routes/image-search.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/intent-recognition.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/knowledge-admin.ts": [
    "post:/proxy"
  ],
  "server/routes/knowledge.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/lineage.ts": [
    "get:/web-aigc"
  ],
  "server/routes/long-text-extraction.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/mcp.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/nl-command.ts": [
    "get:/alerts",
    "get:/audit",
    "get:/commands",
    "get:/commands/:id",
    "get:/commands/:id/dialog",
    "get:/comments",
    "get:/dashboard",
    "get:/history",
    "get:/plans/:id",
    "get:/plans/:id/risks",
    "get:/plans/:id/suggestions",
    "get:/reports/:id",
    "get:/templates",
    "post:/alerts/rules",
    "post:/audit/export",
    "post:/clarification-preview",
    "post:/command-list/:listId/select",
    "post:/command-list/generate",
    "post:/commands",
    "post:/commands/:id/clarify",
    "post:/comments",
    "post:/plans/:id/adjust",
    "post:/plans/:id/apply-suggestion",
    "post:/plans/:id/approve",
    "post:/reports/generate",
    "post:/templates"
  ],
  "server/routes/ocr-recognition.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/open-dashboard.ts": [
    "get:/targets/:dashboardId",
    "post:/nodes/execute"
  ],
  "server/routes/open-page.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/open-report.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/orchestration-recognition-jump.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/persistence-health.ts": [
    "get:/"
  ],
  "server/routes/planets.ts": [
    "get:/",
    "get:/:id",
    "get:/:id/interior"
  ],
  "server/routes/projects.ts": [
    "get:/",
    "get:/:projectId",
    "get:/:projectId/bundle",
    "patch:/:projectId",
    "post:/",
    "post:/:projectId/archive",
    "post:/:projectId/artifacts",
    "post:/:projectId/clarification-questions",
    "post:/:projectId/evidence",
    "post:/:projectId/messages",
    "post:/:projectId/missions/link",
    "post:/:projectId/routes",
    "post:/:projectId/specs"
  ],
  "server/routes/rag.ts": [
    "get:/admin/dlq",
    "get:/admin/health",
    "get:/admin/metrics",
    "get:/feedback/stats",
    "get:/task-rag/:taskId",
    "post:/admin/backfill",
    "post:/admin/dlq/:entryId/retry",
    "post:/admin/purge",
    "post:/admin/reembed",
    "post:/feedback",
    "post:/ingest",
    "post:/ingest/batch",
    "post:/search",
    "post:/web-aigc/document-search",
    "post:/web-aigc/fragment-search"
  ],
  "server/routes/replay.ts": [
    "get:/:missionId",
    "get:/:missionId/audit",
    "get:/:missionId/events",
    "get:/:missionId/export",
    "get:/:missionId/snapshots",
    "post:/:missionId/snapshots",
    "post:/:missionId/verify",
    "use:/:missionId"
  ],
  "server/routes/reports.ts": [
    "get:/heartbeat",
    "get:/heartbeat/:agentId/:reportId",
    "get:/heartbeat/:agentId/:reportId/download",
    "get:/heartbeat/status",
    "post:/heartbeat/:agentId/run"
  ],
  "server/routes/reputation.ts": [
    "get:/admin/reputation/distribution",
    "get:/admin/reputation/leaderboard",
    "get:/admin/reputation/trends",
    "get:/agents/:id/reputation",
    "post:/admin/reputation/:agentId/adjust",
    "post:/admin/reputation/:agentId/reset"
  ],
  "server/routes/robot-reply.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/similarity-match.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/skills.ts": [
    "get:/",
    "get:/:id/metrics",
    "get:/:id/versions",
    "post:/",
    "post:/:id/execute",
    "put:/:id/:version/disable",
    "put:/:id/:version/enable"
  ],
  "server/routes/sliderule.ts": [
    "delete:/sessions/:sessionId",
    "get:/ai-topology",
    "get:/health",
    "get:/sessions",
    "get:/sessions/:sessionId",
    "post:/execute-capability",
    "post:/orchestrate-plan",
    "post:/respond",
    "post:/sessions/__clear",
    "post:/sessions/__reload",
    "put:/sessions/:sessionId"
  ],
  "server/routes/static-webpage-read.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/tasks.ts": [
    "get:/",
    "get:/:id",
    "get:/:id/artifacts",
    "get:/:id/artifacts/:index/download",
    "get:/:id/artifacts/:index/preview",
    "get:/:id/decisions",
    "get:/:id/events",
    "get:/:id/projection",
    "get:/:id/session",
    "post:/",
    "post:/:id/cancel",
    "post:/:id/decision",
    "post:/:id/operator-actions"
  ],
  "server/routes/telemetry.ts": [
    "get:/history",
    "get:/live",
    "post:/contract/error-probe"
  ],
  "server/routes/transaction-flow.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/ue.ts": [
    "get:/debug",
    "get:/health",
    "post:/debug"
  ],
  "server/routes/vector-delete.ts": [
    "post:/"
  ],
  "server/routes/vector-update.ts": [
    "post:/"
  ],
  "server/routes/vision.ts": [
    "get:/outputs/:outputId/:filename",
    "post:/analyze",
    "post:/ocr"
  ],
  "server/routes/voice.ts": [
    "get:/config",
    "post:/stt",
    "post:/tts"
  ],
  "server/routes/web-aigc-risk-actions.ts": [
    "post:/vector-delete",
    "post:/vector-insert",
    "post:/vector-update"
  ],
  "server/routes/web-qa.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/web-search.ts": [
    "post:/nodes/execute"
  ],
  "server/routes/workflows.ts": [
    "get:/",
    "get:/:id",
    "get:/:id/graph-instance",
    "get:/:id/messages",
    "get:/:id/nodes/:nodeId/skills",
    "get:/:id/report",
    "get:/:id/report/department/:managerId/download",
    "get:/:id/report/download",
    "get:/:id/runtime-definition",
    "get:/:id/runtime-state",
    "get:/:id/tasks",
    "post:/",
    "post:/:id/runtime/escalate",
    "post:/:id/runtime/resume",
    "post:/:id/runtime/retry",
    "post:/:id/runtime/run",
    "post:/:id/runtime/terminate",
    "post:/organization/preview",
    "use:/open-report"
  ]
};

// Frozen direct literal app.* /api declarations inside server/index.ts (bypass route modules).
// Separate freeze required because normalizePath folds e.g. /api/tasks/:id/* into /api/tasks (registered surface)
// and surface unknown check alone does not prevent new direct decls under existing prefixes.
// Total count + full literal method:path set for directs.
const FROZEN_DIRECT_INDEX_COUNT = 3;
const FROZEN_DIRECT_INDEX_METHOD_PATHS = [
  "post:/api/executor/events",
  "post:/api/tasks/smoke/dispatch",
  "post:/api/tasks/smoke/seed-running",
];

function normalizePath(p) {
  return p.replace(/:.*$/, "").replace(/\/:[^/]+/g, "").replace(/\/$/, "");
}

function normalizeSub(p) {
  // normalize root "/" to "/" (not empty) so literal root handlers are captured as e.g. "post:/"
  const s = p.replace(/\/$/, "");
  return s || "/";
}

// Extract router handler declarations for freeze.
// - totalDecls: count of ALL router.(get|post|...|use|all)( calls (literal or dynamic expr).
//   This ensures adding a new method on same path, or a dynamic router.post(var) etc. increases count.
// - litMethodPaths: for literal string paths, "method:/path" pairs (e.g. "post:/", "get:/:id").
//   Used to freeze exact handler declarations on literal paths.
function extractRouteHandlerCounts() {
  const routesDir = resolve(repoRoot, "server/routes");
  let names = [];
  try {
    names = readdirSync(routesDir).filter((n) => n.endsWith(".ts") && !n.includes("__tests__"));
  } catch {
    return {};
  }
  const counts = {};
  const litMethodPathsByFile = {};
  for (const name of names) {
    const rel = `server/routes/${name}`;
    const full = resolve(routesDir, name);
    try {
      const src = readFileSync(full, "utf8");
      // Broad: every router handler declaration (catches dynamic and same-path different methods)
      const declRe = /router\.(get|post|put|delete|patch|use|all)\s*\(/g;
      const totalDecls = (src.match(declRe) || []).length;

      // Literal method+path for stricter per-declaration freeze on string paths
      const litRe = /router\.(get|post|put|delete|patch|use|all)\s*\(\s*["'`]([^"'`]+?)["'`]/g;
      const lits = new Set();
      let m;
      while ((m = litRe.exec(src)) !== null) {
        const method = m[1].toLowerCase();
        let p = normalizeSub(m[2]);
        if (p) lits.add(`${method}:${p}`);
      }
      counts[rel] = totalDecls;
      litMethodPathsByFile[rel] = Array.from(lits).sort();
    } catch {
      counts[rel] = 0;
      litMethodPathsByFile[rel] = [];
    }
  }
  return { counts, litMethodPathsByFile };
}

// Extract direct app.*(/api...) literal declarations from server/index.ts.
// Returns total literal decl count + exact "method:literal-path" set (keeps :params etc).
// This is separate from mounted surface scan + REGISTERED because normalizePath folds
// param paths (e.g. /api/tasks/:id/foo -> /api/tasks) so new directs under known surfaces
// would not hit "unknown". We freeze count + lits so ANY new direct /api decl fails.
function extractDirectIndexDecls() {
  const indexPath = resolve(repoRoot, "server/index.ts");
  let src;
  try {
    src = readFileSync(indexPath, "utf8");
  } catch {
    return { count: 0, litMethodPaths: [] };
  }
  const litRe = /app\.(get|post|put|delete|patch|all)\s*\(\s*["'`](\/api[^"'`]+?)["'`]/g;
  const lits = new Set();
  let m;
  while ((m = litRe.exec(src)) !== null) {
    const method = m[1].toLowerCase();
    const p = m[2]; // exact literal path as declared (preserve :id etc for exact freeze)
    lits.add(`${method}:${p}`);
  }
  const declMatches = src.match(/app\.(get|post|put|delete|patch|all)\s*\(\s*["'`](\/api[^"'`]+?)["'`]/g) || [];
  const count = declMatches.length;
  return { count, litMethodPaths: Array.from(lits).sort() };
}

function extractMountedApis() {
  const indexPath = resolve(repoRoot, "server/index.ts");
  let src = readFileSync(indexPath, "utf8");
  // collapse whitespace to catch multiline constructs for use() forms
  const collapsed = src.replace(/\s+/g, " ");
  const raw = [];
  // existing: app.use mounts
  const useRe = /app\.use\([^)]*["'`](\/api[^"'`,)]*)/g;
  let m;
  while ((m = useRe.exec(collapsed)) !== null) {
    raw.push(m[1]);
  }
  // also scan direct app.get/post/...('/api/...') literals in server/index.ts for surface discovery
  // (full literal paths help surface check for non-folded cases; direct decl freeze below handles param-fold cases)
  const directRe = /app\.(get|post|put|delete|patch|all)\s*\(\s*["'`](\/api[^"'`]+?)["'`]/g;
  while ((m = directRe.exec(src)) !== null) {
    raw.push(m[2]);
  }
  // also catch the attachHealthProxy case explicitly
  if (src.includes("attachHealthProxy") || collapsed.includes("attachHealthProxy")) {
    raw.push("/api/health");
  }
  const cleaned = raw
    .map((p) => normalizePath(p))
    .filter((p) => p.startsWith("/api"));
  return Array.from(new Set(cleaned)).sort();
}

function hasThinProxyMarker(fileRel) {
  const full = resolve(repoRoot, fileRel);
  try {
    const content = readFileSync(full, "utf8");
    const markers = [
      "PYTHON_FIRST_COMPAT",
      "thin compat",
      "thin proxy",
      "thin shell",
      "proxy to Python",
      "delegate to python",
      "PYTHON_API_TARGET",
      "python proxy",
      "explicit thin",
    ];
    return markers.some((mk) => content.toLowerCase().includes(mk.toLowerCase()));
  } catch {
    return false;
  }
}

function main() {
  console.log("[check-no-node-backend-api] Scanning Node backend API mounts + route handler declarations for regressions...");
  const discovered = extractMountedApis();
  console.log(`Discovered ${discovered.length} mounted /api surfaces.`);

  const unknown = discovered.filter((d) => !REGISTERED_SURFACES.includes(d));
  if (unknown.length > 0) {
    console.error("\n[FAIL] NEW NODE-OWNED BACKEND APIs INTRODUCED (regression guard):");
    unknown.forEach((u) => console.error("  + " + u));
    console.error("\nThese surfaces are not in the registered baseline from the no-Node cutover inventory.");
    console.error("Add to Python FastAPI (slide-rule-python/routes) + update Vite/Python routing +");
    console.error("update agent-loop/tasks/backend-python-no-node-api-migration-status-105.md before adding Node mount.");
    console.error("Or, if intentionally retained, update REGISTERED_SURFACES in this guard (and record in status).");
    process.exit(1);
  }

  // Check direct app.* /api literal decls in server/index.ts (per review: must freeze total direct decl count
  // and complete method:path set separately; normalizePath folding on param paths e.g. /api/xxx/:id/y under
  // registered prefix would otherwise allow new direct without "unknown" or route-module check).
  const { count: directCount, litMethodPaths: directLits } = extractDirectIndexDecls();
  const directViolations = [];
  if (directCount > FROZEN_DIRECT_INDEX_COUNT) {
    directViolations.push(`server/index.ts: ${directCount} direct /api handlers (frozen ${FROZEN_DIRECT_INDEX_COUNT})`);
  }
  const frozenDirectPaths = FROZEN_DIRECT_INDEX_METHOD_PATHS;
  for (const s of directLits) {
    if (!frozenDirectPaths.includes(s)) {
      directViolations.push(`server/index.ts new direct handler declaration: ${s}`);
    }
  }
  if (directViolations.length > 0) {
    console.error("\n[FAIL] NEW NODE-OWNED BACKEND API DIRECT HANDLERS in server/index.ts:");
    directViolations.forEach((v) => console.error("  + " + v));
    console.error("\nDirect app.*('/api/...') literals (including under already-registered mount prefixes) are frozen.");
    console.error("New direct Node backend API handlers must not be added; use Python (slide-rule-python/routes) + update status.");
    console.error("Update FROZEN_DIRECT_INDEX_* only after cutover.");
    process.exit(1);
  }

  // Check declared handlers inside route modules (per review findings).
  // - Unknown route files (not in FROZEN) that declare ANY router handlers are forbidden.
  // - For known files: total decl count must not exceed frozen (covers dynamics + net adds).
  // - For every module, no new literal "method:path" allowed (full freeze of all literal decl sets).
  const { counts: currentCounts, litMethodPathsByFile } = extractRouteHandlerCounts();
  const handlerViolations = [];
  const newModuleViolations = [];
  const routesDir = resolve(repoRoot, "server/routes");
  for (const [file, curCount] of Object.entries(currentCounts)) {
    if (!Object.prototype.hasOwnProperty.call(FROZEN_HANDLER_COUNTS, file)) {
      // Use broad detection (literal or expr) so dynamic handlers also trigger for unlisted modules.
      try {
        const src = readFileSync(resolve(routesDir, file.replace("server/routes/", "")));
        if (/router\.(get|post|put|delete|patch|use|all)\s*\(/.test(src)) {
          newModuleViolations.push(`${file}: declares router handlers (unknown route module not in frozen baseline)`);
        }
      } catch {
        // ignore unreadable; treat as no handler for safety here
      }
      continue;
    }
    const frozen = FROZEN_HANDLER_COUNTS[file];
    if (typeof frozen === "number" && curCount > frozen) {
      handlerViolations.push(`${file}: ${curCount} handlers (frozen ${frozen})`);
    }
    // literal method+path exact set check for ALL frozen modules (addresses review: new literal on any module
    // must fail even when paired with removal of another handler that keeps total count flat).
    const frozenMethodPaths = FROZEN_METHOD_PATHS[file] || [];
    for (const s of (litMethodPathsByFile[file] || [])) {
      if (!frozenMethodPaths.includes(s)) {
        handlerViolations.push(`${file} new handler declaration: ${s}`);
      }
    }
  }
  if (newModuleViolations.length > 0) {
    console.error("\n[FAIL] NEW NODE-OWNED BACKEND API ROUTE MODULES INTRODUCED:");
    newModuleViolations.forEach((v) => console.error("  + " + v));
    console.error("\nAdding new server/routes/*.ts files containing router handlers is forbidden (even under existing mount prefixes in REGISTERED_SURFACES).");
    console.error("Any new backend API surface must be implemented in Python (slide-rule-python/routes/*) first; Node may only provide documented thin proxies.");
    console.error("Update FROZEN_HANDLER_COUNTS (and migration status) only after cutover and explicit review.");
    process.exit(1);
  }
  if (handlerViolations.length > 0) {
    console.error("\n[FAIL] NEW NODE-OWNED BACKEND API ENDPOINTS DETECTED inside registered route modules:");
    handlerViolations.forEach((v) => console.error("  + " + v));
    console.error("\nAdding router handlers in server/routes/** (e.g. tasks.ts) after baseline is forbidden.");
    console.error("New business APIs must be added in Python (slide-rule-python/routes) with Node thin-proxy only.");
    console.error("Update baseline in this guard only after proper Python cutover + status ledger.");
    process.exit(1);
  }

  // Harden PYTHON_FIRST_COMPAT thin proxy requirement
  let thinFailures = 0;
  for (const surf of PYTHON_FIRST_COMPAT_SURFACES) {
    const routeFile = THIN_PROXY_FILES[surf];
    if (!routeFile) continue;
    if (!hasThinProxyMarker(routeFile)) {
      console.error(`[FAIL] ${surf} expected thin proxy marker in ${routeFile} but none found.`);
      thinFailures++;
    } else {
      console.log(`[ok] ${surf} -> ${routeFile} has thin proxy marker.`);
    }
  }

  if (thinFailures > 0) {
    console.error(`\n${thinFailures} PYTHON_FIRST_COMPAT surfaces lack thin proxy evidence.`);
    process.exit(1);
  }

  console.log("\n[check-no-node-backend-api] PASS: no new Node-owned backend APIs detected.");
  console.log("All discovered mounts are within the registered set.");
  console.log("Route handler declaration counts and full literal method:path sets inside server/routes modules match frozen baseline.");
  console.log("Direct app.* /api literal declarations in server/index.ts match frozen baseline.");
  console.log("PYTHON_FIRST_COMPAT thin shells verified where applicable.");
  process.exit(0);
}

main();
