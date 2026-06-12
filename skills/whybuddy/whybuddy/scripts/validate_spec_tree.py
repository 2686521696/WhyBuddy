#!/usr/bin/env python3
"""Validate spec tree / traceability JSON structure for WhyBuddy parity contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def _nodes(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [n for n in payload if isinstance(n, dict)]
    if isinstance(payload, dict):
        for key in ("nodes", "specTree", "tree", "requirements"):
            value = payload.get(key)
            if isinstance(value, list):
                return [n for n in value if isinstance(n, dict)]
    return []


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: validate_spec_tree.py <spec-tree.json>", file=sys.stderr)
        return 2

    path = Path(argv[1])
    if not path.exists():
        print(f"missing spec tree: {path}", file=sys.stderr)
        return 1

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"invalid json: {exc}", file=sys.stderr)
        return 1

    nodes = _nodes(payload)
    if len(nodes) < 1:
        print("spec tree has no nodes", file=sys.stderr)
        return 1

    missing_id = [i for i, n in enumerate(nodes) if not str(n.get("id") or "").strip()]
    if missing_id:
        print(f"nodes missing id at indexes: {missing_id[:5]}", file=sys.stderr)
        return 1

    print(f"ok: spec tree validated ({len(nodes)} nodes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))