"""v5_skill_packages — 原版技能包库（技能库四期）。

技能包 = 从 TRAE 技能创作赛开源仓库抓取的完整 SKILL.md 指令
（scripts/harvest-skill-packages.mjs 采集，data/skill_packages.json，
收录沿用 owner 兜底决策：署名回链 + 协议标签 + 异议按条下架）。

执行语义（与语义档案试跑的本质区别）：SKILL.md 原文整体作为 system
prompt——LLM 按原作者写的指令干活，而不是按我们转述的一句话定位。
边界如实：技能里引用的本地脚本/文件/工具在本运行时不可用，guard
指令要求模型完成纯文本可完成的部分并明说缺了什么。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "skill_packages.json"

_cache: Optional[List[Dict[str, Any]]] = None


def _load_items() -> List[Dict[str, Any]]:
    global _cache
    if _cache is None:
        try:
            raw = json.loads(_DATA_PATH.read_text(encoding="utf-8"))
            _cache = [it for it in raw.get("items", []) if (it.get("content") or "").strip()]
        except Exception:
            _cache = []
    return _cache


def list_skill_packages() -> List[Dict[str, Any]]:
    """轻量元数据清单（不带 content，客户端列表/join 用）。"""
    return [
        {
            "id": it.get("id", ""),
            "repo": it.get("repo", ""),
            "path": it.get("path", ""),
            "sourceUrl": it.get("sourceUrl", ""),
            "license": it.get("license", "unknown"),
            "name": it.get("name", ""),
            "description": it.get("description", ""),
            "truncated": bool(it.get("truncated")),
            "contentChars": len(it.get("content", "")),
        }
        for it in _load_items()
    ]


def get_skill_package(package_id: str) -> Optional[Dict[str, Any]]:
    for it in _load_items():
        if it.get("id") == package_id:
            return it
    return None


_GUARD = (
    "你将按下面这份 SKILL.md 技能定义执行任务（该技能来自开源社区，"
    "按原文指令行事）。执行边界：本运行时是纯文本对话环境——技能里"
    "引用的本地脚本、文件读写、外部工具在这里不可用；对这些部分，"
    "完成纯文本可以完成的等价工作，并在结尾用一行「[运行时说明] …」"
    "如实说明跳过了什么。除此之外不要解释流程，直接产出任务结果本身，"
    "用户输入是什么语言就用什么语言回答（默认简体中文）。"
)


def build_skill_messages(pkg: Dict[str, Any], user_input: str) -> List[Dict[str, str]]:
    """SKILL.md 原文做 system prompt 的消息装配（纯函数，测试可锁）。"""
    system = f"{_GUARD}\n\n===== SKILL.md（{pkg.get('name', '')}） =====\n{pkg.get('content', '')}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_input},
    ]
