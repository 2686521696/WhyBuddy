"""跑的测试全是模板自带、一字没改的：回执说清它测的是模板，不是这次的改动。

⚠ 2026-10-07 真机 r105 sr-20261007220722-0PQCTHFM8K（@visual-design-foundations 读书会报名页 token）：index.html 换成了
  静态报名页，tests/counter.test.mjs 没动，测的是模板的 increment()；收尾「核验结果：npm test：2 项通过」
  （project_tools._template_tests_sentence 头注）。走真回执入口 command_receipt_from，模板文件从仓库里真的模板读。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from services.project_creation import load_project_template
from services.project_tools import command_receipt_from, operation_snapshot

# 真机操作记录里存的原样（r106 pop-c9ccf518af5041838b6051742f2b8fa3）：模型传 `npm test`，托管安装器只存一个词。
#   第一版判据喂 "npm test"，全绿，真机一次没生效。
R105_COMMAND = "test"
R105_LOG = "✔ successive button actions advance the displayed count (1.356849ms)\nℹ tests 2\nℹ pass 2\nℹ fail 0\n"
SAYS = "工程模板自带的、一字没改"


class _Store:
    def __init__(self, command, files):
        self.files = files
        self.operation = SimpleNamespace(
            operationId="pop-1", projectId="prj-1", kind="runtime.exec", status="completed",
            expectedRevision="prv-1", cancelRequested=False, result={"command": command, "exitCode": 0})

    def snapshot_operation(self, operation_id, *, owner_id):
        return {"operation": self.operation, "lastSeq": 3}

    def get_operation(self, operation_id, *, owner_id):
        return self.operation

    def read_files(self, project_id, revision=None, *, owner_id):
        assert (project_id, revision) == ("prj-1", "prv-1")
        return dict(self.files)

    def list_events(self, operation_id, *, owner_id, after_seq=0, limit=200):
        return [SimpleNamespace(seq=1, type="runtime.console", payload={"data": R105_LOG})]


def _hint(command, files):
    store = _Store(command, files)
    adapter = SimpleNamespace(store=store, owner_id="alice",
                              _snapshot=lambda op: operation_snapshot(store.snapshot_operation(op, owner_id="alice")))
    return str(command_receipt_from(adapter, "pop-1").get("hint") or "")


def _r105_tree():
    files, _ = load_project_template("react-vite")
    files["index.html"] = "<!doctype html><link rel=stylesheet href=tokens.css><h1>社区读书会报名</h1>"
    files["tokens.css"] = ":root { --space-1: 0.25rem; }"
    return files


def test_the_r105_run_is_named_as_the_templates_own_tests():
    hint = _hint(R105_COMMAND, _r105_tree())
    assert SAYS in hint and "tests/counter.test.mjs" in hint


def test_without_the_boundary_the_receipt_would_not_say_it():
    """反向的前提：这句话不是回执本来就有的——换成 build 就没有。"""
    assert SAYS not in _hint("npm run build", _r105_tree())


@pytest.mark.parametrize("change", ["edited", "added"])
def test_tests_written_for_the_change_get_no_such_line(change):
    files = _r105_tree()
    if change == "edited":
        files["tests/counter.test.mjs"] += "\ntest('signup page has a label per input', () => {});\n"
    else:
        files["tests/signup.test.mjs"] = "import test from 'node:test';\ntest('tokens', () => {});\n"
    assert SAYS not in _hint(R105_COMMAND, files)


def test_a_raw_test_command_counts_too():
    """不走托管安装器的写法（cd … && npx vitest / node --test）也认。"""
    assert SAYS in _hint("cd /home/user/workspace && node --test tests/*.test.mjs", _r105_tree())


def test_the_tasks_template_counts_too():
    files, _ = load_project_template("react-vite-tasks")
    assert SAYS in _hint("cd /home/user/workspace && npm run test", files)
