"""
Central redaction helper for AgentLoop 109 secret rescue.

Reused by:
- run readers (agent_loop_runs.py)
- bridge receipts (agent_loop_bridge.py)
- provider health (agent_loop_provider_health.py)

Covers: API keys, bearer tokens, proxy credentials (user:pass@), env lines, command receipts, health output.

Does not broadly redact task/run ids (only secret-indicating patterns).
Never logs raw values.
"""

import re
from typing import Any, Dict, Optional


def redact_sensitive(text: str) -> str:
    """Redact secrets from text: keys, tokens, bearer, proxy creds, env assignments.

    Safe for logs, stderr, command output, reports, health text.
    """
    if not text or not isinstance(text, str):
        return text or ""
    red = text

    # Bearer / Authorization: Bearer xxx
    red = re.sub(
        r'(?i)\b(Authorization|Bearer)\s+[\w\.\-_=]+',
        r'\1 ***REDACTED***',
        red,
    )

    # Proxy credentials: http://user:pass@host or https://u:p@...
    red = re.sub(
        r'(?i)(https?://)[^:@\s/]+:[^@\s/]+(@)',
        r'\1***:***\2',
        red,
    )

    # JSON "secretKey": "val" or 'secretKey': 'val'  -- early to preserve structure for quoted forms
    # (use double-quoted raw literals to avoid any single-quote wrapper / unescaped ' in charclass syntax issues)
    red = re.sub(
        r"(?i)(?P<key>\"[^\"]*(?:api[_-]?key|secret|token|password|auth|credential|proxy)[^\"]*\")\s*:\s*\"[^\"]*\"",
        r'\g<key>: "***REDACTED***"',
        red,
    )
    red = re.sub(
        r"(?i)(?P<key>'[^']*(?:api[_-]?key|secret|token|password|auth|credential|proxy)[^']*')\s*:\s*'[^']*'",
        r"\g<key>: '***REDACTED***'",
        red,
    )

    # key=val / key:val for names containing secret keywords (covers env, args, json-ish)
    red = re.sub(
        r'(?i)(?P<key>\b(?:api[_-]?key|secret|token|password|auth[_-]?token|private[_-]?key|credential|access[_-]?key|proxy[_-]?user|proxy[_-]?pass|base[_-]?url)[^\s:=]*)\s*[:=]\s*["\']?[^"\'\s,}\]\n]+',
        r'\g<key>=***REDACTED***',
        red,
    )

    # export VAR=... or set VAR=... for secret-named vars
    red = re.sub(
        r'(?i)\b(export\s+|set\s+)?(?P<key>[A-Z_]*(?:KEY|SECRET|TOKEN|PASS|AUTH|CREDS?|PROXY)[A-Z_]*)\s*=\s*[^\s;"\']+',
        r'\1\g<key>=***REDACTED***',
        red,
    )

    # bare common secret prefixes (sk- etc) - match anywhere as standalone secret values
    red = re.sub(
        r'(?i)\b(sk-[a-zA-Z0-9_-]{8,}|ghp_[a-zA-Z0-9_-]{8,}|xoxb-[a-zA-Z0-9_-]{8,}|AIza[0-9A-Za-z\-_]{10,}|AKIA[0-9A-Z]{10,})\b',
        '***REDACTED***',
        red,
    )

    return red


def redact_env_dict(env: Optional[Dict[str, str]]) -> Optional[Dict[str, str]]:
    """Redact values for any env key that looks secret or proxy-related."""
    if env is None:
        return None
    if not isinstance(env, dict):
        return env
    out: Dict[str, str] = {}
    secret_hints = ("key", "secret", "token", "pass", "auth", "cred", "proxy")
    for k, v in env.items():
        kl = str(k).lower().replace("_", "").replace("-", "")
        if any(h in kl for h in secret_hints):
            out[k] = "***REDACTED***"
        else:
            out[k] = str(v) if v is not None else v
    return out


def redact_command_receipt(receipt: Dict[str, Any]) -> Dict[str, Any]:
    """Return a redacted copy of AgentLoopCommandReceipt-like dict.

    Redacts: command line, stdout, stderr, env, and any secret in args list.
    """
    if not isinstance(receipt, dict):
        return receipt
    r = dict(receipt)
    if isinstance(r.get("command"), str):
        r["command"] = redact_sensitive(r["command"])
    if r.get("stdout"):
        r["stdout"] = redact_sensitive(str(r["stdout"]))
    if r.get("stderr"):
        r["stderr"] = redact_sensitive(str(r["stderr"]))
    if r.get("env"):
        r["env"] = redact_env_dict(r.get("env"))
    if isinstance(r.get("args"), list):
        r["args"] = [redact_sensitive(a) if isinstance(a, str) else a for a in r["args"]]
    return r


def redact_health_output(health: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively redact any secret-looking strings from health output (proxy etc).
    Also redacts secret-looking dict keys (e.g. keys that are themselves sk-/token values)
    so that raw secrets never appear in health JSON responses.
    """
    if not isinstance(health, dict):
        return health

    def _walk(o: Any) -> Any:
        if isinstance(o, str):
            return redact_sensitive(o)
        if isinstance(o, dict):
            return {
                (redact_sensitive(str(k)) if isinstance(k, str) else k): _walk(v)
                for k, v in o.items()
            }
        if isinstance(o, list):
            return [_walk(x) for x in o]
        return o

    return _walk(dict(health))


__all__ = [
    "redact_sensitive",
    "redact_env_dict",
    "redact_command_receipt",
    "redact_health_output",
]
