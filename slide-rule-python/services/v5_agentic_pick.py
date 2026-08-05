"""Agentic pick（F2 实验，2026-07-15）：LLM 提案下一批能力，确定门验收。

北极星语境：V5.2 的 pick_next_capabilities 是纯规则挑选（关键词路由 +
缺啥补啥 + 冷启动兜底），LLM 在推演循环里只在盒子内填空、没有驾驶权
——这是「IM 照本宣科」观感的直接来源。本模块把"下一步干什么"这一个
决策点让给 LLM，但保持三条不变量（门裁决）：

  1. 收敛权仍归规则：规则版 pick 为空 → 本轮照旧收敛，LLM 无权续命；
     LLM 提案只在规则版非空时才可能替换它（选材自主，停机确定）。
  2. 词表封闭：提案里的 capabilityId 必须在 V5.2 能力词表内，roleId
     必须在四角色内——幻觉能力/角色直接剔除。
  3. fail-open 回落：LLM 停用/失败/提案全被剔除 → 返回 None，调用方
     沿用规则版结果。

E32 转正（2026-07-17，用户拍板）：十话题双模式对比 + LLM judge 内容
质量评测 4:0 胜出后，SLIDERULE_AGENTIC_PICK 默认从 off 切到 on——
未设置 = 开；显式 off/0/false/no = 回到纯规则版。三条不变量不动，
LLM 不可用时行为与老规则版逐字节一致（fail-open）。

对比评测跑法见 scripts/agentic_pick_eval.py（十话题双模式指标对比）。
"""

from __future__ import annotations

import os
from typing import Any, Optional

from models.v5_state import V5SessionState

# ── V5.2 能力词表（与 slide_rule_session.pick_next_capabilities 的产出
#    全集一致；中文注解给 LLM 读）─────────────────────────────────────

CAPABILITY_VOCAB: dict[str, str] = {
    "gap.ask": "识别信息缺口并向用户提问（澄清需求）",
    "intent.clarify": "细化模糊意图为明确目标",
    "intent.parse": "解析用户意图结构",
    "structure.decompose": "把目标分解成规格树（spec tree）",
    "evidence.search": "检索外部证据（RAG/搜索）支撑结论",
    "repo.inspect": "检查代码仓库（有 GitHub/GitLab 链接时）",
    "risk.analyze": "分析关键风险与分歧点",
    "route.generate": "生成可选实现路线",
    "route.compare": "对比路线优劣并给出建议",
    "scenario.simulate": "沙盘推演关键场景",
    "critique.generate": "生成批判性质疑（红队视角）",
    "counter.argue": "对既有结论提出反方论证",
    "synthesis.merge": "综合多方产物成统一结论",
    "report.write": "撰写可行性/结论报告",
    "document.draft": "起草交付文档",
    "traceability.matrix": "生成需求-实现追溯矩阵",
    "task.write": "拆写可执行任务清单",
    "instruction.package": "打包提示词/指令包",
    "outcome.visualize": "可视化成果（图表/结构图）",
    "handoff.package": "打包最终交接物",
    # 收口能力（agentic 独有解锁）：规则版 pick 从不产出它——真实产品里
    # 装配闭环由前端流程触发；给 LLM 这个选项 = 让它自己判断「该收口了」。
    # 门保持 fail-closed：证据不齐装配照样 blocked，提案无法作弊。
    #
    # ⚠ 2026-08-04 改写措辞。原文是「…证据不齐会被门拦下——**收口前先确保
    # 证据充分**」，它跟 _state_digest 里那句「提案收口没有惩罚，拖到轮次
    # 耗尽才有」**直接打架**，而且打架的这句就挂在能力本身上——模型正是在
    # 决定要不要选它的时候读到这句。
    #
    # 真机后果（同一个题连跑三轮，第三轮）：loop-4/loop-5 连着两轮写
    # 「当前证据不足，不进入运行时装配」，六轮跑满从没选过收口，最后被
    # awaitReason=max_loops 强停，evidence 0/6、blocked、一个应用都没落库。
    # 而前两轮同样的输入是出了应用的——**两成一败**。
    #
    # 现在如实说：收口早了顶多是 blocked（用户至少看得到进度和拦下的理由），
    # 拖到轮次耗尽是同样的 blocked **外加什么都没有**。后者严格更差，所以
    # 不该让"再补一轮证据"看起来永远是更安全的选择。
    "appbundle.runtimeclosure": "装配运行时闭环，收口出应用。证据齐则出应用；不齐则如实标 blocked 并说明缺什么——**这也是一种交付**，比拖到轮次耗尽什么都没有好",
}

ROLE_VOCAB = ("产品", "架构", "工程", "综合")

# 能力 → 缺省角色（LLM 给了非法角色时的纠偏映射，与规则版口径一致）
_DEFAULT_ROLE: dict[str, str] = {
    "gap.ask": "产品",
    "intent.clarify": "产品",
    "intent.parse": "产品",
    "task.write": "产品",
    "structure.decompose": "架构",
    "outcome.visualize": "架构",
    "route.generate": "架构",
    "route.compare": "架构",
    "document.draft": "工程",
    "instruction.package": "工程",
    "handoff.package": "工程",
    "repo.inspect": "工程",
}

_MAX_PICKS = 5  # 与规则版 cap<=5 同口径


def agentic_pick_enabled() -> bool:
    # E32 默认 on（评测 4:0 转正）；显式 off 才回纯规则版
    return str(os.getenv("SLIDERULE_AGENTIC_PICK", "on")).strip().lower() not in (
        "off",
        "0",
        "false",
        "no",
    )


# ── 状态摘要（LLM 的"仪表盘"：让它看见全局再提案）──────────────────────


def _artifact_kind_counts(state: V5SessionState) -> dict[str, int]:
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    counts: dict[str, int] = {}
    for a in getattr(state, "artifacts", []) or []:
        if isinstance(a, dict):
            aid, kind, tl = a.get("id"), a.get("kind"), a.get("trustLevel")
        else:
            aid = getattr(a, "id", None)
            kind = getattr(a, "kind", None)
            tl = getattr(a, "trustLevel", None)
        if not kind or aid in stales:
            continue
        if tl in ("gated_pass", "audited"):
            counts[kind] = counts.get(kind, 0) + 1
    return counts


def _progress_line(loop_index: int, max_loops: int) -> str:
    """进度 + **随轮次递进**的收口压力（2026-08-04）。

    原来是一句不变的话（"过半仍未装配闭环应认真考虑收口…"）。问题是它从第 1 轮
    到第 6 轮说得一模一样——第 6 轮的紧迫程度和第 1 轮显然不是一回事，而模型
    只看得到同一句提醒。真机第三轮就是这么跑没的：六轮跑满、一次都没选收口、
    被 max_loops 强停，evidence 0/6，什么都没交付。

    所以按剩余轮次分三档说话。最后一轮说得最重——那时候"再补一轮"这个选项
    **已经不存在了**，可原来的措辞完全没体现这一点。
    """
    remaining = max_loops - loop_index - 1
    base = f"【进度】第 {loop_index + 1}/{max_loops} 轮"
    if remaining <= 0:
        return (
            base + "（**这是最后一轮**。没有下一轮了：这一轮不提案收口，"
            "本次推演就会以 max_loops 强停收场——evidence 0/6、blocked、"
            "用户一个应用都拿不到。证据不齐也要收，门会如实标出缺什么，"
            "那仍然是有内容的交付。）"
        )
    if remaining <= 2:
        return (
            base + f"（只剩 {remaining} 轮。到这一步应当**优先考虑收口**而不是"
            "再补一轮证据：收口早了顶多被门标 blocked 并说明缺什么，拖到轮次"
            "耗尽是同样的 blocked 外加什么都没有——后者严格更差。）"
        )
    return (
        base + "（收口感知：过半仍未装配闭环应认真考虑收口——证据不齐门会拦下"
        "并如实标 blocked，提案收口没有惩罚，拖到轮次耗尽才有）"
    )


def _closure_line(state: V5SessionState) -> str:
    """闭环当前是什么状态（2026-08-04）。

    ## 为什么必须有这一行

    真机：模型在 **loop-3 选了收口（成功，出 v1）、loop-4 又选了一次（出 v2）**。
    每选一次就是一整套——重新生成五系统模型、生图（实测 100~260s）、取色、
    设计首页、落库。两次就是两套，一轮推演的时间直接翻倍。

    它不是乱选。从模型的视角这个决定完全理性：`_progress_line` 正在按剩余轮次
    催它收口，而**状态摘要里没有任何一处告诉它"你已经收过了、成功了"**——
    `【已执行能力序列】` 只给能力名、不带结果。催促加强了，"已经做完"这个事实
    却没同步过去。

    这是 2026-08-04 那次措辞改动（鼓励尽早收口）留下的缺口：那次改对了"从不
    收口"这个真问题，但没把配套的状态回传补上。**两处各自合理，凑一起漏了一个
    信息。**

    ## 措辞取向

    已收口时明说"不需要再收一次"，但**留一个出口**——"除非有新的补充需求"。
    不能把话说死成"禁止再选"：用户带着新要求继续推演时，精修出 v2 是正当的
    （那条路径本来就存在，见 v5_full_driver 的 refine 分支）。要挡的是**没有
    新需求却重复收口**，不是所有的第二次。
    """
    pc = getattr(state, "publishClosure", None)
    if not isinstance(pc, dict) or not pc:
        return "【闭环状态】尚未收口——本次推演还没有产出应用。"
    blocked = bool(pc.get("blocked"))
    present = pc.get("evidencePresentCount")
    total = pc.get("skillCount")
    tally = f"{present}/{total}" if present is not None and total else "—"
    if blocked:
        return (
            f"【闭环状态】收过一次但被拦下（blocked，证据 {tally}）。"
            "补齐缺的那几项之后可以再收一次。"
        )
    return (
        f"【闭环状态】**已成功收口**（closed，证据 {tally}），应用已经产出。"
        "除非用户带来新的补充需求，**不需要再选一次收口**——重复收口会把整套"
        "模型生成、生图与首页设计再跑一遍，而产出跟已有的这版没有实质差别。"
    )


def _state_digest(state: V5SessionState, user_text: str, loop_index: int, max_loops: int = 6) -> str:
    goal = state.goal if isinstance(state.goal, dict) else {}
    kinds = _artifact_kind_counts(state)
    runs = getattr(state, "capabilityRuns", []) or []
    recent = [
        (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        for r in runs[-8:]
    ]
    open_qs = [
        str(q.get("text") if isinstance(q, dict) else q)[:60]
        for q in (getattr(state, "openQuestions", []) or [])[:5]
    ]
    gaps = [
        str(g.get("title") or g.get("id") if isinstance(g, dict) else g)[:60]
        for g in (getattr(state, "coverageGaps", []) or [])[:6]
    ]
    lines = [
        f"【本轮用户输入】{(user_text or '').strip()[:300]}",
        f"【目标】{str(goal.get('text') or '')[:200]}（状态 {goal.get('status') or '未定'}）",
        _progress_line(loop_index, max_loops),
        # 紧跟进度之后：进度那句在催收口，这句说清"收过没有、成没成"。
        # 两句必须挨着，隔开了模型容易只看见催促（真机就是这么连收两次的）。
        _closure_line(state),
        f"【已执行能力序列（最近 8 步）】{' → '.join(recent) or '无'}",
        f"【健康产物】{kinds or '无'}；失效产物 {len(getattr(state, 'staleArtifactIds', []) or [])} 件",
        f"【未答问题】{open_qs or '无'}",
        f"【覆盖缺口】{gaps or '无'}",
    ]
    lines.extend(_history_lines(state))
    return "\n".join(lines)


def _history_lines(state: V5SessionState) -> list[str]:
    """把**上几轮自己做过的决定和它的效果**摆到面前（2026-08-04）。

    ## 为什么补这一段

    真机日志（社区消防巡检那次，6 轮 6.4 分钟）：五轮的 rationale 几乎逐字
    相同——

        loop-1  先补齐消防巡检业务与合规依据，再进行红队质疑…
        loop-2  当前需求主线已明确但证据覆盖不足，先补齐关键业务与合规依据…
        loop-3  先补齐消防巡检业务与合规依据，再将需求细化…
        loop-4  先补齐社区消防巡检业务与合规证据，再针对方案风险…
        loop-5  先补齐消防巡检业务与合规依据，再整合现有风险…

    对应到执行：evidence.search 被选中 5 次、synthesis.merge 4 次、
    critique/risk/intent.clarify/structure.decompose 各 2 次。最后是驱动器的
    max_repeat_guard 强行踩的刹车——不是它自己判断够了。整轮结束
    publishClosure 仍是 null：**6.4 分钟、16 次能力调用，一个应用都没交付**。

    ## 缺的到底是什么

    不是"没有历史"——digest 里一直有【已执行能力序列】。缺的是**因果**：

      · 它看得到 evidence.search 跑过，看不到自己上一轮**为什么**选它；
      · 更关键的是看不到那一轮**有没有用**——覆盖缺口是不是少了一个。

    没有这两条，每轮都是从一个长得差不多的状态重新推理一遍，自然得出差不多
    的结论。所以这里补三样：上轮理由原文、缺口有没有推进、以及一句针对
    "重复选"的明确要求。

    ## 为什么不直接禁止重复

    重复本身不是错——证据确实可能要分两次补。禁掉会逼它去挑不该挑的能力。
    这里只要求它**给出新理由**：说不出跟上次的区别，就是在原地转圈。判断留给
    它，证据摆给它看。
    """
    ledger = list(getattr(state, "decisionLedger", []) or [])

    def _get(d, k, default=""):
        return (d.get(k, default) if isinstance(d, dict) else getattr(d, k, default)) or default

    llm_decisions = [d for d in ledger if _get(d, "source") == "llm"]
    if not llm_decisions:
        return []

    out: list[str] = ["【你前几轮的决定（这是你自己说过的话，不是别人的）】"]
    for d in llm_decisions[-3:]:
        chose = _get(d, "chose", []) or []
        why = str(_get(d, "rationale", ""))[:120]
        out.append(f"· {_get(d, 'turnId')}：选了 {'、'.join(chose) or '（空）'}；理由「{why}」")

    # 缺口有没有被推进——上一轮到底有没有用，只有这一条能说明
    gaps = getattr(state, "coverageGaps", []) or []
    resolved = sum(
        1 for g in gaps
        if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None)) == "resolved"
    )
    out.append(f"【上述决定的效果】覆盖缺口已解决 {resolved}/{len(gaps)} 项")

    # 重复计数：只列真的重复了的。没重复就不出这段——凭空提一句"可以重复"
    # 反而是在给它出主意。
    counts: dict[str, int] = {}
    for r in getattr(state, "capabilityRuns", []) or []:
        cap = r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")
        if cap:
            counts[cap] = counts.get(cap, 0) + 1
    repeated = {c: n for c, n in counts.items() if n >= 2}
    if repeated:
        out.append(
            "【已经重复跑过的能力】"
            + "、".join(f"{c}×{n}" for c, n in sorted(repeated.items(), key=lambda kv: -kv[1]))
        )
        out.append(
            "⚠ 上面这些**再选一次就必须说明这次跟上次做的有什么不同**（补哪一块、"
            "为什么上次那次不够）。说不出区别就换别的能力，或者直接收口——重复跑"
            "同一件事既不会让缺口变少，也拖到最后什么都交付不出来。"
        )
    return out


# ── LLM 提案 + 门验收 ─────────────────────────────────────────────────


def _validate_proposal(raw: Any, state: V5SessionState) -> list[dict] | None:
    """验收：词表封闭 + 角色纠偏 + 去重 + 重复护栏 + cap<=5。全灭 → None。"""
    if not isinstance(raw, dict):
        return None
    items = raw.get("picks")
    if not isinstance(items, list):
        return None
    import sys as _sys

    from .repeat_policy import is_repeat_exhausted, reason_allows_repeat

    picks: list[dict] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        cap = str(item.get("capabilityId") or "").strip()
        if cap not in CAPABILITY_VOCAB or cap in seen:
            continue  # 幻觉能力/重复提案剔除
        # 重复护栏：窗口内跑满次数的不许再提——防 LLM 原地打转。
        #
        # 判据搬去 repeat_policy 与驱动器那道门共用（2026-08-05）。此前两边
        # 各写各的：这里数最近 6 次 run，驱动器数**整个会话**，于是同一个
        # 能力可能提案门放行、执行门拦下，白跑一次规划。
        repeat_granted = False
        if is_repeat_exhausted(state, cap):
            why = str(item.get("why") or "").strip()
            # 跑满之后还想要，就得说出这次跟上次有什么不同。提示词一直这么
            # 要求，`why` 字段也一直在传，只是以前没人读——见 repeat_policy。
            if not reason_allows_repeat(state, cap, why):
                continue
            repeat_granted = True
            print(
                f"[agentic-pick] {cap} 已跑满，凭理由放行一次：{why[:80]}",
                file=_sys.stderr, flush=True,
            )
        role = str(item.get("roleId") or "").strip()
        if role not in ROLE_VOCAB:
            role = _DEFAULT_ROLE.get(cap, "综合")
        seen.add(cap)
        pick = {"capabilityId": cap, "roleId": role}
        if repeat_granted:
            # 驱动器那道门排在后面，不带这个标记它会把刚放行的又拦掉——
            # 那就退回"两道门各判各的"的老毛病了。
            pick["repeatGranted"] = True
            pick["why"] = why
        picks.append(pick)
        if len(picks) >= _MAX_PICKS:
            break
    return picks or None


def agentic_pick_next_capabilities(
    state: V5SessionState,
    user_text: str,
    *,
    loop_index: int = 0,
    max_loops: int = 6,
) -> Optional[dict]:
    """LLM 看全局提案下一批能力。返回 {"picks": [...], "rationale": str}；
    停用/失败/提案全被门剔除 → None（调用方回落规则版）。"""
    if not agentic_pick_enabled():
        return None
    import sys as _sys

    vocab_lines = "\n".join(f"- {cap}：{desc}" for cap, desc in CAPABILITY_VOCAB.items())
    messages = [
        {
            "role": "system",
            "content": (
                "你是产品推演引擎的编排器。根据推演现场的仪表盘，"
                "提案下一批要执行的能力（1-5 个，按执行顺序）。原则：\n"
                "1. 缺证据先补证据，有分歧先红队质疑，结论未综合先综合，"
                "用户明确要交付物才走交付链\n"
                "2. 不要重复已充分执行的能力；每个提案说一句为什么\n"
                "3. capabilityId 只能从能力清单里选（原样抄写），"
                "roleId 只能是 产品|架构|工程|综合\n"
                "只输出 JSON：{\"rationale\":\"一句话总体策略\","
                "\"picks\":[{\"capabilityId\":\"\",\"roleId\":\"\","
                "\"why\":\"\"}]}\n"
                "能力清单：\n" + vocab_lines
            ),
        },
        {"role": "user", "content": _state_digest(state, user_text, loop_index, max_loops)},
    ]
    parsed = None
    # 推理模型空正文偶发（transient=False 客户端不重试）+ 网关高载时
    # 瞬时失败——本地重试一次（与 scene_archetype 同款实测处方）
    for _attempt in range(2):
        try:
            from sliderule_llm.client import call_llm_json

            parsed, _res = call_llm_json(
                messages,
                temperature=0.2,
                max_tokens=4000,
                max_attempts=1,
                reasoning_effort="low",
                # E32 转正后 pick 在每轮主路径上：选材是快决策，不给它
                # 全局 600s 的深思预算——60s 答不上来就回落规则版（fail-open）
                timeout_ms=60_000,
            )
            break
        except Exception as exc:
            print(
                f"[agentic-pick] loop {loop_index} attempt {_attempt + 1}/2 失败: {str(exc)[:160]}",
                file=_sys.stderr, flush=True,
            )
    if parsed is None:
        print(f"[agentic-pick] loop {loop_index}: 回落规则版", file=_sys.stderr, flush=True)
        return None
    picks = _validate_proposal(parsed, state)
    if not picks:
        print(f"[agentic-pick] loop {loop_index}: 提案全被门剔除，回落规则版", file=_sys.stderr, flush=True)
        return None
    return {
        "picks": picks,
        "rationale": str(parsed.get("rationale") or "")[:200],
    }
