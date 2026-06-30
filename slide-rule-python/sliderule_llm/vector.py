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

from .config import VectorStoreConfig, get_vector_store_config


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


def create_vector_runtime_from_config(
    config: VectorStoreConfig | None = None,
    *,
    embedding_provider: Any | None = None,
    transport: Transport | None = None,
) -> VectorRuntime | None:
    """Build the configured vector runtime without inventing real credentials.

    Disabled config returns None so callers can choose an explicit fallback.
    Enabled Qdrant config still requires an injected embedding provider; tests may
    inject a fake transport while production callers can rely on the default HTTP
    transport.
    """
    resolved_config = config or get_vector_store_config()
    if not resolved_config.enabled or resolved_config.runtime == "disabled":
        return None
    if resolved_config.runtime != "qdrant":
        raise VectorRuntimeError(f"unsupported vector runtime: {resolved_config.runtime}")
    if embedding_provider is None:
        raise VectorRuntimeError(
            "vector runtime requires explicit embedding_provider"
        )
    vector_client = QdrantVectorClient(
        VectorConfig(
            base_url=resolved_config.base_url,
            collection=resolved_config.collection,
            api_key=resolved_config.api_key,
            timeout_ms=resolved_config.timeout_ms,
            dimension=resolved_config.dimension,
        ),
        transport=transport,
    )
    return create_vector_runtime(
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
    store_config = get_vector_store_config()
    return VectorConfig(
        base_url=store_config.base_url,
        collection=store_config.collection,
        api_key=store_config.api_key,
        timeout_ms=store_config.timeout_ms,
        dimension=store_config.dimension,
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


class RAGVectorStoreProvider:
    """Python-owned RAG vector store provider abstraction with Qdrant-shaped contract.

    This is the production boundary for ingestion vector upsert/delete/retrieval.
    Node routes act as thin proxies; real semantics live here.

    Supports:
    - no-key degraded (api_key empty -> still operable but marked degraded)
    - fake Qdrant via injected transport for tests
    - upsert, delete, retrieve (search)
    - embedding dimension mismatch detection on upsert
    """

    def __init__(
        self,
        *,
        client: QdrantVectorClient | None = None,
        config: VectorConfig | None = None,
        transport: Transport | None = None,
        force_degraded: bool = False,
    ) -> None:
        self._degraded = force_degraded
        if client is not None:
            self._client = client
            self._config = client.config
        else:
            resolved = config or get_vector_config()
            self._config = resolved
            if not resolved or force_degraded:
                self._degraded = True
            self._client = QdrantVectorClient(resolved, transport=transport)

    def is_degraded(self) -> bool:
        return self._degraded or not bool(self._config.api_key)

    def get_config(self) -> VectorConfig:
        return self._config

    def upsert(self, records: Sequence[Mapping[str, Any]], collection: str | None = None) -> dict[str, Any]:
        if not records:
            return {"attempted": True, "stored": False, "upsertedCount": 0, "recordIds": []}
        dim = self._config.dimension
        for rec in records:
            vec = rec.get("vector") or []
            if len(vec) != dim:
                raise VectorClientUnavailable(
                    f"embedding mismatch: vector dim {len(vec)} != expected {dim}"
                )
        try:
            self._client.upsert(records, collection)
            ids = [str(r.get("id")) for r in records]
            return {
                "collection": collection or self._config.collection,
                "attempted": True,
                "stored": True,
                "upsertedCount": len(records),
                "recordIds": ids,
            }
        except (VectorClientTimeout, VectorClientUnavailable) as exc:
            if self.is_degraded():
                return {
                    "collection": collection or self._config.collection,
                    "attempted": True,
                    "stored": False,
                    "upsertedCount": 0,
                    "recordIds": [],
                    "degraded": True,
                    "error": str(exc),
                }
            raise

    def delete(self, ids: Sequence[str], collection: str | None = None) -> dict[str, Any]:
        if not ids:
            return {"attempted": True, "deleted": False, "deletedCount": 0, "targetIds": []}
        try:
            self._client.delete(ids, collection)
            return {
                "collection": collection or self._config.collection,
                "attempted": True,
                "deleted": True,
                "deletedCount": len(ids),
                "targetIds": [str(i) for i in ids],
            }
        except (VectorClientTimeout, VectorClientUnavailable) as exc:
            if self.is_degraded():
                return {
                    "collection": collection or self._config.collection,
                    "attempted": True,
                    "deleted": False,
                    "deletedCount": 0,
                    "targetIds": [str(i) for i in ids],
                    "degraded": True,
                    "error": str(exc),
                }
            raise

    def search(
        self,
        query_vector: Sequence[float],
        *,
        top_k: int = 10,
        min_score: float | None = None,
        filter: Mapping[str, Any] | None = None,
        collection: str | None = None,
    ) -> list[VectorSearchHit]:
        try:
            return self._client.search(
                query_vector, top_k=top_k, min_score=min_score, filter=filter, collection=collection
            )
        except (VectorClientTimeout, VectorClientUnavailable) as exc:
            if self.is_degraded():
                return []
            raise

    def health(self) -> dict[str, Any]:
        base = {"backend": "qdrant", "degraded": self.is_degraded()}
        try:
            h = self._client.health_check()
            return {**base, **h}
        except Exception:  # noqa: BLE001
            return {**base, "connected": False}


def create_rag_vector_provider(
    *,
    transport: Transport | None = None,
    force_degraded: bool = False,
) -> RAGVectorStoreProvider:
    """Factory for Python RAG vector provider (Qdrant contract).

    - transport injected for fake Qdrant in tests
    - force_degraded or no api_key yields explicit degraded mode (visible failures)
    """
    try:
        store_cfg = get_vector_store_config()
        cfg = get_vector_config()
        if force_degraded or not store_cfg.enabled or store_cfg.runtime == "disabled":
            return RAGVectorStoreProvider(force_degraded=True)
        return RAGVectorStoreProvider(config=cfg, transport=transport)
    except Exception:  # noqa: BLE001
        return RAGVectorStoreProvider(force_degraded=True)
