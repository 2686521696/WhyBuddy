"""Minimal vector client for the Python migration.

This module intentionally keeps the first parity slice small: configuration
parsing, request shaping, and error semantics. Tests inject a fake transport,
so routine gates never connect to a real Qdrant instance.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Protocol, Sequence


JsonDict = dict[str, Any]
Transport = Callable[[str, str, JsonDict | None, Mapping[str, str], int], JsonDict]


class VectorClientError(Exception):
    """Base error for vector client failures."""


class VectorClientTimeout(VectorClientError):
    """Raised when the vector backend times out."""


class VectorClientUnavailable(VectorClientError):
    """Raised when the vector backend is unavailable or returns an error."""


@dataclass(frozen=True)
class VectorConfig:
    base_url: str
    collection: str
    api_key: str
    timeout_ms: int
    dimension: int


@dataclass(frozen=True)
class VectorSearchHit:
    id: str
    score: float
    content: str
    metadata: dict[str, Any]


class VectorSearchClient(Protocol):
    def search(
        self,
        query_vector: Sequence[float],
        *,
        top_k: int = 10,
        min_score: float | None = None,
        filter: Mapping[str, Any] | None = None,
        collection: str | None = None,
    ) -> list[VectorSearchHit]:
        ...


@dataclass(frozen=True)
class VectorRuntime:
    """Injectable vector retrieval dependencies for evidence wiring."""

    vector_client: VectorSearchClient
    embedding_provider: Any


class VectorRuntimeError(VectorClientError):
    """Raised when vector runtime wiring is incomplete."""


def create_vector_runtime(
    *,
    vector_client: VectorSearchClient | None = None,
    embedding_provider: Any | None = None,
) -> VectorRuntime:
    """Clear runtime entry for vector-backed evidence retrieval.

    Tests inject fake or in-memory clients. Production callers pass explicit
    dependencies; this helper does not substitute fake defaults.
    """
    if vector_client is None or embedding_provider is None:
        raise VectorRuntimeError(
            "vector runtime requires explicit vector_client and embedding_provider"
        )
    return VectorRuntime(
        vector_client=vector_client,
        embedding_provider=embedding_provider,
    )


def _pick(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value is not None and value.strip():
            return value.strip()
    return None


def _positive_int(value: str | None, default: int) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def get_vector_config() -> VectorConfig:
    return VectorConfig(
        base_url=(_pick("QDRANT_URL", "RAG_VECTOR_STORE_URL") or "http://localhost:6333").rstrip("/"),
        collection=_pick("QDRANT_COLLECTION", "RAG_VECTOR_COLLECTION") or "knowledge_base",
        api_key=_pick("QDRANT_API_KEY", "RAG_VECTOR_STORE_API_KEY") or "",
        timeout_ms=_positive_int(_pick("QDRANT_TIMEOUT_MS", "RAG_VECTOR_TIMEOUT_MS"), 10_000),
        dimension=_positive_int(_pick("QDRANT_DIMENSION", "RAG_EMBEDDING_DIMENSION"), 1536),
    )


def _default_transport(
    method: str,
    url: str,
    body: JsonDict | None,
    headers: Mapping[str, str],
    timeout_ms: int,
) -> JsonDict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    for key, value in headers.items():
        request.add_header(key, value)
    try:
        with urllib.request.urlopen(request, timeout=timeout_ms / 1000) as response:  # noqa: S310
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:300]
        raise VectorClientUnavailable(
            f"vector backend returned {exc.code}: {detail}"
        ) from exc
    except TimeoutError as exc:
        raise VectorClientTimeout(f"vector request timed out: {method} {url}") from exc
    except urllib.error.URLError as exc:
        reason = getattr(exc, "reason", exc)
        if isinstance(reason, TimeoutError):
            raise VectorClientTimeout(f"vector request timed out: {method} {url}") from exc
        raise VectorClientUnavailable(f"vector backend unavailable: {reason}") from exc
    if not raw.strip():
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise VectorClientUnavailable("vector backend returned invalid JSON") from exc
    if not isinstance(parsed, dict):
        raise VectorClientUnavailable("vector backend returned non-object JSON")
    return parsed


class QdrantVectorClient:
    def __init__(
        self,
        config: VectorConfig | None = None,
        *,
        transport: Transport | None = None,
    ) -> None:
        self.config = config or get_vector_config()
        self._transport = transport or _default_transport

    def health_check(self) -> dict[str, Any]:
        try:
            self._request("GET", "/healthz", None)
            return {"connected": True, "backend": "qdrant"}
        except VectorClientTimeout:
            raise
        except VectorClientError:
            return {"connected": False, "backend": "qdrant"}

    def upsert(self, records: Sequence[Mapping[str, Any]], collection: str | None = None) -> None:
        if not records:
            return
        points = []
        for record in records:
            metadata = dict(record.get("metadata") or {})
            content = str(record.get("content") or "")
            points.append(
                {
                    "id": str(record["id"]),
                    "vector": list(record["vector"]),
                    "payload": {"content": content, **metadata},
                }
            )
        self._request("PUT", f"/collections/{collection or self.config.collection}/points", {"points": points})

    def search(
        self,
        query_vector: Sequence[float],
        *,
        top_k: int = 10,
        min_score: float | None = None,
        filter: Mapping[str, Any] | None = None,
        collection: str | None = None,
    ) -> list[VectorSearchHit]:
        body: JsonDict = {
            "vector": list(query_vector),
            "limit": top_k,
            "with_payload": True,
        }
        if min_score is not None:
            body["score_threshold"] = min_score
        if filter:
            body["filter"] = _build_qdrant_filter(filter)

        data = self._request("POST", f"/collections/{collection or self.config.collection}/points/search", body)
        result = data.get("result") or []
        if not isinstance(result, list):
            raise VectorClientUnavailable("vector search result must be a list")
        hits: list[VectorSearchHit] = []
        for item in result:
            if not isinstance(item, dict):
                continue
            payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
            hits.append(
                VectorSearchHit(
                    id=str(item.get("id", "")),
                    score=float(item.get("score") or 0.0),
                    content=str(payload.get("content") or ""),
                    metadata=dict(payload),
                )
            )
        return hits

    def delete(self, ids: Sequence[str], collection: str | None = None) -> None:
        if not ids:
            return
        self._request(
            "POST",
            f"/collections/{collection or self.config.collection}/points/delete",
            {"points": [str(item) for item in ids]},
        )

    def _request(self, method: str, path: str, body: JsonDict | None) -> JsonDict:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["api-key"] = self.config.api_key
        try:
            return self._transport(
                method,
                f"{self.config.base_url}{path}",
                body,
                headers,
                self.config.timeout_ms,
            )
        except VectorClientTimeout:
            raise
        except VectorClientError:
            raise
        except TimeoutError as exc:
            raise VectorClientTimeout(f"vector request timed out: {method} {path}") from exc
        except Exception as exc:  # noqa: BLE001
            raise VectorClientUnavailable(f"vector request failed: {exc}") from exc


def _build_qdrant_filter(filter: Mapping[str, Any]) -> dict[str, Any]:
    must: list[dict[str, Any]] = []
    for key, value in filter.items():
        if value is None:
            continue
        if isinstance(value, (list, tuple)):
            must.append({"key": key, "match": {"any": list(value)}})
        else:
            must.append({"key": key, "match": {"value": value}})
    return {"must": must} if must else {}
