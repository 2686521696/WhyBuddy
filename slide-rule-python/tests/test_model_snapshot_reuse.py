"""模型快照在**过闸那一刻**就落地，不等它变成完整闭环（2026-08-09）。

## 起因：725 秒买了一份已经有的东西

线上一趟真跑（黑灰产情报自动化分析系统，22 分 52 秒）的会话状态里：

    reasoningEvents  loop-1 wallMs=387713（含收口）
                     loop-2 wallMs=370341（含收口）
                     loop-3 wallMs=354975（含收口）
    modelVersions    只有 1 条，createdAt = 18:38:31 —— 最后一轮结束那一刻
    产物             art-1/2/3-appbundle.runtimeClosure 各 3089 字节，**字节完全相同**

后两轮 725 秒（占全程 55%）重新生成出了与第一轮一模一样的东西。三次
`[enrich-timing] model.generate` 分别烧掉 172.6 / 208.7 / 165.8 秒。

`_reuse_this_turn_model` 那把锁本来就是治这个的，但它读 `modelVersions`，
而当时唯一的写入口 `record_model_version` 要求闭环 perSkillEvidence 六段齐全
（`extract_model_from_closure` 缺一段返回 None）。轮次没走到完整闭环 →
一条都不记 → 下一轮读到空 → 全价重来。

**最贵的产物只在最便宜的条件满足时才进缓存。** 锁在最需要它的场景里用不上。
"""

import pytest

from models.v5_state import V5SessionState
from services.v5_full_driver import (
    goal_digest,
    record_model_snapshot,
    reusable_model_for_turn,
)

SECTIONS = ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")


def _model(tag: str = "v1") -> dict:
    return {s: {"id": s, "tag": tag} for s in SECTIONS}


def _state(turn: str = "turn-1") -> V5SessionState:
    st = V5SessionState(
        sessionId="s-1",
        goal={"text": "黑灰产情报自动化分析系统", "status": "clear"},
        ownerId="u-1",
    )
    st.lastTurnId = turn
    return st


class Test记快照:
    def test_直接记一份模型_不经过闭环(self):
        st = _state()
        record_model_snapshot(st, _model(), "黑灰产情报自动化分析系统")
        assert len(st.modelVersions) == 1
        assert st.modelVersions[0]["model"] == _model()
        assert st.modelVersions[0]["turnId"] == "turn-1"
        assert st.modelVersions[0]["goalDigest"] == goal_digest(st)

    def test_记完就能被复用锁读到(self):
        # 这条是整件事的目的：下一轮不必重新生成
        st = _state()
        assert reusable_model_for_turn(st) is None
        record_model_snapshot(st, _model(), "目标")
        assert reusable_model_for_turn(st) == _model()

    def test_模型没变不追加新版本(self):
        st = _state()
        record_model_snapshot(st, _model(), "目标")
        record_model_snapshot(st, _model(), "目标")
        assert len(st.modelVersions) == 1, "同一份模型记两遍不该产生两个版本"

    def test_模型变了才追加(self):
        st = _state()
        record_model_snapshot(st, _model("v1"), "目标")
        record_model_snapshot(st, _model("v2"), "目标")
        assert [v["id"] for v in st.modelVersions] == ["mv-1", "mv-2"]
        assert st.currentModelVersionId == "mv-2"

    def test_空模型不记(self):
        st = _state()
        record_model_snapshot(st, {}, "目标")
        record_model_snapshot(st, None, "目标")  # type: ignore[arg-type]
        assert st.modelVersions == []

    def test_目标变了就不复用(self):
        # 复用键的另一半（turborepo#4572 的教训：影响输出的输入必须进键）
        st = _state()
        record_model_snapshot(st, _model(), "目标")
        st.goal = {"text": "换了个完全不同的目标"}
        assert reusable_model_for_turn(st) is None

    def test_换轮次就不复用(self):
        st = _state()
        record_model_snapshot(st, _model(), "目标")
        st.lastTurnId = "turn-2"
        assert reusable_model_for_turn(st) is None


class Test过闸即缓存:
    """写入侧接线：`_try_llm_generate_evidence` 一返回就该记上。"""

    @staticmethod
    def _llm_result(tag: str = "v1") -> dict:
        return {
            s: {"id": f"llm-linkage-{s}", "_model_section": {"id": s, "tag": tag}}
            for s in SECTIONS
        }

    def test_从_llm_result_拼回模型并记上(self):
        from services.v5_capability_executor import _cache_gate_passed_model

        st = _state()
        _cache_gate_passed_model(st, self._llm_result(), "黑灰产情报自动化分析系统")
        assert len(st.modelVersions) == 1
        assert st.modelVersions[0]["model"] == _model()
        # 记完立刻可复用 —— 下一轮的收口不必再生成一遍
        assert reusable_model_for_turn(st) == _model()

    def test_缺段就不记(self):
        # 半份模型复用出去比不复用更糟：下游按六段齐全假设读
        from services.v5_capability_executor import _cache_gate_passed_model

        st = _state()
        broken = self._llm_result()
        broken["rbac"].pop("_model_section")
        _cache_gate_passed_model(st, broken, "目标")
        assert st.modelVersions == []

    def test_自己出问题不能把推演带崩(self, capsys):
        from services.v5_capability_executor import _cache_gate_passed_model

        class _Boom:
            @property
            def modelVersions(self):
                raise RuntimeError("状态炸了")

        _cache_gate_passed_model(_Boom(), self._llm_result(), "目标")  # type: ignore[arg-type]
        assert "模型快照记录跳过" in capsys.readouterr().out

    def test_两条写入路径记的是同一种东西(self):
        """闭环那条路与过闸那条路，存进去的必须是同一份模型。

        否则复用锁会在两条路之间抖：一条存增强前、一条存增强后，
        命中与否取决于上一轮走的是哪条。
        """
        from services.v5_capability_executor import _cache_gate_passed_model
        from services.v5_full_driver import record_model_version

        via_gate = _state()
        _cache_gate_passed_model(via_gate, self._llm_result(), "目标")

        via_closure = _state()
        closure = {
            "perSkillEvidence": {
                s: {"modelSection": {"id": s, "tag": "v1"}} for s in SECTIONS
            }
        }
        record_model_version(via_closure, closure, "目标")

        assert via_gate.modelVersions[0]["model"] == via_closure.modelVersions[0]["model"]


class Test接线:
    """判据对 ≠ 接线对：上面那些直接调 helper 的测试，把调用点删掉照样全绿。

    所以这一条走真实路径 `_build_per_skill_evidence`，只断言一件事：
    模型过闸之后，`state.modelVersions` 里必须有东西。
    """

    @pytest.fixture
    def gate_passes(self, monkeypatch):
        import services.v5_capability_executor as ex
        import services.v5_llm_generate as gen_mod
        import services.v5_model_gate as gate_mod

        model = _model()
        monkeypatch.setattr(ex, "_llm_generate_enabled", lambda: True)
        monkeypatch.setattr(
            gen_mod, "generate_five_system_model",
            lambda goal, llm_json_fn=None, gate_feedback=None: dict(model),
        )
        monkeypatch.setattr(
            gate_mod, "validate_five_system_model",
            lambda m, **kw: {"passed": True, "findings": []},
        )
        # 增强两段与确定性修复都短路：本条只测"过闸之后有没有记快照"
        monkeypatch.setattr("services.v5_model_repair.repair_five_system_model", lambda m: {"model": m})
        monkeypatch.setattr("services.freeform_block.enrich_freeform_blocks", lambda m: m)
        monkeypatch.setattr(
            "services.freeform_block.enrich_monitor_page_overviews",
            lambda m, preview_sink=None: m,
        )
        monkeypatch.setattr("services.device_policy.normalize_model_preferred_device", lambda g, m: m)
        return model

    def test_过闸之后状态里就有可复用的模型(self, gate_passes):
        from services.v5_capability_executor import _build_per_skill_evidence

        st = _state()
        assert st.modelVersions == []
        _build_per_skill_evidence(st, blocked_signal=False, goal=st.goal["text"])
        assert st.modelVersions, "过闸了却没记快照 —— 下一轮会全价重新生成一遍"
        assert reusable_model_for_turn(st) == gate_passes
