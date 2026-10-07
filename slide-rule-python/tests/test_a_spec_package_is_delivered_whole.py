"""一个 SPEC 包（十几份文件、含 .json / .mmd）整包交到用户手里，不是只收前 8 份 .md。

⚠ 2026-10-07 真机 r100 sr-20261007203300-V6MJNJDCSG（@sliderule 小区共享工具借还 SPEC）：交付写了 19 份进 output/，
  产物库只有 8 份 .md——收集脚本到第 8 份就停（总索引 spec-package.md 丢了），.json / .mmd 后缀不认
  （project_workspace_artifacts 收集段、deliverable_kind.TEXT_DELIVERABLE_EXTENSIONS 头注）。
下面的文件清单就是那一轮 output/ 的原样；沙盒收集脚本原样跑。
"""

from __future__ import annotations

import json
import subprocess
import sys

from services import rehearsal_control as control
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT

R100_OUTPUT = [
    "acceptance_tests.md", "checks_ledger.json", "clarified_brief.json", "companion_log.json",
    "contracts/api-draft.md", "decision_mode.json", "docs/design.md", "docs/requirements.md", "docs/tasks.md",
    "effect_preview.md", "handoff_manifest.json", "open_items.md", "project_context.json", "prompt_pack.md",
    "README.md", "route_options.json", "spec-package.md", "spec_tree.json", "structure/state-flow.mmd",
    "traceability_matrix.json",
]


def _collect(root):
    reply = subprocess.run([sys.executable, "-c", ARTIFACT_IO_SCRIPT], text=True, capture_output=True,
                           input=json.dumps({"action": "collect-office", "root": str(root)}), check=True)
    return sorted(f["path"] for f in json.loads(reply.stdout)["files"])


def test_the_whole_r100_package_is_collected(tmp_path):
    for rel in R100_OUTPUT:
        path = tmp_path / "output" / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('{"ok": true}' if rel.endswith(".json") else f"# {rel}\n", "utf-8")
    got = _collect(tmp_path)
    assert got == sorted("output/" + rel for rel in R100_OUTPUT)
    assert "output/spec-package.md" in got and "output/spec_tree.json" in got and "output/structure/state-flow.mmd" in got


def test_working_files_outside_output_are_still_not_delivered(tmp_path):
    """反向：bridge/ 里的中间 JSON、根目录的 package.json 照旧不收（只认 output/）。"""
    (tmp_path / "bridge").mkdir()
    (tmp_path / "bridge" / "metadata.json").write_text("{}", "utf-8")
    (tmp_path / "package.json").write_text("{}", "utf-8")
    (tmp_path / "output").mkdir()
    (tmp_path / "output" / "spec_tree.json").write_text("{}", "utf-8")
    assert _collect(tmp_path) == ["output/spec_tree.json"]


def test_a_closing_that_only_links_json_is_looked_at():
    assert control._TEXT_LINK_HINT.search("[规格树](output/spec_tree.json)")


def test_every_collected_file_reaches_the_model_with_its_link(tmp_path):
    """收回来还得把链接交给模型：工作器收集 → 回执快照 → 给模型那句话，三处一路走真代码。

    ⚠ 2026-10-07 真机 r103（同一会话，在 output/machine/ 下补 12 份 json/mmd/yaml）：产物库收齐 20 份，
      回执三处还在 [:8]——模型说「回执被截断」，一条条重跑命令去拿后 12 份的链接，15 分钟耗光
      （deliverable_kind.MAX_DELIVERED_FILES 头注）。
    """
    from types import SimpleNamespace

    from services.project_office_artifacts import ProjectOfficeArtifactStore
    from services.project_runtime_worker import _RuntimeTask
    from services.project_store import ProjectStore
    from services.project_tools import _command_pointer, operation_snapshot

    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'p.db'}")
    try:
        made = store.create_project("s-spec", owner_id="alice", files={"README.md": "workspace"},
                                    template_version="whybuddy-workspace-1", plan_ref="plan-1")
        items = [{"path": "output/" + rel, "data": f"# {rel}\n".encode()} for rel in R100_OUTPUT]
        task = SimpleNamespace(provider=SimpleNamespace(collect_office_files=lambda _h: items), handle=object(),
                               store=store, owner_id="alice", original=SimpleNamespace(projectId=made.projectId),
                               result={"command": "python3 gen.py", "exitCode": 0})
        _RuntimeTask._collect_office_artifacts(task)
        rows = ProjectOfficeArtifactStore(store).list(made.projectId, owner_id="alice")
    finally:
        store.close()
    assert len(rows) == len(R100_OUTPUT)
    operation = SimpleNamespace(operationId="pop-1", kind="runtime.exec", status="completed",
                                expectedRevision="prv-1", cancelRequested=False, result=task.result)
    hint = _command_pointer(operation_snapshot({"operation": operation, "lastSeq": 3}), "")["hint"]
    for row in rows:
        assert f"[{row['path']}](/api/sliderule/projects/{made.projectId}/artifacts/{row['artifactId']})" in hint, row["path"]


def test_the_sandbox_cap_and_the_receipt_cap_are_one_number():
    """§四成对：沙盒脚本是字符串，import 不到常量；数对不上就是又一处「收了没给链接」或「给了链接没收」。"""
    from services.deliverable_kind import MAX_DELIVERED_FILES
    assert f"max_files = {MAX_DELIVERED_FILES}\n" in ARTIFACT_IO_SCRIPT


def test_every_deliverable_suffix_downloads_with_its_own_type():
    """§四生成侧/消费侧：交付清单加了后缀、下载路由的类型表没跟上，就是 octet-stream + 兜底名丢后缀（r104）。"""
    from routes.project_sources import _OFFICE_TYPES, _office_disposition
    from services.deliverable_kind import IMAGE_DELIVERABLE_EXTENSIONS, OFFICE_EXTENSIONS, TEXT_DELIVERABLE_EXTENSIONS
    every = OFFICE_EXTENSIONS | TEXT_DELIVERABLE_EXTENSIONS | IMAGE_DELIVERABLE_EXTENSIONS
    assert every - set(_OFFICE_TYPES) == set()
    assert 'filename="office-file.json"' in _office_disposition("spec_tree.json", ".json")
