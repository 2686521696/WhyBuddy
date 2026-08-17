"""合并必须发生在**真正在跑的那条生成链**上（2026-08-16 晚，代价惨痛）。

## 为什么单独有这个文件

Merge Patch 的实现和单测都对（test_refine_merge_patch.py 12 条 + 2 个变异全咬住），
但真机跑完发现诊断日志 `精修合并（RFC 7386）` **一次都没出现**——因为它接在
`generate_five_system_model` 上，而这一轮实际产出模型的是 **spec-first 链路**
（`v5_capability_executor.py:492` 的 `run_spec_first(...)["model"]`）。

代码装在了不通电的插座上。而这已经是同一天内第三次同类错误：

    改了闭环重建那一步      而模型是主循环里生成的
    改了提示词收尾          同样在没被使用的那一步
    合并接在老生成器        真正在跑的是 spec-first

三次都是**没先确认哪条路真的在跑**就动手，三次都靠真机日志才发现。

## 这条判据的作用

把"哪条链在跑"从事后靠日志发现，变成**当场红灯**。加了它之后，接错插座在
`pytest` 阶段就暴露，不用等 25 分钟真机跑。

## ⚠ 当前它是**故意红**的

spec-first 的出口返回的永远是一份**完整模型**（设计如此：从 spec 树重新生成），
补丁语义与之不兼容。所以这条现在会失败——那是**如实反映现状**，不是判据写坏了。

修复方向不是把 merge_patch 硬塞进去，而是沿用这个文件里已有的
`reuse_language` / `reuse_style_brief` 那套"精修沿用上一版"的做法，把它从
风格段扩展到模型段。见文末 TODO。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402


def _code(mod) -> str:
    """源码去注释去 docstring —— 本文件注释里就写着这些函数名，不剥必然假绿。"""
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_the_live_generator_is_spec_first_not_the_legacy_one():
    """先锁住"哪条链在跑"这个事实本身 —— 后面的判据都建在它上面。

    这条要是红了，说明链路换了，下面那条的前提就没了，得重新确认再改判据。
    """
    from services import v5_capability_executor as ex

    code = _code(ex)
    assert "run_spec_first(" in code, "spec-first 不在链路里了？先确认现状再改判据"
    at_spec = code.index("run_spec_first(")
    at_legacy = code.find("generate_five_system_model(")
    assert at_legacy == -1 or at_spec < at_legacy, (
        "老链路排到了 spec-first 前面 —— 主生成器变了"
    )


@pytest.mark.xfail(
    reason="spec-first 出口返回完整模型，补丁语义不兼容；见模块头与 TODO。"
         "这条故意留着红，作为「合并尚未落到真实链路」的活证据。",
    strict=True,
)
def test_the_merge_runs_on_the_path_that_actually_produces_the_model():
    """精修合并必须发生在 spec-first 的模型出口上。

    strict xfail：修好之后这条会变成 XPASS 而报错，逼着把 xfail 标记摘掉——
    不会出现"修好了但判据还挂着 xfail 没人发现"。
    """
    from services import v5_capability_executor as ex

    code = _code(ex)
    at = code.index('run_spec_first(')
    window = code[at:at + 900]
    assert "_apply_refine_patch" in window or "merge_patch" in window, (
        "spec-first 产出模型之后没有做任何精修合并 —— 没提到的段仍会被整段重写"
    )


# TODO(下一轮)：正确修法不是把 merge_patch 硬接在 spec-first 出口。
#   spec-first 天生"从 spec 树重新生成"，出口永远是完整模型。
#   该沿用同文件里已有的 `_reuse_style` / `_reuse_language`
#   （"精修沿用上一版风格段/设计语言"）那套做法，把"沿用上一版"从风格段
#   扩展到模型段：精修时未被指令涉及的段直接从基线复制，不进重新生成。
#   这跟 Kubernetes server-side apply 的字段归属是同一个思路——
#   谁拥有哪一段，重新生成就不许覆盖不属于它的部分。
