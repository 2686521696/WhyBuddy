"""工具的写权限是**声明出来的能力**，缺省只读，由分发强制。

抄的标准答案：grok-build `xai-tool-protocol/src/capabilities.rs`

    pub enum ToolScope { Read, Write }
    /// Tools that mutate external state must declare `Write` so the
    /// computer hub routes them to the leader agent only.
    /// Absence is treated as `Read`.

那边写权限是**工具自己声明的字段**、由路由强制；缺省 Read 意味着新工具
默认不能写，要写得显式声明。

本仓 KD3 说的是同一件事，但只是文档里的一段话：
「只有 rehearse/refine/repair 可生成新五系统模型。challenge 只失效；
 restore_version/fork_variant 只移/复制指针。无工具可写 blocked=false」
靠人读文档遵守 —— 而这个仓自己的第三条写着「函数写对了 ≠ 它被调用了」，
同理：纪律写对了 ≠ 它被强制了。

这里的「写」精确指**生成新五系统模型**，也就是进工厂信封
（`_handoff_factory` 是唯一那道门，rehearse 经
`_confirm_rehearse_and_handoff` 也归它）。

⚠ challenge / restore_version / fork_variant 在这条轴上是 READ，
  **不代表它们不落盘**：challenge 写 staleArtifactIds、restore/fork 移指针，
  都会 persist。这条轴只管「能不能造一份新模型」。别看见 READ 就以为
  它们不碰会话——也别为了"看着一致"把它们提成 WRITE，那会让这道闸失去意义。

反向：把 rehearse 的 WRITE 声明删掉 / 把闸从 _handoff_factory 拿掉 /
只在 forced 一条路上设 scope —— 三种都必须红。
"""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.rehearsal_control import (  # noqa: E402
    CLOSED_TOOLS,
    TOOL_SCOPE,
    ToolScope,
    resolve_tool_scope,
)


def test_default_is_read_absence_means_read():
    """缺省只读：没声明的工具（含以后新加的）一律不能进工厂。"""
    assert resolve_tool_scope("一个还没声明过的新工具") is ToolScope.READ
    assert resolve_tool_scope("") is ToolScope.READ
    assert resolve_tool_scope(None) is ToolScope.READ


def test_only_the_three_model_writers_declare_write():
    """能造新五系统模型的 WRITE 动词。工厂单跳与 rehearse 同一把闸。"""
    writers = {n for n in CLOSED_TOOLS if resolve_tool_scope(n) is ToolScope.WRITE}
    assert writers == {
        "rehearse",
        "workflow",
        "spec",
        "pages",
        "structure",
        "bind",
        "closure",
        "refine",
        "repair",
    }, (
        f"能造新五系统模型的工具集变了：{sorted(writers)}。"
        "多一个 = 闸被绕过；少一个 = 那个动词点不着火。"
    )


def test_pointer_movers_and_invalidator_are_read_on_this_axis():
    """这条轴只管"能不能造新模型"，不是"落不落盘"。"""
    for name in ("challenge", "restore_version", "fork_variant"):
        assert resolve_tool_scope(name) is ToolScope.READ, (
            f"{name} 被提成 WRITE 了——它不生成新模型，提上去这道闸就没意义了"
        )


def test_cheap_tools_are_read():
    for name in ("ask_user", "clarify", "search_evidence", "inspect_model", "scope_card"):
        assert resolve_tool_scope(name) is ToolScope.READ


def test_scope_table_only_covers_closed_tools():
    """声明表不许出现闭集之外的名字（拼错的声明 = 静默失效的闸）。"""
    unknown = set(TOOL_SCOPE) - set(CLOSED_TOOLS)
    assert unknown == set(), f"TOOL_SCOPE 里有闭集之外的名字：{sorted(unknown)}"


# ── 强制：声明了还得真的拦住 ──────────────────────────────────────


def test_read_scope_tool_cannot_reach_the_factory_envelope():
    """通电：READ 工具走到 _handoff_factory 必须抛，不是靠自觉绕开。

    这条是整个模块的意义所在——没有它，TOOL_SCOPE 就只是一张装饰表。
    """
    import asyncio

    from services import rehearsal_control as rc

    async def _run():
        with rc.tool_scope_scope("inspect_model"):
            async for _ in rc._handoff_factory(
                _bare_state(),
                "随便",
                None,
                None,
                "desktop",
                None,
                repair=False,
                profile="app",
            ):
                pass

    with pytest.raises(rc.ToolScopeViolation) as err:
        asyncio.run(_run())
    assert "inspect_model" in str(err.value)


def test_write_scope_tool_passes_the_gate():
    """反向配对：WRITE 工具不许被这道闸误伤。"""
    from services import rehearsal_control as rc

    # 只验闸本身放行，不真跑工厂：闸在函数最前面。
    with rc.tool_scope_scope("rehearse"):
        rc.assert_may_write_model()  # 不抛即通过


def test_unset_scope_is_fail_closed():
    """没进过 tool_scope_scope（比如有人绕过分发直调）→ 缺省 READ → 拦。"""
    from services import rehearsal_control as rc

    with pytest.raises(rc.ToolScopeViolation):
        rc.assert_may_write_model()


def test_both_dispatch_paths_set_the_scope():
    """成对改：LLM 选工具那条和 forcedTool 那条都要设，少一条就是半个闸。"""
    import inspect
    import re

    from services import rehearsal_control as rc

    src = re.sub(r'"""[\s\S]*?"""', "", inspect.getsource(rc))
    src = re.sub(r"#.*", "", src)
    hits = src.count("tool_scope_scope(")
    assert hits >= 3, (
        f"tool_scope_scope 只出现 {hits} 次（定义 1 + 两条分发路径 2）。"
        "只在一条路上设 = 另一条路上的工具全是缺省 READ 或全不设防。"
    )


def _bare_state():
    from models.v5_state import V5SessionState

    return V5SessionState(
        sessionId="scope-guard",
        goal={"text": "随便一个应用", "status": "clear"},
    )
