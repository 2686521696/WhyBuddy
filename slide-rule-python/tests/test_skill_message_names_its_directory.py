"""skill 回执要说这份技能在沙盒哪个目录；正文里的相对路径相对它。

⚠ 2026-09-28 隔离真机第 80 轮 sr-20260928014044-76AFAFC2M1（读书打卡网页装了 webapp-testing，
  追问「用 webapp-testing 技能把新增、勾选完成、删除这几步真的点一遍」）：正文写
  `python scripts/with_server.py --help`，模型在工作区根原样照跑——脚本在
  .sliderule/skills/webapp-testing/scripts/ 下。回执只带一个 path 属性。

判据用仓库里 webapp-testing.zip 原样开箱、按商店的方式解析；回执里说的目录 + 正文里那条相对
路径，必须正好是开箱写进沙盒的那个路径（skill_hydrate.sandbox_relpath）——两边对不上就是
又指了一个不存在的地方。把 build_skill_message 里 lead 那段删掉，第一条变红。
"""

from __future__ import annotations

from pathlib import Path

from services.control_skills import SkillInfo, build_skill_message, skill_base_dir
from services.skill_catalog_store import parse_skill_md
from services.skill_hydrate import sandbox_relpath
from services.skill_package_format import skill_md_text, unpack_skill_zip

ZIP = Path(__file__).resolve().parents[2] / "skills" / "seeds" / "webapp-testing.zip"


def _webapp_testing():
    files = unpack_skill_zip(ZIP.read_bytes())
    info = parse_skill_md(skill_md_text(files), path=".sliderule/skills/webapp-testing/SKILL.md",
                          name="webapp-testing")
    return files, info


def test_the_message_names_the_directory_the_scripts_are_written_to():
    files, info = _webapp_testing()
    message = build_skill_message(info)
    assert "Base directory for this skill: .sliderule/skills/webapp-testing/" in message
    # 第 80 轮模型照抄的那条相对路径
    assert "python scripts/with_server.py --help" in info.body
    assert "scripts/with_server.py" in files
    assert skill_base_dir(info) + "scripts/with_server.py" == sandbox_relpath("webapp-testing", "scripts/with_server.py")


def test_the_body_is_still_there_whole():
    """反向：加的是一句目录说明，正文一个字不少。"""
    _, info = _webapp_testing()
    assert info.body in build_skill_message(info)


def test_a_skill_without_a_sandbox_path_gets_no_made_up_directory():
    """反向：没有 .../SKILL.md 形状的 path 就不编一个目录。"""
    bare = SkillInfo(name="x", description="d", path="", body="正文", enabled=True)
    assert "Base directory" not in build_skill_message(bare)
