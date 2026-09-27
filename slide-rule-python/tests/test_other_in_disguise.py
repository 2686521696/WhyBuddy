"""「我现在填写」这种选项是「其他（自己写）」的复本，摘掉。

⚠ 2026-09-27 隔离真机 sr-20260927072026-61BV5J0D9R（发布会 PPT）：模型要用户填产品名、
  竞品、联系方式，每道题只给「我现在填写（推荐）」，说明写「在“其他”中写出……」。
  卡上选它没有输入框，答案零信息，模型原样再问三轮，45 分钟没出计划。

夹具是那一轮模型原样发出的三发 ask_user_question 参数。第二组走真分发（harness），
量流到前端的 control_ask_user 事件。把 coerce_questions 里的过滤删掉，两组都红。
"""

from __future__ import annotations

import pytest

from control_turn_support import ControlHarness, llm_text, llm_tool, new_sid, seed_session, six_fields
from services.user_questions import coerce_questions

pytest.importorskip("fastapi")

#: 第一发：产品信息 / 观众 / 品牌 / 竞品价格。
FIRST = {'questions': [{'question': '产品名称、所属行业和一句话定位是什么？如果还没有定稿，我可以先用占位信息。', 'options': [{'label': '我提供具体信息（推荐）', 'description': '请在“其他”中填写产品名、行业和定位'}, {'label': '请你拟定一套示例产品', 'description': '我会为一个科技/企业服务类新产品补齐内容'}]}, {'question': '发布会的主要观众是谁？', 'options': [{'label': '客户与潜在客户（推荐）', 'description': '重点突出价值、功能、价格和上市节奏'}, {'label': '投资人/媒体', 'description': '重点突出市场机会、差异化和增长计划'}, {'label': '内部销售与渠道', 'description': '重点突出卖点、竞品话术和套餐政策'}]}, {'question': '品牌蓝和视觉风格有具体要求吗？', 'options': [{'label': '你来设计（推荐）', 'description': '采用稳重、现代的品牌蓝配色和发布会风格'}, {'label': '我提供品牌规范', 'description': '请在“其他”中填写色值、字体或参考文件'}, {'label': '沿用现有品牌', 'description': '请在“其他”中说明品牌名称及可参考的资料'}]}, {'question': '竞品、价格和上市时间是否已有确定信息？', 'multi_select': True, 'options': [{'label': '已有竞品名单（推荐）', 'description': '请在“其他”中列出竞品名称和已知差异'}, {'label': '已有价格方案', 'description': '请在“其他”中提供套餐、价格和计费方式'}, {'label': '已有上市时间表', 'description': '请在“其他”中提供关键日期或阶段'}, {'label': '需要你合理拟定', 'description': '我会明确标注为建议方案，避免伪装成已确认事实'}]}]}
#: 第二发：三道「请提供……」，只有「我现在填写（推荐）」。
SECOND = {'questions': [{'question': '请提供产品的基础信息：产品名称、所属行业、以及用于封面的“一句话介绍”。', 'options': [{'label': '我现在填写（推荐）', 'description': '在“其他”中写出：名称｜行业｜一句话介绍。'}]}, {'question': '请提供竞品名单，以及已确定的价格和上市节点；若尚未确定，可写“由你拟定”。', 'options': [{'label': '我现在填写（推荐）', 'description': '在“其他”中写出：竞品名称｜定价信息｜上市时间表。'}]}, {'question': '联系方式页要展示哪些信息？', 'options': [{'label': '我现在填写（推荐）', 'description': '在“其他”中写邮箱、官网、电话、联系人或二维码链接。'}, {'label': '使用演示占位信息', 'description': '生成可替换的邮箱、官网和咨询电话占位内容。'}]}]}


def _labels(rows):
    return [[o["label"] for o in q["options"]] for q in rows]


def test_pointer_only_questions_become_open_questions():
    rows = coerce_questions(SECOND["questions"])
    assert _labels(rows) == [[], [], ["使用演示占位信息"]]


def test_options_that_send_the_user_to_other_are_dropped_the_rest_stay():
    rows = coerce_questions(FIRST["questions"])
    assert _labels(rows) == [
        ["请你拟定一套示例产品"],
        ["客户与潜在客户（推荐）", "投资人/媒体", "内部销售与渠道"],   # 反向：真选择一个不动
        ["你来设计（推荐）"],
        ["需要你合理拟定"],
    ]


@pytest.mark.parametrize("label", ["我现在填写", "我来填写（推荐）", "手动输入", "自己写", "我提供"])
def test_self_fill_labels(label):
    assert coerce_questions([{"question": "q", "options": [label, "由你拟定"]}])[0]["options"] == [{"label": "由你拟定"}]


@pytest.mark.parametrize("label", ["我提供具体信息", "使用演示占位信息", "写实风格", "填充色为蓝"])
def test_real_choices_that_merely_contain_the_words_stay(label):
    assert [o["label"] for o in coerce_questions([{"question": "q", "options": [label]}])[0]["options"]] == [label]


def test_on_the_live_path_the_card_gets_input_boxes_not_dead_options(monkeypatch):
    harness = ControlHarness(monkeypatch)
    sid = new_sid("other-in-disguise")
    seed_session(sid, goal={"text": "新产品发布会 PPT", "status": "clear"})
    harness.llm_impl = lambda m, **k: (
        llm_tool("ask_user_question", SECOND, call_id="ask") if len(harness.llm_calls) == 1 else llm_text("好")
    )
    _, events = harness.post(six_fields(sid, "帮我做发布会 PPT"))
    ask = [e for e in events if e.get("type") == "control_ask_user"][-1]
    assert _labels(ask["questions"]) == [[], [], ["使用演示占位信息"]]
