#!/usr/bin/env python3
"""Generate a deterministic fallback SPEC tree for WhyBuddy skill packages."""

from __future__ import annotations

import json
import sys


def build(goal: str) -> dict:
    normalized_goal = (goal or "未命名目标").strip() or "未命名目标"
    nodes = [
        {
            "id": "n0",
            "parentId": None,
            "type": "requirement",
            "title": normalized_goal,
            "acceptance": "交付一套可校验、可预览、可复审的 WhyBuddy Skill 规格包。",
        },
        {
            "id": "n1",
            "parentId": "n0",
            "type": "design",
            "title": "闭环流程设计",
            "notes": "覆盖输入、澄清、路线规划、规格树、文档派生、预览交付和反馈回炉。",
        },
        {
            "id": "n2",
            "parentId": "n1",
            "type": "task",
            "title": "生成规格文档与技能说明",
            "verify": "输出 requirements.md、design.md、tasks.md、SKILL.md 和校验脚本。",
        },
        {
            "id": "n3",
            "parentId": "n0",
            "type": "evidence",
            "title": "来源：用户提供的闭环总图或目标描述",
            "source": "user_input",
        },
    ]
    return {
        "rootNodeId": "n0",
        "version": 1,
        "status": "fallback",
        "nodes": nodes,
        "provenance": {
            "generationSource": "template",
            "promptId": None,
            "model": None,
            "fingerprint": None,
            "error": "LLM unavailable or generated tree failed validation",
        },
    }


def main(argv: list[str]) -> int:
    goal = argv[1] if len(argv) > 1 else ""
    print(json.dumps(build(goal), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
