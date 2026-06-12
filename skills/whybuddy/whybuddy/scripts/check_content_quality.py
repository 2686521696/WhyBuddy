#!/usr/bin/env python3
"""Validate markdown deliverables for required sections and minimum substance."""

from __future__ import annotations

import re
import sys
from pathlib import Path

REQUIRED_HEADINGS = (
    re.compile(r"^#\s+需求", re.M),
    re.compile(r"^##\s+验收", re.M),
    re.compile(r"EARS|验收标准", re.I),
)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_content_quality.py <markdown-file>", file=sys.stderr)
        return 2

    path = Path(argv[1])
    if not path.exists():
        print(f"missing file: {path}", file=sys.stderr)
        return 1

    text = path.read_text(encoding="utf-8")
    if len(text.strip()) < 400:
        print("content too short (<400 chars)", file=sys.stderr)
        return 1

    missing = [name for name, pat in zip(("需求", "验收", "EARS"), REQUIRED_HEADINGS) if not pat.search(text)]
    if missing:
        print(f"missing sections: {', '.join(missing)}", file=sys.stderr)
        return 1

    print(f"ok: content quality passed for {path.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))