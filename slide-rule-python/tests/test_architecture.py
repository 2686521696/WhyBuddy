# -*- coding: utf-8 -*-
"""架构边界闸：这是我们的「编译器」。

## 为什么有这个文件

2026-08-29 对照 grok-build（`docs/欠缺模块清单-对照Claude与Grok-build.md` §16）：

    grok-build   架构图 0 张。91 个 crate 在 Cargo.toml 里显式声明依赖，
                 347 条边由**编译器**强制；循环依赖在 Rust 里编译不出来。
    WhyBuddy     架构图 17 张全手画，265 个模块 394 条边**零强制**。

手画的后果量到过：已知缺口图六条里四条早就不成立、19 个模块块有 12 个从没画过。
代码这边同样飘：62% 的内部 import 写在函数体里（绕环的标准手法），5 个真的环。

**他们的架构图是编译器画的，我们的是人画的。** 这个文件补的就是那个编译器。

## 三条判据，各挡一件事

    未声明的跨包依赖变多   → 红（对应「没声明就编译不过」）
    新增循环依赖           → 红（对应「循环依赖编译不出来」）
    图与代码不同步         → 红（对应「根 Cargo.toml 是生成的」）

第三条是用户真正要的那条：**多台电脑改了代码不重新生成，图就不一致**。
判据把「重新生成一遍，看看和仓里那份一不一样」变成机器的事。

## ⚠ 这道闸自己也得咬得住

本仓 2026-08-29 刚数过一轮「闸装上了 ≠ 闸咬得动」（§14）。所以这里每条判据
都配了变异验证，而且第一条判据是**扫描器自己没瞎**——写 arch_graph 的第一版
就把 472 个测试文件算进了依赖图（`"tests/" in str(p)` 匹配不到 `tests/foo.py`，
因为没有前导斜杠），噪音把真信号整个盖住。
"""

import os
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import arch_graph  # noqa: E402

_G = arch_graph.build_graph()
_M = arch_graph.load_manifest()


class Test扫描器自己没瞎:
    """⚠ 排第一。扫描集不对，下面三条全是绿灯空过。"""

    def test_扫到的是产线代码不是测试(self):
        assert _G.files_scanned > 200, f"只扫到 {_G.files_scanned} 个文件，判据会空过"
        assert not any(m.startswith("tests.") for m in _G.modules), (
            "测试文件被算进依赖图了——第一版就栽在这（路径是 tests/foo.py，"
            "没有前导斜杠，`\"tests/\" in str(p)` 匹配不到）"
        )

    def test_核心模块都在图里(self):
        for m in ("services.v5_full_driver", "routes.sliderule_full",
                  "services.spec_first_pipeline"):
            assert m in _G.modules, f"{m} 不在图里，扫描范围漏了"

    def test_函数体里的import也算数(self):
        """⚠ 全仓 62% 的 import 在函数体里。不算 = 默认放行三分之二的依赖，
        而且给了一句话绕过闸的办法：把 import 挪进函数。"""
        deferred = sum(1 for e in _G.edges if e.deferred)
        assert deferred > 100, f"只认出 {deferred} 条函数体内 import，解析器坏了"
        assert any(
            e.deferred and e.src.startswith("services.") for e in _G.edges
        ), "services 里一条函数体内 import 都没认出来"


class Test依赖必须先声明:
    """对应 grok 的「没声明就编译不过」。"""

    def test_没有新增的未声明依赖(self):
        now = set(arch_graph.layer_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("violations", []))
        new = sorted(now - base)
        assert not new, (
            f"新增了未声明的跨包依赖：{new}。\n"
            f"要么改代码别这么依赖，要么在 architecture.toml 的 may_depend_on 里"
            f"**显式声明**（并写清为什么）。不许直接塞进 baseline。"
        )

    def test_基线只许变短(self):
        """⚠ 反向判据：棘轮不能倒着转。基线里躺着已经修好的条目，
        下一个人会以为那笔欠账还在。"""
        now = set(arch_graph.layer_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("violations", []))
        stale = sorted(base - now)
        assert not stale, (
            f"这些欠账已经还清了，从 architecture.toml 的 baseline 里删掉：{stale}"
        )

    def test_分层声明本身是自洽的(self):
        """⚠ 反向判据：声明里不许出现不存在的层，也不许自己依赖自己。"""
        layers = _M.get("layer", {})
        assert layers, "architecture.toml 没有 layer 声明，判据会空过"
        for name, spec in layers.items():
            for dep in spec.get("may_depend_on", []):
                assert dep in layers, f"{name} 声明依赖了不存在的层 {dep}"
                assert dep != name, f"{name} 声明依赖了自己"


class Test循环依赖只许变少:
    """对应 grok 的「循环依赖编译不出来」。Rust 里编译器管，Python 得自己数。"""

    def test_没有新增的环(self):
        # ⚠ 口径是**跨 component**：同一个「crate」内部互指是允许的（见
        #   Test同一个crate内部允许互指）。三处（CLI / 这里 / 生成的图）必须同口径，
        #   少算一项就会误报，而误报的闸下一个人会直接注释掉。
        now = set(arch_graph.cross_component_cycles(_G, _M))
        base = set(_M.get("baseline", {}).get("cycles", []))
        new = sorted(now - base)
        assert not new, (
            f"新增了循环依赖：{new}。\n"
            f"Python 不会因此报错——它会让你把 import 挪进函数体里继续跑，"
            f"然后在某次 reload 或某个新入口上炸。"
        )

    def test_基线里的环还在_修好了就删掉(self):
        now = set(arch_graph.cross_component_cycles(_G, _M))
        base = set(_M.get("baseline", {}).get("cycles", []))
        stale = sorted(base - now)
        assert not stale, (
            f"这些环已经拆掉了，从 architecture.toml 的 baseline 里删掉：{stale}"
        )

    def test_环的签名是规范化的(self):
        """⚠ 同一个环换个起点就成了「新环」的话，棘轮基线会被自己搅乱。"""
        for c in arch_graph.find_cycles(_G):
            members = c.split(" -> ")
            assert members[0] == members[-1], f"环签名没闭合：{c}"
            assert members[0] == min(members[:-1]), f"环签名没从最小成员起转：{c}"


class Test图与代码同步:
    """⚠ 用户要的正是这一条：**多台电脑改了代码不重新生成，图就不一致**。

    对应 grok 的「根 Cargo.toml 是生成的，treat it as read-only」。
    """

    def test_仓里那份图就是现在重新生成的那份(self):
        assert arch_graph.DIAGRAM.exists(), (
            f"{arch_graph.DIAGRAM} 不在——跑 "
            f"`python slide-rule-python/arch_graph.py --emit` 生成"
        )
        want = arch_graph.render_doc(_G, _M)
        got = arch_graph.DIAGRAM.read_text(encoding="utf-8")
        assert got == want, (
            "架构图和代码对不上了。**不要手改那个文件**，跑：\n"
            "  slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit"
        )

    def test_生成是确定性的(self):
        """⚠ 不确定就等于没修：两台电脑生成的文件不一样，判据每次都红，
        下一个人就会把它注释掉——而「多台电脑不一致」正是要治的病。"""
        a = arch_graph.render_doc(arch_graph.build_graph(), _M)
        b = arch_graph.render_doc(arch_graph.build_graph(), _M)
        assert a == b, "同一份代码生成了两份不同的图"

    def test_图上标着不许手改(self):
        head = arch_graph.DIAGRAM.read_text(encoding="utf-8")[:400]
        assert "不要手改" in head, "生成的图必须自己声明是生成的，否则一定有人手改它"


class Test闸能被真的绕过吗:
    """⚠ 反向判据：想清楚这道闸挡不住什么，写下来，别让人以为它全包。"""

    def test_动态import挡不住_已知边界(self):
        """`importlib.import_module("services.x")` 这类动态 import 是 AST 看不见的。

        这不是缺陷，是**边界**：写下来，免得下一个人以为这道闸全包。
        真要挡，得上运行时钩子，代价另算。
        """
        src = (arch_graph.ROOT / "arch_graph.py").read_text(encoding="utf-8")
        assert "import_module" not in src.split('"""')[2], (
            "如果哪天支持了动态 import，把这条判据改掉"
        )

    def test_命令行闸与判据同源(self):
        """⚠ CI 跑 `--check`，本地跑 pytest，两条路必须给同一个答案——
        否则就是本仓第四条：同一件事两个实现，改一个不改另一个。"""
        r = subprocess.run(
            [sys.executable, str(arch_graph.ROOT / "arch_graph.py"), "--check"],
            capture_output=True, text=True,
        )
        base = _M.get("baseline", {})
        # ⚠ 三项都要算进来。少算一项，命令行红而这里判 clean，判据会**误报**——
        #   而误报的闸下一个人会直接注释掉（§14.2 记过这个形状）。
        clean = (
            not (set(arch_graph.layer_violations(_G, _M)) - set(base.get("violations", [])))
            and not (
                set(arch_graph.cross_component_cycles(_G, _M)) - set(base.get("cycles", []))
            )
            and not (
                set(arch_graph.services_violations(_G, _M))
                - set(base.get("services_violations", []))
            )
        )
        assert (r.returncode == 0) == clean, (
            f"命令行闸与 pytest 判据结论不一致：exit={r.returncode} clean={clean}\n{r.stdout}"
        )


class Test叶子层不许碰上层:
    """抄 grok 的叶子 crate：他们把 51 个共用工具切成独立 crate，依赖方向由
    编译器焊死——大块能用叶子，叶子永远碰不到大块。

    我们 195 个 services 模块平铺在一个命名空间里，谁都能 import 谁，
    **这正是「463 条 import 藏在函数体里」的根**：放文件头会循环导入，只好挪进
    函数体。分层之后方向被钉住，环没地方长，import 才有可能挪回文件头。

    ⚠ 分层是从今天的真实依赖深度算出来的（棘轮基线），不是重新设计。
      所以今天只有 1 条越层——闸的价值在**从今往后**，不在此刻抓到多少。
    """

    def test_分层声明覆盖了每个services模块(self):
        """⚠ 先钉住覆盖率：漏掉的模块不受任何约束，而判据看不出来。"""
        spec = _M.get("services_layer", {})
        assert spec, "architecture.toml 没有 services_layer 声明"
        declared = {m for cfg in spec.values() for m in cfg.get("modules", [])}
        actual = {m for m in _G.modules if m.startswith("services.")}
        missing = sorted(actual - declared)
        assert not missing, (
            f"这些 services 模块没落进任何一层，等于不受约束：{missing[:8]}"
            f"（共 {len(missing)} 个）。新模块要落进 util / core / flow 之一。"
        )

    def test_没有模块被分进两层(self):
        """⚠ 反向判据：一个模块在两层里，闸的结论就取决于遍历顺序。"""
        spec = _M.get("services_layer", {})
        seen: dict = {}
        dup = []
        for layer, cfg in spec.items():
            for m in cfg.get("modules", []):
                if m in seen:
                    dup.append(f"{m}（{seen[m]} 与 {layer}）")
                seen[m] = layer
        assert not dup, f"这些模块被分进了两层：{dup}"

    def test_util层实测确实是叶子(self):
        """util 的全部意义就是「不依赖 services 内任何模块」。
        这条一旦不成立，它就不再能被所有人安全 import，也就没资格叫叶子。"""
        spec = _M.get("services_layer", {})
        util = set(spec.get("util", {}).get("modules", []))
        assert len(util) > 50, f"util 只有 {len(util)} 个，分层没生成对"
        bad = sorted(
            f"{e.src} -> {e.dst}"
            for e in _G.edges
            if e.src in util and e.dst.startswith("services.") and e.dst != e.src
        )
        assert not bad, f"util 层有模块依赖了 services 内其它模块：{bad[:6]}"

    def test_没有新增的越层依赖(self):
        now = set(arch_graph.services_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("services_violations", []))
        new = sorted(now - base)
        assert not new, (
            f"services 内部新增了越层依赖：{new}\n"
            f"叶子不许碰上层、core 不许碰 flow。要么调整代码，要么"
            f"在 architecture.toml 里把模块挪到合适的层（并说明为什么）。"
        )

    def test_越层基线只许变短(self):
        now = set(arch_graph.services_violations(_G, _M))
        base = set(_M.get("baseline", {}).get("services_violations", []))
        stale = sorted(base - now)
        assert not stale, f"这些越层已经修好了，从 baseline 里删掉：{stale}"

    def test_分层规则本身不许反向(self):
        """⚠ 反向判据：rank 高的可以依赖 rank 低的，反过来不行。
        规则写反了闸照样绿——它只会忠实地执行一条错规则。"""
        spec = _M.get("services_layer", {})
        rank = {k: v.get("rank", 99) for k, v in spec.items()}
        for name, cfg in spec.items():
            for dep in cfg.get("may_depend_on", []):
                assert dep in spec, f"{name} 依赖了不存在的层 {dep}"
                assert rank[dep] < rank[name], (
                    f"{name}(rank={rank[name]}) 声明可以依赖 {dep}(rank={rank[dep]})"
                    f"——方向反了，这条规则会把越层放行"
                )


class Test同一个crate内部允许互指:
    """⚠ 这个概念不是给环开的后门，是把 grok 的模型补全。

    Rust 禁止的是 **crate 之间**成环；**同一个 crate 内部的模块可以互相引用**。
    实测 grok-build：`xai-grok-tools` 内有 8 组互相引用的模块对、
    `xai-grok-shell` 内 15 组，其中 `implementations ⇄ registry` 与我们
    `capability_maps ⇄ slide_rule_executor` 形状完全一样（注册表与实现互指）。

    我们的模块粒度比 crate 细，所以要显式声明谁跟谁是一个 crate。
    **闸没有变松**：跨 component 的环照样红，下面第一条钉的就是这个。
    """

    def test_跨component的环照样红(self):
        """⚠ 最要紧的一条。这个概念要是把跨组的环也放行了，闸就废了。"""
        cyc = "services.a -> services.b -> services.a"
        import unittest.mock as mock

        with mock.patch.object(arch_graph, "find_cycles", lambda _g: [cyc]):
            split = {
                "component": {
                    "x": {"modules": ["services.a"]},
                    "y": {"modules": ["services.b"]},
                }
            }
            assert arch_graph.cross_component_cycles(_G, split) == [cyc], (
                "跨 component 的环被放行了——闸废了"
            )
            # ⚠ 同组**也不够**：还得那个组明写 allow_internal_cycles。
            #   2026-08-29 把 270 个模块全归组之后，「同组即放行」会让环判据
            #   当场废掉一大半——归组是为了声明依赖，不是给环发通行证。
            same = {"component": {"x": {"modules": ["services.a", "services.b"]}}}
            assert arch_graph.cross_component_cycles(_G, same) == [cyc], (
                "同组但没 opt-in 就被放行了——归组成了消环的后门"
            )
            opted = {
                "component": {
                    "x": {
                        "modules": ["services.a", "services.b"],
                        "allow_internal_cycles": True,
                    }
                }
            }
            assert arch_graph.cross_component_cycles(_G, opted) == [], (
                "明写了 allow_internal_cycles 还不放行——那 grok 的模型就没抄对"
            )

    def test_没声明component的模块_成环照样红(self):
        """⚠ 反向判据：默认是严的。不写声明 = 不许成环。"""
        import unittest.mock as mock

        with mock.patch.object(
            arch_graph, "find_cycles", lambda _g: ["services.p -> services.q -> services.p"]
        ):
            assert arch_graph.cross_component_cycles(_G, {}) != []

    def test_每个component都写了理由(self):
        """⚠ 门槛：得能说清「它们为什么是一个东西」，而不是「它们碰巧成环」。

        ⚠ 2026-08-29 把字数门槛从 30 降到 15，并补了「理由不许重复」。
          原因：全仓归组之后有 8 个组的理由**本身是有信息的**，只是中文密度高、
          不到 30 字（「最底下的叶子：配置与数据形状。谁都能依赖它，它谁都不依赖。」）。
          **为了凑字数去加水，判据就变成了装饰**——本仓第五条：判据要盯语义。
          真正能挡住敷衍的是**去重**：抄一份模板套 23 个组，当场红。
        """
        comps = _M.get("component", {})
        assert comps, "没有 component 声明——如果是有意的，把这条判据一起删掉"
        whys = {}
        for name, spec in comps.items():
            why = (spec.get("why") or "").strip()
            assert len(why) >= 15, f"component {name} 没写清为什么它们是一个东西"
            assert why not in whys, (
                f"component {name} 与 {whys[why]} 的理由一模一样——"
                f"套模板等于没写"
            )
            whys[why] = name
            assert spec.get("modules"), f"component {name} 是空的"

    def test_opt_in允许内部成环的组必须很小(self):
        """⚠ 这条替代了旧的「component 不许无限膨胀」。

        旧判据挡的是「把半个仓塞进一个 component 来消环」。2026-08-29 全仓归组
        之后那条按字面必然红（270 个模块都在组里），但**它挡的那件事仍然要挡**——
        只是位置变了：现在能消环的只有 `allow_internal_cycles` 那几个组，
        所以门槛钉在**它们**身上。
        """
        comps = _M.get("component", {})
        opted = {n: c for n, c in comps.items() if c.get("allow_internal_cycles")}
        assert len(opted) <= 2, f"太多组允许内部成环了：{sorted(opted)}"
        for name, c in opted.items():
            mods = c.get("modules", [])
            assert len(mods) <= 6, (
                f"{name} 允许内部成环却有 {len(mods)} 个模块——"
                f"组越大，这条豁免盖住的东西越多，等于拿声明消环"
            )

    def test_单个组不许吃掉半个仓(self):
        """⚠ 组太大就退化成「没分组」：依赖声明会变成一句废话。"""
        comps = _M.get("component", {})
        total = len(_G.modules)
        for name, c in comps.items():
            n = len(c.get("modules", []))
            assert n <= total // 4, (
                f"{name} 有 {n} 个模块（全仓 {total}）——太大了，"
                f"组间依赖声明会退化成废话"
            )


class Test显式例外不是后门:
    """⚠ `[accepted]` 与 `[baseline]` 是两件事：baseline 是欠账（只许变少），
    accepted 是「就该这样，原因如下」。grok 的对应物是 Cargo.toml 依赖行上那句
    注释——依赖存在是事实，**为什么存在**得写下来。

    这一组判据挡的是它退化成「消违规的开关」。
    """

    def test_每条例外都写了理由(self):
        for edge, why in arch_graph.accepted_edges(_M).items():
            assert len(why) >= 30, f"例外 {edge} 没写清为什么——不写理由就不算显式"

    def test_例外必须真的存在于代码里(self):
        """⚠ 反向判据：删掉那条依赖之后，例外要跟着删。
        留着过期例外 = 下一个人以为那条依赖还在，也 = 悄悄放行同名的新边。"""
        real = {f"{e.src} -> {e.dst}" for e in _G.edges}
        stale = sorted(set(arch_graph.accepted_edges(_M)) - real)
        assert not stale, f"这些例外对应的依赖已经没了，从 architecture.toml 删掉：{stale}"

    def test_例外数量不许膨胀(self):
        n = len(arch_graph.accepted_edges(_M))
        assert n <= 5, (
            f"显式例外有 {n} 条——超过个位数就不再是「例外」，"
            f"该回头看是不是分层本身画错了"
        )

    def test_一个例外不许放行同一对包上的其它边(self):
        """⚠ 违规是按**包对**报的，例外是按**具体边**给的。

        只要包对背后还有一条没被接受的边，这个包对就得照样红——
        否则一条例外会顺手把同一对包上所有边一起放行，闸当场穿底。
        """
        ok = set(arch_graph.accepted_edges(_M))
        assert ok, "没有例外，这条判据是空的"
        edge = next(iter(ok))
        src_pkg = edge.split(" -> ")[0].split(".")[0]
        dst_pkg = edge.split(" -> ")[1].split(".")[0]
        fake = arch_graph.Edge(
            src=f"{src_pkg}.zz_fake", dst=f"{dst_pkg}.zz_fake",
            src_pkg=src_pkg, dst_pkg=dst_pkg, deferred=False, line=1,
        )
        import copy

        g2 = copy.copy(_G)
        g2.edges = list(_G.edges) + [fake]
        assert f"{src_pkg} -> {dst_pkg}" in arch_graph.layer_violations(g2, _M), (
            "同一对包上多出一条没被接受的边，却没报违规——例外放行得太宽"
        )
