"""图片交付物（图表、导出的页面图）：跟办公文件、文本交付物同一条交付路——沙盒里收回、进产物库、链接换成真地址。

⚠ 2026-10-07 真机 r85 sr-20261007155747-HMKAPNJ7WK（@data-visualization-discipline 四店销售趋势图）：模型画了两张 PNG、
  看过、改过、再看过，收尾两个链接都是 404——产物库只收办公文件和文本（deliverable_kind.IMAGE_DELIVERABLE_EXTENSIONS 头注）。
收尾原话在 fixtures/r85_chart_closing.json；沙盒那份收集脚本原样跑；图是 Pillow 画的真 PNG。
"""

from __future__ import annotations

import base64
import io
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from PIL import Image

from services.deliverable_kind import is_auto_collected_output, is_deliverable_bytes
from services.project_office_artifacts import ProjectOfficeArtifactStore, rewrite_deliverable_links
from services.project_runtime_worker import _RuntimeTask
from services.project_store import ProjectStore
from services.project_workspace_artifacts import ARTIFACT_IO_SCRIPT

R85 = json.loads((Path(__file__).parent / "fixtures" / "r85_chart_closing.json").read_text("utf-8"))
MAIN, MASKED = R85["images"]


def _png(color=(30, 90, 200)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (320, 200), color).save(out, format="PNG")
    return out.getvalue()


@pytest.fixture
def project(tmp_path):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'p.db'}")
    made = store.create_project("s-chart", owner_id="alice", files={"README.md": "workspace"},
                                template_version="whybuddy-workspace-1", plan_ref="plan-1")
    yield SimpleNamespace(store=store, id=made.projectId)
    store.close()


def test_real_images_are_deliverable_and_disguised_text_is_not():
    assert is_deliverable_bytes(MAIN, _png())
    assert not is_deliverable_bytes("output/chart.png", b"# not really a png")      # 改后缀的文本不算图
    assert not is_deliverable_bytes("output/chart.jpg", _png())                      # 头对不上后缀也不算


def test_only_output_dir_images_are_collected_automatically():
    assert is_auto_collected_output(MAIN)
    assert not is_auto_collected_output("public/logo.png")         # 网页素材不是交付
    assert not is_auto_collected_output("chart.png")               # 根目录的草稿图也不是


def test_the_sandbox_collector_takes_output_images_only(tmp_path):
    (tmp_path / "output").mkdir()
    (tmp_path / "output" / Path(MAIN).name).write_bytes(_png())
    (tmp_path / "output" / "fake.png").write_bytes(b"not an image")
    (tmp_path / "public").mkdir()
    (tmp_path / "public" / "logo.png").write_bytes(_png())
    reply = subprocess.run([sys.executable, "-c", ARTIFACT_IO_SCRIPT], text=True, capture_output=True,
                           input=json.dumps({"action": "collect-office", "root": str(tmp_path)}), check=True)
    files = json.loads(reply.stdout)["files"]
    assert [f["path"] for f in files] == [MAIN]
    assert base64.b64decode(files[0]["data"]) == _png()


def test_the_worker_keeps_collected_output_images(project):
    task = SimpleNamespace(
        provider=SimpleNamespace(collect_office_files=lambda _h: [
            {"path": MAIN, "data": _png()}, {"path": MASKED, "data": _png((90, 90, 90))},
            {"path": "chart.png", "data": _png()},                                      # 反向：根目录的不收
        ]),
        handle=object(), store=project.store, owner_id="alice",
        original=SimpleNamespace(projectId=project.id), result={},
    )
    _RuntimeTask._collect_office_artifacts(task)
    office = ProjectOfficeArtifactStore(project.store)
    rows = office.list(project.id, owner_id="alice")
    assert sorted(row["path"] for row in rows) == sorted([MAIN, MASKED])
    _meta, data = office.get_bytes(project.id, rows[0]["artifactId"], owner_id="alice")
    assert data[:8] == b"\x89PNG\r\n\x1a\n"


def test_the_real_closing_links_become_the_real_downloads(project):
    """r85 收尾原话：`/artifacts/<文件名>.png`——最后一段是文件名不是 id。产物库里同名只有一份，就换成那份的地址。"""
    office = ProjectOfficeArtifactStore(project.store)
    main = office.put(project.id, owner_id="alice", path=MAIN, data=_png())
    masked = office.put(project.id, owner_id="alice", path=MASKED, data=_png((90, 90, 90)))
    base = f"/api/sliderule/projects/{R85['projectId']}/artifacts/"
    downloads = {MAIN: base + main["artifactId"], MASKED: base + masked["artifactId"]}
    out = rewrite_deliverable_links(R85["closing"], downloads)
    assert f"]({base}{main['artifactId']})" in out and f"]({base}{masked['artifactId']})" in out
    assert "/artifacts/门店上半年销售额趋势.png)" not in out                       # 原来那条 404 的不在了


def test_a_name_that_matches_two_files_is_not_guessed(project):
    """反向：同名两份（不同目录）不猜——猜错比点不开更糟。"""
    base = "/api/sliderule/projects/prj-x/artifacts/"
    downloads = {"output/a/chart.png": base + "art-" + "a" * 40, "output/b/chart.png": base + "art-" + "b" * 40}
    text = f"[图]({base}chart.png)"
    assert rewrite_deliverable_links(text, downloads) == text


def test_the_download_names_the_image_type():
    """下载头的媒体类型表认图片（右栏取字节拼 Blob 时用得上；没登记就是 application/octet-stream）。"""
    from routes.project_sources import _OFFICE_TYPES
    assert {_OFFICE_TYPES[ext] for ext in (".png", ".jpg", ".jpeg", ".gif", ".webp")} == {
        "image/png", "image/jpeg", "image/gif", "image/webp"}


def test_the_plan_and_the_gate_both_say_images_are_files():
    from services import rehearsal_control as control
    from services.control_goal_continuation import BLOCKER_TEXT
    plan = next(t for t in control.CONTROL_TOOLS if t["function"]["name"] == "write_plan")["function"]["description"]
    assert ".png" in plan and ".png" in BLOCKER_TEXT["office_file_not_found"]
