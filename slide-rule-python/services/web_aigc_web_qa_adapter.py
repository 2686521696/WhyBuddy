"""Python-owned runtime facade for Web AIGC web-qa long-tail adapter.

Node is thin proxy when executePythonRuntime provided (or default wired).
This defines the owned contract and bridge for web-qa answer assembly.
Real external search/LLM remain external-owned per provider closure.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


WEB_QA_ADAPTER_CONTRACT_VERSION = "web_aigc.web_qa_runtime.v1"

WebQaStatus = Literal["success", "degraded", "error", "permission_denied"]


def _non_empty(value: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("must be a non-empty string")
    return value.strip()


class WebQaRuntimeMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    backend: Literal["python"] = "python"
    provider: Literal["python-facade"] = "python-facade"
    source: str = "web-qa-python-adapter-105"
    externalCalls: Literal[False] = False


class WebQaError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str

    @field_validator("code", "message")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class WebQaEvidenceItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    kind: str
    title: str
    url: Optional[str] = None
    snippet: str


class WebQaSourceLink(BaseModel):
    model_config = ConfigDict(extra="allow")

    kind: str
    href: str
    label: str


class WebQaNodeOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: WebQaStatus
    strategy: Literal["document_search", "inline_pages", "fallback"] = "inline_pages"
    answer: str
    citations: List[str] = Field(default_factory=list)
    sourceLinks: List[WebQaSourceLink] = Field(default_factory=list)
    evidenceList: List[WebQaEvidenceItem] = Field(default_factory=list)
    fallbackUsed: bool = False
    fallbackReason: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)
    runtime: Dict[str, Any] = Field(default_factory=dict)
    provenance: Dict[str, Any] = Field(default_factory=dict)
    permission: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    error: Optional[WebQaError] = None


class WebQaRuntimeResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    status: WebQaStatus
    answer: str
    citations: List[str] = Field(default_factory=list)
    sourceLinks: List[Dict[str, Any]] = Field(default_factory=list)
    evidenceList: List[Dict[str, Any]] = Field(default_factory=list)
    strategy: str = "document_search"
    metadata: Dict[str, Any] = Field(default_factory=dict)
    runtime: Dict[str, Any] = Field(default_factory=dict)
    provenance: Dict[str, Any] = Field(default_factory=dict)
    permission: Dict[str, Any] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    error: Optional[Dict[str, Any]] = None


def execute_web_qa_runtime_bridge(payload: Dict[str, Any]) -> WebQaRuntimeResponse:
    """Python owned entry for web-qa execution contract."""
    question = str(payload.get("question") or payload.get("input", {}).get("question", "")).strip()
    if not question:
        return WebQaRuntimeResponse(
            ok=False,
            status="error",
            answer="",
            error={"code": "missing_question", "message": "question is required"},
            warnings=["python web-qa: missing question"],
        )

    pages = payload.get("pages") or []
    search = payload.get("search") or {}
    use_search = bool(search.get("query") or payload.get("searchQuery"))

    answer = f"Python web-qa facade answer for: {question[:80]}"
    citations: List[str] = []
    evidence: List[Dict[str, Any]] = []
    sources: List[Dict[str, Any]] = []
    warnings: List[str] = []

    if pages:
        answer += " (with inline pages)"
        for i, p in enumerate(pages[:3]):
            pid = str(p.get("pageId", f"page-{i}"))
            citations.append(pid)
            evidence.append({"id": pid, "kind": "inline", "title": str(p.get("title", pid)), "snippet": "inline context"})
    if use_search:
        answer += " (search context applied)"
        citations.append("search:python-facade")
        sources.append({"kind": "search", "href": "py://search", "label": "python search"})

    return WebQaRuntimeResponse(
        ok=True,
        status="success",
        answer=answer,
        citations=citations,
        sourceLinks=sources,
        evidenceList=evidence,
        strategy="document_search" if use_search else "inline_pages",
        metadata={
            "question": question,
            "pageCount": len(pages),
            "sourceCount": len(citations),
            "pythonFacade": True,
        },
        runtime=WebQaRuntimeMetadata().model_dump(),
        provenance={"provider": "python-facade", "source": "web-qa-105-cutover"},
        permission={"allowed": True, "auditId": "py-web-qa-105"},
        warnings=warnings,
    )
