import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync("data/sliderule-sessions.json", "utf8"));
const sessions = Array.isArray(data) ? data : data.sessions || [data];

function pickSession() {
  for (const id of ["1781510307176", "1781510174315"]) {
    const hit = sessions.find(
      (s) =>
        String(s.id || s.sessionId || "").includes(id) ||
        JSON.stringify(s).includes(`marathon-${id}`)
    );
    if (hit) return hit;
  }
  return sessions[sessions.length - 1];
}

const session = pickSession();
const st = session.state || session;
console.log(
  JSON.stringify(
    {
      sessionId: session.id || session.sessionId,
      mode: session.mode || st.marathonMode || st.driveMode,
      goal: (session.goal || st.goal || "").slice(0, 300),
      stopReason: st.stopReason || session.stopReason,
      marathonRound: st.marathonRound ?? st.currentMarathonRound,
    },
    null,
    2
  )
);

const runs = (st.capabilityRuns || []).filter((r) =>
  String(r.turnId || "").includes("1781510")
);
console.log("\n=== capabilityRuns ===");
for (const r of runs) {
  console.log(
    JSON.stringify({
      turnId: r.turnId,
      cap: r.capabilityId,
      status: r.status,
      provenance: r.provenance || r.output?.provenance,
      ms: r.latencyMs ?? r.durationMs,
      model: r.model,
      roleMode: r.roleMode,
    })
  );
}

const graph = st.graph?.nodes || [];
const nodes = graph.filter((n) => String(n.turnId || n.id || "").includes("1781510"));
console.log("\n=== graph nodes ===");
for (const n of nodes) {
  console.log(
    JSON.stringify({
      id: n.id,
      cap: n.capabilityId || n.label,
      turnId: n.turnId,
      parent: n.parentId || n.structuralParentId,
      type: n.type,
    })
  );
}

const ledger = st.decisionLedger || [];
console.log("\n=== decisionLedger (marathon) ===");
for (const e of ledger.filter((x) => JSON.stringify(x).includes("1781510")).slice(-40)) {
  console.log(JSON.stringify(e));
}

const arts = (st.artifacts || []).filter((a) =>
  String(a.turnId || a.id || "").includes("1781510")
);
console.log("\n=== artifacts ===");
for (const a of arts) {
  const panel = a.payload?.panel;
  console.log(
    JSON.stringify({
      id: a.id,
      type: a.type || a.kind,
      cap: a.capabilityId,
      title: (a.title || "").slice(0, 100),
      hasPanel: !!panel,
      panelRoles: panel?.positions?.length,
    })
  );
}

const events = st.reasoningEvents || [];
const ev = events.filter((e) => String(e.turnId || "").includes("1781510"));
console.log("\n=== reasoningEvents ===", ev.length);
const kinds = {};
for (const e of ev) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
console.log(JSON.stringify(kinds));