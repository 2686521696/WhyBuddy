#!/usr/bin/env python3
"""Ledger wrapper: run a child check and append a tamper-evident entry."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _usage() -> str:
    return (
        "usage: gate.py <checks_ledger.json> <check_name> -- <command> [args...]\n"
        "       gate.py --help"
    )


def _load_ledger(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict) and isinstance(payload.get("entries"), list):
        return [item for item in payload["entries"] if isinstance(item, dict)]
    return []


def main(argv: list[str]) -> int:
    if len(argv) < 2 or argv[1] in {"-h", "--help"}:
        print(_usage(), file=sys.stderr)
        return 2

    ledger_path = Path(argv[1])
    if len(argv) < 4 or argv[3] != "--":
        print(_usage(), file=sys.stderr)
        return 2

    check_name = argv[2]
    cmd = argv[4:]
    if not cmd:
        print("gate.py: missing child command after --", file=sys.stderr)
        return 2

    proc = subprocess.run(cmd, capture_output=True, text=True)
    entry = {
        "check": check_name,
        "command": cmd,
        "exitCode": proc.returncode,
        "stdout": proc.stdout[-4000:],
        "stderr": proc.stderr[-4000:],
        "passed": proc.returncode == 0,
        "recordedAt": datetime.now(timezone.utc).isoformat(),
    }

    ledger = _load_ledger(ledger_path)
    ledger.append(entry)
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8")

    if proc.returncode != 0:
        print(proc.stderr or proc.stdout or f"check failed: {check_name}", file=sys.stderr)
    else:
        print(f"ok: {check_name} recorded in {ledger_path}")
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))