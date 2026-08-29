# -*- coding: utf-8 -*-
"""架构图不许手画：从**真代码**里把依赖图算出来，并按清单强制边界。

## 为什么有这个文件

2026-08-29 对照 grok-build 数出来的差距（见
`docs/欠缺模块清单-对照Claude与Grok-build.md` §16）：

    grok-build   架构图 **0 张**。91 个 crate 在各自 Cargo.toml 里显式声明
                 依赖（边上还写着为什么依赖），347 条边全由编译器强制；
                 循环依赖在 Rust 里根本编译不出来。根 Cargo.toml 是**生成的**，
                 README 里标着 treat it as read-only。
    WhyBuddy     架构图 17 张，全手画。265 个模块 394 条内部依赖边，**零强制**。

手画的后果已经量到过：已知缺口图六条里四条早就不成立、V6.0 的 19 个模块块有
12 个从没画过。而代码这边同样在飘——内部 import 有 62% 写在**函数体里**
（Python 里绕循环依赖的标准手法），顶层 import 图里有 5 个真的环，包括最核心
的那一对 `v5_full_driver ⇄ v5_capability_executor`。

**他们的架构图是编译器画的，我们的是人画的。** 这个文件补的就是那个编译器。

## 三件事，对应 grok 的三条

| grok | 这里 |
|---|---|
| 每个 crate 在 Cargo.toml 显式声明依赖 | `architecture.toml` 显式声明分层与允许的边 |
| 没声明就编译不过 / 循环编译不出来 | `tests/test_architecture.py` 是我们的编译器：未声明的边红、新增的环红 |
| 根 Cargo.toml 是**生成的**，read-only | `docs/SlideRule V6.2 架构图（自动生成）.md` 由本文件生成，判据保证它与代码同步 |

## ⚠ 三个非做不可的细节（少一个这道闸就是摆设）

**① 函数体里的 import 必须算数。**
全仓 62% 的内部 import 在函数体里。只数顶层 import 等于**默认放行三分之二的
依赖**，而且给了一个一句话就能绕过闸的办法：把 import 挪进函数。
本文件对两种一视同仁，只在报告里标出 `deferred`。

**② 存量违规用棘轮，不用一次大修。**
现存的违规和环冻进 `architecture.toml` 的 `[baseline]`，判据只比「有没有变多」。
想清哪条清哪条，清完从基线里删掉——**基线只许变短**。
一次性大改核心依赖的风险，远大于它能换来的整洁。

**③ 生成必须是确定性的。**
一切排序固定。否则两台电脑生成的文件不一样，就回到了「多台电脑架构不一致」
那个病——而那正是要治的东西。

## 用法

    python arch_graph.py --check     # 闸：违规/环有没有变多
    python arch_graph.py --emit      # 重新生成架构图（写 docs/）
    python arch_graph.py --freeze    # 把当前违规/环写进基线（**慎用**，只在有意接受时）
    python arch_graph.py --report    # 人看的摘要
"""

from __future__ import annotations

import argparse
import ast
import pathlib
import sys
import tomllib
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Set, Tuple

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent
MANIFEST = ROOT / "architecture.toml"
DIAGRAM = REPO / "docs" / "SlideRule V6.2 架构图（自动生成）.md"

#: 顶层包 = 分层单位。对应 grok 的 crate。
#: ⚠ 2026-08-29：这份名单原来是**手写**的，而它同时被当成「哪些 import 算内部边」
#:   的筛子——于是任何不在名单里的顶层模块**结构上不可能有入边**。
#:   实测漏的是 `stdio_utf8`：`app.py` 第 24 行顶层 `from stdio_utf8 import
#:   configure_stdio_utf8`，图里那条边根本不存在，它在零入度名单里显示成"没人用"。
#:   同样漏的还有 `complete_migration`、`arch_graph`。
#:
#:   手写名单是这仓一路在拆的那种东西（合法域四本账、闸的常量拷贝）。现在改成
#:   **从真实模块集合派生**（`_package_roots`），加一个顶层 .py 或一个新包都不用
#:   再来改这里。下面这份只留作**兜底 + 判据的对照物**：
#:   `test_扫描器_包名单是从代码派生的` 会拿派生结果跟它比，少了就红。
_SEED_PACKAGES: Tuple[str, ...] = (
    "models",
    "config",
    "sliderule_llm",
    "services",
    "routes",
    "middlewares",
    "scripts",
    "app",
)

PACKAGES: Tuple[str, ...] = _SEED_PACKAGES

#: 不参与架构判定的目录。
#: ⚠ 判断用 `parts[0]`，不是 `"tests/" in str(p)`——写这个文件的第一版就是后者，
#:   而路径长这样：`tests/foo.py`（**没有前导斜杠**），于是 472 个测试文件全被
#:   算进了依赖图，"其它 → services" 1268 条噪音压过了真信号。
#:   判据 `test_architecture.py::Test扫描器自己没瞎` 钉的就是这一条。
_SKIP_DIRS = frozenset({"tests", ".venv", "__pycache__", "data", "static", "tmp", "node_modules"})


@dataclass(frozen=True)
class Edge:
    """一条依赖边。`deferred` = 写在函数体里的 import。"""

    src: str          # 源模块，如 services.v5_full_driver
    dst: str          # 目标模块
    src_pkg: str
    dst_pkg: str
    deferred: bool
    line: int

    def key(self) -> str:
        return f"{self.src} -> {self.dst}"


@dataclass
class Graph:
    modules: Set[str] = field(default_factory=set)
    edges: List[Edge] = field(default_factory=list)
    files_scanned: int = 0

    def pkg_edges(self) -> Set[Tuple[str, str]]:
        return {(e.src_pkg, e.dst_pkg) for e in self.edges if e.src_pkg != e.dst_pkg}

    def module_graph(self) -> Dict[str, Set[str]]:
        g: Dict[str, Set[str]] = {}
        for e in self.edges:
            g.setdefault(e.src, set()).add(e.dst)
        return g


def _module_name(path: pathlib.Path) -> str:
    rel = path.relative_to(ROOT)
    return rel.with_suffix("").as_posix().replace("/", ".")


def _pkg_of(module: str) -> str:
    """模块名的第一段就是它的包；顶层单文件模块自己就是一个包。

    ⚠ 2026-08-29 之前这里写的是
    `head if head in PACKAGES else "app" if module == "app" else "?"`，
    而 `layer_violations` 会把带 `"?"` 的边**整条跳过**。于是手写 PACKAGES
    漏掉的那几个顶层模块（`stdio_utf8` / `arch_graph` / `complete_migration`）
    造出了**第二个盲区**：就算边扫出来了，闸也当没看见。
    一份手写名单同时当筛子和分类器用，漏一项漏两次。
    """
    return module.split(".")[0]


def _resolve(node: ast.AST, here: str, roots: Optional[Set[str]] = None) -> List[str]:
    """把一条 import 语句解析成**候选**内部模块名（外部依赖丢掉）。

    ⚠ `from . import x` 的目标是 `当前包.x`，**不是当前包**。
      第一版漏了这一条：`from . import spec_first_pipeline` 被解析成 `services`，
      于是 `page_id_freeze ⇄ spec_first_pipeline` 这个环**扫不出来**。
      是变异测试逼出来的（故意造一个环，闸没红）——不做变异就会把一道
      漏筛的闸当成装好了。

    ⚠ `from .foo import bar` 里的 `bar` 可能是模块也可能是函数，AST 分不清。
      这里两个候选都吐出来（`包.foo` 与 `包.foo.bar`），由 `build_graph`
      拿真实模块集合去筛——**存在的才算边**。

    ⚠ `roots` 必须由调用方从真实文件派生，别退回硬编码的 `PACKAGES`。
      2026-08-29 实测：名单里漏了顶层的 `stdio_utf8`，于是 `app.py` 第 24 行
      那句顶层 import **在图里根本不存在**——它反而以"零入度、没人用"的样子
      出现在孤儿名单里。一份手写名单同时当筛子用，漏一项就是**静默漏边**，
      而漏边的闸看着是绿的。
    """
    out: List[str] = []
    if isinstance(node, ast.ImportFrom):
        if node.level:
            parts = here.split(".")[:-1]          # 去掉自身模块名 → 当前包路径
            up = node.level - 1
            base = parts[: len(parts) - up] if up else parts
            stem = [*base, node.module] if node.module else base
            out.append(".".join(stem))
            for a in node.names:                  # from . import <模块>
                out.append(".".join([*stem, a.name]))
        elif node.module:
            out.append(node.module)
            for a in node.names:
                out.append(f"{node.module}.{a.name}")
    elif isinstance(node, ast.Import):
        out.extend(a.name for a in node.names)
    return [m for m in out if m.split(".")[0] in (roots or PACKAGES)]


def _deferred_lines(tree: ast.AST) -> Set[int]:
    """函数体覆盖的行号。见模块头 ⚠① —— 这些 import 一样算数。"""
    lines: Set[int] = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            lines.update(range(n.lineno, (n.end_lineno or n.lineno) + 1))
    return lines


def _sources(root: pathlib.Path) -> List[pathlib.Path]:
    out = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        if any(part in _SKIP_DIRS for part in rel.parts):
            continue
        out.append(path)
    return out


def build_graph(root: pathlib.Path = ROOT) -> Graph:
    """两趟：先把模块集合收齐，再拿它筛 import 候选。

    ⚠ 必须两趟。`from .foo import bar` 里 `bar` 是模块还是函数，AST 分不清，
      只有对着**真实存在的模块集合**才能判——一趟走完就只能猜，而猜错的方向
      正好是漏边（把 `包.模块` 记成 `包`），漏边的闸看着是绿的。
    """
    g = Graph()
    files = _sources(root)
    for path in files:
        g.modules.add(_module_name(path))
    # 包名单从真实模块集合派生，不用手写的 PACKAGES 当筛子（见 _resolve ⚠）。
    roots = {m.split(".")[0] for m in g.modules}

    for path in files:
        here = _module_name(path)
        g.files_scanned += 1
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
        except SyntaxError:
            continue
        deferred = _deferred_lines(tree)
        for node in ast.walk(tree):
            if not isinstance(node, (ast.Import, ast.ImportFrom)):
                continue
            cands = [c for c in _resolve(node, here, roots) if c in g.modules and c != here]
            if not cands:
                continue
            # 最长的那个才是真目标：`from services.x import y` 的候选里
            # `services.x` 与 `services.x.y` 都可能在，前者才是模块。
            target = max(cands, key=len)
            g.edges.append(
                Edge(
                    src=here,
                    dst=target,
                    src_pkg=_pkg_of(here),
                    dst_pkg=_pkg_of(target),
                    deferred=node.lineno in deferred,
                    line=node.lineno,
                )
            )
    g.edges.sort(key=lambda e: (e.src, e.dst, e.line))
    return g


# ── component：同一个「crate」内部允许互相引用 ──────────────────────────────
#
# ⚠ 这不是给环开的后门，是把 grok 的模型补全。
#
#   Rust 里禁止的是 **crate 之间**成环；**同一个 crate 内部的模块可以互相引用**。
#   实测 grok-build：`xai-grok-tools` 内有 8 组互相引用的模块对、`xai-grok-shell`
#   内有 15 组，其中 `implementations ⇄ registry` 与我们
#   `capability_maps ⇄ slide_rule_executor` 形状完全一样（注册表与实现互指）。
#
#   我们的模块粒度比 crate 细，所以要显式声明「哪几个模块其实是同一个 crate」。
#   声明要写理由，而且**跨 component 的环照样红**——闸没有变松，只是量对了东西。
def component_of(manifest: dict) -> Dict[str, str]:
    owner: Dict[str, str] = {}
    for name, spec in manifest.get("component", {}).items():
        for m in spec.get("modules", []):
            owner[m] = name
    return owner


def component_violations(g: "Graph", manifest: dict) -> List[str]:
    """component 之间**没有声明过**的依赖边。对应 grok 的 Cargo.toml：
    没写在 `[dependencies]` 里的 crate，`use` 它就编译不过。

    ⚠ 这是 component 归组真正的价值所在。只归组不查依赖，那只是给模块贴标签。
    """
    spec = manifest.get("component", {})
    if not spec:
        return []
    owner = component_of(manifest)
    allowed = {n: set(c.get("may_depend_on", [])) for n, c in spec.items()}
    bad: Set[str] = set()
    for e in g.edges:
        a, b = owner.get(e.src), owner.get(e.dst)
        if a is None or b is None or a == b:
            continue
        if b not in allowed.get(a, set()):
            bad.add(f"{a} -> {b} :: {e.src} -> {e.dst}")
    return sorted(bad)


_COMPONENT_OF_CACHE: dict = {}


def _comp_map(manifest: dict) -> Dict[str, str]:
    key = id(manifest)
    if key not in _COMPONENT_OF_CACHE:
        _COMPONENT_OF_CACHE[key] = component_of(manifest)
    return _COMPONENT_OF_CACHE[key]


def satellite_components(g: Graph, manifest: dict) -> List[str]:
    """**唯一的消费者正是它自己依赖的那个组** —— 那不是两个 crate，是一个。

    ## 为什么要有这条（2026-08-29 我自己栽进去了）

    `refine` 组三个模块（精修的范围计算器），唯一 import 它们的是
    `spec_first_pipeline`，而它们又回读 spec-first 自己的校验器
    （html_structure / spec_tree / app_graph）——`refine ⇄ spec_first` 这个组间环
    的全部内容。

    我在 §22.3 拒绝过合并，理由写的是「refine_page_scope 有 8 个消费者，散在三个组，
    不是流水线的私有卫星」。**那个 8 是裸 grep 数出来的**——命中的是注释和文档字符串。
    依赖图里真正的 import 方只有 1 个。

    也就是说：我拿一个错的测量去论证「不该做这件事」。⚠ **用 grep 数依赖，错的方向
    刚好是「看起来更耦合」，于是它会替你把该做的事挡下来**，而且看着像审慎。

    按 grok 的口径，同一个 crate 内部的模块互指是合法的（xai-grok-tools 8 对、
    xai-grok-shell 15 对，含 `implementations ⇄ registry`）。这种形状的正解是
    **合并**，不是给环开例外。

    这条判据把「数消费者」从人手里拿走：条件是
    「被且只被一个组依赖 ∧ 那个组正是它 may_depend_on 里的」。
    """
    users: Dict[str, Set[str]] = {}
    comp = _comp_map(manifest)
    for e in g.edges:
        a, b = comp.get(e.src), comp.get(e.dst)
        if a and b and a != b:
            users.setdefault(b, set()).add(a)
    out = []
    for name, spec in sorted((manifest.get("component") or {}).items()):
        seen = users.get(name) or set()
        if len(seen) == 1:
            only = next(iter(seen))
            if only in (spec.get("may_depend_on") or []):
                out.append(f"{name} 只被 {only} 依赖，而它自己又依赖 {only}")
    return out


def orphans(g: Graph, manifest: dict) -> List[str]:
    """**没有任何模块 import 它**的模块，扣掉声明过的入口。

    ## 抄的是什么

    grok 那边 90 个 crate 全在 workspace 里，被依赖数为 0 的只有装配根
    `xai-grok-pager-bin` 一个——**因为它是 binary**。一个既不是入口、又没人依赖的
    crate，在那套体系里是明显的死重量。Python 没有编译器替我们数，所以自己数。

    ## ⚠ 零入度 ≠ 死代码，别照着这个名单删

    实测这 55 个里绝大多数**不是忘了删**，是三类各有各的理由：

      · **Node 边界镜像**（web_aigc_* / task_*_closure / blueprint_*_takeover / a2a_*）
        Node 拥有运行时，Python 这边把契约镜像下来、用测试钉住。删了等于丢掉那份记录。
      · **脚本/评测插座**（v5_session_driver）模块头明写「产品路由调用点零，
        禁止再 import 进来当驱动器」——它是**故意**不在产品链上的。
      · **未挂载的基线面**（routes.sliderule）docstring 自己写着
        「Primary mounted surface in app.py is sliderule_full.py」。

    所以这里给的是**棘轮**，不是待删清单：今天这些冻在基线里，**只许变少**；
    新长出来的孤儿必须当场解释——要么接上，要么写进 `[entrypoints]` 说清为什么。
    """
    import fnmatch

    indeg: Dict[str, int] = {m: 0 for m in g.modules}
    for e in g.edges:
        indeg[e.dst] = indeg.get(e.dst, 0) + 1
    pats = list((manifest.get("entrypoints") or {}).get("patterns") or [])
    out = []
    for m in sorted(g.modules):
        if indeg.get(m, 0):
            continue
        if any(fnmatch.fnmatch(m, p) for p in pats):
            continue
        out.append(m)
    return out


def component_cycles(manifest: dict, g: "Graph") -> List[str]:
    """component 之间的环——crate 级的环，Rust 里根本编译不出来。

    ⚠ 模块级的环已经清零，但**组级的环有 17 个**（2026-08-29 实测）。
      这不是矛盾：粒度不同看到的东西不同，crate 粒度下的缠绕以前根本没人量过。
    """
    owner = component_of(manifest)
    out_edges: Dict[str, Set[str]] = {}
    for e in g.edges:
        a, b = owner.get(e.src), owner.get(e.dst)
        if a and b and a != b:
            out_edges.setdefault(a, set()).add(b)
    color: Dict[str, int] = {}
    found: Set[str] = set()

    def walk(u: str, stack: List[str]) -> None:
        color[u] = 1
        stack.append(u)
        for v in sorted(out_edges.get(u, ())):
            c = color.get(v, 0)
            if c == 1:
                cyc = stack[stack.index(v):]
                i = cyc.index(min(cyc))
                rot = cyc[i:] + cyc[:i]
                found.add(" -> ".join([*rot, rot[0]]))
            elif c == 0:
                walk(v, stack)
        stack.pop()
        color[u] = 2

    for n in sorted(out_edges):
        if color.get(n, 0) == 0:
            walk(n, [])
    return sorted(found)


def cross_component_cycles(g: "Graph", manifest: dict) -> List[str]:
    """闸认的环。

    放行的**唯一**条件：环整个落在同一个 component 里，**而且那个 component
    明写了 `allow_internal_cycles = true`**。

    ⚠ 为什么要单独 opt-in，而不是「同一个 component 就放行」：
      2026-08-29 把 270 个模块全部归进 component 之后，「同组即放行」会让环判据
      **当场废掉一大半**——归组的目的是声明依赖，不是给环发通行证。
      默认严：即使在同一个 component 里，成环也红；确实是有意互指的（注册表与
      实现那种），单独在清单里写一行并说明理由。
    """
    spec = manifest.get("component", {})
    owner = component_of(manifest)
    opted = {name for name, c in spec.items() if c.get("allow_internal_cycles")}
    out = []
    for c in find_cycles(g):
        members = c.split(" -> ")[:-1]
        owners = {owner.get(m) for m in members}
        if len(owners) == 1 and None not in owners and owners.pop() in opted:
            continue
        out.append(c)
    return out


# ── 清单 ────────────────────────────────────────────────────────────────────
def load_manifest(path: pathlib.Path = MANIFEST) -> dict:
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def accepted_edges(manifest: dict) -> Dict[str, str]:
    """显式例外：`模块 -> 模块` → 为什么接受。

    ⚠ 这是「有意为之、并且写清了理由」，跟 `[baseline]`（欠账、只许变少）
      是**两件事**。grok 的对应物是 Cargo.toml 依赖行上那句注释
      （`# CompactionDetail, embedded in CompactionMode::Segments.`）——
      依赖存在是事实，为什么存在得写下来。

    ⚠ 门槛：必须写 why，而且判据盯着总量。拿它消违规等于把闸关掉。
    """
    return {
        str(item.get("edge", "")).strip(): str(item.get("why", "")).strip()
        for item in manifest.get("accepted", [])
        if item.get("edge")
    }


def layer_violations(g: Graph, manifest: dict) -> List[str]:
    """包与包之间**没有声明过**的依赖边。对应 grok「没声明就编译不过」。

    ⚠ 一个包对只有在它背后**每一条**具体边都被显式接受时才消失。
      漏掉这一条的话，一个例外会顺手把同一对包上的其它边一起放行。
    """
    allowed = {
        name: set(spec.get("may_depend_on", []))
        for name, spec in manifest.get("layer", {}).items()
    }
    ok_edges = set(accepted_edges(manifest))
    concrete: Dict[Tuple[str, str], List[str]] = {}
    for e in g.edges:
        if e.src_pkg == e.dst_pkg or "?" in (e.src_pkg, e.dst_pkg):
            continue
        if e.dst_pkg in allowed.get(e.src_pkg, set()):
            continue
        concrete.setdefault((e.src_pkg, e.dst_pkg), []).append(f"{e.src} -> {e.dst}")
    bad: Set[str] = set()
    for (src, dst), edges in concrete.items():
        if all(x in ok_edges for x in edges):
            continue
        bad.add(f"{src} -> {dst}")
    return sorted(bad)


def find_cycles(g: Graph) -> List[str]:
    """模块级循环依赖。Rust 里编译器管这件事，Python 里只能自己数。

    返回**规范化**的环签名（从字典序最小的成员起转），否则同一个环换个起点
    就成了「新环」，棘轮基线会被自己搅乱。
    """
    graph = g.module_graph()
    known = g.modules
    color: Dict[str, int] = {}
    found: Set[str] = set()

    def norm(cycle: List[str]) -> str:
        # 从字典序最小的成员起转，并**补上闭合边**——不补的话 A⇄B 显示成
        # "A -> B"，看着像一条普通依赖，读的人不知道它是个环。
        i = cycle.index(min(cycle))
        rotated = cycle[i:] + cycle[:i]
        return " -> ".join([*rotated, rotated[0]])

    def walk(u: str, stack: List[str]) -> None:
        color[u] = 1
        stack.append(u)
        for v in sorted(graph.get(u, ())):
            if v not in known:
                continue
            c = color.get(v, 0)
            if c == 1:
                found.add(norm(stack[stack.index(v):]))
            elif c == 0:
                walk(v, stack)
        stack.pop()
        color[u] = 2

    sys.setrecursionlimit(10000)
    for m in sorted(graph):
        if color.get(m, 0) == 0:
            walk(m, [])
    return sorted(found)


# ── 生成架构图 ──────────────────────────────────────────────────────────────
def emit_mermaid(g: Graph, manifest: dict) -> str:
    """从真代码生成架构图。**确定性**：一切排序固定（见模块头 ⚠③）。"""
    layers = manifest.get("layer", {})
    order = sorted(layers, key=lambda n: (layers[n].get("rank", 99), n))
    counts: Dict[Tuple[str, str], int] = {}
    deferred_counts: Dict[Tuple[str, str], int] = {}
    for e in g.edges:
        if e.src_pkg == e.dst_pkg or "?" in (e.src_pkg, e.dst_pkg):
            continue
        counts[(e.src_pkg, e.dst_pkg)] = counts.get((e.src_pkg, e.dst_pkg), 0) + 1
        if e.deferred:
            deferred_counts[(e.src_pkg, e.dst_pkg)] = (
                deferred_counts.get((e.src_pkg, e.dst_pkg), 0) + 1
            )

    per_pkg: Dict[str, int] = {}
    for m in g.modules:
        per_pkg[_pkg_of(m)] = per_pkg.get(_pkg_of(m), 0) + 1

    violations = set(layer_violations(g, manifest))
    lines = ["flowchart TB"]
    for name in order:
        spec = layers[name]
        why = spec.get("what", "")
        lines.append(f'  {name}["{name}<br/>{per_pkg.get(name, 0)} 个模块<br/>{why}"]')
    for (a, b), n in sorted(counts.items()):
        d = deferred_counts.get((a, b), 0)
        label = f"{n}" + (f" · 其中 {d} 条在函数体里" if d else "")
        arrow = "-.->" if f"{a} -> {b}" in violations else "-->"
        lines.append(f"  {a} {arrow}|{label}| {b}")
    return "\n".join(lines)


def render_doc(g: Graph, manifest: dict) -> str:
    cycles = cross_component_cycles(g, manifest)
    violations = layer_violations(g, manifest)
    svc_v = services_violations(g, manifest)
    orph = orphans(g, manifest)
    base = manifest.get("baseline", {})
    deferred = sum(1 for e in g.edges if e.deferred)
    body = [
        "# SlideRule V6.2 架构图（自动生成）",
        "",
        "> ⚠ **这个文件是生成的，不要手改。** 改了下次 `--emit` 会覆盖，而且",
        "> `tests/test_architecture.py::Test图与代码同步` 会当场变红。",
        "> 要改架构，改代码或改 `slide-rule-python/architecture.toml`，然后重新生成：",
        "> ",
        "> ```bash",
        "> slide-rule-python/.venv/bin/python slide-rule-python/arch_graph.py --emit",
        "> ```",
        "",
        "抄的是 grok-build 的做法：他们**一张架构图都没有**，91 个 crate 在各自",
        "`Cargo.toml` 里显式声明依赖，347 条边由编译器强制，根 `Cargo.toml` 是生成的。",
        "我们没有那个编译器，所以自己写一个——见 `slide-rule-python/arch_graph.py` 模块头。",
        "",
        "## 此刻的事实（由代码算出，不是手写）",
        "",
        f"- 扫描文件 **{g.files_scanned}** 个，模块 **{len(g.modules)}** 个",
        f"- 内部依赖边 **{len(g.edges)}** 条，其中 **{deferred}** 条写在函数体里"
        f"（{deferred * 100 // max(1, len(g.edges))}%）",
        f"- 未声明的跨包依赖 **{len(violations)}** 条（基线 {len(base.get('violations', []))} 条）",
        f"- 模块级循环依赖 **{len(cycles)}** 个（基线 {len(base.get('cycles', []))} 个）",
        f"- services 内部越层依赖 **{len(svc_v)}** 条"
        f"（基线 {len(base.get('services_violations', []))} 条）",
        f"- 没人 import 的模块 **{len(orph)}** 个"
        f"（基线 {len(base.get('orphans', []))} 个）—— ⚠ **不是待删清单**，"
        f"多数是 Node 边界镜像 / 脚本插座 / 未挂载的基线面，见 `arch_graph.orphans()`",
        "",
        "### services 内部分层（抄 grok 的叶子 crate）",
        "",
        f"| 层 | 模块数 | 可以依赖 | 是什么 |",
        f"|---|---|---|---|",
    ] + [
        f"| `{name}` | {len(spec.get('modules', []))} | "
        f"{'、'.join(spec.get('may_depend_on', [])) or '（谁都不依赖）'} | {spec.get('what', '')} |"
        for name, spec in sorted(
            manifest.get("services_layer", {}).items(),
            key=lambda kv: kv[1].get("rank", 99),
        )
    ] + [
        "",
        "叶子层 `util` 不依赖 services 里任何其它模块——这是它能被所有人安全 import "
        "的全部理由，也是 `import` 不必躲进函数体的前提。",
        "",
        "虚线 = 未在 `architecture.toml` 里声明的边（欠账，只许变少）。",
        "",
        "```mermaid",
        emit_mermaid(g, manifest),
        "```",
        "",
        "## 循环依赖",
        "",
        "Rust 里这一类根本编译不出来；Python 得自己数。**只许变少。**",
        "",
    ]
    if cycles:
        for c in cycles:
            body.append(f"- `{c}`")
    else:
        body.append("（当前没有循环依赖）")
    body += [
        "",
        "## 未声明的跨包依赖",
        "",
    ]
    if violations:
        for v in violations:
            body.append(f"- `{v}`")
    else:
        body.append("（当前没有）")
    comps = manifest.get("component", {})
    if comps:
        owner = component_of(manifest)
        cedges: Dict[Tuple[str, str], int] = {}
        for e in g.edges:
            a, b = owner.get(e.src), owner.get(e.dst)
            if a and b and a != b:
                cedges[(a, b)] = cedges.get((a, b), 0) + 1
        cyc = set()
        for c in component_cycles(manifest, g):
            m = c.split(" -> ")
            for i in range(len(m) - 1):
                cyc.add((m[i], m[i + 1]))
        body += [
            "",
            "## crate 级：component 依赖图",
            "",
            "抄 grok 的 Cargo.toml——他们 90 个 crate、347 条**声明过**的边由编译器焊死。",
            f"我们 {len(comps)} 个 component、{len(cedges)} 条边，由 `architecture.toml` 声明、判据强制。",
            "**红色虚线 = 参与组间成环的边**（模块级已清零，组级还欠着，见下）。",
            "",
            "```mermaid",
            "flowchart LR",
        ]
        for name in sorted(comps):
            n = len(comps[name].get("modules", []))
            body.append(f'  {name}["{name}<br/>{n}"]')
        for (a, b), n in sorted(cedges.items()):
            body.append(f"  {a} {'-.->' if (a, b) in cyc else '-->'}|{n}| {b}")
        body += ["```", ""]

    body += ["", "## services 内部越层依赖", "",
             "叶子碰了上层，或 core 碰了 flow。**只许变少。**", ""]
    if svc_v:
        for v in svc_v:
            body.append(f"- `{v}`")
    else:
        body.append("（当前没有）")
    body.append("")
    return "\n".join(body)


# ── CLI ─────────────────────────────────────────────────────────────────────
def _freeze(g: Graph, manifest: dict) -> None:
    import re

    text = MANIFEST.read_text(encoding="utf-8")
    v = layer_violations(g, manifest)
    c = cross_component_cycles(g, manifest)
    sv = services_violations(g, manifest)

    def block(name: str, items: Iterable[str]) -> str:
        rows = "".join(f'  "{i}",\n' for i in items)
        return f"{name} = [\n{rows}]"

    text = re.sub(r"violations = \[[^\]]*\]", block("violations", v), text, flags=re.S)
    text = re.sub(r"cycles = \[[^\]]*\]", block("cycles", c), text, flags=re.S)
    text = re.sub(
        r"services_violations = \[[^\]]*\]", block("services_violations", sv), text, flags=re.S
    )
    MANIFEST.write_text(text, encoding="utf-8")
    print(f"基线已写入：违规 {len(v)} 条，环 {len(c)} 个，services 越层 {len(sv)} 条")
    # ⚠ 说清它**没**覆盖什么。默认全覆盖会让"往基线里加东西"变得太顺手，
    #   而那正是仓里明写着不该出现在日常流程里的动作（架构边界那一节）。
    #   不说清则更糟：下一个人以为 --freeze 是全量的，剩下三条棘轮悄悄没跟上。
    print(
        "⚠ 未覆盖：component_violations / component_cycles / orphans —— "
        "这三条要手改 architecture.toml，逼你逐条写清为什么接受这笔欠账"
    )


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="闸：违规/环有没有变多")
    ap.add_argument("--emit", action="store_true", help="重新生成架构图")
    ap.add_argument("--freeze", action="store_true", help="把当前状态写进基线（慎用）")
    ap.add_argument("--report", action="store_true", help="人看的摘要")
    args = ap.parse_args(argv)

    g = build_graph()
    manifest = load_manifest()
    v, c = layer_violations(g, manifest), cross_component_cycles(g, manifest)
    sv = services_violations(g, manifest)
    cv = component_violations(g, manifest)
    cc = component_cycles(manifest, g)
    orph = orphans(g, manifest)
    sat = satellite_components(g, manifest)
    base = manifest.get("baseline", {})

    if args.emit:
        DIAGRAM.parent.mkdir(parents=True, exist_ok=True)
        DIAGRAM.write_text(render_doc(g, manifest), encoding="utf-8")
        print(f"已生成 {DIAGRAM.relative_to(REPO)}")
        return 0
    if args.freeze:
        _freeze(g, manifest)
        return 0
    if args.report or not args.check:
        print(f"模块 {len(g.modules)}  边 {len(g.edges)}  "
              f"函数体内 {sum(1 for e in g.edges if e.deferred)}")
        print(f"未声明跨包依赖 {len(v)}（基线 {len(base.get('violations', []))}）")
        for x in v:
            print(f"   {x}")
        print(f"跨 component 循环依赖 {len(c)}（基线 {len(base.get('cycles', []))}）")
        for x in c:
            print(f"   {x}")
        _inside = [x for x in find_cycles(g) if x not in c]
        if _inside:
            print(f"component 内部互指 {len(_inside)}（同一个「crate」，允许）")
            for x in _inside:
                print(f"   {x}")
        print(f"services 内部越层 {len(sv)}（基线 {len(base.get('services_violations', []))}）")
        for x in sv:
            print(f"   {x}")
        print(f"未声明的组间依赖 {len(cv)}（基线 {len(base.get('component_violations', []))}）")
        for x in cv[:10]:
            print(f"   {x}")
        print(f"组间循环依赖 {len(cc)}（基线 {len(base.get('component_cycles', []))}）")
        for x in cc[:10]:
            print(f"   {x}")
        print(f"没人 import 的模块 {len(orph)}（基线 {len(base.get('orphans', []))}）"
              f" —— ⚠ 不是待删清单，见 orphans() 文档")
        print(f"卫星组（唯一消费者正是它依赖的那个组）{len(sat)}")
        for x in sat:
            print(f"   {x}")
        if not args.check:
            return 0

    new_v = sorted(set(v) - set(base.get("violations", [])))
    new_c = sorted(set(c) - set(base.get("cycles", [])))
    new_s = sorted(set(sv) - set(base.get("services_violations", [])))
    new_cv = sorted(set(cv) - set(base.get("component_violations", [])))
    new_cc = sorted(set(cc) - set(base.get("component_cycles", [])))
    new_o = sorted(set(orph) - set(base.get("orphans", [])))
    if new_v or new_c or new_s or new_cv or new_cc or new_o or sat:
        for x in new_v:
            print(f"❌ 新增未声明依赖：{x}")
        for x in new_c:
            print(f"❌ 新增循环依赖：{x}")
        for x in new_s:
            print(f"❌ services 内部新增越层依赖：{x}")
        for x in new_cv:
            print(f"❌ 新增未声明的组间依赖：{x}")
        for x in new_cc:
            print(f"❌ 新增组间循环依赖：{x}")
        for x in sat:
            print(f"❌ 卫星组：{x} —— 那不是两个 crate，是一个。合并掉，"
                  f"或者说清为什么它该独立（见 satellite_components 文档）")
        for x in new_o:
            print(f"❌ 新增没人 import 的模块：{x}"
                  f"（接上它，或在 architecture.toml 的 [entrypoints] 里说清为什么）")
        return 1
    print("✅ 没有新增的未声明依赖或循环")
    return 0



# ── services 内部分层（抄 grok 的叶子 crate）────────────────────────────────
#
# grok 把 51 个共用叶子（token 估算、路径、文件工具…）切成独立 crate，
# 依赖方向由编译器焊死：大块能用叶子，叶子永远碰不到大块。
# 我们 195 个 services 模块平铺在一个命名空间里，谁都能 import 谁——
# 这正是「463 条 import 藏在函数体里」的根。
#
# ⚠ 分层是**从今天的真实依赖深度算出来的**，不是重新设计。它是一条棘轮基线：
#   先把现状固定成契约，此后只许变好。别把它读成"架构本该如此"。
SERVICES_LAYERS = ("util", "core", "flow")


def services_depth(g: "Graph") -> Dict[str, int]:
    """services 内部的依赖深度。0 = 不依赖 services 里任何其它模块。

    环上就地截断——环的存在本身由 find_cycles 单独管，这里只要一个稳定的分层。
    """
    inside = {m for m in g.modules if m.startswith("services.")}
    out: Dict[str, Set[str]] = {}
    for e in g.edges:
        if e.src in inside and e.dst in inside and e.src != e.dst:
            out.setdefault(e.src, set()).add(e.dst)
    depth: Dict[str, int] = {}

    def walk(m: str, seen: Tuple[str, ...]) -> int:
        if m in depth:
            return depth[m]
        if m in seen:
            return 0
        vals = [walk(x, seen + (m,)) + 1 for x in out.get(m, ())]
        depth[m] = max(vals) if vals else 0
        return depth[m]

    sys.setrecursionlimit(10000)
    for m in sorted(inside):
        walk(m, ())
    return depth


def suggest_services_layers(g: "Graph") -> Dict[str, List[str]]:
    """按深度分三档。分界线是数出来的，不是拍的：

        深度 0      117 个  纯叶子 → util
        深度 1..2    52 个  → core
        深度 >=3     26 个  编排（驱动器 / 流水线 / 控制面）→ flow
    """
    depth = services_depth(g)
    buckets: Dict[str, List[str]] = {k: [] for k in SERVICES_LAYERS}
    for m, d in depth.items():
        buckets["util" if d == 0 else "core" if d <= 2 else "flow"].append(m)
    return {k: sorted(v) for k, v in buckets.items()}


def services_violations(g: "Graph", manifest: dict) -> List[str]:
    """services 内部越层依赖：叶子碰了上层、core 碰了 flow。"""
    spec = manifest.get("services_layer", {})
    if not spec:
        return []
    owner: Dict[str, str] = {}
    for layer, cfg in spec.items():
        for m in cfg.get("modules", []):
            owner[m] = layer
    allowed = {k: set(v.get("may_depend_on", [])) | {k} for k, v in spec.items()}
    bad: Set[str] = set()
    for e in g.edges:
        a, b = owner.get(e.src), owner.get(e.dst)
        if a is None or b is None:
            continue
        if b not in allowed.get(a, set()):
            bad.add(f"{a} -> {b} :: {e.src} -> {e.dst}")
    return sorted(bad)


if __name__ == "__main__":
    raise SystemExit(main())
