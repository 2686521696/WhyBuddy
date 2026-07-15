"""
Pydantic models for SlideRule V5 state (migrated from shared/blueprint/v5-reasoning-state.ts and Node usage).

This replaces the TS types used in Node's session-driver, orchestrate-plan, execute-capability, GCOV, etc.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field, model_validator, ValidationInfo

# AwaitReason from shared/blueprint/v5-reasoning-state.ts for runtime await parking (P0)
AwaitReason = Literal[
    "ready",
    "confirm",
    "coverage",
    "budget",
    "convergence",
    "user_input",
    "max_loops",
    "max_repeat_guard",
    "no_progress",
]


class ProducedBy(BaseModel):
    """Structured server-owned provenance for Artifact.
    Matches shared/blueprint/v5-reasoning-state.ts exactly.
    Frontend/client cannot forge; only server paths (executors, drivers) populate.
    Required for trustLevel elevation beyond untrusted.
    """
    capabilityRunId: str
    capabilityId: str
    roleId: Optional[str] = None


class Artifact(BaseModel):
    """V5 Artifact contract (PYTHON_AUTHORITY).
    Aligned to producedBy, trustLevel, passedGates, stale, status, payload behavior per task.
    Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY.
    Do not default to trusted. Trust gates + provenance ledger justify elevation.
    Normal construction (Artifact(), **dict from client/PUT, model_validate without context) rejects elevated trustLevel, producedBy, and non-empty passedGates.
    Artifact.server_construct for new elevated; V5SessionState.server_load for durable/persisted state roundtrip.
    This separates client anti-forgery from server-owned persistence reload of gated/audited artifacts.
    frontend/client dicts cannot forge server-owned trust/provenance via the model.
    payload is retained for structured executor output (e.g. sources/critiques) but MUST NOT participate in trustLevel/passedGates decisions.
    stale per-artifact marker for compat; authoritative invalidation uses V5SessionState.staleArtifactIds.
    status provides explicit lifecycle state separate from trustLevel.
    """
    id: str
    kind: str = "evidence"
    provenance: str = "python-rag"  # was ai_generated, mcp:github, template, llm, etc.
    # Do not default to trusted (per task requirements: do-not-default-artifacts-to-trusted)
    trustLevel: Literal["untrusted", "gated_pass", "audited"] = "untrusted"
    passedGates: List[str] = Field(default_factory=list)
    title: Optional[str] = None
    summary: Optional[str] = None
    content: str = ""
    # payload保留且不参与 trust gate：executor 结构化输出（例 critiques, sources）；Trust Gate 不得读取此字段判定。
    payload: Optional[Dict[str, Any]] = None
    # producedBy 必须是结构化 server-owned provenance；前端 PUT 不得伪造 server-owned trust/provenance 语义。
    producedBy: Optional[ProducedBy] = None
    stale: bool = False
    # status: 明确 artifact 状态语义（独立于 trustLevel）；active 为默认；stale/superseded 由 server 驱动的失效/轮次机制设置。
    status: Optional[Literal["active", "stale", "superseded"]] = "active"

    @classmethod
    def server_construct(cls, **data: Any) -> "Artifact":
        """Server-only path to construct Artifact with elevated trustLevel / server provenance.
        Call ONLY from server executor/driver/gate code AFTER actual gate evaluations have passed.
        Uses model_validate(..., context={"server_trusted": True}) to bypass ONLY the anti-forgery
        _reject_elevated_in_raw_input check, while still executing full Pydantic field/schema validation
        (Literal for trustLevel/status, list for passedGates, required fields+shape for ProducedBy etc.).
        Client/frontend paths using normal Artifact() or model_validate without context are rejected.
        For loading previously persisted server state containing elevated artifacts, use V5SessionState.server_load.
        """
        # Pass through as-is; context tells validator to skip only anti-forgery.
        # Pydantic will validate all fields, sub-models, and literals here.
        return cls.model_validate(data, context={"server_trusted": True})

    @model_validator(mode="before")
    @classmethod
    def _reject_elevated_in_raw_input(cls, data, info):
        """Enforce server-only trust/provenance boundary at raw input (PYTHON_AUTHORITY).
        Rejects client-supplied producedBy (server-owned provenance), non-empty passedGates (trust gate state),
        or elevated trustLevel unless server_trusted context provided.
        Normal Artifact(**client_dict), V5SessionState(**client_state) etc. hit this (incl. nested artifacts) and reject.
        model_validate(..., context={"server_trusted": True}) via server_load allows persisted elevated server state.
        server_construct uses model_validate with server_trusted context (bypasses only anti-forgery, not field/schema validation).
        Client/frontend dicts cannot forge server-owned producedBy/passedGates/trust.
        """
        if info is not None and getattr(info, "context", None) and info.context.get("server_trusted"):
            return data
        if isinstance(data, dict):
            tl = data.get("trustLevel")
            if tl in ("gated_pass", "audited"):
                raise ValueError(
                    "trustLevel elevation to gated_pass/audited is server-only; "
                    "use Artifact.server_construct(...) after real gate execution or V5SessionState.server_load for persisted state. "
                    "Client/frontend dicts cannot forge server-owned trust/provenance."
                )
            if data.get("producedBy") is not None:
                raise ValueError(
                    "producedBy is server-owned provenance; "
                    "use Artifact.server_construct(...) after real gate execution or V5SessionState.server_load for persisted state. "
                    "Client/frontend dicts cannot forge server-owned trust/provenance."
                )
            pg = data.get("passedGates")
            if isinstance(pg, (list, tuple)) and len(pg) > 0:
                raise ValueError(
                    "passedGates is server-only trust gate state; "
                    "use Artifact.server_construct(...) after real gate execution or V5SessionState.server_load for persisted state. "
                    "Client/frontend dicts cannot forge server-owned trust/provenance."
                )
        return data

# Classification for sliderule-python-v52-artifact-contract-105 (this task):
# TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (partial loose dicts) -> PYTHON_AUTHORITY
# Python owns durable Artifact contract (producedBy structured, status, payload isolation, stale, trust defaults).
# Normal construction rejects elevated trustLevel + producedBy + non-empty passedGates (anti-forgery for server-owned provenance/trust); server-only Artifact.server_construct for gated/audited (and server provenance).
# V5SessionState.server_load provides context-distinguished reload for persisted durable state containing elevated artifacts.
# No Node fallback hiding semantics. Client inputs cannot set elevated trustLevel/producedBy/passedGates for forgery.
# Previous slices (core, runtime, ledgers, replay, stale-superseded) remain PYTHON_AUTHORITY.

# Classification for sliderule-python-v52-state-schema-core-105:
# TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (partial) -> PYTHON_AUTHORITY
# This slice (V5SessionState core fields) is now PYTHON_AUTHORITY.
# Python owns durable state schema; no Node fallback for these fields.

class OpenQuestion(BaseModel):
    id: str
    text: str

class GateState(BaseModel):
    """Matches shared/blueprint/v5-reasoning-state.ts GateState for V5 gates list."""
    gateId: str
    kind: Literal["precondition", "commit"]
    status: Literal["open", "passed", "failed"]
    evaluatedAt: Optional[str] = None
    phase: Optional[Literal["commit", "ship"]] = None

class DependencyEdge(BaseModel):
    """Matches shared/blueprint/v5-reasoning-state.ts DependencyEdge."""
    fromArtifactId: str
    toArtifactId: str
    reason: str

class CapabilityRun(BaseModel):
    id: str
    capabilityId: str
    turnId: str
    inputs: List[str] = []
    outputs: List[str] = []
    gateResults: List[Dict[str, Any]] = []
    result: Optional[Dict[str, Any]] = None
    # Task goal: align with inputs/outputs/gateResults/result/timing/error.
    # roleId/ledgerEntryId added for TS contract parity (from blueprint).
    roleId: Optional[str] = None
    ledgerEntryId: Optional[str] = None
    timing: Optional[Dict[str, Any]] = None  # {startedAt, completedAt, durationMs}
    error: Optional[Dict[str, Any]] = None  # {code, message, ...} for failed runs

# Classification for sliderule-python-v52-capability-run-contract-105 (this task):
# TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (partial fields: inputs/outputs/gateResults/result only) -> PYTHON_AUTHORITY
# Python now owns full CapabilityRun contract (inputs, outputs, gateResults, result, timing, error + roleId/ledger for parity).
# Direct model + focused tests prove the fields; no Node fallback hiding semantics.
# This advances StateSchema durable contract parity for capability execution records.
# Prior slices (core/runtime/ledgers/replay/stale/artifact) remain PYTHON_AUTHORITY.

class CoverageGap(BaseModel):
    id: str
    kind: str
    label: str
    requiredCapabilityId: Optional[str] = None
    status: Literal["open", "resolved", "waived"] = "open"
    createdAt: str

class CoverageContract(BaseModel):
    id: str
    version: int = 1
    mode: Literal["simple", "complex"] = "complex"
    requiredCapabilities: List[str]
    minEvidencePerRequirement: int = 1
    blockingGapIds: List[str] = []

# V5.1 ledger models for sliderule-python-v52-state-ledgers-105 (PYTHON_AUTHORITY slice)
# These enable Python to persist/validate the decision/cost/flow/structure ledger state.
# Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
# This slice is now PYTHON_AUTHORITY; no Node fallback; direct Python models + V5SessionState fields.
class SchedulingDecision(BaseModel):
    """V5.1 DLEDGER (P1/A): auditable record of each pickNextCapabilities decision."""
    id: str
    turnId: str
    saw: List[str] = Field(default_factory=list)
    chose: List[str] = Field(default_factory=list)
    skipped: List[Dict[str, Any]] = Field(default_factory=list)
    addresses: List[str] = Field(default_factory=list)
    rationale: str = ""
    alternativesRejected: List[str] = Field(default_factory=list)
    createdAt: str
    status: Optional[Literal["active", "challenged", "superseded"]] = None
    challengedAt: Optional[str] = None
    challengeText: Optional[str] = None
    source: Optional[Literal["llm", "heuristic_fallback", "local_heuristic"]] = None
    droppedFromProposal: List[Dict[str, Any]] = Field(default_factory=list)

class FlowBoundaryCheck(BaseModel):
    """V5.1 FLOWB (Knife 4): Flow Boundary check record for formal path purification."""
    id: str
    turnId: str
    source: Literal["brainstorm", "discussion", "artifact", "executor"]
    strippedProtocolNodes: List[str] = Field(default_factory=list)
    assertions: List[str] = Field(default_factory=list)
    passed: bool
    createdAt: str

class StructureGateCheck(BaseModel):
    """S13/S14: G_SCHEMA / G_INV results persisted for structure.decompose (T_LEDGER)."""
    id: str
    turnId: str
    runId: str
    gateId: str
    attempt: Optional[int] = None
    status: Literal["passed", "failed"]
    reason: Optional[str] = None
    createdAt: str

class CapabilityCostRecord(BaseModel):
    """V5.1 Knife 6: Cost telemetry record for a capability run (estimated)."""
    id: str
    turnId: str
    capabilityRunId: str
    capabilityId: str
    estimatedTokens: Optional[int] = None
    estimatedCostUsd: Optional[float] = None
    durationMs: Optional[int] = None
    source: Literal["estimated", "server", "manual"]
    createdAt: str


# sessionReplayLog / reasoningEvents slice (sliderule-python-v52-state-replay-events-105):
# Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
# This slice is now PYTHON_AUTHORITY. Python owns the durable V5.2 replay and reasoningEvents schemas.
# List defaults + optional fields ensure pre-existing saved sessions missing these keys load with [] (legacy compat, no Node fallback hiding semantics).
class SlideRuleReplayEvent(BaseModel):
    """V5 append-only replay log entry (JOB->REPLAY->STORE per sessionId)."""
    id: str
    sessionId: str
    at: str
    kind: Literal["capability_run", "conversation", "decision"]
    turnId: Optional[str] = None
    capabilityId: Optional[str] = None
    capabilityRunId: Optional[str] = None
    conversationId: Optional[str] = None
    decisionId: Optional[str] = None


class ReasoningEventMeta(BaseModel):
    """Minimal meta for reasoning projection events (convergence etc)."""
    convergenceScore: Optional[float] = None
    consensusReached: Optional[bool] = None
    dissent: Optional[List[Dict[str, Any]]] = None
    toolName: Optional[str] = None
    sourceTag: Optional[str] = None


class ReasoningEvent(BaseModel):
    """V5 reasoning execution events inside a capabilityRun (optional, for UI projection; truncatable, backward compat)."""
    id: str
    turnId: str
    capabilityRunId: str
    capabilityId: str
    kind: Literal["capability_start", "think", "observe", "tool_call", "role_position", "role_critique", "role_rebuttal", "panel_converge", "subtask", "capability_complete"]
    roleId: Optional[str] = None
    targetRoleId: Optional[str] = None
    text: str
    refs: Optional[List[str]] = None
    meta: Optional[ReasoningEventMeta] = None
    order: int
    ts: str


class UserIntervention(BaseModel):
    """Matches shared/blueprint/v5-reasoning-state.ts UserIntervention for durable V5.2 session state (intervention, challenge etc)."""
    targetArtifactId: Optional[str] = None
    targetNodeId: Optional[str] = None
    targetReportSectionId: Optional[str] = None
    targetDecisionId: Optional[str] = None
    intent: Literal["challenge", "clarify", "expand", "synthesize", "generate_plan", "preview", "compare", "revise"]
    text: str
    answeredGapIds: List[str] = Field(default_factory=list)


class V5SessionState(BaseModel):
    """Core state for V5 full-path (orchestrate, coverage, artifacts, runs).
    Aligned to shared/blueprint/v5-reasoning-state.ts V5SessionState core fields.

    Classification for sliderule-python-v52-state-ts-parity-golden-105 (sequence 8/72, StateSchema):
    TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT (prior field slices) -> PYTHON_AUTHORITY
    This task adds the complete durable V5.2 session fields + golden fixtures proving schema parity for persisted durable sessions.
    Python owns the durable session state shape (all listed TS V5SessionState durable fields including intervention, focus, flags); direct tests use golden fixtures.
    No Node fallback hiding semantics. This advances Python state authority for V5.2 durable sessions.
    """
    sessionId: str
    goal: Dict[str, Any]
    artifacts: List[Artifact] = []
    capabilityRuns: List[CapabilityRun] = []
    coverageGaps: List[CoverageGap] = []
    coverageContract: Optional[CoverageContract] = None
    coverageGate: Optional[Dict[str, Any]] = None
    graph: Dict[str, Any] = Field(default_factory=lambda: {"nodes": [], "edges": []})
    # staleArtifactIds / supersededArtifactIds slice (sliderule-python-v52-state-stale-superseded-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # staleArtifactIds: marked by invalidation engine (trust cascade / re-entry). Required list.
    # supersededArtifactIds: superseded by round digests (M6); separate from stale per spec; for context compression in marathon, not trust cascade. Optional in TS, defaults [] for legacy.
    # Python owns both fields with direct model; list defaults ensure roundtrip + legacy missing-key compat. No Node fallback hiding semantics.
    staleArtifactIds: List[str] = []
    supersededArtifactIds: List[str] = Field(default_factory=list)
    conversation: List[Dict[str, Any]] = []
    # TS core fields for this task (PYTHON_AUTHORITY):
    openQuestions: List[Dict[str, Any]] = Field(default_factory=list)
    evidence: List[Dict[str, Any]] = Field(default_factory=list)
    decisions: List[Dict[str, Any]] = Field(default_factory=list)
    risks: List[Dict[str, Any]] = Field(default_factory=list)
    gates: List[GateState] = Field(default_factory=list)
    dependencyGraph: List[DependencyEdge] = Field(default_factory=list)
    # runtimePhase / await / delivery / role slice (sliderule-python-v52-state-runtime-phase-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # This slice is now PYTHON_AUTHORITY for V5.2 state schema (runtime/await/delivery/role fields).
    # Python owns durable state; safe legacy defaults (None) preserve roundtrip for pre-V5.2 states.
    # No Node fallback hiding semantics.
    runtimePhase: Optional[Literal["idle", "orchestrating", "awaiting", "failed", "done"]] = None
    awaitReason: Optional[AwaitReason] = None
    awaitDetail: Optional[str] = None
    lastTurnId: Optional[str] = None
    deliveryPhase: Optional[Literal["none", "shipping", "shipped"]] = None
    roleMode: Optional[Literal["simple", "complex", "degraded"]] = None
    # V5.1 ledgers slice (sliderule-python-v52-state-ledgers-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # decisionLedger, costLedger, flowBoundaryLedger, structureGateLedger now PYTHON_AUTHORITY.
    # List defaults ensure persistence roundtrip for pre-ledger states; explicit models for validation.
    # No Node fallback hiding V5.2 ledger semantics.
    decisionLedger: List[SchedulingDecision] = Field(default_factory=list)
    costLedger: List[CapabilityCostRecord] = Field(default_factory=list)
    flowBoundaryLedger: List[FlowBoundaryCheck] = Field(default_factory=list)
    structureGateLedger: List[StructureGateCheck] = Field(default_factory=list)
    # sessionReplayLog / reasoningEvents slice (sliderule-python-v52-state-replay-events-105):
    # Classification: TS_RUNTIME_OWNED -> NODE_BACKEND_OWNED -> PYTHON_COMPAT -> PYTHON_AUTHORITY
    # Python owns durable state for replay log and reasoning events; list defaults for legacy saved sessions missing the keys.
    # No Node fallback; explicit minimal models for schema validation and roundtrips.
    sessionReplayLog: List[SlideRuleReplayEvent] = Field(default_factory=list)
    reasoningEvents: List[ReasoningEvent] = Field(default_factory=list)
    # E13 直播时间线持久化：最近几轮左栏叙述步骤（纯展示数据，无信任语义，
    # 客户端轮次落定时随 PUT 回传；刷新后前端据此完整回放推演时间线）。
    # 封顶（3 轮 × 步数/字数）在 routes/sliderule_full.py PUT 落库前强制。
    turnNarrations: List[Dict[str, Any]] = Field(default_factory=list)
    # additional durable V5.2 session fields (currentFocus, userIntervention, booleans, dirty) for full schema parity (sliderule-python-v52-state-ts-parity-golden-105)
    currentFocus: Optional[Dict[str, Any]] = None
    userIntervention: Optional[UserIntervention] = None
    brainstormDegraded: bool = False
    escalated: bool = False
    projectionDirtyNodeIds: List[str] = Field(default_factory=list)
    # publishClosure (AppBundle runtime/publish closure evidence projection from python /drive-full and /drive-marathon):
    # Frontend SlideRule session state persistence (119): declared as optional so store load/save roundtrips carry it.
    # Attached on drive response (client adapter or python route), preserved here.
    # Legacy sessions without key load with None (fail-closed compat, no breakage).
    # Pure schema + pass-through; derive logic stays in v5_publish_closure_response; no network/provider/DB here.
    publishClosure: Optional[Dict[str, Any]] = None
    # skillRuntimeGraph (cross-skill runtime evidence graph from python /drive-full and /drive-marathon):
    # Kept durable alongside publishClosure so browser reload can replay Skill linkage surfaces.
    skillRuntimeGraph: Optional[Dict[str, Any]] = None
    # ... (add more fields as migrated from TS)

    @classmethod
    def server_load(cls, data: Any) -> "V5SessionState":
        """Server-only reload path for durable V5SessionState from persisted storage (PYTHON_AUTHORITY ownership).
        Persisted state may legitimately contain Artifacts with trustLevel=gated_pass/audited (server produced after gates).
        Uses model_validate with server_trusted context so child Artifact validators permit elevated trust.
        Normal V5SessionState(**client_dict) or model_validate(client) without context will run strict Artifact validation
        and reject any attempt to forge elevated trust artifacts from input.
        This provides the durable state server reload path required for roundtrip/behavior ownership without mixing client
        forgery protection and server persistence load.
        """
        if isinstance(data, dict):
            return cls.model_validate(data, context={"server_trusted": True})
        # fallback
        return cls.model_validate(data, context={"server_trusted": True})

class ExecuteCapabilityResult(BaseModel):
    title: str
    summary: str
    content: str
    provenance: str = "python-rag"
    degraded: bool = False
    degradedReason: Optional[str] = None
    sources: List[Dict[str, Any]] = []
    toolName: Optional[str] = None
    skillName: Optional[str] = None

class PlanProjectionPhase(BaseModel):
    id: str
    label: str
    status: Literal["pending", "active", "complete", "blocked"]
    stepIds: List[str] = []

class PlanProjectionStep(BaseModel):
    id: str
    capabilityId: str
    roleId: str
    status: Literal["pending", "running", "complete", "blocked"] = "pending"
    phaseId: str
    why: Optional[str] = None

class PlanProjectionRisk(BaseModel):
    id: str
    severity: Literal["low", "medium", "high"]
    summary: str
    mitigation: str

class PlanProjectionRecoveryPoint(BaseModel):
    id: str
    label: str
    action: str
    retryable: bool = True

class PlanProjectionError(BaseModel):
    code: str
    reason: str
    message: str

class PlanStateProjection(BaseModel):
    kind: Literal["orchestrate.plan.state_projection"] = "orchestrate.plan.state_projection"
    schemaVersion: int = 1
    stateAuthority: Literal["node"] = "node"
    stateMutation: Literal["none"] = "none"
    status: Literal["partial", "complete", "error"]
    phase: str
    partial: bool
    phases: List[PlanProjectionPhase]
    steps: List[PlanProjectionStep]
    risks: List[PlanProjectionRisk]
    recoveryPoints: List[PlanProjectionRecoveryPoint]
    error: Optional[PlanProjectionError] = None

class OrchestratePlanResult(BaseModel):
    selected: List[Dict[str, Any]]
    rationale: str
    source: str = "python-rag"
    converged: Optional[bool] = None
    usage: Optional[Dict[str, Any]] = None
    planStateProjection: Optional[PlanStateProjection] = None
