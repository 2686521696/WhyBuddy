"""小工程同时要对着看的几份文件，不许读一份挤掉一份。

⚠ 2026-09-28 隔离真机第 99 轮 sr-20260928103951-6PN9CJ1KGR（家庭菜谱网页，追问「收藏的菜谱可以打分，按分数排序」）：
  microcompact 只按条数留最近 2 条。模型要同时对着 main.tsx 两窗（0..40、35..44）和 style.css——
  三份结果，读第三份第一份就成了桩，再读又挤掉另一份。12 发全是读，一次没写，被「只看不写」闸停。
  夹具 round99_recipe_reads.json 是那三次读取回执原样（22.7k 字）；前面四份技能正文照真机顺序。

判据直接执行产线 microcompact_messages。把保留规则改回「最近 2 条」，第一条变红。
"""

from __future__ import annotations

import json
from pathlib import Path

from services.control_context_compact import estimate_message_tokens, microcompact_messages

READS = json.loads((Path(__file__).parent / "fixtures" / "round99_recipe_reads.json").read_text("utf-8"))


def _call(messages, index, tool, content):
    call_id = f"call-{index}"
    messages.append({"role": "assistant", "content": "", "tool_calls": [{
        "id": call_id, "type": "function", "function": {"name": tool, "arguments": "{}"}}]})
    messages.append({"role": "tool", "tool_call_id": call_id, "content": content})


def _round99():
    messages = [{"role": "system", "content": "你是控制面。"},
                {"role": "user", "content": "收藏的菜谱可以打分，按分数排序"}]
    # 真机顺序：先加载四份技能，再读三份源码
    for i, name in enumerate(("frontend-design", "responsive-design", "webapp-testing", "verification-before-completion")):
        _call(messages, i, "skill", json.dumps({"ok": True, "skill": name,
              "skill_message": f'<skill name="{name}">' + "规" * 6000 + "</skill>"}, ensure_ascii=False))
    for i, read in enumerate(READS, start=10):
        _call(messages, i, read["tool"], read["content"])
    return messages


def test_the_round99_working_set_survives():
    out, _report = microcompact_messages(_round99())
    bodies = [row["content"] for row in out if row.get("role") == "tool"]
    for read in READS:
        assert read["content"] in bodies        # 三份都还是原文，不是桩


def test_older_bulk_is_still_folded_right_away():
    """反向：立刻折叠没丢——更早的技能正文照旧变桩，占用确实下降。"""
    messages = _round99()
    out, report = microcompact_messages(messages)
    assert report.did_compact and report.tokens_after < estimate_message_tokens(messages)
    stubs = [json.loads(row["content"]) for row in out
             if row.get("role") == "tool" and '"compacted": true' in row["content"]]
    assert {stub["tool"] for stub in stubs} == {"skill"}


def test_a_long_session_is_still_cut_to_a_small_tail():
    """反向：十份 15k 的旧读取不会因为按字数而全留着。"""
    messages = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    body = json.dumps({"path": "src/big.ts", "content": "X" * 15000})
    for i in range(10):
        _call(messages, i, "file_read", body)
    out, _ = microcompact_messages(messages)
    assert [row["content"] for row in out if row.get("role") == "tool"].count(body) == 2


def test_at_least_the_last_two_survive_even_when_huge():
    messages = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]
    older = json.dumps({"path": "a.ts", "content": "A" * 30000})
    newest = json.dumps({"path": "b.ts", "content": "B" * 30000})
    _call(messages, 0, "file_read", older)
    _call(messages, 1, "file_read", newest)
    out, _ = microcompact_messages(messages)
    bodies = [row["content"] for row in out if row.get("role") == "tool"]
    assert older in bodies and newest in bodies
