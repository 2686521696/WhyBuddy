"""file_read 读已装技能的任意文件（不只 SKILL.md）。

⚠ 2026-09-28 隔离真机第 82 轮 sr-20260928024607-KCH4NABCBH（记账网页装了 webapp-testing，追问「用 webapp-testing
  把添加记录、修改、删除点一遍」）：模型 file_read
  `.sliderule/skills/webapp-testing/examples/element_discovery.py`、`console_logging.py` →
  project_file_not_found，没有提示。file_read 读的是源码树；技能文件在沙盒（开箱写进去的），
  只有 SKILL.md 开了口子。

判据走真 ProjectTools.execute，技能包是仓库里 webapp-testing.zip 原样经 files_for_package 展开，
只把「装了哪些」换成桩；路径是第 82 轮那两条原样。把 _skill_package_files 那支删掉，第一条变红。
"""

from __future__ import annotations

from pathlib import Path

from project_actor_support import project_actor  # noqa: F401  （夹具）
from services import skill_catalog_store
from services.skill_package_format import unpack_skill_zip
from test_project_tools import create, execute, setup  # noqa: F401  （夹具）

ZIP = Path(__file__).resolve().parents[2] / "skills" / "seeds" / "webapp-testing.zip"
ROUND82_PATHS = (".sliderule/skills/webapp-testing/examples/element_discovery.py",
                 ".sliderule/skills/webapp-testing/examples/console_logging.py")


class Catalog:
    def list_installed(self, owner_id):
        return [{"slug": "webapp-testing", "id": "webapp-testing"}] if owner_id == "alice" else []

    def unpack_package(self, pkg):
        return unpack_skill_zip(ZIP.read_bytes())


def _installed(monkeypatch):
    monkeypatch.setattr(skill_catalog_store, "get_skill_catalog_store", lambda: Catalog())
    return unpack_skill_zip(ZIP.read_bytes())


def test_the_round82_example_files_are_read(setup, monkeypatch):
    package = _installed(monkeypatch)
    create(setup)
    for path in ROUND82_PATHS:
        rel = path.split("webapp-testing/", 1)[1]
        read = execute(setup, "file_read", {"file": path, "start_line": 0, "end_line": 400})
        assert read["ok"] is True, read
        assert read["content"] == package[rel][:len(read["content"])] and read["content"]
        assert "不在工程源码里" in read["hint"] and path in read["hint"]


def test_a_file_the_skill_does_not_have_lists_what_it_has(setup, monkeypatch):
    _installed(monkeypatch)
    create(setup)
    miss = execute(setup, "file_read", {"file": ".sliderule/skills/webapp-testing/examples/nope.py"})
    assert miss["ok"] is False and miss["error"] == "project_file_not_found"
    assert "examples/element_discovery.py" in miss["hint"]


def test_a_skill_that_is_not_installed_is_not_served(setup, monkeypatch):
    """反向：没装的技能不许冒出文件来（不从种子库兜底）。"""
    monkeypatch.setattr(skill_catalog_store, "get_skill_catalog_store", lambda: Catalog())
    create(setup)
    miss = execute(setup, "file_read", {"file": ".sliderule/skills/mcp-builder/reference/x.md"})
    assert miss["ok"] is False and miss["error"] == "project_file_not_found"
