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
