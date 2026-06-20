"""
Pydantic models for SlideRule V5 state (migrated from shared/blueprint/v5-reasoning-state.ts and Node usage).

This replaces the TS types used in Node's session-driver, orchestrate-plan, execute-capability, GCOV, etc.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Literal
from pydantic import BaseModel, Field

class Artifact(BaseModel):
    id: str
    kind: str = "evidence"
    provenance: str = "python-rag"  # was ai_generated, mcp:github, template, llm, etc.
    trustLevel: Optional[Literal["gated_pass", "audited"]] = "gated_pass"
    passedGates: List[str] = ["commit"]
    title: Optional[str] = None
    summary: Optional[str] = None
    content: str = ""
    payload: Optional[Dict[str, Any]] = None
    producedBy: Optional[Dict[str, Any]] = None
    stale: bool = False

class CapabilityRun(BaseModel):
    id: str
    capabilityId: str
    turnId: str
    inputs: List[str] = []
    outputs: List[str] = []
    gateResults: List[Dict[str, Any]] = []
    result: Optional[Dict[str, Any]] = None

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

class V5SessionState(BaseModel):
    """Core state for V5 full-path (orchestrate, coverage, artifacts, runs)."""
    sessionId: str
    goal: Dict[str, Any]
    artifacts: List[Artifact] = []
    capabilityRuns: List[CapabilityRun] = []
    coverageGaps: List[CoverageGap] = []
    coverageContract: Optional[CoverageContract] = None
    coverageGate: Optional[Dict[str, Any]] = None
    graph: Dict[str, Any] = Field(default_factory=lambda: {"nodes": [], "edges": []})
    staleArtifactIds: List[str] = []
    conversation: List[Dict[str, Any]] = []
    # ... (add more fields as migrated from TS)

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
