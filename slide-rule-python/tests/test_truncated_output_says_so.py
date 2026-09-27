"""回执里的输出被截了，就说截了、全长多少、源码该用什么读。

⚠ 2026-09-27 隔离真机第 48 轮 sr-20260927144042-WQZDYYDHHR（关西旅行 PPT + 追问配图）：
  模型用 `sed -n '1,260p' generate_ppt.py`、`'241,520p'`、`'1,180p'`、`'180,380p'`……
  把同一个生成脚本翻了近十遍。shell 回执只留屏幕最后 800 字、不说被截了，它以为
  窗口没打出来，就一遍遍缩小重来。

夹具是那一轮的生成脚本原样（148 行、9319 字）。事件流照真机：PTY 回显 + 输出都在
runtime.console。走 command_receipt_from（shell_exec / shell_wait / project_status 共用）。
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from services.project_tools import command_receipt_from, operation_snapshot

SCRIPT = (Path(__file__).parent / "fixtures" / "round48_generate_ppt.py.txt").read_text("utf-8")
ROUND48_SED = "sed -n '1,260p' generate_ppt.py"


class _Store:
    def __init__(self, command, output, **result):
        self.command, self.output, self.result = command, output, result
        self.events = [SimpleNamespace(type="runtime.console", seq=1,
                                       payload={"data": f"user@e2b:~/workspace$ {command}\r\n{output}\r\nuser@e2b:~/workspace$ "})]
        self.operation = SimpleNamespace(operationId="pop-48", kind="runtime.exec", status="completed",
                                         expectedRevision="prv-1", cancelRequested=False,
                                         input={"command": "shell", "script": command},
                                         result={"command": command, "exitCode": 0, **result})

    def get_operation(self, operation_id, *, owner_id):
        return self.operation

    def snapshot_operation(self, operation_id, *, owner_id):
        return {"operation": self.operation, "lastSeq": 1}

    def list_events(self, operation_id, *, owner_id, after_seq=0, limit=200):
        return [e for e in self.events if e.seq > after_seq][:limit]


def _receipt(command, output, **result):
    store = _Store(command, output, **result)
    adapter = SimpleNamespace(store=store, owner_id="alice",
                              _snapshot=lambda op: operation_snapshot(store.snapshot_operation(op, owner_id="alice")))
    return command_receipt_from(adapter, "pop-48")


def test_printing_a_long_script_says_it_was_cut_and_what_to_use():
    receipt = _receipt(ROUND48_SED, SCRIPT)
    assert receipt["excerptTruncated"] is True
    assert receipt["outputChars"] > len(SCRIPT)  # 回显那行也在屏幕上
    assert len(receipt["excerpt"]) < len(SCRIPT)
    assert "只有最后" in receipt["hint"] and "file_read" in receipt["hint"] and "start_line" in receipt["hint"]


def test_a_short_output_is_not_marked_cut():
    """反向：没截就不说截了。"""
    receipt = _receipt("sed -n '1,5p' generate_ppt.py", "\n".join(SCRIPT.splitlines()[:5]))
    assert "excerptTruncated" not in receipt and "只有最后" not in receipt["hint"]


def test_a_long_build_log_is_marked_cut_but_not_told_to_use_file_read():
    """反向：生成/构建的长日志也照实说截了，但那不是在读源码，不劝 file_read。"""
    receipt = _receipt("python3 generate_ppt.py", "progress line\n" * 200)
    assert receipt["excerptTruncated"] is True
    assert "file_read" not in receipt["hint"]


# 第 49 轮（员工信息登记 Excel）原样：openpyxl 核对命令，输出 1215 字——不是在翻文件。
ROUND49_CHECK = ("python3 -c \"from openpyxl import load_workbook; p='员工信息登记.xlsx'; w=load_workbook(p); "
                 "s=w['员工登记']; b=w['基础数据']; print('sheets=',w.sheetnames)\"")


def test_a_long_inspection_output_is_cut_but_not_told_to_use_file_read():
    receipt = _receipt(ROUND49_CHECK, "row value\n" * 150)
    assert receipt["excerptTruncated"] is True
    assert "file_read" not in receipt["hint"]
