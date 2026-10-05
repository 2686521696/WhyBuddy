"""文本交付物（.md / .txt / .csv）跟办公文件走同一条交付路：产物库 → 下载地址 → 完工闸。

⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004174725-J5XFTG8673：模型写了一份 Markdown。
  办公计划只认 .pptx / .docx / .xlsx，它就选了 web-app——建 Vite 工程、开端口、跑浏览器验收（失败），
  收尾给 `[team-weekly-meeting-guide.md](/home/user/workspace/team-weekly-meeting-guide.md)`，用户点不开。
  照 Manus 的做法：交付是「把文件附上」，不绑在「做网页」上。收尾那句话里的链接就是附件声明。

收尾原话、文档正文抄自那一轮（fixtures/text_deliverable_weekly_meeting.json）。
收集脚本跑的是沙盒里那份原样；链接收件走 _with_deliverable_links（所有对用户说话的出口都过它）。
"""

from __future__ import annotations

import asyncio
import base64
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from plan_approval_support import approved_plan_rows
from services import rehearsal_control as control
from services.control_goal_continuation import BLOCKER_TEXT
from services.control_run_service import ControlRunService
from services.deliverable_kind import (
    OFFICE_FILE,
    WORKSPACE_README,
    deliverable_suffix,
    is_auto_collected_text,
    is_deliverable_bytes,
)
from services.project_office_artifacts import ProjectOfficeArtifactStore, linked_text_deliverables
from services.project_runtime_worker import _RuntimeTask
from services.project_store import ProjectStore
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "text_deliverable_weekly_meeting.json").read_text("utf-8"))
CLOSING, PATH, DOCUMENT = FIXTURE["closing"], FIXTURE["path"], FIXTURE["document"]


@pytest.fixture
def project(tmp_path):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'p.db'}")
    made = store.create_project("s-doc", owner_id="alice",
                                files={"README.md": WORKSPACE_README, PATH: DOCUMENT},
                                template_version="whybuddy-workspace-1", plan_ref="plan-1")
    yield SimpleNamespace(store=store, id=made.projectId)
    store.close()


# —— 一、判定：什么配当交付物 ——

def test_text_bytes_are_deliverable_and_disguised_binary_is_not():
    assert is_deliverable_bytes(PATH, DOCUMENT.encode("utf-8"))
    assert is_deliverable_bytes("output/表.csv", "﻿门店,销售额\n朝阳,1200\n".encode("utf-8"))
    assert not is_deliverable_bytes("output/x.txt", b"\x00\x01binary")       # 二进制改后缀不算
    assert not is_deliverable_bytes("x.docx", b"# not a zip")                 # 办公文件仍然认 zip 包
    assert deliverable_suffix("a.mdx") is None and deliverable_suffix(".md") is None


def test_only_output_dir_text_is_collected_automatically():
    assert is_auto_collected_text("output/report.md")
    # 反向：工作区 README、源码里的说明、技能的中间件都不是交付
    assert not is_auto_collected_text("README.md")
    assert not is_auto_collected_text("docs/notes.md")
    assert not is_auto_collected_text("bridge/output.csv")


# —— 二、产物库 ——

def test_the_artifact_store_keeps_text_files_and_versions_them(project):
    office = ProjectOfficeArtifactStore(project.store)
    first = office.put(project.id, owner_id="alice", path=PATH, data=DOCUMENT.encode("utf-8"))
    office.put(project.id, owner_id="alice", path=PATH, data=(DOCUMENT + "\n补一句").encode("utf-8"))
    _meta, data = office.get_bytes(project.id, first["artifactId"], owner_id="alice")
    assert data.decode("utf-8").endswith("补一句")
    assert len(office.versions(project.id, first["artifactId"], owner_id="alice")) == 2
    with pytest.raises(ValueError):
        office.put(project.id, owner_id="alice", path="x.txt", data=b"\x00bin")


# —— 三、沙盒里自动收：跑沙盒那份脚本原样 ——

def test_the_sandbox_collector_takes_output_text_but_not_readme(tmp_path):
    (tmp_path / "output").mkdir()
    (tmp_path / "output" / "周会制度.md").write_text(DOCUMENT, "utf-8")
    (tmp_path / "output" / "blob.txt").write_bytes(b"\x00\x01")
    (tmp_path / "README.md").write_text(WORKSPACE_README, "utf-8")
    (tmp_path / "notes.md").write_text("草稿", "utf-8")
    reply = subprocess.run([sys.executable, "-c", ARTIFACT_IO_SCRIPT], text=True, capture_output=True,
                           input=json.dumps({"action": "collect-office", "root": str(tmp_path)}), check=True)
    files = json.loads(reply.stdout)["files"]
    assert [f["path"] for f in files] == ["output/周会制度.md"]
    assert base64.b64decode(files[0]["data"]).decode("utf-8") == DOCUMENT


def test_the_worker_keeps_collected_output_text(project):
    task = SimpleNamespace(
        provider=SimpleNamespace(collect_office_files=lambda _h: [
            {"path": "output/周会制度.md", "data": DOCUMENT.encode("utf-8")},
            {"path": "README.md", "data": WORKSPACE_README.encode("utf-8")},   # 反向：根目录 README 不收
        ]),
        handle=object(), store=project.store, owner_id="alice",
        original=SimpleNamespace(projectId=project.id), result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    paths = [row["path"] for row in ProjectOfficeArtifactStore(project.store).list(project.id, owner_id="alice")]
    assert paths == ["output/周会制度.md"]


# —— 四、收尾那句话里的链接 = 附件声明（真机原话） ——

def test_the_real_closing_links_the_file_that_is_in_the_source_tree():
    files = {"README.md": WORKSPACE_README, PATH: DOCUMENT}
    assert linked_text_deliverables(CLOSING, files) == [PATH]
    # 反向：链接对不上源码树的不猜；同名两份不按名字认
    assert linked_text_deliverables("[x](/home/user/workspace/missing.md)", files) == []
    assert linked_text_deliverables("[x](a.md)", {"d1/a.md": "1", "d2/a.md": "2"}) == []


def _say(project, text, kind):
    state = SimpleNamespace(projectId=project.id,
                            controlTranscript=approved_plan_rows("写周会制度", deliverable_kind=kind))
    token = control._PROJECT_TOOLS.set(SimpleNamespace(store=project.store, owner_id="alice"))
    try:
        return control._with_deliverable_links(state, text)
    finally:
        control._PROJECT_TOOLS.reset(token)


def test_saying_the_closing_delivers_the_file_and_rewrites_the_link(project):
    spoken = _say(project, CLOSING, OFFICE_FILE)
    rows = ProjectOfficeArtifactStore(project.store).list(project.id, owner_id="alice")
    assert [row["path"] for row in rows] == [PATH]
    assert f"/api/sliderule/projects/{project.id}/artifacts/{rows[0]['artifactId']}" in spoken
    assert "/home/user/workspace/" not in spoken                     # 用户点不开的沙盒路径没了


def test_a_web_project_linking_its_readme_is_not_a_file_delivery(project):
    """反向：网页工程收尾链一下 README.md 不是交付——收进产物库，画廊会把整个网页工程改判成文件卡。"""
    _say(project, "说明见 [README.md](README.md)，文档在 " + CLOSING, "web-app")
    assert ProjectOfficeArtifactStore(project.store).list(project.id, owner_id="alice") == []


def test_a_web_workspace_does_not_collect_output_text(tmp_path):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'web.db'}")
    made = store.create_project("s-web", owner_id="alice", files={"package.json": "{}"},
                                template_version="vite-1", plan_ref="plan-1")
    task = SimpleNamespace(
        provider=SimpleNamespace(collect_office_files=lambda _h: [
            {"path": "output/notes.md", "data": b"# notes"}]),
        handle=object(), store=store, owner_id="alice",
        original=SimpleNamespace(projectId=made.projectId), result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    assert ProjectOfficeArtifactStore(store).list(made.projectId, owner_id="alice") == []
    store.close()


def test_a_delivered_text_file_satisfies_the_office_goal(tmp_path, project, monkeypatch):
    """完工闸（has_any）看得见它：交出 Markdown 的办公目标算交付了；没交出的照旧缺项（fail-closed）。"""
    state = SimpleNamespace(controlTranscript=approved_plan_rows("写周会制度", deliverable_kind=OFFICE_FILE))
    service = SimpleNamespace(authorize=lambda *_a, **_k: state, project_store=project.store)
    monkeypatch.setattr(project.store, "get_project_for_session",
                        lambda _sid, owner_id: SimpleNamespace(projectId=project.id))
    record = {"sessionId": "s-doc", "ownerId": "alice"}
    assert asyncio.run(ControlRunService._goal_is_done(service, record)) is False
    assert asyncio.run(ControlRunService._goal_blocked_reasons(service, record)) == ["office_file_not_found"]
    ProjectOfficeArtifactStore(project.store).put(project.id, owner_id="alice", path=PATH,
                                                  data=DOCUMENT.encode("utf-8"))
    assert asyncio.run(ControlRunService._goal_is_done(service, record)) is True


# —— 五、编排：模型选得到这条路、知道怎么交 ——

def test_the_plan_tool_says_a_text_file_is_a_file_delivery_not_a_web_app():
    # 走模型真拿到的那份工具清单（list_control_tools），不读源码常量（§一）
    from models.v5_state import V5SessionState
    state = V5SessionState(sessionId="sr-text-deliver", ownerId="alice", goal={"text": "写一份周会制度说明"})
    tools = {t["function"]["name"]: t["function"] for t in control.list_control_tools(state)}
    said = tools["write_plan"]["description"]
    # 语义：.md 被归在 office-file 那一句里，而不是只出现在别处
    sentence = said[said.index("交给用户的是文件"):]
    assert ".md" in sentence[:sentence.index("office-file")]
    assert "output/" in said and "[文件名](路径)" in said
    assert ".md" in BLOCKER_TEXT["office_file_not_found"]          # 续跑提示不再只说办公三种
    assert "output/" in WORKSPACE_README


def test_a_reply_without_text_links_does_not_read_the_whole_source_tree(project, monkeypatch):
    """每句带链接的话都会过这里；没链到 .md / .txt / .csv 就不去网关上读整棵源码树。"""
    reads = []
    real = project.store.read_files
    monkeypatch.setattr(project.store, "read_files", lambda *a, **k: reads.append(1) or real(*a, **k))
    _say(project, "[下载 PPT](/home/user/workspace/output/deck.pptx)，[官网](https://example.com)", OFFICE_FILE)
    assert reads == []
    _say(project, CLOSING, OFFICE_FILE)
    assert reads == [1]                                             # 反向：真有文本链接时照读
