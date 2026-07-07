"""基线比对（路线 3 · D4）的单元测试 —— 纯 dict 进出，零 LLM。

覆盖：无回归、生成/Gate/hard-fail 三类回归级 fail、judge 均分跌一档、
warn 数增阈值、judge 从有到失败、域缺失/新增 info、字段缺失不猜。
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.v5_eval_baseline import compare_eval_baseline  # noqa: E402


def _domain(
    name="连锁健身房",
    generated=True,
    gate_passed=True,
    hard_fails=0,
    warns=0,
    judge_avg=4.0,
    judge_attempted=True,
):
    d = {
        "name": name,
        "generated": generated,
        "gate_passed": gate_passed,
        "content": {
            "hardFailCount": hard_fails,
            "findings": [{"code": f"W{i}", "severity": "warn", "detail": "x"} for i in range(warns)],
        },
        "judge": {"avg": judge_avg, "dims": {}} if judge_avg is not None else None,
    }
    if judge_attempted:
        d["judge_attempted"] = True
    return d


def _payload(*domains):
    return {"generatedAt": "2026-07-07 10:00 UTC", "model": "gpt-5.5", "domains": list(domains)}


def test_no_regression_when_equal_or_better():
    base = _payload(_domain(hard_fails=1, warns=2, judge_avg=3.0))
    cur = _payload(_domain(hard_fails=0, warns=1, judge_avg=4.5))  # 全面变好
    result = compare_eval_baseline(cur, base)
    assert result["findings"] == []
    assert result["regressionFailCount"] == 0
    assert result["comparedDomains"] == 1


def test_generation_and_gate_and_hardfail_regressions_are_fail():
    base = _payload(
        _domain(name="a"), _domain(name="b"), _domain(name="c", hard_fails=0)
    )
    cur = _payload(
        _domain(name="a", generated=False),
        _domain(name="b", gate_passed=False),
        _domain(name="c", hard_fails=2),
    )
    result = compare_eval_baseline(cur, base)
    codes = {f["code"] for f in result["findings"]}
    assert {"GENERATION_REGRESSION", "GATE_REGRESSION", "HARD_FAIL_REGRESSION"} <= codes
    assert result["regressionFailCount"] == 3
    # 生成失败的域不再叠报内容比对
    assert sum(1 for f in result["findings"] if "「a」" in f["detail"]) == 1


def test_judge_drop_threshold_is_one_scale_step():
    base = _payload(_domain(judge_avg=4.33))
    cur_small_drop = _payload(_domain(judge_avg=3.67))  # 跌 0.66 < 1.0 → 噪音，不报
    assert compare_eval_baseline(cur_small_drop, base)["findings"] == []
    cur_big_drop = _payload(_domain(judge_avg=3.33))  # 跌 1.0 → warn
    result = compare_eval_baseline(cur_big_drop, base)
    assert [f["code"] for f in result["findings"]] == ["JUDGE_SCORE_DROP"]
    assert result["findings"][0]["severity"] == "warn"
    assert result["regressionFailCount"] == 0


def test_warn_count_increase_threshold():
    base = _payload(_domain(warns=1))
    assert compare_eval_baseline(_payload(_domain(warns=2)), base)["findings"] == []  # +1 不报
    result = compare_eval_baseline(_payload(_domain(warns=3)), base)  # +2 → warn
    assert [f["code"] for f in result["findings"]] == ["WARN_COUNT_UP"]


def test_judge_lost_is_warn_only_when_attempted():
    base = _payload(_domain(judge_avg=4.0))
    cur_failed = _payload(_domain(judge_avg=None, judge_attempted=True))
    result = compare_eval_baseline(cur_failed, base)
    assert [f["code"] for f in result["findings"]] == ["JUDGE_UNAVAILABLE"]
    # 本次根本没开 --judge（未 attempted）→ 口径不同，不报
    cur_no_judge = _payload(_domain(judge_avg=None, judge_attempted=False))
    assert compare_eval_baseline(cur_no_judge, base)["findings"] == []


def test_domain_missing_and_new_are_info():
    base = _payload(_domain(name="老域"))
    cur = _payload(_domain(name="新域"))
    result = compare_eval_baseline(cur, base)
    by_code = {f["code"]: f for f in result["findings"]}
    assert by_code["DOMAIN_MISSING"]["severity"] == "info"
    assert by_code["DOMAIN_NEW"]["severity"] == "info"
    assert result["regressionFailCount"] == 0
    assert result["comparedDomains"] == 0


def test_malformed_payloads_do_not_crash():
    assert compare_eval_baseline({}, {})["findings"] == []
    result = compare_eval_baseline(
        {"domains": [{"name": "x", "content": "not-a-dict", "judge": "nope"}]},
        {"domains": [{"name": "x", "content": None, "judge": {"avg": "abc"}}]},
    )
    assert result["regressionFailCount"] == 0
