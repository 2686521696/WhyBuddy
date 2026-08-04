# -*- coding: utf-8 -*-
"""闭环相关性校验：产出的模型到底是不是**这道题**的产出。

## 为什么需要这个

闭环判定原先只数「6 个技能证据齐不齐」，不看证据的内容。于是 2026-08-04 这轮
出现了：用户要「中小学课后托管」，上游 LLM 网关偶发 400 → agentic-pick 回落
规则版 → 没跑建模链路 → 舞台回退渲染内置的「员工请假管理」样板 → 6 项证据
数量齐全 → 判 `closed 6/6` 交付。模型自己在收口总结里写了「尚未证实已实现
学生、班次、排班、签到签退和托管账单」，但那句话不参与任何判定。

## 做法来源

骨架照 RAGAS 的 `NonLLMContextRecall`（src/ragas/metrics/_context_recall.py）：
对 reference 里的每一项，在 retrieved 里取**最大**相似度，再平均成覆盖率，
拿阈值卡。这里的对应关系是：

    reference_contexts  →  目标拆出来的业务点（"登记学生和托管班次"…）
    retrieved_contexts  →  模型里的实体名 + 页面名（"就餐老人"、"每日菜单"…）

输出契约照 DeepEval 的 `AnswerRelevancyMetric`
（deepeval/metrics/answer_relevancy/answer_relevancy.py）：`score` /
`threshold` / `passed` / `reason` 四件套——判定要能自解释，光给个 bool
排查不了。

**必须是 non-LLM 的**：这条校验的主要触发场景就是「LLM 挂了导致降级」，
再调一次 LLM 判相关性等于循环依赖，故障时必然一起失效。所以全程纯字符串
计算，零依赖（环境里没有 jieba / rapidfuzz，也不为这个引）。

## 相似度为什么用非对称包含度而不是 Dice

中文没有空格分词，用字符 bigram。但实体名（"就餐老人"，3 个 bigram）通常比
目标短语（"登记就餐老人"，5 个 bigram）短，对称的 Dice 会被长度差稀释。
改成「短的那个有多少比例被长的覆盖」——`|A∩B| / min(|A|,|B|)`。

## 参数是标定出来的，不是拍的

标定集：App Store 里 6 个真实落库应用（邻里食安/暖食通×2/心桥咨询/安消巡管/
绘本借阅）当正例，它们两两错配出 24 个负例对，外加 2026-08-04 跑歪那次的
真实数据（课后托管的目标 × 内置请假样板）。实测：

    公式          单项阈值   正例覆盖率最低   错配对最高   真实负例
    Dice          0.5        0.50            —           0.00
    包含度        0.3        0.80            —           0.14
    包含度        0.5        0.71            0.00        0.14   ← 选它

选包含度 + 单项 0.5：正例最低 0.71，24 个错配对**全部 0.00**，真实负例 0.14。
覆盖率阈值取 0.5，落在 0.14 与 0.71 之间，两边各留 0.36 / 0.21 的余量。
Dice 虽然负例更干净，但正例最低只有 0.50，贴着阈值没余量，弃用。

标定脚本与数据见提交说明；重标定时把阈值连同上表一起改，别只改数字。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Sequence

# ── 标定出来的参数（改动请重跑标定，见模块头） ──
TERM_HIT_THRESHOLD = 0.5
"""单个业务点算「被覆盖」的相似度门槛。"""

COVERAGE_THRESHOLD = 0.5
"""覆盖率低于此值判定为「产出与题目不符」。同 RAGAS NonLLMContextRecall 默认。"""

MIN_PHRASES = 3
"""目标拆不出 3 个业务点就不判——太短的目标样本量不足，误杀风险高于收益。"""

# 句子切分：中英文标点通吃
_SPLIT_RE = re.compile(r"[，,。：:；;、\n\r\t（）()【】\[\]]+")
# 并列连词：一个分句里常挂多个业务点（"登记学生和托管班次"）
_CONJ_RE = re.compile(r"[和与及跟]")
# 只掐纯功能性套话，绝不碰业务词；"做一套/做一个" 可能出现在句中而非句首
_NOISE_RE = re.compile(r"(^(给|建|开发|搭建)|做一[套个]|^做|一[套个]|系统$|平台$)")
_TIGHTEN_RE = re.compile(r"[\s\-_/]+")


def split_goal_phrases(goal: str) -> List[str]:
    """把目标拆成业务点列表——对应 RAGAS 的 reference_contexts。

    刻意**不做分词**：分词要么引依赖，要么在业务复合词上出错（"刷卡就餐记录"
    会被切碎）。按标点+并列连词切到短语粒度就够了，而且短语粒度恰好就是我们
    想校验的东西——「这个业务点做了没有」。
    """
    out: List[str] = []
    for seg in _SPLIT_RE.split(goal or ""):
        for part in _CONJ_RE.split(seg.strip()):
            part = _NOISE_RE.sub("", part.strip()).strip()
            if len(part) >= 2:
                out.append(part)
    return out


def _bigrams(text: str) -> set:
    tight = _TIGHTEN_RE.sub("", (text or "").lower())
    if len(tight) < 2:
        return {tight} if tight else set()
    return {tight[i:i + 2] for i in range(len(tight) - 1)}


def containment(a: str, b: str) -> float:
    """非对称包含度：短的那个有多少比例被长的覆盖。见模块头「为什么不用 Dice」。"""
    ba, bb = _bigrams(a), _bigrams(b)
    if not ba or not bb:
        return 0.0
    return len(ba & bb) / min(len(ba), len(bb))


def collect_model_terms(model: Any) -> List[str]:
    """从五系统模型里取实体名与页面名——对应 RAGAS 的 retrieved_contexts。

    只取 name 不取 id：id 常是拼音/英文短码（`leave_request`），跟中文目标
    比对没有意义，反而会引入噪声匹配。
    """
    terms: List[str] = []
    if not isinstance(model, dict):
        return terms
    datamodel = model.get("datamodel")
    if isinstance(datamodel, dict):
        for entity in datamodel.get("entities") or []:
            if isinstance(entity, dict) and str(entity.get("name") or "").strip():
                terms.append(str(entity["name"]).strip())
    page = model.get("page")
    if isinstance(page, dict):
        for pg in page.get("pages") or []:
            if isinstance(pg, dict) and str(pg.get("name") or "").strip():
                terms.append(str(pg["name"]).strip())
    return terms


def goal_coverage(goal: str, terms: Sequence[str]) -> Dict[str, Any]:
    """覆盖率判定。返回 DeepEval 风格的自解释结果。

    `applicable=False` 表示样本不足以判定（目标太短或模型没有可比对的名字），
    调用方应当**放行**——这条校验只负责抓「明确不相关」，不负责在信息不足时
    替别人下结论。
    """
    phrases = split_goal_phrases(goal)
    usable = [t for t in terms if str(t).strip()]

    if len(phrases) < MIN_PHRASES or not usable:
        return {
            "applicable": False,
            "score": 1.0,
            "threshold": COVERAGE_THRESHOLD,
            "passed": True,
            "matched": [],
            "missing": [],
            "reason": (
                f"样本不足以判定相关性（业务点 {len(phrases)} 个 < {MIN_PHRASES}"
                f"，模型可比对名称 {len(usable)} 个），跳过。"
            ),
        }

    matched: List[Dict[str, Any]] = []
    missing: List[Dict[str, Any]] = []
    for phrase in phrases:
        best_score, best_term = 0.0, ""
        for term in usable:
            s = containment(phrase, term)
            if s > best_score:
                best_score, best_term = s, term
        item = {"phrase": phrase, "score": round(best_score, 3), "matchedBy": best_term}
        (matched if best_score >= TERM_HIT_THRESHOLD else missing).append(item)

    score = len(matched) / len(phrases)
    passed = score >= COVERAGE_THRESHOLD
    if passed:
        reason = f"目标的 {len(phrases)} 个业务点覆盖了 {len(matched)} 个（{score:.0%}）。"
    else:
        gaps = "、".join(m["phrase"] for m in missing[:5])
        reason = (
            f"产出与题目不符：目标的 {len(phrases)} 个业务点只覆盖了 {len(matched)} 个"
            f"（{score:.0%} < {COVERAGE_THRESHOLD:.0%}）。未见落实：{gaps}。"
        )
    return {
        "applicable": True,
        "score": round(score, 3),
        "threshold": COVERAGE_THRESHOLD,
        "passed": passed,
        "matched": matched,
        "missing": missing,
        "reason": reason,
    }


def evaluate_model_relevance(goal: str, model: Any) -> Dict[str, Any]:
    """对外入口：目标 vs 五系统模型的相关性。"""
    return goal_coverage(goal, collect_model_terms(model))
