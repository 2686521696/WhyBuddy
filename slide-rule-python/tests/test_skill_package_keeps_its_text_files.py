"""技能包里的文本文件全都要开箱，不按后缀挑。

⚠ 2026-09-28 隔离真机第 79 轮 sr-20260928012108-PZDWPXT0K9（@office-skills，追问「用 office-skills 自带的
  校验脚本再检查一遍」）：技能文件第一次真进了沙盒（test_installed_skills_reach_the_sandbox），
  模型找到 scripts/office/validate.py 去跑，失败在「缺 schemas/ecma/fouth-edition/
  opc-relationships.xsd」。office-skills.zip 100 个文件只开出 60 个——39 个 .xsd 是 UTF-8 的
  XML，被后缀白名单丢了。用修好后的开箱在本地 venv 里跑同一个 validate.py 对一份真 PPTX：
  「All validations PASSED!」。

判据用仓库里那份 office-skills.zip 原样。把 _looks_text 改回按后缀挑，前两条变红。
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

from services.skill_package_format import unpack_skill_zip

ZIP = Path(__file__).resolve().parents[2] / "skills" / "seeds" / "office-skills.zip"


def _entries():
    with zipfile.ZipFile(ZIP) as z:
        return {i.filename.split("/", 1)[1]: z.read(i) for i in z.infolist() if not i.is_dir()}


def test_the_validator_schemas_come_out_of_the_box():
    files = unpack_skill_zip(ZIP.read_bytes())
    # 第 79 轮 validate.py 报缺的那一份
    assert "scripts/office/schemas/ecma/fouth-edition/opc-relationships.xsd" in files
    schemas = [p for p in _entries() if p.startswith("scripts/office/schemas/")]
    assert schemas and all(p in files for p in schemas)


def test_every_text_file_in_the_package_is_unpacked():
    """文本 = 没有 NUL、能按 UTF-8 解开。这样的文件一个都不许少。"""
    files = unpack_skill_zip(ZIP.read_bytes())
    text = [p for p, data in _entries().items() if b"\x00" not in data and _utf8(data)]
    assert sorted(files) == sorted(text)


def _utf8(data):
    try:
        data.decode("utf-8")
        return True
    except UnicodeDecodeError:
        return False


def _pack(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        for name, data in entries.items():
            z.writestr(name, data)
    return out.getvalue()


def test_binaries_are_still_skipped_and_a_latin1_text_does_not_sink_the_package():
    """反向：字体、图片（带 NUL）照旧跳过；上一版后缀命中就不验 UTF-8，一份 latin-1 的
    .txt 会让整包 decode 抛错。现在它被跳过，包照常开出来。"""
    files = unpack_skill_zip(_pack({
        "kit/SKILL.md": "---\nname: kit\ndescription: d\n---\n",
        "kit/fonts/a.ttf": b"\x00\x01\x00\x00font",
        "kit/notes.txt": "café".encode("latin-1"),
        "kit/schema.xsd": "<xs:schema/>",
    }))
    assert set(files) == {"SKILL.md", "schema.xsd"}
