"""「这次扫描没有合格的办公文件」只在它是消息的时候说。

⚠ 2026-09-26 隔离真机 sr-20260926043506-7B49NNSE1M：失败的 `python3 create_ppt.py`
  和 `pip install python-pptx` 的回执都挂着这句。一条失败了（失败本身才是消息），
  一条只是装依赖（本来就不产出文件）。它该出现的只有一种：命令成功跑完、
  却什么都没收回——3d9bfd12 加它时就是为这个。

四条回执都照那一轮的原样字段拼（command / exitCode / officeScan）。
把 `_command_pointer` 里的判断改回 `officeScan == "empty"` 就说，前两条变红；
把它整个删掉，后两条变红。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services.project_tools import _command_pointer, _only_installs, operation_snapshot

SENTENCE = "没有合格的办公文件"


def _receipt(command, exit_code, excerpt=""):
    operation = SimpleNamespace(
        operationId="pop-1", kind="runtime.exec", status="completed" if exit_code == 0 else "failed",
        expectedRevision="prv-1", cancelRequested=False,
        result={"command": command, "exitCode": exit_code, "officeScan": "empty"})
    return _command_pointer(operation_snapshot({"operation": operation, "lastSeq": 3}), excerpt)


def test_a_failed_command_is_about_its_failure_not_the_scan():
    receipt = _receipt("python3 create_ppt.py", 1,
                       "ModuleNotFoundError: No module named 'pptx'")
    assert SENTENCE not in receipt["hint"] and "officeScan" not in receipt


def test_installing_dependencies_is_not_expected_to_produce_a_file():
    receipt = _receipt("pip install python-pptx", 0, "Successfully installed python-pptx-1.0.2")
    assert SENTENCE not in receipt["hint"] and "officeScan" not in receipt


def test_a_successful_script_that_left_nothing_behind_is_told_so():
    receipt = _receipt("python3 create_ppt.py", 0, "saved 10")
    assert SENTENCE in receipt["hint"] and receipt["officeScan"] == "empty"


def test_install_then_generate_is_a_generating_command():
    receipt = _receipt("pip install python-pptx && python3 create_ppt.py", 0, "saved 10")
    assert SENTENCE in receipt["hint"]


def test_a_hidden_failure_does_not_get_the_scan_sentence_either():
    """退出码 0 但日志尾说失败（_hidden_command_failure）：同样是失败在说话。"""
    receipt = _receipt("python3 create_ppt.py; echo EXIT:$?", 0, "Traceback (most recent call last)\nEXIT:1")
    assert receipt.get("commandOk") is False
    assert SENTENCE not in receipt["hint"]


@pytest.mark.parametrize("command, expected", [
    ("pip install python-pptx", True),
    ("pip3 install -q python-pptx openpyxl", True),
    ("python3 -m pip install python-docx", True),
    ("npm install pptxgenjs", True),
    ("npm i", True),
    ("sudo apt-get -y install libreoffice", True),
    ("pip install x && npm ci", True),
    ("pip install x && python3 gen.py", False),
    ("python3 create_ppt.py", False),
    ("pip list", False),
    ("npm run build", False),
    ("", False),
])
def test_only_installs(command, expected):
    assert _only_installs(command) is expected
