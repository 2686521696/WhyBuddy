"""旧串出现好几处：回执说清几处、哪几行、两条出路；replace_all 能一次全换。

⚠ 2026-09-28 隔离真机第 92 轮 sr-20260928071407-JS538JZTFK（时间记录网页，追问「整体配色换成
  暖色调，按钮改成圆角」）：style.css 里同一个色值用在好几条规则里。回执只有裸的
  project_str_replace_ambiguous，没有提示、也没有「全部替换」，模型一轮撞了 10 次。
  夹具 round92_time_log_style.css.txt 是撞墙前那一版（prv-2ac17032…）原样：#f27a5b 出现 14 处。

判据走真 `_dispatch_tool`。把 kernel_str_replace_changes 里挂 hint 的那两行删掉，第一条变红；
把 _kernel_edit 里的 replace_all 透传删掉，第二、三条变红。
"""

from __future__ import annotations

from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch

CSS = (Path(__file__).parent / "fixtures" / "round92_time_log_style.css.txt").read_text("utf-8")
PATH = "src/style.css"
LINES = [i + 1 for i, line in enumerate(CSS.split("\n")) if "#f27a5b" in line]


def _saved(setup):
    create(setup)
    assert _dispatch(setup, "file_write", {"file": PATH, "content": CSS})["ok"] is True

    def read():  # 落库的原文，不走 file_read（它有回喂上限）
        project = setup.store.get_project_for_session(setup.state.sessionId, owner_id="alice")
        head = setup.store.get_revision(project.projectId, owner_id="alice").revision
        return setup.store.read_files(project.projectId, head, owner_id="alice")[PATH]
    return read


def test_the_round92_ambiguous_replace_says_how_many_and_where(setup):
    read = _saved(setup)
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "old_str": "#f27a5b", "new_str": "#e07a3f"})
    assert result["ok"] is False and result["error"] == "project_str_replace_ambiguous", result
    hint = result["hint"]
    assert f"出现了 {CSS.count('#f27a5b')} 处" in hint
    assert f"第 {LINES[0]}、{LINES[1]}" in hint          # 真的行号，1 起
    assert "replace_all=true" in hint and "前后" in hint  # 两条出路都说
    assert read() == CSS                                 # 反向：一处都没改


def test_replace_all_changes_every_occurrence(setup):
    read = _saved(setup)
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "old_str": "#f27a5b", "new_str": "#e07a3f",
                                                   "replace_all": True})
    assert result["ok"] is True, result
    after = read()
    assert "#f27a5b" not in after and after.count("#e07a3f") == CSS.count("#f27a5b")
    assert after.replace("#e07a3f", "#f27a5b") == CSS    # 别的一个字节都没动


def test_the_paired_replace_tools_take_the_same_switch(setup):
    """§四：search_replace（replace_all）与 project_str_replace（replaceAll）是同一条落库，一起改。"""
    read = _saved(setup)
    assert _dispatch(setup, "search_replace", {"path": PATH, "old_string": "#dedbd2", "new_string": "#eadfce",
                                               "replace_all": True})["ok"] is True
    assert _dispatch(setup, "project_str_replace", {"path": PATH, "oldStr": "#172331", "newStr": "#3a2618",
                                                    "replaceAll": True})["ok"] is True
    after = read()
    assert "#dedbd2" not in after and "#172331" not in after
    assert after.count("#eadfce") == CSS.count("#dedbd2") and after.count("#3a2618") == CSS.count("#172331")


def test_a_unique_match_still_replaces_once_without_the_switch(setup):
    """反向：默认仍是「唯一一处」语义；只出现一次的照常改，不需要 replace_all。"""
    read = _saved(setup)
    unique = next(line for line in CSS.split("\n") if line and CSS.count(line) == 1 and "#f27a5b" in line)
    result = _dispatch(setup, "file_str_replace", {"file": PATH, "old_str": unique, "new_str": unique + " "})
    assert result["ok"] is True, result
    assert read() == CSS.replace(unique, unique + " ", 1)
