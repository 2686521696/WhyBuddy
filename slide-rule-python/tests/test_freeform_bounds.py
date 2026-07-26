"""freeform 内容树深度/节点上限哨兵（2026-07-26 修复）。

历史缺口：内容树没有任何规模上限——超深/超大树能一路过 Pydantic 校验流进
前端无界递归渲染，把整个应用舞台打成白屏。修法是 micromark/cmark 同款纪律：
不可信输入写死嵌套/规模上限，生成侧超限进 reask、前端同值截断降级。
"""

import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.freeform_block import (
    FREEFORM_MAX_DEPTH,
    FREEFORM_MAX_NODES,
    build_freeform_models,
)

DATAMODEL = {"entities": []}


def _leaf(text: str = "叶子") -> dict:
    return {"tag": "span", "text": text}


def _chain(depth: int) -> dict:
    node = _leaf()
    for _ in range(depth):
        node = {"tag": "div", "children": [node]}
    return node


def test_normal_tree_passes():
    design = build_freeform_models(DATAMODEL)
    design.model_validate({"root": {"tag": "div", "children": [_leaf("a"), _leaf("b")]}})


def test_depth_cap_enforced():
    design = build_freeform_models(DATAMODEL)
    with pytest.raises(ValidationError, match="嵌套过深"):
        design.model_validate({"root": _chain(FREEFORM_MAX_DEPTH + 5)})


def test_node_cap_enforced():
    design = build_freeform_models(DATAMODEL)
    wide = {"tag": "div", "children": [_leaf("宽树叶") for _ in range(FREEFORM_MAX_NODES + 10)]}
    with pytest.raises(ValidationError, match="节点过多"):
        design.model_validate({"root": wide})


def test_at_limit_not_rejected():
    """上限以内不误伤（深度恰好达上限、节点数远小于上限）。"""
    design = build_freeform_models(DATAMODEL)
    design.model_validate({"root": _chain(FREEFORM_MAX_DEPTH - 1)})


def test_bounds_match_frontend():
    """双侧常量必须同值——前端 block-registry.tsx 是纵深防御第二道。"""
    registry = (
        Path(__file__).resolve().parent.parent.parent
        / "client/src/pages/sliderule/live-runtime/block-registry.tsx"
    ).read_text(encoding="utf-8")
    assert f"FREEFORM_MAX_DEPTH = {FREEFORM_MAX_DEPTH}" in registry
    assert f"FREEFORM_MAX_NODES = {FREEFORM_MAX_NODES}" in registry
