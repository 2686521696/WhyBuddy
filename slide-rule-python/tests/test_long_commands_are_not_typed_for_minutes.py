"""长命令不许一个字一次往返地敲上一两分钟。

⚠ 2026-09-27 隔离真机第 43 轮 sr-20260927131842-Q10C6BF56R（IT 制度 Word + 追问核对
  标题层级）：852 字的 `python3 -c "…核对…"` 总耗时 105 s，其中打字 103.3 s——
  811 次单字 send_stdin，每次一个 E2B 往返（~0.127 s/字）。命令本身不到半秒。
  模型的前台等待被打字吃光，回执 running，只好 shell_wait 再等。

判据走真的 start_console（假 PTY 记下每一次 send_stdin），数写入次数。
把 _console_boot 改回逐字敲，第一条变红。
"""

from __future__ import annotations

import time

from services import e2b_workspace_provider as module
from tests.test_workspace_provider import setup_provider  # noqa: F401  (fixture)

# 第 43 轮那条核对命令，原样（op …b698d4）。
ROUND43_CHECK = "python3 -c \"from docx import Document; p='IT设备申领与归还管理制度.docx'; d=Document(p); text='\\n'.join(x.text for x in d.paragraphs); heads=['第一章 总则','第二章 适用范围与职责','第三章 设备分类与配置原则','第四章 设备申领流程','第五章 审批流程与权限','第六章 设备使用与日常管理','第七章 设备归还流程','第八章 异常情况与责任处理','第九章 离职、转岗与长期休假管理','第十章 记录、审计与信息安全','第十一章 附则','附件一 IT设备申领单','附件二 设备归还/验收单','附件三 IT设备异常情况报告单']; missing=[h for h in heads if h not in text]; flow='直属上级审批' in text and '部门负责人审批' in text and 'IT技术审核' in text and '设备配发' in text and '使用人验收' in text and '台账归档' in text; print({'readable':True,'paragraphs':len(d.paragraphs),'tables':len(d.tables),'missing_headings':missing,'approval_flow_complete':flow,'has_header':bool(d.sections[0].header.paragraphs[0].text),'has_footer':bool(d.sections[0].footer.paragraphs[0].text)}); assert not missing and flow and len(d.tables)>=10\" && unzip -t IT设备申领与归还管理制度.docx | tail -1"



def _typed(provider, handle, fake, command):
    provider.start_console(handle, command)
    deadline = time.time() + 2
    while provider.is_process_running(handle, "7") and time.time() < deadline:
        time.sleep(0.01)
    setup = next(i for i, chunk in enumerate(fake.pty.sent) if b"PROMPT_COMMAND" in chunk)
    return fake.pty.sent[setup + 1:-1]  # 去掉最后那一下回车


def test_a_long_command_is_typed_in_a_bounded_number_of_writes(setup_provider, monkeypatch):  # noqa: F811
    provider, handle, fake, _ = setup_provider
    monkeypatch.setattr(module, "CONSOLE_TYPE_INTERVAL", 0)
    assert len(ROUND43_CHECK) == 852
    writes = _typed(provider, handle, fake, ROUND43_CHECK)
    assert len(writes) <= module.CONSOLE_TYPE_MAX_WRITES, len(writes)
    assert b"".join(writes).decode("utf-8") == ROUND43_CHECK  # 一个字都不丢、不乱序


def test_a_short_command_still_types_one_character_at_a_time(setup_provider, monkeypatch):  # noqa: F811
    """反向：短命令照旧一字一敲——打字效果本身是设计（Manus 那条），别顺手删掉。"""
    provider, handle, fake, _ = setup_provider
    monkeypatch.setattr(module, "CONSOLE_TYPE_INTERVAL", 0)
    writes = _typed(provider, handle, fake, "npm ci --ignore-scripts")
    assert [len(w) for w in writes] == [1] * len("npm ci --ignore-scripts")
