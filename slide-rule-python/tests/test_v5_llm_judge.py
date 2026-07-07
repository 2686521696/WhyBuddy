"""LLM-as-judge 量表（路线 3 · D2）的单元测试 —— 注入假 llm_json_fn，零真实调用。

覆盖：合法响应解析与均分、prompt 携带意图与模型摘要、分数越界/缺维度/
调用异常一律 fail-closed 返回 None（绝不编分）。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.v5_llm_judge import judge_content_quality  # noqa: E402


MODEL = {
    "datamodel": {"entities": [{"id": "gym_member", "name": "会员", "fields": [{"id": "name", "type": "string"}]}]},
    "rbac": {"roles": ["coach"], "permissions": ["gym_member:read"], "menus": []},
    "workflow": {"nodes": [{"id": "book", "name": "预约", "assigneeRole": "coach"}], "transitions": []},
    "page": {"pages": [{"id": "p1", "name": "会员页", "actionPermissions": ["gym_member:read"]}]},
    "aigc": {"capabilities": [{"id": "cap1", "name": "排期建议"}]},
}

GOOD_RESPONSE = {
    "requirement_coverage": {"score": 4, "reasons": ["覆盖了私教排期"], "missed": ["器材保养未建模"]},
    "domain_sense": {"score": 5, "reasons": ["流程符合健身房惯例"]},
    "naming_quality": {"score": 3, "reasons": ["gym_member 具体，cap1 偏泛"]},
}


def test_valid_response_parses_scores_and_avg():
    captured = {}

    def fake(messages):
        captured["messages"] = messages
        return GOOD_RESPONSE

    result = judge_content_quality(MODEL, "做一个连锁健身房管理系统", llm_json_fn=fake)
    assert result is not None
    assert result["dims"]["requirement_coverage"]["score"] == 4
    assert result["dims"]["requirement_coverage"]["missed"] == ["器材保养未建模"]
    assert result["dims"]["domain_sense"]["score"] == 5
    assert result["avg"] == 4.0
    # prompt 带上了意图与模型摘要（实体/角色名在 user 消息里）
    user_msg = captured["messages"][-1]["content"]
    assert "连锁健身房" in user_msg
    assert "gym_member" in user_msg
    assert "coach" in user_msg


def test_out_of_range_score_fails_closed():
    bad = {**GOOD_RESPONSE, "domain_sense": {"score": 9, "reasons": ["?"]}}
    assert judge_content_quality(MODEL, "x", llm_json_fn=lambda m: bad) is None


def test_missing_dimension_fails_closed():
    bad = {k: v for k, v in GOOD_RESPONSE.items() if k != "naming_quality"}
    assert judge_content_quality(MODEL, "x", llm_json_fn=lambda m: bad) is None


def test_llm_exception_fails_closed():
    def boom(messages):
        raise RuntimeError("provider down")

    assert judge_content_quality(MODEL, "x", llm_json_fn=boom) is None


def test_reasons_capped_and_coerced():
    noisy = {
        "requirement_coverage": {"score": "5", "reasons": ["a", "b", "c", "d", "e"], "missed": []},
        "domain_sense": {"score": 4, "reasons": [123, None, {"x": 1}, "ok"]},
        "naming_quality": {"score": 4, "reasons": []},
    }
    result = judge_content_quality(MODEL, "x", llm_json_fn=lambda m: noisy)
    assert result is not None
    assert result["dims"]["requirement_coverage"]["score"] == 5  # 字符串数字可接受
    assert len(result["dims"]["requirement_coverage"]["reasons"]) == 3  # cap 3
    assert result["dims"]["domain_sense"]["reasons"] == ["123", "ok"]  # 非法项剔除
