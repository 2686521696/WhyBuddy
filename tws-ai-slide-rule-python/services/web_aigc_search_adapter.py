"""Fake-provider contract for web AIGC search adapters.

The real search implementations remain Node-owned for this migration slice.
Python only defines stable result shapes for web search, graph search, image
search, and static webpage read.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


SEARCH_ADAPTER_CONTRACT_VERSION = "web_aigc.search_adapter.v1"

SearchAdapterKind = Literal[
    "web_search",
    "graph_search",
    "image_search",
    "static_webpage_read",
]
SearchAdapterScenario = Literal["success", "empty", "error"]
SearchAdapterStatus = Literal["success", "empty", "error", "permission_denied"]


def _non_empty(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


class SearchPermission(BaseModel):
    model_config = ConfigDict(extra="allow")

    allowed: bool = True
    reason: Optional[str] = None
    auditId: Optional[str] = None

    @field_validator("reason", "auditId")
    @classmethod
    def _validate_optional_non_empty(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        return _non_empty(value)


class SearchAdapterProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider: Literal["fake"] = "fake"
    source: str
    query: str
    auditId: Optional[str] = None
    permission: Optional[Dict[str, Any]] = None

    @field_validator("source", "query")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class SearchAdapterError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str

    @field_validator("code", "message")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class WebSearchResultItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    url: str
    snippet: str
    source: str
    provenance: SearchAdapterProvenance

    @field_validator("title", "url", "snippet", "source")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class GraphNode(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entityId: str
    entityType: str
    name: str
    description: str
    confidence: float
    projectId: str

    @field_validator("entityId", "entityType", "name", "description", "projectId")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class GraphEdge(BaseModel):
    model_config = ConfigDict(extra="forbid")

    relationId: str
    relationType: str
    sourceEntityId: str
    targetEntityId: str
    confidence: float
    evidence: str

    @field_validator(
        "relationId",
        "relationType",
        "sourceEntityId",
        "targetEntityId",
        "evidence",
    )
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class GraphPathStep(BaseModel):
    model_config = ConfigDict(extra="forbid")

    entityId: str
    name: str
    entityType: str
    viaRelationType: Optional[str] = None

    @field_validator("entityId", "name", "entityType")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class GraphPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodes: List[GraphNode] = Field(default_factory=list)
    edges: List[GraphEdge] = Field(default_factory=list)
    path: List[GraphPathStep] = Field(default_factory=list)
    summary: str = ""
    isPartial: bool = False


class GraphMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nodeCount: int
    edgeCount: int
    pathLength: int


class ImageSearchResultItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    imageId: str
    title: str
    summary: str
    previewUrl: str
    sourceUrl: str
    source: str
    tags: List[str] = Field(default_factory=list)
    availability: Literal["available", "preview_only", "unavailable"]
    score: float
    matchedBy: List[Literal["query", "tags", "reference"]] = Field(default_factory=list)
    provenance: SearchAdapterProvenance

    @field_validator("imageId", "title", "summary", "previewUrl", "sourceUrl", "source")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class StaticWebpagePage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    url: str
    content: str
    snippet: str
    contentSource: Literal["fake_static_page"]
    fetched: Literal[False] = False

    @field_validator("title", "url", "content", "snippet")
    @classmethod
    def _validate_non_empty(cls, value: str) -> str:
        return _non_empty(value)


class SearchAdapterBaseResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal[SEARCH_ADAPTER_CONTRACT_VERSION] = SEARCH_ADAPTER_CONTRACT_VERSION
    kind: SearchAdapterKind
    query: str
    provenance: SearchAdapterProvenance

    @field_validator("query")
    @classmethod
    def _validate_query(cls, value: str) -> str:
        return _non_empty(value)


class WebSearchSuccessResponse(SearchAdapterBaseResponse):
    ok: Literal[True] = True
    kind: Literal["web_search"]
    status: Literal["success"] = "success"
    results: List[WebSearchResultItem]
    totalCandidates: int

    @model_validator(mode="after")
    def _validate_results(self) -> "WebSearchSuccessResponse":
        if not self.results:
            raise ValueError("success response requires at least one result")
        if self.totalCandidates != len(self.results):
            raise ValueError("totalCandidates must match results length")
        return self


class GraphSearchSuccessResponse(SearchAdapterBaseResponse):
    ok: Literal[True] = True
    kind: Literal["graph_search"]
    status: Literal["success"] = "success"
    graph: GraphPayload
    metrics: GraphMetrics

    @model_validator(mode="after")
    def _validate_metrics(self) -> "GraphSearchSuccessResponse":
        if not self.graph.nodes:
            raise ValueError("success response requires graph nodes")
        if self.metrics.nodeCount != len(self.graph.nodes):
            raise ValueError("nodeCount must match graph nodes length")
        if self.metrics.edgeCount != len(self.graph.edges):
            raise ValueError("edgeCount must match graph edges length")
        if self.metrics.pathLength != len(self.graph.path):
            raise ValueError("pathLength must match graph path length")
        return self


class ImageSearchSuccessResponse(SearchAdapterBaseResponse):
    ok: Literal[True] = True
    kind: Literal["image_search"]
    status: Literal["success"] = "success"
    results: List[ImageSearchResultItem]
    totalCandidates: int

    @model_validator(mode="after")
    def _validate_results(self) -> "ImageSearchSuccessResponse":
        if not self.results:
            raise ValueError("success response requires at least one result")
        if self.totalCandidates != len(self.results):
            raise ValueError("totalCandidates must match results length")
        return self


class StaticWebpageReadSuccessResponse(SearchAdapterBaseResponse):
    ok: Literal[True] = True
    kind: Literal["static_webpage_read"]
    status: Literal["success"] = "success"
    page: StaticWebpagePage


class SearchAdapterEmptyResponse(SearchAdapterBaseResponse):
    ok: Literal[True] = True
    status: Literal["empty"] = "empty"
    results: List[Any] = Field(default_factory=list)
    totalCandidates: Literal[0] = 0

    @model_validator(mode="after")
    def _validate_empty(self) -> "SearchAdapterEmptyResponse":
        if self.results:
            raise ValueError("empty response cannot include results")
        return self


class SearchAdapterErrorResponse(SearchAdapterBaseResponse):
    ok: Literal[False] = False
    status: Literal["error", "permission_denied"]
    error: SearchAdapterError


SearchAdapterResponse = Union[
    WebSearchSuccessResponse,
    GraphSearchSuccessResponse,
    ImageSearchSuccessResponse,
    StaticWebpageReadSuccessResponse,
    SearchAdapterEmptyResponse,
    SearchAdapterErrorResponse,
]


def execute_fake_search_adapter(payload: Dict[str, Any]) -> SearchAdapterResponse:
    """Return a fake search response for the requested adapter kind.

    No external request is made here; all returned URLs use example.test.
    """

    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")

    kind = _read_kind(payload.get("kind"))
    query = _read_query(payload.get("query"))
    scenario = _read_scenario(payload.get("scenario"))
    permission = _read_permission(payload.get("permission"))
    provenance = _build_provenance(kind, query, permission)

    if not permission.allowed:
        return SearchAdapterErrorResponse(
            kind=kind,
            query=query,
            status="permission_denied",
            error=SearchAdapterError(
                code="permission_denied",
                message="Search adapter execution denied by permission policy.",
            ),
            provenance=provenance,
        )

    if scenario == "empty":
        return SearchAdapterEmptyResponse(
            kind=kind,
            query=query,
            provenance=provenance,
        )

    if scenario == "error":
        return SearchAdapterErrorResponse(
            kind=kind,
            query=query,
            status="error",
            error=SearchAdapterError(
                code="fake_provider_error",
                message="Fake search provider failed.",
            ),
            provenance=provenance,
        )

    if kind == "web_search":
        item = WebSearchResultItem(
            title=f"Fake web result for {query}",
            url="https://example.test/fake-web-search/result-1",
            snippet=f"Fake web search snippet for {query}.",
            source="fake-web-search",
            provenance=provenance,
        )
        return WebSearchSuccessResponse(
            kind=kind,
            query=query,
            provenance=provenance,
            results=[item],
            totalCandidates=1,
        )

    if kind == "graph_search":
        graph = GraphPayload(
            nodes=[
                GraphNode(
                    entityId="fake-entity-1",
                    entityType="concept",
                    name="Search Adapter Contract",
                    description=f"Fake graph source for {query}.",
                    confidence=0.92,
                    projectId="fake-project",
                ),
                GraphNode(
                    entityId="fake-entity-2",
                    entityType="capability",
                    name="Fake Provider",
                    description="Provider that never calls external search.",
                    confidence=0.88,
                    projectId="fake-project",
                ),
            ],
            edges=[
                GraphEdge(
                    relationId="fake-relation-1",
                    relationType="supports",
                    sourceEntityId="fake-entity-1",
                    targetEntityId="fake-entity-2",
                    confidence=0.86,
                    evidence="Fake provider supports contract testing.",
                )
            ],
            path=[
                GraphPathStep(
                    entityId="fake-entity-1",
                    name="Search Adapter Contract",
                    entityType="concept",
                ),
                GraphPathStep(
                    entityId="fake-entity-2",
                    name="Fake Provider",
                    entityType="capability",
                    viaRelationType="supports",
                ),
            ],
            summary=f"Fake graph result for {query}.",
            isPartial=False,
        )
        return GraphSearchSuccessResponse(
            kind=kind,
            query=query,
            provenance=provenance,
            graph=graph,
            metrics=GraphMetrics(nodeCount=2, edgeCount=1, pathLength=2),
        )

    if kind == "image_search":
        item = ImageSearchResultItem(
            imageId="fake-image-1",
            title=f"Fake image result for {query}",
            summary=f"Fake image preview metadata for {query}.",
            previewUrl="https://example.test/fake-image-search/preview-1.jpg",
            sourceUrl="https://example.test/fake-image-search/source-1",
            source="fake-image-search",
            tags=["fake", "contract"],
            availability="preview_only",
            score=0.84,
            matchedBy=["query"],
            provenance=provenance,
        )
        return ImageSearchSuccessResponse(
            kind=kind,
            query=query,
            provenance=provenance,
            results=[item],
            totalCandidates=1,
        )

    page = StaticWebpagePage(
        title=f"Fake static page for {query}",
        url=query,
        content=f"Fake static page content for {query}.",
        snippet=f"Fake static page content for {query}.",
        contentSource="fake_static_page",
        fetched=False,
    )
    return StaticWebpageReadSuccessResponse(
        kind=kind,
        query=query,
        provenance=provenance,
        page=page,
    )


def _read_kind(value: Any) -> SearchAdapterKind:
    if value in {"web_search", "graph_search", "image_search", "static_webpage_read"}:
        return value
    raise ValueError("kind must be web_search, graph_search, image_search, or static_webpage_read")


def _read_query(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("query must be a non-empty string")
    return _non_empty(value)


def _read_scenario(value: Any) -> SearchAdapterScenario:
    if value in {"success", "empty", "error"}:
        return value
    if value is None:
        return "success"
    raise ValueError("scenario must be success, empty, or error")


def _read_permission(value: Any) -> SearchPermission:
    if value is None:
        return SearchPermission()
    if not isinstance(value, dict):
        raise ValueError("permission must be an object")
    return SearchPermission(**value)


def _source_for_kind(kind: SearchAdapterKind) -> str:
    return {
        "web_search": "fake-web-search",
        "graph_search": "fake-graph-search",
        "image_search": "fake-image-search",
        "static_webpage_read": "fake-static-webpage-read",
    }[kind]


def _build_provenance(
    kind: SearchAdapterKind,
    query: str,
    permission: SearchPermission,
) -> SearchAdapterProvenance:
    permission_payload = permission.model_dump(exclude_none=True)
    return SearchAdapterProvenance(
        provider="fake",
        source=_source_for_kind(kind),
        query=query,
        auditId=permission.auditId,
        permission=permission_payload if permission_payload else None,
    )
