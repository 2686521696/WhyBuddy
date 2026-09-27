"""只在看的命令，回执不挂「本该重新生成……不要写占位」那一段。

⚠ 2026-09-27 隔离真机 sr-20260927013213-9JXJJJ3RKY：pptx 已经收回，模型再跑
  `unzip -t … && tail -n 2 …` 核对包结构，回执挂着「这次命令没有产出新的办公文件……
  如果这条命令本该重新生成它，那次生成没有写出文件，库里仍是旧版。不要往源码树
  写占位……」。一条检查命令本来就没打算生成——跟「失败命令 / 装依赖不挂扫空句」
  （test_scan_sentence_only_when_it_is_news）是同一类噪声。

⚠ 那一段是 2026-09-24 review 为「重新生成静默失败」加的，反向判据钉住它还在：
  跑脚本、认不出、解析不了的命令照旧说全。

命令原样取自真机回执（第 20 轮的 unzip -t、第 18 轮的 python3 -c 读页数）。
把 `_command_pointer` 里 `_only_inspects` 那一支删掉，前两条变红；
把 `_only_inspects` 改成恒真，反向那几条变红。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services.project_tools import (
    _command_pointer, _only_inspects, command_receipt_from, operation_snapshot)

DECK = "2026年第三季度产品复盘.pptx"
URL = "/api/sliderule/projects/prj-1/artifacts/art-1"
LONG = "本该重新生成"


def _receipt(command, exit_code=0):
    operation = SimpleNamespace(
        operationId="pop-1", kind="runtime.exec", status="completed" if exit_code == 0 else "failed",
        expectedRevision="prv-1", cancelRequested=False,
        result={"command": command, "exitCode": exit_code,
                "officeFilesHeld": [DECK], "officeDownloads": {DECK: URL}})
    return _command_pointer(operation_snapshot({"operation": operation, "lastSeq": 3}), "")


ROUND20_UNZIP = f"unzip -t {DECK} >/tmp/pptx_check.txt && tail -n 2 /tmp/pptx_check.txt"
ROUND18_COUNT = (f"python3 -c \"from pptx import Presentation; p=Presentation('{DECK}'); "
                 f"print('slides',len(p.slides)); print('size',__import__('os').path.getsize('{DECK}'))\"")


@pytest.mark.parametrize("command", [ROUND20_UNZIP, ROUND18_COUNT])
def test_an_inspection_gets_the_short_receipt(command):
    hint = _receipt(command)["hint"]
    assert LONG not in hint and "占位" not in hint
    assert f"库里的办公文件没有变：{DECK}" in hint   # 库里有什么照样说（sr-20260924190011）
    assert f"({URL})" in hint                          # 链接照样给


@pytest.mark.parametrize("command", [
    "python3 generate_q3_review.py",                                    # 重新生成，可能静默失败
    f"python3 make_ppt.py && {ROUND18_COUNT}",                          # 生成 + 核对：有生成就算生成
    "python3 -c \"from pptx import Presentation; p=Presentation(); p.save('x.pptx')\"",
    f"cat part.bin > {DECK}",                                           # 重定向写进办公文件
    "python3 -c 'print(1",                                              # 截断 / 引号不配对：认不出
])
def test_anything_that_might_have_generated_keeps_the_full_warning(command):
    hint = _receipt(command)["hint"]
    assert LONG in hint and "没有产出新的办公文件" in hint


@pytest.mark.parametrize("command, expected", [
    (ROUND20_UNZIP, True),
    (ROUND18_COUNT, True),
    ("ls -la && du -sh .", True),
    (f"wc -c < {DECK}", True),                   # 从办公文件读，不是写
    ("ls 2>/dev/null", True),
    (f"unzip {DECK}", False),                    # 解包会写文件
    ("find . -name '*.tmp' -delete", False),
    ("sed -i s/a/b/ notes.md", False),
    ("npm run build", False),
    ("", False),
])
def test_only_inspects(command, expected):
    assert _only_inspects(command) is expected


# ── 真机那条核对命令有 397 字，快照里的 command 截在 240 ─────────────────────
#: sr-20260927052041-2V6K4Z5SPY 那一轮操作记录里的原样命令（没截断）。
ROUND21_VERIFY = 'python3 -c "from pptx import Presentation; p=Presentation(\'2026_Q3_产品复盘.pptx\'); print(\'slides=\',len(p.slides)); text=\'\\\\n\'.join(sh.text for sl in p.slides for sh in sl.shapes if hasattr(sh,\'text\')); checks=[\'2026 年第三季度\',\'12,800\',\'8.6%\',\'42%\',\'做成了 01\',\'做成了 02\',\'没做成的两件事\',\'下季度三件事\']; print(\'checks=\',[(c,c in text) for c in checks]); print(\'has_company_name=\', any(x in text for x in [\'公司\',\'产品名称\']))"'


class _Store:
    """假 store 只替换存储；_snapshot 照 ProjectTools._snapshot 的原样拼法走 operation_snapshot。"""

    def __init__(self, command):
        self.operation = SimpleNamespace(
            operationId="pop-1", kind="runtime.exec", status="completed", expectedRevision="prv-1",
            cancelRequested=False,
            result={"command": command, "exitCode": 0,
                    "officeFilesHeld": [DECK], "officeDownloads": {DECK: URL}})

    def snapshot_operation(self, operation_id, *, owner_id):
        return {"operation": self.operation, "lastSeq": 3}

    def list_events(self, operation_id, *, owner_id, after_seq=0, limit=200):
        return []


def _receipt_on_the_live_path(command):
    store = _Store(command)
    adapter = SimpleNamespace(store=store, owner_id="alice",
                              _snapshot=lambda op: operation_snapshot(store.snapshot_operation(op, owner_id="alice")))
    return command_receipt_from(adapter, "pop-1")


def test_the_real_long_verification_command_gets_the_short_receipt():
    assert len(ROUND21_VERIFY) > 240
    receipt = _receipt_on_the_live_path(ROUND21_VERIFY)
    # 真机的输入形状：模型看见的 command 是截断的，截断版自己是认不出的——
    # 第一版就是拿这个去判，所以真机上照旧挂了长句。
    assert len(receipt["command"]) == 240 and not _only_inspects(receipt["command"])
    assert LONG not in receipt["hint"]
    assert f"库里的办公文件没有变：{DECK}" in receipt["hint"]


def test_a_long_generating_command_still_gets_the_full_warning():
    """反向：全文判下来是生成，照旧说全。"""
    command = "python3 build_deck.py && " + ROUND21_VERIFY
    receipt = _receipt_on_the_live_path(command)
    assert LONG in receipt["hint"]
