"""
AgentLoop settings API service (SlideRule 108).

Non-secret persistence only (e.g. data/agent-loop-settings.json).
Never writes raw secrets/keys.
Secret responses report only configured status (no values).
Save: skips secrets, normalizes/validates enums or rejects 400 at route.
Non-secrets: worker agents (fix/review), max turns, retries, queue path, worktree mode/scope, proxy/inject flags, provider base URLs.
"""

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from config.settings import get_settings

# Non-secret store (do not use for keys)
NONSECRET_STORE = "data/agent-loop-settings.json"
NONSECRET_STORE_ENV = "AGENT_LOOP_SETTINGS_FILE"

# Supported non-secret keys per criteria + alignment with existing
NON_SECRET_KEYS = {
    "fixAgent",
    "reviewAgent",
    "workerMaxTurns",
    "workerMaxRetries",
    "queuePath",
    "worktreeScope",
    "baseUrl",
    "injectKeysToWorker",
    "activeProfile",
    # proxy flags / worktree mode aliases if present
    "useWorktree",
    "worktree",
}

# Enums that must be validated or normalized on save
SETTING_ENUMS: Dict[str, Tuple[str, ...]] = {
    "fixAgent": ("grok", "codex"),
    "reviewAgent": ("grok", "codex", "none"),
    "worktreeScope": ("queue", "task"),
}

# Default non-secret values (mirrors common defaults, no secrets)
DEFAULT_NON_SECRET: Dict[str, Any] = {
    "fixAgent": "grok",
    "reviewAgent": "codex",
    "workerMaxTurns": 128,
    "workerMaxRetries": 2,
    "queuePath": "agent-loop/scripts/migration-queue.json",
    "worktreeScope": "queue",
    "baseUrl": "",
    "injectKeysToWorker": True,
    "activeProfile": "local",
}


def _resolve_store() -> Path:
    envf = os.getenv(NONSECRET_STORE_ENV)
    if envf:
        return Path(envf)
    # relative to repo root (tws-ai-slide-rule-python parent or self)
    here = Path(__file__).resolve()
    root = here.parents[1] if (here.parent.parent / "agent-loop").exists() or (here.parents[2] / "agent-loop").exists() else here.parent.parent
    # try locate repo root
    for cand in [here.parent.parent, here.parents[2] if len(here.parents) > 2 else here.parent.parent]:
        if (cand / "agent-loop").is_dir():
            return cand / NONSECRET_STORE
    return Path(NONSECRET_STORE)


def _is_secret_key(k: str) -> bool:
    kl = str(k).lower().replace("_", "").replace("-", "")
    return any(p in kl for p in ("apikey", "secret", "token", "password", "auth", "credential", "privatekey"))


def _load_raw() -> Dict[str, Any]:
    path = _resolve_store()
    if not path.exists():
        return {}
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw) if raw.strip() else {}
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _write_raw(data: Dict[str, Any]) -> None:
    path = _resolve_store()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load_agent_loop_settings() -> Dict[str, Any]:
    """Return merged non-secret settings + defaults. Never includes raw secrets."""
    stored = _load_raw()
    merged = {**DEFAULT_NON_SECRET, **{k: v for k, v in stored.items() if k in NON_SECRET_KEYS and not _is_secret_key(k)}}
    # overlay some from env/config if present (non secret only)
    try:
        s = get_settings()
        if getattr(s, "AGENT_LOOP_DEFAULT_QUEUE", None):
            merged["queuePath"] = getattr(s, "AGENT_LOOP_DEFAULT_QUEUE")
    except Exception:
        pass
    return merged


def save_agent_loop_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Persist only allowed non-secrets. Returns the saved subset (no secrets)."""
    if not isinstance(payload, dict):
        payload = {}
    to_save: Dict[str, Any] = {}
    for k, v in payload.items():
        if _is_secret_key(k):
            continue
        if k not in NON_SECRET_KEYS:
            continue
        to_save[k] = v
    # merge with existing to preserve others
    current = _load_raw()
    for k, v in to_save.items():
        current[k] = v
    # keep only non-secrets
    filtered = {k: v for k, v in current.items() if k in NON_SECRET_KEYS and not _is_secret_key(k)}
    _write_raw(filtered)
    return filtered


def get_secret_status() -> Dict[str, Any]:
    """Return only configured status for known secrets. Never raw values."""
    status: Dict[str, Any] = {}
    # Check common agentloop secret names via env or main settings (status only)
    env = os.environ
    candidates = [
        ("grokApiKey", ["GROK_API_KEY", "XAI_API_KEY", "AGENT_LOOP_GROK_API_KEY"]),
        ("openaiApiKey", ["OPENAI_API_KEY", "AGENT_LOOP_OPENAI_API_KEY"]),
        ("anthropicApiKey", ["ANTHROPIC_API_KEY", "AGENT_LOOP_ANTHROPIC_API_KEY"]),
        ("llmApiKey", ["LLM_API_KEY"]),
    ]
    try:
        s = get_settings()
        for sec_name, envs in candidates:
            configured = False
            for e in envs:
                if env.get(e):
                    configured = True
                    break
            # also check pydantic settings LLM etc
            if not configured and sec_name == "llmApiKey" and getattr(s, "LLM_API_KEY", None):
                configured = True
            status[sec_name] = {"configured": configured}
    except Exception:
        for sec_name, _ in candidates:
            status[sec_name] = {"configured": False}
    return status


def sanitize_for_save(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Filter to non-secrets; caller decides on enum validation."""
    if not isinstance(payload, dict):
        return {}
    out: Dict[str, Any] = {}
    for k, v in payload.items():
        if _is_secret_key(k):
            continue
        if k in NON_SECRET_KEYS:
            out[k] = v
        elif k == "injectToWorker":
            out["injectKeysToWorker"] = v
    return out


def validate_enums(payload: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
    """Return (ok, error_msg). For enums, must be valid or caller can normalize."""
    if not isinstance(payload, dict):
        return True, None
    for k, allowed in SETTING_ENUMS.items():
        if k in payload and payload[k] is not None:
            val = str(payload[k]).strip().lower()
            if val not in allowed:
                return False, f"invalid enum value for {k}: {payload[k]} (allowed: {allowed})"
    return True, None


def normalize_enums(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Optional normalize: drop or clamp bad enums (for cases where not rejecting)."""
    if not isinstance(payload, dict):
        return payload or {}
    out = dict(payload)
    for k, allowed in SETTING_ENUMS.items():
        if k in out and out[k] is not None:
            val = str(out[k]).strip().lower()
            if val not in allowed:
                # normalize to first allowed (or keep for reject path)
                out[k] = allowed[0]
    return out
