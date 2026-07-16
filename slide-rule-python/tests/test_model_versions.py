"""E29 增量迭代 + 版本前进/回退：生成层精修/直供上下文、版本快照、闭环取模。"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.v5_state import V5SessionState  # noqa: E402
from services import v5_llm_generate as gen  # noqa: E402
from services.v5_full_driver import (  # noqa: E402
    extract_model_from_closure,
    record_model_version,
)

MODEL = {
    "datamodel": {"entities": [{"id": "e1", "name": "学生", "fields": ["name"]}]},
    "workflow": {"nodes": [{"id": "n1"}], "transitions": []},
    "rbac": {"roles": ["管理员"], "permissions": []},
    "page": {"pages": [{"id": "p1", "name": "首页"}]},
    "aigc": {"capabilities": []},
    "appbundle": {"pageBindings": [], "roleRefs": ["管理员"], "dataModelRefs": ["e1"]},
}


def _closure_with(model):
    return {
        "blocked": False,
        "perSkillEvidence": {
            **{k: {"evidencePresent": True, "modelSection": v} for k, v in model.items()},
        },
    }


def teardown_function(_fn):
    gen.set_refine_context(None)
    gen.set_model_override(None)


def test_extract_model_from_closure_roundtrip():
    assert extract_model_from_closure(_closure_with(MODEL)) == MODEL
    broken = _closure_with(MODEL)
    del broken["perSkillEvidence"]["rbac"]["modelSection"]
    assert extract_model_from_closure(broken) is None  # 缺段如实返回 None


def test_record_model_version_appends_and_dedupes():
    state = V5SessionState(sessionId="mv", goal={"text": "g"})
    record_model_version(state, _closure_with(MODEL), "初次生成")
    assert len(state.modelVersions) == 1
    assert state.modelVersions[0]["id"] == "mv-1"
    # 模型没变 → 不追加（与设计无关的追问不刷版本）
    record_model_version(state, _closure_with(MODEL), "再问一句")
    assert len(state.modelVersions) == 1
    # 模型变化 → 追加 v2，携带指令
    changed = {**MODEL, "rbac": {"roles": ["管理员", "家长"], "permissions": []}}
    record_model_version(state, _closure_with(changed), "加一个家长角色")
    assert len(state.modelVersions) == 2
    assert state.modelVersions[1]["instruction"] == "加一个家长角色"
    assert state.modelVersions[1]["model"]["rbac"]["roles"] == ["管理员", "家长"]
    # 指针跟随最新版本（前进/回退按钮的锚点）
    assert state.currentModelVersionId == "mv-2"


def test_model_override_supplies_generate_without_llm():
    gen.set_model_override(MODEL)
    out = gen.generate_five_system_model("任意意图")
    assert out == MODEL  # 直供：不调 LLM 原样返回（回退路径）


def test_refine_context_lands_in_prompt():
    gen.set_refine_context(MODEL, "把角色系统加一个家长端")
    content = gen._build_user_content("做一个课后托管系统")
    assert "REFINE MODE" in content
    assert "把角色系统加一个家长端" in content
    assert "学生" in content  # 现有模型 JSON 注入
    gen.set_refine_context(None)
    assert "REFINE MODE" not in gen._build_user_content("做一个课后托管系统")
