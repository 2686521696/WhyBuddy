"""file_str_replace 收一批 edits：同一个文件好几处不同的改，一次调用、全成才落盘、只出一个版本。

⚠ 2026-09-30 隔离真机第 161 轮（员工手册 Word，追问「第 3 章后加一章远程办公规定」）：插一章之后
  后面的小节要顺延编号，模型连发 19 次 file_str_replace，每次一行，整个追问 11 分 50 秒。
  replace_all 只管同一段字处处换；好几段不同的字没有一次改完的路。

夹具：那一轮第 11 版（重编号前）与第 23 版（重编号后）的 scripts/generate_employee_handbook.py 原样。
这两版之间正好是 12 次单行替换；判据把这 12 处原样装进一批 edits 发一次，落库必须和第 23 版逐字相同。

判据走真 `_dispatch_tool`。把 project_tools 里 `edits` 那一支删掉，第一条变红；
把 _str_replace_edits_changes 里「整批不落」换成「对上几项落几项」，第二条变红。
"""

from __future__ import annotations

import difflib
from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.project_tool_contracts import PROJECT_TOOLS
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

FIXTURES = Path(__file__).parent / "fixtures"
BEFORE = (FIXTURES / "round161_handbook_before_renumber.py.txt").read_text("utf-8")
AFTER = (FIXTURES / "round161_handbook_after_renumber.py.txt").read_text("utf-8")
PATH = "scripts/generate_employee_handbook.py"


def _real_edits():
    """第 11 → 23 版之间模型一行一行发的那 12 次替换。"""
    a, b = BEFORE.split("\n"), AFTER.split("\n")
    edits = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag != "equal":
            edits += [{"old_str": o, "new_str": n} for o, n in zip(a[i1:i2], b[j1:j2])]
    return edits


def _saved(setup):
    create(setup)
    assert _dispatch(setup, "file_write", {"file": PATH, "content": BEFORE})["ok"] is True

    def state():
        project = setup.store.get_project_for_session(setup.state.sessionId, owner_id="alice")
        head = setup.store.get_revision(project.projectId, owner_id="alice").revision
        return head, setup.store.read_files(project.projectId, head, owner_id="alice")[PATH]
    return state


def test_the_round161_renumbering_goes_in_one_call(setup):
    state = _saved(setup)
    head_before, _ = state()
    edits = _real_edits()
    assert len(edits) == 12
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "edits": edits})
    assert result["ok"] is True, result
    head_after, body = state()
    assert body == AFTER                                  # 和那一轮 12 次单改的终点逐字相同
    assert head_after != head_before


def test_one_bad_edit_leaves_the_file_untouched_and_names_it(setup):
    state = _saved(setup)
    edits = _real_edits()
    edits[6] = {"old_str": "('9.9 并不存在的小节'", "new_str": "x"}
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "edits": edits})
    assert result["ok"] is False and result["error"] == "project_str_replace_not_found", result
    assert "edits 第 7 项（共 12 项）" in result["hint"] and "一处都没改" in result["hint"]
    assert state()[1] == BEFORE                           # 前 6 项对得上也不许落


def test_an_ambiguous_edit_in_a_batch_says_where(setup):
    """每一项照单处的规矩：多处就拒，说几处、哪几行。"""
    state = _saved(setup)
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "edits": [{"old_str": "'], [", "new_str": "'],["}]})
    assert result["ok"] is False and result["error"] == "project_str_replace_ambiguous", result
    assert "edits 第 1 项" in result["hint"] and "replace_all=true" in result["hint"]
    assert state()[1] == BEFORE


def test_the_model_is_told_about_edits():
    """接在链路上：发给模型的工具定义里有 edits，描述里说了什么时候用（§三）。"""
    tool = next(t for t in PROJECT_TOOLS if t["function"]["name"] == "file_str_replace")["function"]
    assert "edits" in tool["parameters"]["properties"]
    assert "all-or-nothing" in tool["description"] and "renumbering" in tool["description"]


def test_neither_or_both_forms_are_refused(setup):
    """反向：schema 上只有 file 必填，二选一靠校验器——两样都不给、两样都给，都拒，文件不动。"""
    state = _saved(setup)
    for args in ({"file": PATH},
                 {"file": PATH, "old_str": "a", "new_str": "b", "edits": [{"old_str": "a", "new_str": "b"}]},
                 {"file": PATH, "old_str": "a"}):
        result = _dispatch(setup, "file_str_replace", args)
        assert result["ok"] is False, (args, result)
    assert state()[1] == BEFORE
