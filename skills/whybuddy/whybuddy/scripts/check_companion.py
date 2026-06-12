#!/usr/bin/env python3
"""Validate companion_log.json has real critic/grounding trace entries."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _load(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("entries", "events", "companion"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    raise ValueError("expected companion log array or object with entries")


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_companion.py <companion_log.json>", file=sys.stderr)
        return 2

    path = Path(argv[1])
    if not path.exists():
        print(f"missing companion log: {path}", file=sys.stderr)
        return 1

    try:
        entries = _load(path)
    except (json.JSONDecodeError, ValueError) as exc:
        print(f"invalid companion log: {exc}", file=sys.stderr)
        return 1

    if not entries:
        print("companion log is empty", file=sys.stderr)
        return 1

    grounded = 0
    critiques = 0
    for item in entries:
        role = str(item.get("role") or item.get("roleId") or "")
        kind = str(item.get("kind") or item.get("type") or "")
        text = str(item.get("text") or item.get("summary") or item.get("content") or "")
        if "接地" in role or "ground" in kind.lower() or "来源" in text:
            grounded += 1
        if "挑刺" in role or "critique" in kind.lower() or "反证" in text:
            critiques += 1

    if grounded == 0 and critiques == 0:
        print("companion log has no grounding or critique traces", file=sys.stderr)
        return 1

    print(f"ok: companion log {len(entries)} entries (ground={grounded}, critique={critiques})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))