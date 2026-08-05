# -*- coding: utf-8 -*-
"""本轮模型复用：第二次收口不该把整条生成链重跑一遍。

## 事故

2026-08-04 真跑：模型自己在多个 loop 里选了收口，MAX_REPEAT_PER_CAP=2 放行
两次。第二次收口时生成入口没有复用通道，从头再调一次 LLM 生成（13 万字），
拿到一份全新模型。而链路上那三道幂等保护——page.freeformOverview 已存在就
跳过、chartColors 已有就不重取、sheet_used 计数——检查的全是「model 内部
字段」，新模型上这些都是空，保护形同虚设。于是生图 100s + 取色 12s + 设计
100s 整套重跑，两张不同参照图取出两套不同配色（5 色 vs 4 色），后写覆盖
先写，第一遍 233 秒全废，占整轮 23.5 分钟的 14%。

**锁挂在门上，但每次来的是一扇新门。**

## 复用键的两个来源

- vercel/turborepo#4572「cache doesn't invalidate on change in dependent
  code」：缓存最大的坑不是没命中，是**影响输出的输入没进键**，于是改了
  东西还吃旧结果。→ goal 必须进键。
- Stripe 幂等键：同一个键配不同参数必须拒绝，而不是静默返回旧结果。
  → goalDigest 对不上时宁可重算。

作用域刻意收窄到单轮：跨轮复用会让「用户补充需求后仍拿旧模型」。
"""

import pytest

from models.v5_state import V5SessionState
from services.v5_full_driver import goal_digest, reusable_model_for_turn

GOAL = "给公司做一套请假审批系统：登记员工和假期余额、提交请假单、主管审批"

MODEL = {
    "datamodel": {"entities": [{"id": "employee", "name": "员工"}]},
    "page": {"pages": [{"id": "p1", "name": "我的请假单",
                        # 增强产物就在模型里——这正是复用能连生图一起省掉的原因
                        "freeformOverview": {"root": {"tag": "div"}}}]},
    "rbac": {}, "workflow": {}, "aigc": {},
    "appbundle": {"appIdentity": {"productName": "假期无忧",
                                  "chartColors": ["#2f7eea", "#ff9f1c"]}},
}


def _state(*, turn="turn-1", goal=GOAL, version_turn="turn-1",
           version_goal_digest=None, model=MODEL, with_version=True):
    st = V5SessionState(sessionId="s", goal={"text": goal})
    st.lastTurnId = turn
    if with_version:
        st.modelVersions = [{
            "id": "mv-1",
            "turnId": version_turn,
            "goalDigest": version_goal_digest if version_goal_digest is not None else goal_digest(st),
            "model": model,
        }]
    return st


class TestGoalDigest:
    def test_同一目标同一指纹(self):
        assert goal_digest(_state()) == goal_digest(_state())

    def test_目标不同指纹不同(self):
        assert goal_digest(_state()) != goal_digest(_state(goal="做个记账应用"))

    def test_首尾空白不影响(self):
        assert goal_digest(_state(goal=GOAL)) == goal_digest(_state(goal=f"  {GOAL}  "))


class TestReuseKey:
    def test_同轮同目标可复用(self):
        assert reusable_model_for_turn(_state()) == MODEL

    def test_换了一轮不复用(self):
        """跨轮复用会让「用户补充需求之后仍拿到旧模型」——turborepo 那个坑。"""
        assert reusable_model_for_turn(_state(turn="turn-2")) is None

    def test_目标变了不复用(self):
        st = _state()
        st.goal = {"text": "完全不同的需求：做一个社区团购系统"}
        assert reusable_model_for_turn(st) is None

    def test_旧快照没记指纹时不复用(self):
        """加 goalDigest 之前存下的版本没有这个字段——宁可重算，不赌。"""
        assert reusable_model_for_turn(_state(version_goal_digest="")) is None

    def test_没有历史版本不复用(self):
        assert reusable_model_for_turn(_state(with_version=False)) is None

    def test_没有_lastTurnId_不复用(self):
        st = _state()
        st.lastTurnId = None
        assert reusable_model_for_turn(st) is None

    @pytest.mark.parametrize("bad", [None, "字符串", 123, {"model": "不是字典"}])
    def test_快照形状不对不复用(self, bad):
        st = _state()
        st.modelVersions = [bad] if not isinstance(bad, dict) else [bad]
        assert reusable_model_for_turn(st) is None

    def test_复用的是最新一版(self):
        st = _state()
        newer = {**MODEL, "aigc": {"marker": "newer"}}
        st.modelVersions.append({
            "id": "mv-2", "turnId": "turn-1",
            "goalDigest": goal_digest(st), "model": newer,
        })
        assert reusable_model_for_turn(st) == newer


class TestSnapshotCarriesDigest:
    def test_记录版本时写入_goalDigest(self):
        """没有这个字段，复用键就缺了一半，等于 turborepo 那个坑。"""
        from services.v5_full_driver import record_model_version

        st = V5SessionState(sessionId="s", goal={"text": GOAL})
        st.lastTurnId = "turn-1"
        closure = {"perSkillEvidence": {
            k: {"modelSection": MODEL[k]}
            for k in ("datamodel", "workflow", "rbac", "page", "aigc", "appbundle")
        }}
        record_model_version(st, closure, "首次生成")
        assert len(st.modelVersions) == 1
        assert st.modelVersions[0]["goalDigest"] == goal_digest(st)
        # 存完立刻就能被复用——这正是第二次收口要走的路
        assert reusable_model_for_turn(st) is not None


class TestExecutorReuse:
    def test_命中复用时不调_LLM_生成(self, monkeypatch, capsys):
        import services.v5_capability_executor as ex

        called = {"n": 0}

        def _boom(*a, **k):
            called["n"] += 1
            return None

        monkeypatch.setattr(ex, "_try_llm_generate_evidence", _boom)
        st = _state()
        per_skill = ex._build_per_skill_evidence(st, False, GOAL)
        assert called["n"] == 0, "复用命中了却还去调 LLM 生成"
        # 六项证据都由复用模型铺齐
        assert all(per_skill[s].get("evidencePresent") for s in ex.REQUIRED_EVIDENCE_KEYS)
        assert "复用上一版" in capsys.readouterr().out

    def test_复用失败时照常走生成不被拖垮(self, monkeypatch):
        """复用是省时间的优化，它自己出问题绝不能把能正常生成的推演带崩。"""
        import services.v5_capability_executor as ex

        def _boom(state):
            raise RuntimeError("版本史读挂了")

        monkeypatch.setattr(
            "services.v5_full_driver.reusable_model_for_turn", _boom
        )
        st = _state()
        assert ex._reuse_this_turn_model(st, {}) is False
