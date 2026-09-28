"""shell_exec / bash 的描述要跟校验说同一件事：多行能跑，上限多少。

⚠ 2026-09-27 隔离真机第 66 轮 sr-20260927192856-9BNQR8C0SD（应收账款 Excel）：模型把整个
  生成脚本写成一条 `python3 - <<'PY' …` 发出去，超过 2000 字被 project_tool_arguments_invalid
  打回，45 秒的生成白花，下一发才改成 file_write + python3 build_workbook.py。
  那时两处描述还写着「one-line command」「newlines are rejected」——第 31 轮放开多行时
  只改了校验（test_multiline_command_runs_in_the_console），描述没跟着改（§四）；上限一字没提。

判据从校验侧取真值（Field 的 max_length、classify_shell_command），不抄数字。
把描述改回「newlines are rejected」，第一条变红；把 {command_max} 换成写死的数字再改常量，第二条变红。
"""

from __future__ import annotations

import re

import pytest
from pydantic import ValidationError

from services.project_tool_contracts import (
    SHELL_COMMAND_MAX_CHARS,
    GithubBashArguments,
    ShellExecArguments,
    classify_shell_command,
    project_tool_definitions,
)

# 第 66 轮被打回那一发的开头，原样（后面是两千多字的 openpyxl 脚本）。
ROUND66_HEAD = "python3 - <<'PY'\nfrom openpyxl import Workbook, load_workbook\n"


def _descriptions():
    out = {}
    for item in project_tool_definitions():
        fn = item.get("function", item)
        if fn["name"] in {"shell_exec", "bash"}:
            out[fn["name"]] = fn["description"]
    assert set(out) == {"shell_exec", "bash"}
    return out


def test_neither_description_says_newlines_are_rejected():
    # 校验侧的真值：多行 heredoc 是被接受的
    assert classify_shell_command(ROUND66_HEAD + "print(1)\nPY")[0] == "shell"
    for name, text in _descriptions().items():
        lowered = text.lower()
        # 盯语义不盯字面：第一版查 "newlines are rejected"，原话 "Newlines and sudo are
        # rejected" 照样绿（§二）。同一句里出现 newline 和 reject 就算。
        assert not re.search(r"newlines?\b[^.]*\breject", lowered), name
        assert not re.search(r"one[- ]line (?:command|pty)", lowered), name
        assert "heredoc" in lowered, name


def test_both_descriptions_state_the_real_limit_and_the_way_around_it():
    for model in (ShellExecArguments, GithubBashArguments):
        limit = next(m.max_length for m in model.model_fields["command"].metadata if hasattr(m, "max_length"))
        assert limit == SHELL_COMMAND_MAX_CHARS
    for name, text in _descriptions().items():
        assert f"at most {SHELL_COMMAND_MAX_CHARS} characters" in text, name
        assert "file_write" in text, name


def test_the_limit_is_really_enforced():
    """反向：上限不是只写在描述里。"""
    script = ROUND66_HEAD + "x = 1\n" * SHELL_COMMAND_MAX_CHARS + "PY"
    with pytest.raises(ValidationError):
        ShellExecArguments(command=script)
    ShellExecArguments(command=ROUND66_HEAD + "print(1)\nPY")


def test_both_descriptions_say_where_the_chinese_fonts_are():
    """⚠ 第 74 轮 sr-20260927211536-5XX8MCNCKE：PIL 载 DejaVu 画插图，图里只好全写英文，
    给中国小学生看。镜像里其实有 Noto CJK。两处描述都要带上（§四），且是渲染出来的，
    不是留着占位符。"""
    from services.project_tool_contracts import SANDBOX_FONTS_NOTE
    for name, text in _descriptions().items():
        assert SANDBOX_FONTS_NOTE in text, name
        assert "{sandbox_fonts}" not in text, name
        assert "fc-list :lang=zh" in text and "DejaVu" in text, name


def test_the_font_note_gives_a_line_that_can_be_copied():
    """⚠ 第 75 轮 sr-20260927212952-0P836MAD1P：第一版只说「有 Noto CJK，载一个」，模型 fc-match
    查到了文件，PIL 那两行照旧 truetype(DejaVuSans-Bold.ttf)，图里的中文全成方块。
    要给到能照抄的调用：路径 + ImageFont.truetype，并说清 DejaVu 画中文是方块。"""
    from services.project_tool_contracts import SANDBOX_CJK_FONT, SANDBOX_FONTS_NOTE
    assert SANDBOX_CJK_FONT.endswith(".ttc") and SANDBOX_CJK_FONT.startswith("/usr/share/fonts/")
    assert f"ImageFont.truetype('{SANDBOX_CJK_FONT}'" in SANDBOX_FONTS_NOTE
    assert "boxes" in SANDBOX_FONTS_NOTE


def test_both_descriptions_say_rg_is_missing():
    """⚠ 第 32、36、39、72、80 轮都先敲 rg，command not found 再换。两处描述事先说。"""
    for name, text in _descriptions().items():
        assert "rg" in text and "not installed" in text and "grep -rn" in text, name


def test_both_descriptions_say_a_browser_cannot_run_in_the_sandbox():
    """⚠ 第 81～83 轮各烧 15 分钟装 Playwright，Chromium 缺 libnspr4 起不来（E2B 探针确认，装库要 root，
    平台拒 sudo）。两处描述事先说，并给出路：project_verify。"""
    for name, text in _descriptions().items():
        assert "libnspr4" in text and "project_verify" in text, name
