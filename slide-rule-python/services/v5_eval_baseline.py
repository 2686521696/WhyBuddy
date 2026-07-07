"""v5_eval_baseline — 五系统生成评测的基线比对（路线 3 · D4）。

评测脚本用 --json-out 固化一次全量运行为基线 JSON；下次运行用 --baseline
指向它，本模块逐域比对，只报**回归**（变差），不为持平/变好发奖：

severity 语义（与 v5_content_quality 对齐）：
  fail — 基线没有、这次出现的硬退步：生成失败、Gate 失败、内容质量
         hard-fail 数上升。参与 --content-gate 退出码。
  warn — 深度退步趋势：judge 均分跌 ≥1.0、warn 数增 ≥2、judge 从有到失败。
  info — 备查：域缺失/新增（对比口径变了，不算质量回归）。

诚实边界：
- judge 分数有同模型自恋偏差 + 采样噪音，所以阈值取 1.0（一个量表档位）
  而非 0.1；跌不到一档不报。
- 只依赖两份 JSON 的公共结构（domains[].name/generated/gate_passed/
  content/judge），字段缺失按"无数据"跳过该项比对，绝不猜。

纯函数：两份 dict 进、结论出，无副作用。
"""

from __future__ import annotations

from typing import Any, Dict, List

JUDGE_DROP_THRESHOLD = 1.0  # 一个量表档位；低于此为噪音
WARN_INCREASE_THRESHOLD = 2


def _finding(code: str, severity: str, detail: str) -> Dict[str, str]:
    return {"code": code, "severity": severity, "detail": detail}


def _domains_by_name(payload: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    domains = payload.get("domains") if isinstance(payload, dict) else None
    for d in domains if isinstance(domains, list) else []:
        if isinstance(d, dict) and isinstance(d.get("name"), str):
            out[d["name"]] = d
    return out


def _warn_count(domain: Dict[str, Any]) -> int:
    content = domain.get("content")
    if not isinstance(content, dict):
        return 0
    findings = content.get("findings")
    if not isinstance(findings, list):
        return 0
    return sum(1 for f in findings if isinstance(f, dict) and f.get("severity") == "warn")


def _hard_fail_count(domain: Dict[str, Any]) -> int:
    content = domain.get("content")
    if not isinstance(content, dict):
        return 0
    try:
        return int(content.get("hardFailCount") or 0)
    except (TypeError, ValueError):
        return 0


def _judge_avg(domain: Dict[str, Any]) -> float | None:
    judge = domain.get("judge")
    if not isinstance(judge, dict):
        return None
    try:
        return float(judge.get("avg"))
    except (TypeError, ValueError):
        return None


def compare_eval_baseline(current: Dict[str, Any], baseline: Dict[str, Any]) -> Dict[str, Any]:
    """逐域比对当前评测与基线。返回 {findings, regressionFailCount, comparedDomains}。"""
    findings: List[Dict[str, str]] = []
    cur = _domains_by_name(current)
    base = _domains_by_name(baseline)

    compared = 0
    for name, b in base.items():
        c = cur.get(name)
        if c is None:
            findings.append(
                _finding("DOMAIN_MISSING", "info", f"域「{name}」在基线里有、本次未运行——对比口径不完整")
            )
            continue
        compared += 1

        # ---- 硬退步（fail）---------------------------------------------------
        if b.get("generated") and not c.get("generated"):
            findings.append(
                _finding("GENERATION_REGRESSION", "fail", f"域「{name}」基线生成成功，本次生成失败")
            )
            continue  # 没有模型，后面的内容比对无意义
        if b.get("gate_passed") and not c.get("gate_passed"):
            findings.append(
                _finding("GATE_REGRESSION", "fail", f"域「{name}」基线 Gate 通过，本次 Gate 失败")
            )
        b_fail, c_fail = _hard_fail_count(b), _hard_fail_count(c)
        if c_fail > b_fail:
            findings.append(
                _finding(
                    "HARD_FAIL_REGRESSION",
                    "fail",
                    f"域「{name}」内容质量 hard-fail 从 {b_fail} 升到 {c_fail}",
                )
            )

        # ---- 趋势退步（warn）-------------------------------------------------
        b_warn, c_warn = _warn_count(b), _warn_count(c)
        if c_warn - b_warn >= WARN_INCREASE_THRESHOLD:
            findings.append(
                _finding(
                    "WARN_COUNT_UP",
                    "warn",
                    f"域「{name}」内容质量 warn 从 {b_warn} 升到 {c_warn}（阈值 +{WARN_INCREASE_THRESHOLD}）",
                )
            )
        b_avg, c_avg = _judge_avg(b), _judge_avg(c)
        if b_avg is not None and c_avg is not None and b_avg - c_avg >= JUDGE_DROP_THRESHOLD:
            findings.append(
                _finding(
                    "JUDGE_SCORE_DROP",
                    "warn",
                    f"域「{name}」LLM 评审均分从 {b_avg} 跌到 {c_avg}（阈值 -{JUDGE_DROP_THRESHOLD}）",
                )
            )
        elif b_avg is not None and c_avg is None and c.get("judge_attempted"):
            findings.append(
                _finding("JUDGE_UNAVAILABLE", "warn", f"域「{name}」基线有 LLM 评审分，本次评审失败（fail-closed）")
            )

    for name in cur:
        if name not in base:
            findings.append(
                _finding("DOMAIN_NEW", "info", f"域「{name}」为本次新增，基线无对照")
            )

    return {
        "findings": findings,
        "regressionFailCount": sum(1 for f in findings if f["severity"] == "fail"),
        "comparedDomains": compared,
    }
