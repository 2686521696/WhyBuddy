"""开发服务器已经在跑时，系统提示一开口就说清：build / check 会被撤回，确认构建走 project_verify。

⚠ 2026-09-30 隔离真机第 141 轮 sr-20260930035424-BJ13TVNV0V（小组作业分工看板网页，两轮追问）：三次运行各自
  一开口就并行 project_exec check + build，两条都被当场撤回（开发服务器 pop-5a2d… 从第一轮一直在跑）。
  撤回回执只进那一轮上下文，下一轮照犯。全库 56 次撤回分布在 46 轮。

判据走真 `_system_prompt` + 真 ProjectTools + SQL 存储，挡路的那条照真机摆（租约 processRefs 指向
running 的 runtime.start，见 test_queued_command_names_its_blocker._hold_runtime）。
把 _system_prompt 里挂这句的那段删掉，第一条变红；running_dev_server 不看 kind，第三条变红。
"""

from __future__ import annotations

from project_actor_support import project_actor  # noqa: F401  （夹具）
from test_project_tools import create, setup  # noqa: F401  （夹具）
from test_queued_command_names_its_blocker import _dispatch, _hold_runtime
from test_source_files_are_named_before_guessing import _prompt

MARK = "现在在跑，占着工程"


def test_the_round141_follow_up_hears_about_the_server_before_it_builds(setup):
    project = create(setup)
    holder = _hold_runtime(setup, project)
    prompt = _prompt(setup)
    assert MARK in prompt and holder in prompt, prompt[-1200:]
    sentence = prompt[prompt.index(holder):].split("。", 2)
    said = "。".join(sentence[:2])
    assert "project_verify" in said and "撤回" in said


def test_the_sentence_is_true_the_build_really_is_withdrawn(setup):
    """§一之二：提示说的撤回，真走一发就是撤回——同一个现场，同一个工人判据。"""
    project = create(setup)
    _hold_runtime(setup, project)
    assert MARK in _prompt(setup)
    result = _dispatch(setup, "project_exec", {"command": "build", "idempotencyKey": "build-board-v1",
                                                  "expectedRevision": project["revision"]})  # 第 141 轮的形状
    assert result.get("withdrawn") is True, {k: result.get(k) for k in ("error", "hint", "detail", "issues")}


def test_a_finishing_command_holding_the_lease_is_not_called_a_server(setup):
    """反向：占着租约的是会结束的命令，不是常驻服务器，不许这么说。"""
    project = create(setup)
    _hold_runtime(setup, project, kind="runtime.exec")
    assert MARK not in _prompt(setup)


def test_no_server_means_no_sentence(setup):
    """反向：没起服务器（第一轮），不编现场。"""
    create(setup)
    assert MARK not in _prompt(setup)


def test_a_server_already_being_stopped_is_not_called_running(setup):
    """反向：已发出取消的那台在停，排着的会轮到，不能说成占着。"""
    project = create(setup)
    holder = _hold_runtime(setup, project)
    setup.store.request_operation_cancel(holder, owner_id="alice")
    assert MARK not in _prompt(setup)
