"""失败的运行写出了文件：照收，但不许说成交付；exit 127 说出缺的是哪个程序。

⚠ 2026-09-27 隔离真机第 39 轮 sr-20260927121306-ZBCS34V7HW（项目进度 Excel，追问
  「工期改成按工作日」）：
  · 生成脚本写完 xlsx 后自检断言失败，exit 1。worker 照旧收回（失败也可能已写出
    文件，fail-open，见 _collect_office_artifacts 头注），回执却写「办公文件已收回……
    这就是交付」。
  · `pwd && rg --files …` exit 127，回执只有 project_command_failed——第 32、36、39
    轮模型都这么找文件，每次都多花一步。

两条都用那一轮回执的原样 excerpt，走 operation_snapshot（模型看得见的白名单）→
_command_pointer（command_receipt_from 用的同一对）。
"""

from __future__ import annotations

from types import SimpleNamespace

from services.project_tools import _command_pointer, operation_snapshot

ROUND39_FAILED = (
    "user@e2b:~/workspace$ python3 scripts/create_tracker.py\nTraceback (most recent call last):\n"
    "  File \"/home/user/workspace/scripts/create_tracker.py\", line 125, in <module>\n"
    "    assert s[\"E4\"].value == \"=D4-C4+1\"\n           ^^^^^^^^^^^^^^^^^^^^^^^^^^^\n"
    "AssertionError\nuser@e2b:~/workspace$ "
)
ROUND39_RG = (
    "user@e2b:~/workspace$ pwd && rg --files -g '*.py' -g '*.xlsx' -g '*.md' -g '*.txt'\n"
    "/home/user/workspace\nbash: rg: command not found\nuser@e2b:~/workspace$ "
)
XLSX = "项目进度跟踪.xlsx"
FACTS = {XLSX: {"charts": 0, "pictures": 0, "sheets": 1}}


def _receipt(saved, excerpt, command):
    operation = SimpleNamespace(operationId="pop-39", kind="runtime.exec", status="failed",
                                expectedRevision="prv-1", cancelRequested=False,
                                result={"command": command, **saved})
    return _command_pointer(operation_snapshot({"operation": operation, "lastSeq": 9}), excerpt)


def test_a_failed_run_that_wrote_a_file_is_not_called_the_delivery():
    receipt = _receipt({"exitCode": 1, "errorCode": "project_command_failed",
                        "officeFiles": [XLSX], "officeFacts": FACTS},
                       ROUND39_FAILED, "python3 scripts/create_tracker.py")
    hint = receipt["hint"]
    assert "这就是交付" not in hint
    assert "命令失败了" in hint and XLSX in hint and "别对用户说它是交付" in hint
    assert "AssertionError" in receipt["excerpt"]  # 失败本身仍在眼前


def test_a_successful_run_is_still_the_delivery():
    """反向：成功的运行照旧是交付，别把「失败」那句挂到它身上。"""
    receipt = _receipt({"exitCode": 0, "officeFiles": [XLSX], "officeFacts": FACTS},
                       "user@e2b:~/workspace$ python3 scripts/create_tracker.py\n", "python3 scripts/create_tracker.py")
    assert "这就是交付" in receipt["hint"] and "命令失败了" not in receipt["hint"]


def test_exit_127_names_the_missing_program():
    receipt = _receipt({"exitCode": 127, "errorCode": "project_command_failed",
                        "officeFilesHeld": [XLSX]},
                       ROUND39_RG, "pwd && rg --files -g '*.py' -g '*.xlsx' -g '*.md' -g '*.txt'")
    assert receipt["hint"].startswith("沙盒里没有 rg 这个程序")


def test_other_failures_do_not_claim_a_missing_program():
    """反向：exit 1 的 Traceback 不是「没有这个程序」。"""
    receipt = _receipt({"exitCode": 1, "errorCode": "project_command_failed",
                        "officeFiles": [XLSX], "officeFacts": FACTS},
                       ROUND39_FAILED, "python3 scripts/create_tracker.py")
    assert "沙盒里没有" not in receipt["hint"]
