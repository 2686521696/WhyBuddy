"""Real vector retrieval for SlideRule RAG (embeddings + cosine index).

诚实降级链（provenance 永远如实标注检索方式）：
1. 配置了 embedding 凭据（LLM_API_KEY）→ 语义向量检索（retrieval="vector"）。
2. 无凭据 / embedding 调用失败 → 调用方回退关键词基线（原 retrieve_evidence
   行为，retrieval="keyword"），行为与历史版本一致。

索引默认本地 JSON 持久化（RAG_VECTOR_INDEX_PATH）。测试通过 set_vector_store()
注入 fake embedder 走向量路径，不碰网络；生产 embedder 走 LLM_BASE_URL 的
OpenAI 兼容 /embeddings 端点（QWEN_EMBEDDING_MODEL）。
"""

from __future__ import annotations

import json
import math
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, Sequence
from urllib import error as urllib_error
from urllib import request as urllib_request

from config.settings import settings

VECTOR_RAG_RETRIEVAL = "vector"
VECTOR_RAG_PROVENANCE = "python-rag-vector"


class EmbeddingUnavailable(Exception):
    """Raised when the embedder cannot produce vectors (no key / API failure)."""


class Embedder(Protocol):
    def available(self) -> bool: ...

    def embed(self, texts: Sequence[str]) -> List[List[float]]: ...


def _post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout_s: float):
    data = json.dumps(payload).encode("utf-8")
    req = urllib_request.Request(url, data=data, headers=headers, method="POST")
    with urllib_request.urlopen(req, timeout=timeout_s) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8", errors="replace"))


class OpenAICompatEmbedder:
    """Embeddings via the OpenAI-compatible endpoint at LLM_BASE_URL (DashScope/Qwen)."""

    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout_s: float = 30.0,
        post=_post_json,
    ) -> None:
        self._base_url = (base_url or settings.LLM_BASE_URL).rstrip("/")
        self._api_key = api_key if api_key is not None else getattr(settings, "LLM_API_KEY", "") or ""
        self._model = model or settings.QWEN_EMBEDDING_MODEL
        self._timeout_s = timeout_s
        self._post = post

    def available(self) -> bool:
        return bool(self._api_key)

    def embed(self, texts: Sequence[str]) -> List[List[float]]:
        if not self.available():
            raise EmbeddingUnavailable("no embedding api key configured")
        try:
            body = self._post(
                f"{self._base_url}/embeddings",
                {"model": self._model, "input": list(texts)},
                {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._api_key}",
                },
                self._timeout_s,
            )
        except (urllib_error.URLError, OSError, json.JSONDecodeError) as exc:
            raise EmbeddingUnavailable(f"embedding request failed: {exc}") from exc
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list) or len(data) != len(texts):
            raise EmbeddingUnavailable("embedding response shape invalid")
        vectors: List[List[float]] = []
        for item in data:
            vector = item.get("embedding") if isinstance(item, dict) else None
            if not isinstance(vector, list) or not vector:
                raise EmbeddingUnavailable("embedding vector missing in response")
            vectors.append([float(v) for v in vector])
        return vectors


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class LocalVectorIndex:
    """Persistent in-process cosine index (small corpora; no external services)."""

    def __init__(self, path: Optional[str] = None) -> None:
        self._path = Path(path or settings.RAG_VECTOR_INDEX_PATH)
        self._lock = threading.Lock()
        self._records: Dict[str, Dict[str, Any]] = {}
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError, ValueError):
            return
        records = raw.get("records") if isinstance(raw, dict) else None
        if isinstance(records, list):
            for record in records:
                if isinstance(record, dict) and isinstance(record.get("id"), str):
                    self._records[record["id"]] = record

    def _persist(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(
                json.dumps({"records": list(self._records.values())}, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            # 索引持久化是尽力而为；进程内检索仍然可用。
            pass

    def count(self) -> int:
        with self._lock:
            self._load()
            return len(self._records)

    def upsert(self, records: List[Dict[str, Any]]) -> int:
        with self._lock:
            self._load()
            for record in records:
                record_id = str(record.get("id") or "")
                vector = record.get("vector")
                if not record_id or not isinstance(vector, list) or not vector:
                    continue
                self._records[record_id] = record
            self._persist()
            return len(self._records)

    def search(self, vector: Sequence[float], top_k: int) -> List[Dict[str, Any]]:
        with self._lock:
            self._load()
            scored = [
                (_cosine(vector, record.get("vector") or []), record)
                for record in self._records.values()
            ]
        scored.sort(reverse=True, key=lambda pair: pair[0])
        results = []
        for score, record in scored[: max(top_k, 0)]:
            results.append(
                {
                    "id": record.get("id"),
                    "content": record.get("content"),
                    "source": record.get("source"),
                    "score": round(max(min(score, 1.0), 0.0), 4),
                    "retrieval": VECTOR_RAG_RETRIEVAL,
                }
            )
        return results


class VectorRagStore:
    """Embedding + index orchestration with lazy corpus seeding."""

    def __init__(
        self,
        *,
        embedder: Embedder,
        index: Optional[LocalVectorIndex] = None,
        seed_corpus: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        self._embedder = embedder
        self._index = index or LocalVectorIndex()
        self._seed_corpus = seed_corpus or []
        self._seeded = False

    @property
    def embedder(self) -> Embedder:
        return self._embedder

    def available(self) -> bool:
        return self._embedder.available()

    def _ensure_seeded(self) -> None:
        if self._seeded:
            return
        self._seeded = True
        if not self._seed_corpus or self._index.count() > 0:
            return
        contents = [str(item.get("content") or "") for item in self._seed_corpus]
        vectors = self._embedder.embed(contents)
        self._index.upsert(
            [
                {
                    "id": str(item.get("id") or f"seed-{position}"),
                    "content": item.get("content"),
                    "source": item.get("source"),
                    "vector": vector,
                }
                for position, (item, vector) in enumerate(zip(self._seed_corpus, vectors))
            ]
        )

    def ingest(self, records: List[Dict[str, Any]]) -> int:
        """Embed and upsert content records ({id, content, source})."""
        if not records:
            return self._index.count()
        vectors = self._embedder.embed([str(r.get("content") or "") for r in records])
        return self._index.upsert(
            [{**record, "vector": vector} for record, vector in zip(records, vectors)]
        )

    def search(self, query: str, top_k: int) -> List[Dict[str, Any]]:
        self._ensure_seeded()
        query_vector = self._embedder.embed([query])[0]
        return self._index.search(query_vector, top_k)


_vector_store: Optional[VectorRagStore] = None
_default_store_built = False


def set_vector_store(store: Optional[VectorRagStore]) -> None:
    global _vector_store, _default_store_built
    _vector_store = store
    _default_store_built = store is not None


def get_vector_store(seed_corpus: Optional[List[Dict[str, Any]]] = None) -> Optional[VectorRagStore]:
    """Return the configured store, lazily building the production default once."""
    global _vector_store, _default_store_built
    if _vector_store is not None:
        return _vector_store
    if _default_store_built or not settings.RAG_VECTOR_ENABLED:
        return _vector_store
    _default_store_built = True
    embedder = OpenAICompatEmbedder()
    if embedder.available():
        _vector_store = VectorRagStore(embedder=embedder, seed_corpus=seed_corpus or [])
    return _vector_store


def vector_search_or_none(
    query: str,
    top_k: int,
    *,
    seed_corpus: Optional[List[Dict[str, Any]]] = None,
) -> Optional[List[Dict[str, Any]]]:
    """Semantic search when a store is available; None → caller falls back to keyword."""
    store = get_vector_store(seed_corpus)
    if store is None or not store.available():
        return None
    try:
        results = store.search(query, top_k)
    except EmbeddingUnavailable:
        return None
    return results or None
