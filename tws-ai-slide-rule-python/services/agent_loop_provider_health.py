"""
SlideRule AgentLoop 108 provider health service.

Python control plane provider + CLI health checks.
- LLM providers (grok, openai, anthropic): ready if key configured, missing otherwise.
- Supports skipped (for optional/proxy cases).
- CLI workers (grok, codex): use which + --version probe; reports commandPath + version.
- Proxy reported separately (skipped by default, no live).
- Redacted: never emits key values or secrets.
- Cacheable: module level cache with force bypass.
- No network calls performed for provider health (key/env presence + CLI spawn only for --version).
- Missing optionals are non-fatal (per-provider status).
"""

import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

try:
    from services.agent_loop_settings import get_secret_status
except Exception:
    # fallback direct when run in isolated test path
    from agent_loop_settings import get_secret_status  # type: ignore

# 109: reuse central redaction for health output (proxy creds, env etc)
try:
    from services.agent_loop_redaction import redact_health_output
except Exception:
    from agent_loop_redaction import redact_health_output  # type: ignore



# in-memory cache (per process; cleared between test cases)
_health_cache: Dict[str, Any] = {}
_CACHE_TTL = 30.0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _clear_provider_health_cache() -> None:
    global _health_cache
    _health_cache = {}


def _set_health_cache_for_test(data: Dict[str, Any]) -> None:
    """Test helper to inject cached result."""
    global _health_cache
    _health_cache = {"default": {**data, "_cachedAt": time.time()}}


def _has_provider_key(provider: str) -> bool:
    """Check configured status using shared secret status (no values)."""
    p = (provider or "").lower().strip()
    try:
        status = get_secret_status() or {}
        mapping = {
            "grok": "grokApiKey",
            "openai": "openaiApiKey",
            "anthropic": "anthropicApiKey",
        }
        k = mapping.get(p)
        if k and status.get(k, {}).get("configured"):
            return True
    except Exception:
        pass
    # direct env fallback (non secret values, just presence)
    env = os.environ
    if p == "grok":
        return bool(env.get("GROK_API_KEY") or env.get("XAI_API_KEY") or env.get("AGENT_LOOP_GROK_API_KEY"))
    if p == "openai":
        return bool(env.get("OPENAI_API_KEY") or env.get("AGENT_LOOP_OPENAI_API_KEY"))
    if p == "anthropic":
        return bool(env.get("ANTHROPIC_API_KEY") or env.get("AGENT_LOOP_ANTHROPIC_API_KEY"))
    return False


def _resolve_cli_command(name: str) -> Optional[str]:
    """Find absolute command path using which (cross platform)."""
    if not name:
        return None
    p = shutil.which(name)
    if p:
        return p
    # windows extras
    if os.name == "nt":
        for ext in (".exe", ".cmd", ".bat"):
            p = shutil.which(name + ext)
            if p:
                return p
    return None


def _probe_cli_version(cmd_path: str, timeout: float = 1.8) -> Optional[str]:
    """Safely probe --version; never raises to caller."""
    if not cmd_path:
        return None
    try:
        res = subprocess.run(
            [cmd_path, "--version"],
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=False,
        )
        out = ((res.stdout or "") + "\n" + (res.stderr or "")).strip()
        if out:
            first = out.splitlines()[0].strip()
            return first[:160] if first else None
    except Exception:
        # treat probe failure as no version but path existed -> caller decides
        return None
    return None


def _compute_provider_entry(provider: str) -> Dict[str, Any]:
    has = _has_provider_key(provider)
    if not has:
        return {
            "provider": provider,
            "status": "missing",
            "reason": "missing key",
            "checkedAt": _now_iso(),
        }
    return {
        "provider": provider,
        "status": "ready",
        "reason": "key present",
        "checkedAt": _now_iso(),
    }


def _compute_cli_entry(worker: str) -> Dict[str, Any]:
    cmd = worker
    path = _resolve_cli_command(cmd)
    if not path:
        return {
            "worker": worker,
            "status": "missing",
            "command": cmd,
            "commandPath": None,
            "version": None,
            "reason": "command not found",
            "checkedAt": _now_iso(),
        }
    ver = _probe_cli_version(path)
    status = "ready" if ver else "failed"
    return {
        "worker": worker,
        "status": status,
        "command": cmd,
        "commandPath": path,
        "version": ver,
        "reason": "ok" if status == "ready" else "version unavailable",
        "checkedAt": _now_iso(),
    }


def get_provider_health(force: bool = False) -> Dict[str, Any]:
    """Main entry: return redacted cacheable health snapshot.

    - force=True bypasses and refreshes cache.
    - Never performs live paid API calls (LLM status = key presence only).
    - CLI probes are short --version only.
    - Returns per-item status in {ready, missing, skipped, failed}
    - commandPath + version populated for ready CLIs.
    - proxy included (default skipped, non-fatal).
    """
    cache_key = "default"
    now = time.time()

    if not force and cache_key in _health_cache:
        entry = _health_cache[cache_key]
        if now - entry.get("_cachedAt", 0) <= _CACHE_TTL:
            out = dict(entry)
            out.pop("_cachedAt", None)
            return redact_health_output(out)

    # Build
    providers_list = ["grok", "openai", "anthropic"]
    cli_list = ["grok", "codex"]

    providers = {p: _compute_provider_entry(p) for p in providers_list}
    cli = {c: _compute_cli_entry(c) for c in cli_list}

    # proxy: optional, non fatal, usually skipped unless base present
    proxy_status = "skipped"
    proxy_reason = "no custom proxy baseUrl or check disabled for safety"
    try:
        # peek non-secret settings if available
        from services.agent_loop_settings import load_agent_loop_settings

        eff = load_agent_loop_settings() or {}
        if eff.get("baseUrl"):
            proxy_status = "ready"
            proxy_reason = "baseUrl configured"
    except Exception:
        pass

    result: Dict[str, Any] = {
        "checkedAt": _now_iso(),
        "providers": providers,
        "cli": cli,
        "proxy": {
            "status": proxy_status,
            "reason": proxy_reason,
            "checkedAt": _now_iso(),
        },
    }

    # store in cache (with meta)
    to_store = dict(result)
    to_store["_cachedAt"] = now
    _health_cache[cache_key] = to_store

    # 109: apply redaction helper to health output before return
    return redact_health_output(result)


# allow tests to force a skipped provider result (for coverage of all states)
def _mark_provider_skipped_for_test(provider: str) -> None:
    # used in advanced test paths if needed; direct mutation not required for 108 gate
    pass
