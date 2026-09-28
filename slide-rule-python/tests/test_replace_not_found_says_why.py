"""旧串一处都对不上：回执说对不上在哪（转义写错了 / 第一行之后文件里实际是什么）。

⚠ 2026-09-28 隔离真机第 95 轮 sr-20260928090643-EN9AKT1A92（信息安全培训 PPT，追问「每一页右下角加上页码，封面除外」）：
  一轮 12 次 project_str_replace_not_found，没有一句提示。下面的旧串是那一轮模型发的原样，夹具
  round95_build_deck_turn4.py.txt 是它当时面对的那一版 build_deck.py。

判据走真 `_dispatch_tool`。把 kernel_str_replace_changes 里挂 _not_found_hint 的那行删掉，前三条变红。
"""

from __future__ import annotations

import json
from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

SOURCE = (Path(__file__).parent / "fixtures" / "round95_build_deck_turn4.py.txt").read_text("utf-8")
LINES = SOURCE.split("\n")
PATH = "build_deck.py"
ESCAPED = "    footer(slide, 1)\\n\\n\\ndef add_overview():"            # 字面的反斜杠 n，真机原样
GUESSED = "    footer(slide, 4)\n\n\ndef add_data_classification():"     # 凭印象猜的空行和下一个函数


def _replace(setup, old):
    create(setup)
    assert _dispatch(setup, "file_write", {"file": PATH, "content": SOURCE})["ok"] is True
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "old_str": old, "new_str": "X"})
    assert result["ok"] is False and result["error"] == "project_str_replace_not_found", result
    return result["hint"]


def test_a_literal_backslash_n_is_named_as_the_mismatch(setup):
    assert ESCAPED.replace("\\n", "\n") in SOURCE and ESCAPED not in SOURCE   # 夹具前提
    hint = _replace(setup, ESCAPED)
    assert "反斜杠" in hint and "应是换行" in hint and "1 处" in hint


def test_a_wrong_guess_after_a_real_first_line_shows_the_real_text(setup):
    hint = _replace(setup, GUESSED)
    first = next(i for i, line in enumerate(LINES) if line.strip() == "footer(slide, 4)")
    assert f"第 {first + 1}" in hint
    assert LINES[first + 1:first + 4] and all(line in hint for line in LINES[first:first + 4] if line.strip())


def test_nothing_like_it_points_to_search_not_a_guess(setup):
    hint = _replace(setup, "    add_slide_number_everywhere()\n")
    assert "找不到" in hint and "file_find_in_content" in hint


def test_a_real_match_is_unaffected(setup):
    """反向：对得上照常换，不挂提示。"""
    create(setup)
    _dispatch(setup, "file_write", {"file": PATH, "content": SOURCE})
    old = ESCAPED.replace("\\n", "\n")
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "old_str": old, "new_str": old + "  # ok"})
    assert result["ok"] is True and "hint" not in result


# ⚠ 2026-09-28 隔离真机第 105 轮 sr-20260928125559-X5BR6CR7QA（差旅报销 Excel，追问「加一列自动判断是否超预算，超了标红」）：
#   三发旧串都是引号前多了字面反斜杠（`\\"超预算\\"`），落到「第一行也找不到」。
#   夹具是当时那一版脚本与模型第一发 file_str_replace 的原样参数。
SCRIPT105 = (Path(__file__).parent / "fixtures" / "round105_travel_expense_workbook.py.txt").read_text("utf-8")
ROUND105 = json.loads((Path(__file__).parent / "fixtures" / "round105_escaped_quote_replace.json").read_text("utf-8"))


def test_the_round105_escaped_quotes_are_named(setup):
    create(setup)
    assert _dispatch(setup, "file_write", {"file": "scripts/create_travel_expense_workbook.py", "content": SCRIPT105})["ok"]
    result = _dispatch(setup, "file_str_replace", {"file": "scripts/create_travel_expense_workbook.py", **ROUND105})
    assert result["ok"] is False and result["error"] == "project_str_replace_not_found"
    assert '应是引号 "' in result["hint"] and "对上（1 处）" in result["hint"]
