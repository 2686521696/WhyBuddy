"""失败的命令点了技能里没有的文件：回执说没有，并给同一份就近清单（file_read 那边的 §四 另一半）。

⚠ 2026-09-29 隔离真机第 116 轮 sr-20260929103821-XA38NTEQSB（社区读书会志愿者招募方案 Word）：file_read
  `standards/structure/docx-structure.md` 猜错之后，下一轮改用 bash 再猜一次（下面 ROUND116 是操作记录里的原样），
  exit 2，回执只有 sed 的「No such file」。它要的 standards/structure/docx-*.md 就在同目录。

判据走真 worker（test_project_command_worker 夹具）跑这条命令，回执走真 command_receipt_from；技能包是
仓库里 office-skills.zip 原样。把 command_receipt_from 里挂 _missing_skill_files_sentence 的那两行删掉，第一条变红。
"""

from __future__ import annotations

from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import skill_catalog_store
from services.project_tools import ProjectTools, command_receipt_from
from services.skill_package_format import unpack_skill_zip
from test_project_command_worker import command_setup  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

ZIP = Path(__file__).resolve().parents[2] / "skills" / "seeds" / "office-skills.zip"
ROUND116 = ("sed -n '1,220p' .sliderule/skills/office-skills/resources/docx.md && printf '\\n---STRUCTURE---\\n' && "
            "sed -n '1,220p' .sliderule/skills/office-skills/standards/structure/docx-structure.md && "
            "printf '\\n---COLOR---\\n' && sed -n '1,180p' .sliderule/skills/office-skills/standards/color/docx-palettes.md")


class Catalog:
    def list_installed(self, owner_id):
        return [{"slug": "office-skills", "id": "office-skills"}] if owner_id == "alice" else []

    def unpack_package(self, pkg):
        return unpack_skill_zip(ZIP.read_bytes())


def _receipt(command_setup, monkeypatch, script, code, key):
    monkeypatch.setattr(skill_catalog_store, "get_skill_catalog_store", lambda: Catalog())
    store, project, provider, worker, _ = command_setup
    provider.command_code = code
    operation = worker.submit_command(project.projectId, owner_id="alice", expected_revision=project.currentRevision,
        approval_ref="plan-1", idempotency_key=key, command="shell", script=script)
    eventually(lambda: state(store, operation, "failed" if code else "stopped"))
    return command_receipt_from(ProjectTools(store, None, "alice"), operation.operationId)


def test_the_round116_guesses_are_named_with_the_real_folder(command_setup, monkeypatch):
    receipt = _receipt(command_setup, monkeypatch, ROUND116, 2, "r116-sed")
    hint = receipt["hint"]
    assert "office-skills 里没有 standards/structure/docx-structure.md" in hint
    assert "office-skills 里没有 standards/color/docx-palettes.md" in hint
    assert "standards/structure/docx-typography.md" in hint and "standards/color/docx-formal-navy.md" in hint
    assert "resources/docx.md 里没有" not in hint and "没有 resources/docx.md" not in hint   # 真有的那个不点名


def test_a_successful_command_is_left_alone(command_setup, monkeypatch):
    """反向：命令成功就不去翻技能包（通配符、目录名也一样不猜）。"""
    receipt = _receipt(command_setup, monkeypatch, ROUND116, 0, "r116-ok")
    assert "里没有" not in str(receipt.get("hint") or "")


def test_globs_and_folders_are_not_taken_for_missing_files(command_setup, monkeypatch):
    """反向：第 116 轮第一轮的 `find standards/structure -name 'docx-*.md'` 失败了也不许说目录「没有」。"""
    script = ("find .sliderule/skills/office-skills/standards/structure -maxdepth 1 -type f -name 'docx-*.md' "
              "&& cat .sliderule/skills/office-skills/standards/color/docx-*.md")
    receipt = _receipt(command_setup, monkeypatch, script, 1, "r116-glob")
    assert "里没有" not in str(receipt.get("hint") or "")
