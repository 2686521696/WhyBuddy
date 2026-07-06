"""
Settings for the migrated SlideRule V5 Python backend.
Modeled after tws-ai-ask-python/config/settings.py but focused on V5 reasoning + stable RAG/LLM for capabilities (report, mcp, skill, evidence, etc.).
Replaces Node's su8 pool, proxy headaches, template fallbacks.
"""

from functools import lru_cache
from typing import Optional
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PORT: int = 9700
    NODE_ENV: str = "development"

    # DB (reuse cube_pets_office or dedicated). Production credentials must come from .env.
    DB_HOST: str = "localhost"
    DB_PORT: int = 3306
    DB_NAME: str = "cube_pets_office"
    DB_USER: str = "root"
    DB_PASSWORD: str = ""

    # Vector / RAG (stable evidence source, replacing Node LLM pool for tools/evidence)
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_API_KEY: Optional[str] = None
    QDRANT_COLLECTION: str = "knowledge_base"

    # LLM (stable, like original Python; no su8 primary + 6-key pool)
    LLM_BASE_URL: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    LLM_API_KEY: Optional[str] = None
    LLM_MODEL: str = "qwen-max"
    LLM_FAST_MODEL: Optional[str] = "qwen-turbo"
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v1"

    # Internal key for SlideRule delegation (from Node)
    SLIDE_RULE_INTERNAL_KEY: str = "dev-slide-rule-internal"

    # Parallel capability batches in the full drive loop (services/v5_full_driver.py).
    # Each selected capability's provider call is independent; default ON overlaps
    # them (execute concurrently, commit sequentially in selection order).
    # Explicit false selects the serial reference path unchanged. Env var of the
    # same name wins at runtime (checked dynamically by _parallel_caps_enabled).
    SLIDERULE_PARALLEL_CAPS: bool = True

    # Durable task (mission) store for the /api/tasks surface (routes/tasks.py).
    # JSON array of [taskId, MissionRecord] entries; override via TASK_STORE_FILE env.
    TASK_STORE_FILE: str = "data/tasks.json"

    # Node-bridge runtime for skill.invoke / mcp.call (strangler migration).
    # Python owns the runtime boundary; execution is bridged to Node's existing
    # /api/skills/:id/execute and /api/mcp/nodes/execute until native adapters land.
    NODE_BRIDGE_RUNTIME_ENABLED: bool = True
    NODE_BRIDGE_BASE_URL: str = "http://localhost:3001"

    # Real vector RAG (embeddings + cosine index). Needs LLM_API_KEY for the
    # OpenAI-compatible /embeddings endpoint; without it retrieval falls back
    # to the keyword baseline with honest provenance.
    RAG_VECTOR_ENABLED: bool = True
    RAG_VECTOR_INDEX_PATH: str = "data/rag-vector-index.json"

    # AgentLoop worker bridge (108): builds commands for existing Node queue runner.
    # Node remains execution owner; Python owns command construction + receipts.
    # Safe defaults; do not assume node present in dry-run.
    AGENT_LOOP_ROOT: str = "agent-loop"
    AGENT_LOOP_RUN_QUEUE: str = "scripts/run-queue.mjs"
    AGENT_LOOP_LOOP_SCRIPT: str = "src/loop.js"
    AGENT_LOOP_NODE_COMMAND: str = "node"
    AGENT_LOOP_DEFAULT_TIMEOUT_MS: int = 1800000
    AGENT_LOOP_BRIDGE_DRY_RUN: bool = False

    @property
    def DATABASE_URL(self) -> str:
        return f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}?charset=utf8mb4"

    @property
    def is_development(self) -> bool:
        return self.NODE_ENV == "development"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"

@lru_cache()
def get_settings() -> Settings:
    return Settings()

settings = get_settings()
