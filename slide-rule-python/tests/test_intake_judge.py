"""入站判定闸门哨兵（2026-07-27）。

全部离线：LLM 调用走注入的假函数，确定性层直接跑。真实准确率由
scripts/eval_intake_judge.py 对真网关跑 JSONL 用例集来量（当前 35/36，
误拦真需求 0），那个不进 CI。

这里锁的是**不能退化的纪律**，不是准确率：
- fail-open：判定挂了一律放行
- 确定性层绝不误伤真需求/真迭代
- 判决与会话状态矛盾时以状态为准
- 第一版永远不阻断
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import intake_judge as ij


# ── fail-open：闸门坏了不能变成产品坏了 ────────────────────────────

@pytest.mark.parametrize("boom", [
    RuntimeError("gateway 502"),
    ValueError("invalid json"),
    TimeoutError("read timeout"),
])
def test_llm_failure_always_passes_through(boom):
    def raiser(_messages):
        raise boom

    j = ij.judge_turn("一个正经的业务需求描述", has_app=False, llm_json_fn=raiser)
    assert j.action == "proceed"
    assert j.verdict == "real"
    assert j.source == "degraded"
    assert type(boom).__name__ in j.degraded_reason


def test_malformed_llm_payload_passes_through():
    """返回值不是对象、verdict 非法——都不能把用户挡住。"""
    for payload in ({"verdict": "banana", "reason": "", "confidence": 1}, ["not", "a", "dict"], None):
        j = ij.judge_turn("给这个应用加个报表页", has_app=True, llm_json_fn=lambda _m, p=payload: p)
        assert j.action == "proceed", f"payload={payload!r} 把用户挡住了"
        assert j.verdict == "iteration"  # 有应用时的放行侧判决


def test_disabled_by_env_passes_through(monkeypatch):
    monkeypatch.setenv(ij._ENABLED_ENV, "0")
    j = ij.judge_turn("你好", has_app=False)
    assert j.action == "proceed" and j.source == "degraded"


# ── 确定性层：只挡闭眼都知道的，绝不误伤 ──────────────────────────

@pytest.mark.parametrize("text", [
    "做个系统",                      # 模糊但是真意图 → 该交给 LLM
    "把侧栏改成深色",                 # 真迭代
    "我们店里排班总是乱，想弄个东西管一管",  # 真需求（旧启发式漏判过）
    "帮我把公司报销流程数字化",
    "你是谁",                        # 3 字 meta——阈值曾经把它误判成 vague
])
def test_precheck_never_swallows_meaningful_input(text):
    assert ij.precheck(text) is None, f"确定性层误伤了 {text!r}"


@pytest.mark.parametrize("text,verdict", [
    ("你好", "meta"), ("在吗", "meta"), ("hello", "meta"),
    ("？？？", "vague"), ("   ", "vague"), ("", "vague"),
])
def test_precheck_catches_obvious_noise(text, verdict):
    hit = ij.precheck(text)
    assert hit is not None and hit.verdict == verdict
    assert hit.source == "precheck"
    assert hit.guidance, "确定性层拦下也必须给引导，不能只说不行"


# ── 判决与会话状态一致 ────────────────────────────────────────────

def test_verdict_reconciled_with_session_state():
    """空会话不可能是 iteration，有应用不可能是 real——模型判反了以状态为准。"""
    payload = {"verdict": "iteration", "reason": "x", "confidence": 0.9}
    assert ij.judge_turn("社区宠物诊所预约系统", has_app=False, llm_json_fn=lambda _m: payload).verdict == "real"
    payload2 = {"verdict": "real", "reason": "x", "confidence": 0.9}
    assert ij.judge_turn("给这个应用加个报表页", has_app=True, llm_json_fn=lambda _m: payload2).verdict == "iteration"


def test_rules_are_scoped_to_session_state():
    """空会话的 prompt 里不该出现迭代规则，反之亦然——这是「每轮只送相关
    规则」的实现依据，规则增长时干扰面才不会扩大。"""
    new_ids = {r.id for r in ij._applicable_rules(has_app=False)}
    app_ids = {r.id for r in ij._applicable_rules(has_app=True)}
    assert "new_business_need" in new_ids and "iteration_on_current_app" not in new_ids
    assert "iteration_on_current_app" in app_ids and "new_business_need" not in app_ids
    assert {"meta_product_question", "off_topic_chitchat"} <= new_ids & app_ids


def test_prompt_carries_app_summary_when_present():
    """判「是不是真迭代」必须知道当前应用是什么，否则「加个杯测记录」无从判断。"""
    msgs = ij.build_messages("加个评分分布图", has_app=True, app_summary="焙鉴工坊：生豆库存与杯测")
    assert "焙鉴工坊" in msgs[0]["content"]
    assert "iteration" in msgs[0]["content"] and "real" not in msgs[0]["content"].split("判定类别")[1][:200]


# ── 第一版不阻断 ──────────────────────────────────────────────────

@pytest.mark.parametrize("verdict", ["real", "iteration", "vague", "off_topic", "meta"])
def test_first_version_never_blocks(verdict):
    """任何判决都只产出 proceed/hint。要改成硬拦得显式动 _resolve_action，
    不能因为调了个阈值就悄悄把人挡在门外。"""
    assert ij._resolve_action(verdict, 1.0) in ("proceed", "hint")


def test_low_confidence_does_not_nag():
    """模型自己都不确定就别打扰用户——低于地板一律放行。"""
    assert ij._resolve_action("off_topic", 0.2) == "proceed"
    assert ij._resolve_action("off_topic", 0.95) == "hint"
    assert ij._resolve_action("real", 0.1) == "proceed"


# ── 评测用例集本身的完整性 ────────────────────────────────────────

def test_eval_cases_are_wellformed():
    """用例集是判断"能不能开阻断"的唯一依据，它自己坏了就没有依据了。"""
    path = Path(__file__).parent / "data" / "intake_judge_cases.jsonl"
    rows = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(rows) >= 30, "用例太少，误判率没有统计意义"
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)), "用例 id 重复"
    for r in rows:
        assert r["expect"] in ij._VALID_VERDICTS, f"{r['id']} 期望值非法"
        assert isinstance(r.get("hasApp"), bool), f"{r['id']} 缺 hasApp"
    # 五类都要有覆盖，且放行侧（真需求/真迭代）样本要够——误拦是最贵的错误
    by = {v: sum(1 for r in rows if r["expect"] == v) for v in ij._VALID_VERDICTS}
    assert all(by[v] >= 3 for v in by), f"某类样本不足: {by}"
    assert by["real"] + by["iteration"] >= 15, f"放行侧样本不足: {by}"
