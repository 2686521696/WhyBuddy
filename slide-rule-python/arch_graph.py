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
PACKAGES: Tuple[str, ...] = (
    "models",
    "config",
    "sliderule_llm",
    "services",
    "routes",
    "middlewares",
    "scripts",
    "app",
)

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
    head = module.split(".")[0]
    return head if head in PACKAGES else "app" if module == "app" else "?"


def _resolve(node: ast.AST, here: str) -> List[str]:
    """把一条 import 语句解析成**候选**内部模块名（外部依赖丢掉）。

    ⚠ `from . import x` 的目标是 `当前包.x`，**不是当前包**。
      第一版漏了这一条：`from . import spec_first_pipeline` 被解析成 `services`，
      于是 `page_id_freeze ⇄ spec_first_pipeline` 这个环**扫不出来**。
      是变异测试逼出来的（故意造一个环，闸没红）——不做变异就会把一道
      漏筛的闸当成装好了。

    ⚠ `from .foo import bar` 里的 `bar` 可能是模块也可能是函数，AST 分不清。
      这里两个候选都吐出来（`包.foo` 与 `包.foo.bar`），由 `build_graph`
      拿真实模块集合去筛——**存在的才算边**。
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
    return [m for m in out if m.split(".")[0] in PACKAGES]


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
            cands = [c for c in _resolve(node, here) if c in g.modules and c != here]
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


def cross_component_cycles(g: "Graph", manifest: dict) -> List[str]:
    """跨 component 的环——**闸只认这些**。

    环整个落在同一个 component 里 = 同一个 crate 内部互指，Rust 也允许。
    """
    owner = component_of(manifest)
    out = []
    for c in find_cycles(g):
        members = c.split(" -> ")[:-1]
        owners = {owner.get(m) for m in members}
        if len(owners) == 1 and None not in owners:
            continue          # 同一个 component 内部，放行
        out.append(c)
    return out


# ── 清单 ────────────────────────────────────────────────────────────────────
def load_manifest(path: pathlib.Path = MANIFEST) -> dict:
    with open(path, "rb") as fh:
        return tomllib.load(fh)


def layer_violations(g: Graph, manifest: dict) -> List[str]:
    """包与包之间**没有声明过**的依赖边。对应 grok「没声明就编译不过」。"""
    allowed = {
        name: set(spec.get("may_depend_on", []))
        for name, spec in manifest.get("layer", {}).items()
    }
    bad: Set[str] = set()
    for src, dst in g.pkg_edges():
        if src == "?" or dst == "?":
            continue
        if dst not in allowed.get(src, set()):
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
        if not args.check:
            return 0

    new_v = sorted(set(v) - set(base.get("violations", [])))
    new_c = sorted(set(c) - set(base.get("cycles", [])))
    new_s = sorted(set(sv) - set(base.get("services_violations", [])))
    if new_v or new_c or new_s:
        for x in new_v:
            print(f"❌ 新增未声明依赖：{x}")
        for x in new_c:
            print(f"❌ 新增循环依赖：{x}")
        for x in new_s:
            print(f"❌ services 内部新增越层依赖：{x}")
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
