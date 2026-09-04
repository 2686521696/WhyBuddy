# -*- coding: utf-8 -*-
"""导航项检查跟渲染用同一把尺子（2026-09-05 真机第 4 轮抓到）。

## 事故

真机 sr-20260904214530（汉字连线消除小游戏）三页全报：

    [spec_first_pipeline] 外壳统一后仍不一致：p1.nav —
      导航项 ['挑战主', '限时对局', '战绩结算与历史']
      跟 spec 的页面清单 ['挑战主页', '限时对局页', '战绩结算与历史页'] 对不上

两个毛病叠在一起：

1. **两侧口径不一致（§4）**：导航项是 `nav_tab_label()` 渲染的——它会剥
   产品名前缀、剥「某某页」的「页」；而检查侧拿的是 **spec 原名**。
   于是**只要有一页的名字以「页」结尾，这条检查就必然报错**，跟壳对不对得上
   毫无关系。一条系统性误报的检查，下一个人只会学会忽略它——比没有更糟。
   （这跟今天那道「一直开火的闸」是同一种病，只是它一直在喊狼来了。）

2. **「主页」被当成后缀剥了**：「挑战主页」→「挑战主」。`首页` 早就在白名单里，
   `主页` 漏了；剥完 `len >= 2` 那道保险拦不住它（「挑战主」正好 3 个字）。
"""

import pytest

from services.page_naming import nav_tab_label


class Test主页不是后缀:
    @pytest.mark.parametrize("name", ["挑战主页", "首页", "个人主页"])
    def test_主页首页原样保留(self, name):
        assert nav_tab_label(name) == name, f"{name} 的「页」是词的一部分，不该剥"

    @pytest.mark.parametrize("name,want", [
        ("限时对局页", "限时对局"),
        ("战绩结算与历史页", "战绩结算与历史"),
        ("古籍列表页", "古籍列表"),
    ])
    def test_真后缀照剥(self, name, want):
        """★ 反向配对：别为了修一个词把整条规则关掉。

        剥「页」这条规则本身是对的（2026-08-20 芸编智管：五项 × 390px，
        「页」单独折成第三行）。
        """
        assert nav_tab_label(name) == want


class Test两侧同一把尺子:
    def test_检查侧用的就是渲染侧那个函数(self):
        """★ §1/§4：不切字符串，直接解析 `check_shell_consistency` 的 AST，
        看 `want = [...]` 那个表达式里到底调没调 `nav_tab_label`。

        ⚠ 第一版是按"锚点往前 1200 字"切片找的，变异（把 want 改回 spec 原名）
          之后判据照样绿——窗口里还有别的东西。切片锚点选错就是咬不住
          （本仓第二条）。
        """
        import ast
        import inspect

        from services import page_shell

        fn = None
        for node in ast.walk(ast.parse(inspect.getsource(page_shell))):
            if isinstance(node, ast.FunctionDef) and node.name == "check_shell_consistency":
                fn = node
        assert fn is not None, "check_shell_consistency 改名了——判据跟着失效"

        # ⚠ 这个函数里有**两个** `want = ...`（另一个算 aside 偏移），
        #   取最后一个会拿错。按"它读的是 spec.pages"来认人。
        want_expr = None
        for node in ast.walk(fn):
            if (isinstance(node, ast.Assign) and len(node.targets) == 1
                    and getattr(node.targets[0], "id", None) == "want"
                    and "pages" in ast.dump(node.value)):
                want_expr = node.value
        assert want_expr is not None, "找不到那个按 spec.pages 算导航清单的 `want`"
        calls = {
            getattr(c.func, "id", getattr(c.func, "attr", None))
            for c in ast.walk(want_expr) if isinstance(c, ast.Call)
        }
        assert "nav_tab_label" in calls, (
            f"检查侧算 want 时没用渲染那把尺子（用到的是 {sorted(x for x in calls if x)}）"
            f"——只要有页名以「页」结尾就会系统性误报"
        )

    def test_一页名字带页时不再误报(self):
        """端到端：spec 里带「页」，渲染出来剥掉，两边仍应判一致。"""
        spec_names = ["挑战主页", "限时对局页", "战绩结算与历史页"]
        rendered = [nav_tab_label(n) for n in spec_names]
        want = [nav_tab_label(n) for n in spec_names]   # 检查侧同一把尺子
        assert rendered == want, "同一把尺子量两遍还不一样，那是尺子有随机性"
        assert rendered == ["挑战主页", "限时对局", "战绩结算与历史"]
