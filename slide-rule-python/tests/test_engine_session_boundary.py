# -*- coding: utf-8 -*-
"""引擎 ⇄ 会话文件这条边，到底还剩什么（2026-08-29）。

## 这条边是最后一个组间环的全部内容

`drive ⇄ model_core` 这个环，2026-08-29 一路量下来：

    21 条  → 7 条   本轮运行控制面（取消/暂停/降级/重复）单独成 run_control crate。
                    `run_cancel` 本来在 platform、三个亲兄弟在 drive——同一件事
                    拆两个组，引擎为了读一个降级标记就得反过来依赖驱动组。
    7 条   → 6 条   `model_version_restore` 归组归错了（第五次栽在名字前缀上）：
                    它干的是「读会话 → 重建闭环 → D8 裁决 → 提交」，是编排不是模型核心。

剩下 6 条**全部**是同一件事：`v5_full_driver` 要用 7 个长在
`slide_rule_session.py` 里的**回合机制函数**。

## 为什么没接着拆（实测数据在这）

那 7 个函数一共 441 行，而它们又用到同文件里**另外 13 个模块级 helper**
（`_pick_readiness_chain` / `_resolve_role_mode` / `_should_degrade_brainstorm` …）。
也就是说要动的是 1101 行里的 700 多行——**那不是搬家，是把这个文件劈成两半**。

而且劈出来的那一半（能力选取 + 回合记账）该叫什么、归谁，是**职责边界的判断**，
不是重构能顺手带的。`pick_next_capabilities` 一个函数 213 行，是排程主路径。

所以这里立的是**边界判据**，不是修复：把"引擎从会话文件拿哪些名字"钉死。
多拿一个就红——逼下一个人当场说清是又长了一笔债，还是该动手拆了。

⚠ 这条判据**不是**在说现状是对的。它是在说：现状我量清楚了，边界在这里，
别再悄悄变宽。
"""

from __future__ import annotations

import ast
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = pathlib.Path(__file__).resolve().parents[1]

#: 引擎当前从会话文件拿的全部名字。**只许变少。**
#: 每一个都是「回合机制」——不是「读写会话」。这正是它们该被拆出去的理由。
ALLOWED = {
    "pick_next_capabilities",      # 213 行，排程主路径
    "pick_repair_capabilities",    # 44 行
    "commit_artifact",             # 80 行
    "record_capability_run_error",  # 38 行
    "append_reasoning_event",      # 32 行
    "append_replay_event",         # 28 行
    "_is_delivery_intent",         # 6 行
}


def _imported_names(path: pathlib.Path, module: str) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    out: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.ImportFrom) and (n.module or "").endswith(module):
            out.update(a.name for a in n.names)
    return out


class Test引擎只从会话文件拿这几个名字:
    def test_没有多拿(self):
        got = _imported_names(ROOT / "services" / "v5_full_driver.py", "slide_rule_session")
        extra = sorted(got - ALLOWED)
        assert not extra, (
            f"引擎又从 slide_rule_session 多拿了：{extra}。\n"
            f"这条边是最后一个组间环的全部内容——要么别拿，"
            f"要么就是该把回合机制那一半拆出去了（见本文件模块头的实测数据）。"
        )

    def test_名单只许变短(self):
        """⚠ 反向判据。拆走一个就要从名单里划掉，
        否则下一个人以为那笔债还在（同 baseline 只许变短）。"""
        got = _imported_names(ROOT / "services" / "v5_full_driver.py", "slide_rule_session")
        stale = sorted(ALLOWED - got)
        assert not stale, f"这些引擎已经不拿了，从 ALLOWED 里删掉：{stale}"

    def test_拿的确实都是回合机制不是读写会话(self):
        """⚠ 这条是上面两条的**意义**所在。

        如果引擎拿的是 `load_session` / `save_session`，那叫「引擎用会话存储」，
        天经地义，不该算债。它拿的是排程和记账——那是**引擎自己的东西被寄放在
        会话文件里**，所以才是债。名单里混进读写函数的话，这个判断就得重做。
        """
        assert not (ALLOWED & {"load_session", "save_session", "create_session", "delete_session"}), (
            "名单里混进了会话读写函数——那不是债，本文件的整个论证要重做"
        )


class Test那七个函数确实还缠在一起:
    """⚠ 钉住「没接着拆」的**理由**。哪天缠绕解开了（helper 变少了），
    这条会红——那是好消息：该动手拆了。"""

    def test_它们仍然依赖同文件里的一堆helper(self):
        import builtins

        src = (ROOT / "services" / "slide_rule_session.py").read_text(encoding="utf-8")
        tree = ast.parse(src)
        modlevel = {
            n.name
            for n in tree.body
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        bi = set(dir(builtins))
        need: set[str] = set()
        for n in tree.body:
            if not isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if n.name not in ALLOWED:
                continue
            local: set[str] = set()
            for x in ast.walk(n):
                if isinstance(x, ast.arg):
                    local.add(x.arg)
                elif isinstance(x, ast.Name) and isinstance(x.ctx, ast.Store):
                    local.add(x.id)
                elif isinstance(x, (ast.Import, ast.ImportFrom)):
                    local.update((a.asname or a.name).split(".")[0] for a in x.names)
                elif isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    local.add(x.name)
            for x in ast.walk(n):
                if isinstance(x, ast.Name) and isinstance(x.ctx, ast.Load):
                    if x.id in modlevel and x.id not in ALLOWED and x.id not in local and x.id not in bi:
                        need.add(x.id)
        assert len(need) >= 8, (
            f"这 7 个函数对同文件 helper 的依赖降到了 {len(need)} 个（{sorted(need)}）——"
            f"缠绕松了，**这是好消息**：拆出去的代价变小了，回头看看该不该动手。"
            f"顺手把这条判据的门槛调下来或删掉。"
        )
