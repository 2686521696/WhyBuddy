"""传了查无此版的 revision：回执说工程当前是哪一版、只差一个字符的那版点名。闸不放松，照旧拒。

⚠ 2026-09-29 隔离真机第 128 轮 sr-20260929153009-SV45EX6FHQ（书签网页，追问「深色模式不要了，恢复成之前的样子」）：
  三发 project_list / project_search 带 revision=prv-f82aea105e78b2ac53cdbcc2882bb90b0（33 位，真的那版 32 位、
  多抄了一个字符），回执只有 project_revision_not_found。模型读成「版本号跟上下文不一致」，放弃按版本找回。
  下面照那个形状：真版本号尾巴多一个字符。

判据走真 _dispatch_tool。把 project_tools 里 project_revision_not_found 那一支删掉，第一条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch


def _two_revisions(setup):
    project = create(setup)
    first = project["revision"]
    assert _dispatch(setup, "file_write", {"file": "src/theme.css", "content": "body { color: #111; }\n"})["ok"]
    head = setup.store.get_project(project["projectId"], owner_id="alice").currentRevision
    assert head != first
    return first, head


def test_the_round128_extra_character_is_named(setup):
    first, head = _two_revisions(setup)
    mistyped = first + "0"                                  # 真机：多抄一个字符
    for tool, args in (("project_list", {"limit": 20}), ("project_search", {"query": "dark", "limit": 8})):
        result = _dispatch(setup, tool, {**args, "revision": mistyped})
        assert result["ok"] is False and result["error"] == "project_revision_not_found"   # 照旧拒
        hint = result["hint"]
        assert mistyped in hint and f"{first} 跟它只差几个字符" in hint and head in hint, hint


def test_an_unrelated_revision_gets_the_current_one_but_no_guess(setup):
    """反向：跟哪一版都不像，就不猜是哪一版，只说当前是哪一版、不传就是当前。"""
    _, head = _two_revisions(setup)
    result = _dispatch(setup, "project_search", {"query": "x", "revision": "prv-" + "0" * 32})
    assert result["error"] == "project_revision_not_found"
    assert head in result["hint"] and "抄错" not in result["hint"]


def test_a_real_old_revision_still_reads(setup):
    """反向：真有的旧版照常能读，不挂提示。"""
    first, _ = _two_revisions(setup)
    result = _dispatch(setup, "project_list", {"limit": 20, "revision": first})
    assert result["ok"] is True, result
    assert "这一版" not in str(result.get("hint") or "")
