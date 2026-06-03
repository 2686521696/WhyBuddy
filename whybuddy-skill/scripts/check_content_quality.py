#!/usr/bin/env python3
"""Validate the minimum structure of WhyBuddy spec documents."""

from __future__ import annotations

import pathlib
import sys

REQUIRED_SECTIONS = {
    "requirements.md": ["## 目标", "## 范围", "## 功能要求", "## 验收标准"],
    "design.md": ["## 设计目标", "## 模块划分", "## 失败处理策略", "## 质量控制"],
    "tasks.md": ["## 里程碑", "## 任务清单", "## 完成定义"],
}

MIN_CHARACTERS = 200


def read_text(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print(
            "Usage: python scripts/check_content_quality.py requirements.md design.md tasks.md",
            file=sys.stderr,
        )
        return 2

    failures: list[str] = []
    for raw_path in argv[1:4]:
        path = pathlib.Path(raw_path)
        if not path.exists():
            failures.append(f"missing file: {path}")
            continue

        content = read_text(path)
        expected = REQUIRED_SECTIONS.get(path.name)
        if not expected:
            failures.append(f"unknown document type: {path.name}")
            continue

        for section in expected:
            if section not in content:
                failures.append(f"{path.name} is missing required section: {section}")

        if len(content.strip()) < MIN_CHARACTERS:
            failures.append(
                f"{path.name} is too short: {len(content.strip())} chars, minimum {MIN_CHARACTERS}"
            )

    if failures:
        print("failed - spec document quality check")
        for failure in failures:
            print(f"  - {failure}")
        return 1

    print("passed - spec documents have the required structure")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
