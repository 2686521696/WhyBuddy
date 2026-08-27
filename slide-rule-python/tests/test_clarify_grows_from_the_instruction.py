"""开工前的澄清：问题从**这句需求**里长出来，答案要真进生成提示词。

2026-08-27 的诊断：澄清这条链在产品路径上**整条没接**——

  · profile="app" 的短清单（_app_profile_short_picks）里没有 gap.ask，
    六步钟第 ① 步「澄清与取证」基本恒空转；
  · 唯一还在用的模板问题是 TS 那 4 条写死的（users/platform/scenario/scope，
    选项是「个人C端/企业内部」这种通用词），而且挂在旧本地引擎上；
  · 判定还写着「目标 ≥80 字直接算已充分规约、一个问题都不问」；
  · 前端 ClarificationCard 是完整的多步卡（单选/多选/填空/默认值/说明），
    **前面没有任何东西给它喂题**。

所以用户看到的就是"AI 只会一次性随口问一句"。

这里钉四件事，每条都配反向：
  1. 需求含糊 → 真的产出带选项的问题，且落成 open_question 缺口
  2. 反向：模型判断已经清楚（给空列表）→ 不许硬 park 一张空卡
  3. 反向：已经问过一轮 → 不许再问（改开范围卡），别把人困在问答里
  4. 答完之后，答案要**原样进生成提示词**（这条断了前面全白问）
"""

from __future__ import annotations

import pytest

from control_turn_support import (
    ControlHarness,
    event_types,
    llm_tool,
    new_sid,
    seed_session,
    six_fields,
)
from services.slide_rule_session import load_session

pytest.importorskip("fastapi")

VAGUE = "做一个诊所系统"


@pytest.fixture
def harness(monkeypatch):
    return ControlHarness(monkeypatch)


def _gaps(sid: str, status: str = "open"):
    saved = load_session(sid)
    out = []
    for g in saved.coverageGaps or []:
        get = g.get if isinstance(g, dict) else lambda k, _g=g: getattr(_g, k, None)
        if get("kind") == "open_question" and get("status") == status:
            out.append(
                {
                    "id": get("id"),
                    "label": get("label"),
                    "type": get("clarifyType"),
                    "options": get("options"),
                    "context": get("context"),
                    "answer": get("answer"),
                }
            )
    return out


QUESTIONS = [
    {
        "prompt": "这个诊所系统主要给谁用？",
        "type": "multi_choice",
        "options": ["医生", "护士", "前台", "患者"],
        "context": "用谁决定角色与权限怎么切",
        "kind": "users",
    },
    {
        "prompt": "挂号之后要不要走缴费？",
        "type": "single_choice",
        "options": ["要，挂号即缴费", "不要，到诊再缴", "先不做缴费"],
        "context": "影响工作流节点数",
        "kind": "scenario",
    },
]


class TestClarifyProducesRealQuestions:
    def test_questions_land_as_gaps_with_their_options(self, harness):
        sid = new_sid("clarify")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda m, **k: llm_tool("clarify", {"questions": QUESTIONS})
        _, events = harness.post(six_fields(sid, VAGUE))

        assert "control_clarify" in event_types(events)
        assert "control_handoff_factory" not in event_types(events), "澄清阶段不许点火"
        gaps = _gaps(sid)
        assert len(gaps) == 2, gaps
        first = gaps[0]
        assert first["label"] == "这个诊所系统主要给谁用？"
        # ⚠ 选项必须**原样落盘**。Python 的 CoverageGap 之前根本没声明这些字段，
        #   pydantic 静默丢掉，卡片就退化成一个纯文本框——看着就是"只会问大白话"。
        assert first["type"] == "multi_choice"
        assert first["options"] == ["医生", "护士", "前台", "患者"]
        assert first["context"] == "用谁决定角色与权限怎么切"

    def test_choice_without_options_degrades_to_free_text(self, harness):
        """反向：说是选择题却没给选项 → 退成填空，别端出一张点不动的卡。"""
        sid = new_sid("clarify-noopt")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda m, **k: llm_tool(
            "clarify", {"questions": [{"prompt": "预算多少？", "type": "single_choice"}]}
        )
        harness.post(six_fields(sid, VAGUE))
        assert _gaps(sid)[0]["type"] == "free_text"

    def test_empty_question_list_does_not_park_an_empty_card(self, harness):
        """反向：模型判断"已经够清楚"（空列表）→ 不许硬 park，直接开范围卡。

        参考 dzhng/deep-research 的 generateFeedback：本来就清楚就少问或不问。
        为了问而问比不问更烦人。
        """
        sid = new_sid("clarify-empty")
        seed_session(sid, goal={"text": "", "status": "needs_refinement"})
        harness.llm_impl = lambda m, **k: llm_tool("clarify", {"questions": []})
        _, events = harness.post(six_fields(sid, VAGUE))
        types = event_types(events)
        assert "control_clarify" not in types
        assert "control_scope_card" in types, types
        assert _gaps(sid) == []

    def test_second_clarify_round_is_refused(self, harness):
        """反向：已经问过一轮就不再问，改开范围卡——别把人困在问答里。"""
        sid = new_sid("clarify-twice")
        seed_session(
            sid,
            goal={"text": "", "status": "needs_refinement"},
            controlTranscript=[{"id": "ct-1", "kind": "clarify", "text": "上一轮问过了"}],
        )
        harness.llm_impl = lambda m, **k: llm_tool("clarify", {"questions": QUESTIONS})
        _, events = harness.post(six_fields(sid, VAGUE))
        types = event_types(events)
        assert "control_clarify" not in types
        assert "control_scope_card" in types, types


class TestPromptGetsTheAnswers:
    def test_answers_reach_the_generation_prompt_verbatim(self):
        """答案要**原样**进生成提示词——这条断了，前面问得再漂亮也白问。

        ⚠ 判据钉在 `_build_user_content` 的产物上（真的会发给模型的那段字），
          不是"有没有调过 set_clarifications"。调用计数那种判据，把
          clarification_prompt_block 返回空字符串照样绿。
        """
        from models.v5_state import V5SessionState
        from services.v5_llm_generate import (
            _build_user_content,
            clarifications_from_state,
            set_clarifications,
        )

        state = V5SessionState(
            sessionId="clar-prompt",
            goal={"text": "诊所系统", "status": "clear"},
            coverageGaps=[
                {
                    "id": "g1",
                    "kind": "open_question",
                    "label": "挂号之后要不要走缴费？",
                    "status": "resolved",
                    "createdAt": "2026-08-27T00:00:00Z",
                    "answer": "要，挂号即缴费",
                },
                {
                    "id": "g2",
                    "kind": "open_question",
                    "label": "没答的这条",
                    "status": "open",
                    "createdAt": "2026-08-27T00:00:00Z",
                },
            ],
        )
        pairs = clarifications_from_state(state)
        assert pairs == [{"q": "挂号之后要不要走缴费？", "a": "要，挂号即缴费"}]
        set_clarifications(pairs)
        try:
            content = _build_user_content("诊所系统")
            assert "挂号之后要不要走缴费？" in content
            assert "要，挂号即缴费" in content
            # 反向：没答的那条不许进提示词（模型会把它当成已定的事实）
            assert "没答的这条" not in content
        finally:
            set_clarifications(None)

    def test_no_answers_means_no_block(self):
        """反向：没答过就不加这块，prompt 跟从前逐字节一致。"""
        from services.v5_llm_generate import _build_user_content, set_clarifications

        set_clarifications(None)
        content = _build_user_content("诊所系统")
        assert "already answered these clarifying questions" not in content

    def test_resolved_without_an_answer_is_not_fed(self):
        """反向：只把缺口置 resolved、没留答案 → 不许进提示词。

        那正是 2026-08-27 之前的形态：闸绿了，模型什么也没多知道。
        """
        from models.v5_state import V5SessionState
        from services.v5_llm_generate import clarifications_from_state

        state = V5SessionState(
            sessionId="clar-noanswer",
            goal={"text": "x", "status": "clear"},
            coverageGaps=[
                {
                    "id": "g1",
                    "kind": "open_question",
                    "label": "问过的",
                    "status": "resolved",
                    "createdAt": "2026-08-27T00:00:00Z",
                }
            ],
        )
        assert clarifications_from_state(state) == []


class TestAnswerIsStoredOnTheGap:
    def test_answered_gaps_carry_the_answer_text(self, harness):
        sid = new_sid("clarify-answer")
        seed_session(
            sid,
            goal={"text": "诊所系统", "status": "clear"},
            coverageGaps=[
                {
                    "id": "g1",
                    "kind": "open_question",
                    "label": "挂号之后要不要走缴费？",
                    "status": "open",
                    "createdAt": "2026-08-27T00:00:00Z",
                }
            ],
        )
        harness.post(
            six_fields(
                sid,
                "「挂号之后要不要走缴费？」答：要，挂号即缴费",
                answeredGaps=[{"gapId": "g1", "answer": "要，挂号即缴费"}],
            )
        )
        resolved = _gaps(sid, status="resolved")
        assert len(resolved) == 1
        assert resolved[0]["answer"] == "要，挂号即缴费", "答案没留下来 → 生成侧取不到料"


class TestPromptTellsTheModelWhatIsMissing:
    """system prompt 要**指着这句需求说缺什么**，而不是干喊"先澄清"。

    ⚠ 旧的 TS 那套把它做成硬闸：命中维度 <2 才问、目标 ≥80 字直接算说清。
      于是一句一百字的废话一条不问，一句 30 字的好需求反倒被问四条模板题。
      现在规则只报告"我没读到什么"，问不问、问几条交给模型
      （参考 dzhng/deep-research 的 generateFeedback：最多 N 条、清楚就少问）。
    """

    def test_missing_dimensions_are_named_in_the_prompt(self, harness):
        from services.rehearsal_control import _missing_dimensions

        assert "谁用（角色）" in _missing_dimensions("做一个诊所系统")
        # 反向：说清楚了的维度不许再报缺
        said = "给医生和前台用的诊所网页系统，核心流程是挂号到缴费，本期不做库存"
        assert _missing_dimensions(said) == [], _missing_dimensions(said)

    def test_long_but_vague_text_is_not_auto_declared_clear(self):
        """反向：**不许**再用"字数够长就算说清"那条规则。

        旧 isUnderSpecifiedGoal 里写着 `if t.length >= 80: return false`。
        一百字的废话照样什么维度都没说。
        """
        from services.rehearsal_control import _missing_dimensions

        long_vague = "我想做一个很好用的系统" * 12  # 120+ 字，什么维度都没说
        assert len(long_vague) > 80
        assert _missing_dimensions(long_vague), "长文本被当成已充分规约了"

    def test_prompt_carries_the_hint_and_stops_after_one_round(self, harness):
        from models.v5_state import V5SessionState
        from services.rehearsal_control import _system_prompt

        vague = V5SessionState(
            sessionId="p1", goal={"text": "做一个诊所系统", "status": "needs_refinement"}
        )
        prompt = _system_prompt(vague)
        assert "还没读到" in prompt
        assert "clarify" in prompt

        asked = V5SessionState(
            sessionId="p2",
            goal={"text": "做一个诊所系统", "status": "needs_refinement"},
            controlTranscript=[{"id": "c1", "kind": "clarify", "text": "问过了"}],
        )
        after = _system_prompt(asked)
        assert "已经问过一轮" in after
        assert "还没读到" not in after


class TestUnansweredClarifyDoesNotBlockClosure:
    """没答的澄清**不许**把闭环判 blocked。

    ⚠ 这条是本仓第七条的分线题：澄清是**增强**（问了更准，不问也能跑），
      不是证据/闭环。把它做成 fail-closed 的后果是——用户关掉那张卡，
      整场推演就永远出不来，而且提示语还会说"缺证据"。

    ⚠ 反过来，真正的闭环缺口（写进 contract.blockingGapIds 的那些）**必须**
      照旧拦住。所以下面两条一起钉：澄清缺口不拦、契约缺口照拦。
    """

    def _state_with(self, gaps, blocking_ids):
        from models.v5_state import V5SessionState

        return V5SessionState(
            sessionId="clar-gate",
            goal={"text": "诊所系统", "status": "clear"},
            coverageGaps=gaps,
            coverageContract={
                "id": "c1",
                "version": 1,
                "requiredCapabilities": [],
                "blockingGapIds": blocking_ids,
            },
        )

    def _gap(self, gid, kind="open_question", status="open"):
        return {
            "id": gid,
            "kind": kind,
            "label": f"{gid} 的问题",
            "status": status,
            "createdAt": "2026-08-27T00:00:00Z",
        }

    def test_open_clarify_gap_is_not_blocking(self):
        from services.slide_rule_coverage import evaluate_coverage_gate

        state = self._state_with([self._gap("gap-q-1")], blocking_ids=[])
        result = evaluate_coverage_gate(state)
        unresolved = (
            result.get("unresolvedGaps")
            if isinstance(result, dict)
            else getattr(result, "unresolvedGaps", [])
        ) or []
        assert "gap-q-1" not in unresolved, (
            "没答的澄清把闭环拦住了——用户关掉卡片就再也跑不出应用"
        )

    def test_contract_blocking_gap_still_blocks(self):
        """反向：写进契约的缺口照旧拦得住（别为了放行澄清把闸拆了）。"""
        from services.slide_rule_coverage import evaluate_coverage_gate

        state = self._state_with(
            [self._gap("gap-eviD", kind="missing_evidence")],
            blocking_ids=["gap-eviD"],
        )
        result = evaluate_coverage_gate(state)
        unresolved = (
            result.get("unresolvedGaps")
            if isinstance(result, dict)
            else getattr(result, "unresolvedGaps", [])
        ) or []
        assert "gap-eviD" in unresolved
