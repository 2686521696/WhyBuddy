"""rowsRef 漏 fieldRefs 时，reask **必须让模型有机会改对**（2026-08-04）。

## 为什么要有这条

真机验收那轮：一次首页设计连挂三轮、烧 192 秒，最后降级回固定骨架。三轮报的
都是同一句 `rowsRef.fieldRefs 不能为空`——错误回喂了，但紧跟的固定建议整段在
讲 dataRef 的 key 名和白名单，一个字没提 rowsRef。

改成按错误分诊之后，我又跑了一轮想验收，**结果那轮压根没走到设计这一步**
（六轮跑满没收口，enrich 整段没执行）。也就是说：代码改了、推了，但"修好了"
这个结论一直没有证据。

再靠碰运气跑整轮不是办法——一次十分钟，还不一定跑到那段代码。所以这里把
LLM 打桩，**把那条 reask 回路真跑一遍**：第一次故意交一份漏 fieldRefs 的设计，
断言重问消息里带的是 rowsRef 的建议；第二次交合格的，断言整体成功。

打桩验的是**我们这一侧**：错误抓没抓到、建议对不对、第二次机会给没给。
模型看到正确建议后会不会真改对，那是模型的事，打桩验不了，也不该假装验了。
"""

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import freeform_block as FB  # noqa: E402

DATAMODEL = {
    "entities": [
        {
            "id": "inspection",
            "name": "巡检记录",
            "fields": [
                {"id": "site", "name": "点位", "type": "string"},
                {"id": "level", "name": "隐患等级", "type": "string"},
                {"id": "checked_at", "name": "巡检时间", "type": "date"},
            ],
        }
    ]
}

#: 真机那次的形状：rowsRef 只写了 entityRef/limit，漏掉 fieldRefs。
BAD = {
    "root": {
        "tag": "div",
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "inspection", "limit": 5},
                "children": [{"tag": "span", "fieldRef": "site"}],
            }
        ],
    }
}

GOOD = {
    "root": {
        "tag": "div",
        "children": [
            {
                "tag": "div",
                "rowsRef": {"entityRef": "inspection", "fieldRefs": ["site", "level"], "limit": 5},
                "children": [
                    {"tag": "span", "fieldRef": "site"},
                    {"tag": "span", "fieldRef": "level"},
                ],
            }
        ],
    }
}


class _StubLlm:
    """按顺序吐预设回复，并把每次收到的对话记下来。"""

    def __init__(self, replies):
        self.replies = list(replies)
        self.conversations = []

    def __call__(self, messages, **_kw):
        self.conversations.append([dict(m) for m in messages])
        payload = self.replies.pop(0)

        class _R:
            content = json.dumps(payload, ensure_ascii=False)

        return _R()


@pytest.fixture
def stub(monkeypatch):
    def _install(replies):
        s = _StubLlm(replies)
        # 调用点是**函数内**局部 import（from sliderule_llm.client import ...），
        # 所以必须打到源模块上，打 FB 上没用。
        from sliderule_llm import client as _client

        monkeypatch.setattr(_client, "call_llm_with_retry", s)
        # 出图/视觉参照与本条无关，关掉省得走网络
        monkeypatch.setattr(FB, "_supports_image_content_parts", lambda: False)
        return s

    return _install


def test_bad_rowsref_is_caught_and_the_reask_talks_about_rowsref(stub):
    s = stub([BAD, GOOD])
    out = FB.generate_freeform_block(
        "画一个巡检记录列表", DATAMODEL, use_reference_image=False
    )
    assert out["root"]["children"][0]["rowsRef"]["fieldRefs"] == ["site", "level"]
    assert len(s.conversations) == 2, "第一次不合格就该有第二次机会"

    reask = s.conversations[1][-1]["content"]
    # ① 真实报错要在里面（不带的话模型不知道错哪了）
    assert "fieldRefs" in reask
    # ② 建议要指向 rowsRef，**不能**再把它往 dataRef 上引——那正是三轮没改对的原因
    assert "rowsRef" in reask
    assert "trendGrain" not in reask
    assert "entity / field" not in reask


def test_the_reask_offers_deleting_the_node_when_the_page_has_no_list(stub):
    """给一条"删掉它"的出路：这一页本来不需要列表时，逼它补个凑数的字段清单
    会得到一个跟业务无关的列表——比没有更差。"""
    s = stub([BAD, GOOD])
    FB.generate_freeform_block("随便画点什么", DATAMODEL, use_reference_image=False)
    assert "删掉" in s.conversations[1][-1]["content"]


def test_exhausting_attempts_still_raises_so_the_caller_can_degrade(stub):
    """三次都不合格必须抛——上游靠这个异常把区块摘掉、退回固定骨架。

    吞掉的话会变成"生成成功但内容是空"，比失败更难查（fail-open 的语义就靠
    调用方接得到这个异常）。
    """
    stub([BAD, BAD, BAD, BAD])
    with pytest.raises(FB.FreeformGenerationError):
        FB.generate_freeform_block("画列表", DATAMODEL, use_reference_image=False)


def test_a_good_design_needs_no_reask_at_all(stub):
    """一次就对的时候不该有第二次调用——省得把"能自愈"跟"总要重问"混为一谈。"""
    s = stub([GOOD])
    FB.generate_freeform_block("画列表", DATAMODEL, use_reference_image=False)
    assert len(s.conversations) == 1
