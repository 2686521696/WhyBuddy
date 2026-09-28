"""账号装了的技能，要真的出现在产线建出来的沙盒里。

⚠ 2026-09-28 隔离真机第 78 轮 sr-20260928004742-PZZS967DE4（装了 office-skills 与
  pptx-quality-gates，「@office-skills 按这个技能自带的 PPT 规范做」，追问「用 office-skills
  自带的校验脚本再检查一遍」）：技能工具描述写着「技能目录在工程沙盒
  .sliderule/skills/<name>/，脚本用 shell_exec 跑」。模型 `find .sliderule/skills/office-skills …`
  → 五个技能全是 No such file or directory；再 `find / -path '*/office-skills/*'`、
  `find /home/user -path '*/.sliderule/skills/*'`，最后「环境中没有单独安装名为 validate.py 的脚本」。
  开箱注水只接在 ProjectRuntimeService.start 上，而那条只给冒烟命令用（模块头自己写着），
  产线沙盒在 ProjectRuntimeSupervisor 的 worker 里建（本仓 §一）。

判据走真 worker（test_project_command_worker 的夹具），技能文件用仓库里 office-skills.zip
原样经 unpack_skill_zip / files_for_package 展开——只把「这个账号装了哪些」这一问换成桩。
把 worker 里 hydrate_owner_into 那支删掉，第一条变红。
"""

from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import skill_hydrate
from services.deliverable_kind import WORKSPACE_TEMPLATE_VERSION, office_workspace_files
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT
from services.skill_package_format import unpack_skill_zip
from test_project_command_worker import CommandProvider, command_setup  # noqa: F401  （夹具）
from test_project_runtime_worker import eventually, setup, state  # noqa: F401  （夹具）

REPO = Path(__file__).resolve().parents[2]
OFFICE_SKILLS_ZIP = REPO / "skills" / "seeds" / "office-skills.zip"


class Catalog:
    """账号装了 office-skills；展开走真的 unpack_skill_zip。"""

    def __init__(self, fail=False):
        self.fail = fail

    def list_installed(self, owner_id):
        if self.fail:
            raise RuntimeError("catalog down")
        return [{"slug": "office-skills", "id": "office-skills"}] if owner_id == "alice" else []

    def unpack_package(self, pkg):
        return unpack_skill_zip(OFFICE_SKILLS_ZIP.read_bytes())


class RecordingProvider(CommandProvider):
    def __init__(self):
        super().__init__()
        self.writes = []

    def write_files(self, handle, files):
        self.writes.append((handle.sandbox_id, sorted(files)))
        super().write_files(handle, files)

    def written_paths(self):
        return [path for _, paths in self.writes for path in paths]


def _office(command_setup, monkeypatch, catalog):
    store, _, _, worker, _ = command_setup
    provider = RecordingProvider()
    worker.provider_factory = lambda: provider
    monkeypatch.setattr(skill_hydrate, "get_skill_catalog_store", lambda: catalog)
    project = store.create_project(
        "session-office-skills", owner_id="alice", files=office_workspace_files(),
        template_version=WORKSPACE_TEMPLATE_VERSION, plan_ref="plan-1")

    def bash(key, script):
        operation = worker.submit_command(
            project.projectId, owner_id="alice", expected_revision=project.currentRevision,
            approval_ref="plan-1", idempotency_key=key, command="shell", script=script)
        return eventually(lambda: state(store, operation, "stopped"))

    return provider, bash


def test_a_fresh_office_sandbox_gets_the_installed_skill_files(command_setup, monkeypatch):
    provider, bash = _office(command_setup, monkeypatch, Catalog())
    # 第 78 轮模型发的第一条找技能的命令
    done = bash("find-skills", "find .sliderule/skills/office-skills -maxdepth 3 -type f | sort")
    assert done.status == "completed", done.result
    paths = provider.written_paths()
    assert ".sliderule/skills/office-skills/SKILL.md" in paths
    # SKILL.md 叫它读、叫它跑的那些也在（不只是那一份正文）
    assert ".sliderule/skills/office-skills/resources/pptx.md" in paths
    assert ".sliderule/skills/office-skills/scripts/office/pack.py" in paths
    assert done.result["skillFiles"] == len([p for p in paths if p.startswith(".sliderule/skills/")])


def test_the_reused_sandbox_is_not_rewritten_every_command(command_setup, monkeypatch):
    """反向：办公工作区一台沙盒跑到底（test_office_bash_reuses_one_sandbox_and_names_the_pptx），
    技能只在开箱那一次写，不是每条命令推一遍 60 个文件。"""
    provider, bash = _office(command_setup, monkeypatch, Catalog())
    bash("one", "python3 --version")
    first = len([p for p in provider.written_paths() if p.startswith(".sliderule/skills/")])
    second = bash("two", "ls")
    assert provider.created == 1
    again = len([p for p in provider.written_paths() if p.startswith(".sliderule/skills/")])
    assert first > 0 and again == first
    assert "skillFiles" not in second.result


def test_a_broken_catalog_does_not_stop_the_command(command_setup, monkeypatch):
    """§七：技能注水是增强项，商店炸了命令照跑。"""
    provider, bash = _office(command_setup, monkeypatch, Catalog(fail=True))
    done = bash("py", "python3 --version")
    assert done.status == "completed" and done.result["exitCode"] == 0
    assert done.result["skillFiles"] == 0
    assert not [p for p in provider.written_paths() if p.startswith(".sliderule/")]


def _minimal_zip():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
    return out.getvalue()


def test_the_collector_does_not_hand_back_a_skill_template_as_the_deliverable(tmp_path):
    """反向（新写进沙盒的东西不许冒充交付）：技能包可以带模板 .pptx，收回脚本跳过 .sliderule。
    跑的是沙盒里那份脚本原样。"""
    (tmp_path / ".sliderule" / "skills" / "deck-kit" / "templates").mkdir(parents=True)
    (tmp_path / ".sliderule" / "skills" / "deck-kit" / "templates" / "base.pptx").write_bytes(_minimal_zip())
    (tmp_path / "新品发布会.pptx").write_bytes(_minimal_zip())
    reply = subprocess.run([sys.executable, "-c", ARTIFACT_IO_SCRIPT], text=True, capture_output=True,
                           input=json.dumps({"action": "collect-office", "root": str(tmp_path)}), check=True)
    files = json.loads(reply.stdout)["files"]
    assert [f["path"] for f in files] == ["新品发布会.pptx"]
    assert base64.b64decode(files[0]["data"]).startswith(b"PK\x03\x04")
