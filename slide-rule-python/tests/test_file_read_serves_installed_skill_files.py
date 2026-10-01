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

# ⚠ 2026-10-01 webapp-testing 从种子下架（沙盒里 Chromium 起不来，见 skills/seeds/retired.json）。这里钉的是
#   「技能文件怎么读、目录怎么说」的通用行为，第 80/82 轮那份包原样留作夹具。
ZIP = Path(__file__).parent / "fixtures" / "round80_webapp_testing_skill.zip"
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


# ⚠ 2026-09-29 隔离真机第 116 轮 sr-20260929103821-XA38NTEQSB（社区读书会志愿者招募方案 Word）：两轮追问都
#   file_read `.sliderule/skills/office-skills/standards/structure/docx-structure.md`。清单按字母序截 30 条，
#   被 scripts/office/schemas/ 的 .xsd 占满，standards/ 排第 72，它要的那个目录一个也没露出来。
#   技能包是仓库里 office-skills.zip 原样。把 _skill_files_near 换回 sorted(package)[:30]，这条变红。
OFFICE_ZIP = Path(__file__).resolve().parents[2] / "skills" / "seeds" / "office-skills.zip"
ROUND116_PATH = ".sliderule/skills/office-skills/standards/structure/docx-structure.md"


class OfficeCatalog(Catalog):
    def list_installed(self, owner_id):
        return [{"slug": "office-skills", "id": "office-skills"}] if owner_id == "alice" else []

    def unpack_package(self, pkg):
        return unpack_skill_zip(OFFICE_ZIP.read_bytes())


def test_the_round116_guess_is_answered_with_its_own_folder_first(setup, monkeypatch):
    monkeypatch.setattr(skill_catalog_store, "get_skill_catalog_store", lambda: OfficeCatalog())
    package = unpack_skill_zip(OFFICE_ZIP.read_bytes())
    same_folder = sorted(p for p in package if p.startswith("standards/structure/"))
    assert same_folder and sorted(package).index(same_folder[0]) >= 30          # 夹具前提：字母序截 30 看不到
    create(setup)
    miss = execute(setup, "file_read", {"file": ROUND116_PATH})
    assert miss["ok"] is False and miss["error"] == "project_file_not_found"
    assert all(path in miss["hint"] for path in same_folder), miss["hint"]
    assert ".xsd" not in miss["hint"].split("standards/structure/")[0]          # 同目录排在一堆 schema 前面


def test_the_listing_still_names_the_skill_and_the_missing_file(setup, monkeypatch):
    """反向：排序变了，不许把「没有这个文件」这句话丢了，也不许把整包 100 个都倒出来。"""
    monkeypatch.setattr(skill_catalog_store, "get_skill_catalog_store", lambda: OfficeCatalog())
    create(setup)
    hint = execute(setup, "file_read", {"file": ROUND116_PATH})["hint"]
    assert "office-skills 里没有 standards/structure/docx-structure.md" in hint
    assert hint.count(", ") < 40 and "另" in hint
