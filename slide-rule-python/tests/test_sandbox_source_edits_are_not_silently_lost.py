"""办公工作区里，命令在沙盒里改了工程源码：回执点名「只在沙盒里、下一条命令会被还原」。

⚠ 2026-09-29 隔离真机第 107 轮 sr-20260929070420-W29Y3BK1EP（设计工作室员工手册 Word）：追问「把考勤与休假那一章改成表格」，
  模型用 python heredoc 在沙盒里改 scripts/create_handbook.py 并重新生成（10 张表）；源码里的脚本没变。
  下一个追问读源码、在源码上改页眉页脚，worker 开跑前按源码重写沙盒——考勤表格被还原，7 张表。

判据走真 worker（test_project_command_worker 夹具），provider 的 sha256sum 回显按沙盒里真实的样子给。
把 run_command 里 _note_sandbox_only_edits 那一行删掉，第一条变红。
"""

from __future__ import annotations

import hashlib

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files
from services.project_tool_contracts import project_tool_definitions
from services.project_tools import _command_pointer, operation_snapshot
from services.workspace_provider import ProcessResult
from test_project_command_worker import CommandProvider, command_setup  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

SCRIPT = "add_heading(doc, '第三章 考勤与休假', 1)\nadd_para(doc, '按月统计考勤。')\n"
EDITED = SCRIPT.replace("add_para(doc, '按月统计考勤。')", "add_table(doc, ['类型', '天数'], [['年假', '5']])")
ROUND107_EDIT = ("python3 - <<'PY'\nfrom pathlib import Path\np=Path('scripts/create_handbook.py')\n"
                 "s=p.read_text()\np.write_text(s.replace('add_para', 'add_table'))\nPY\n"
                 "python3 scripts/create_handbook.py")


def _sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class SandboxProvider(CommandProvider):
    """sha256sum 回显的是沙盒里命令跑完之后的样子。"""
    after: dict = {}

    def run(self, handle, command, **kwargs):
        self.commands.append(command)
        files = {**self.contents, **self.after}
        lines = [f"{_sha(text)}  {name}" for name, text in files.items() if name in command]
        return ProcessResult(stdout="\n".join(lines) + "\n", exit_code=0)


def _office(command_setup, provider_after, key):
    store, _, _, worker, _ = command_setup
    provider = SandboxProvider()
    provider.after = provider_after
    worker.provider_factory = lambda: provider
    project = store.create_project(f"session-{key}", owner_id="alice",
        files={**office_workspace_files(), "scripts/create_handbook.py": SCRIPT},
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")
    operation = worker.submit_command(project.projectId, owner_id="alice",
        expected_revision=project.currentRevision, approval_ref="plan-1", idempotency_key=key,
        command="shell", script=ROUND107_EDIT)
    done = eventually(lambda: state(store, operation, "stopped"))
    snap = operation_snapshot(store.snapshot_operation(operation.operationId, owner_id="alice"))
    return done, snap, _command_pointer(snap, "", full_command=ROUND107_EDIT), provider


def test_the_round107_sandbox_edit_is_named_before_it_is_lost(command_setup):
    done, snap, receipt, _ = _office(command_setup, {"scripts/create_handbook.py": EDITED}, "r107-drift")
    assert done.status == "completed", done.result
    assert snap["sandboxOnlyEdits"] == ["scripts/create_handbook.py"]
    assert "只在沙盒里" in receipt["hint"] and "file_write" in receipt["hint"] and "重写回去" in receipt["hint"]


def test_an_untouched_source_tree_gets_no_warning(command_setup):
    """反向：命令只生成文件、没改源码，不许唠叨。"""
    _, snap, receipt, _ = _office(command_setup, {}, "r107-clean")
    assert "sandboxOnlyEdits" not in snap
    assert "只在沙盒里" not in receipt.get("hint", "")


def test_a_web_project_does_not_probe(command_setup):
    """反向：网页工程每条命令一台新沙盒、跑完回收，没有「下一条」可还原，不多跑一条命令。"""
    store, project, provider, worker, _ = command_setup
    operation = worker.submit_command(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key="r107-web", command="shell", script="echo hi")
    eventually(lambda: state(store, operation, "stopped"))
    assert not any(str(c).startswith("sha256sum") for c in provider.commands)


def test_both_shell_descriptions_say_sandbox_source_edits_do_not_stick():
    """§四：shell_exec 与 bash 同一个工人，两处都要事先说清。"""
    for item in project_tool_definitions():
        fn = item.get("function", item)
        if fn["name"] in {"shell_exec", "bash"}:
            assert "re-written from the saved source before every command" in fn["description"], fn["name"]
