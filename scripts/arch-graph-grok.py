# -*- coding: utf-8 -*-
"""从 grok-build 的 Cargo workspace **算出**架构图，不许手画。

WhyBuddy 自己的图由 `arch_graph.py` / `arch-graph-ts.mjs` 生成。grok-build
那一侧他们一张图都没有——91 来个 crate 的边写在各自 Cargo.toml 里，由
cargo 强制。本文件只读他们的声明，画出那张他们从来没画过的图，好对照。

⚠ 不把 grok-build 源码拷进本仓。路径按下面顺序找：
    1. `--root`
    2. 环境变量 `GROK_BUILD_ROOT`
    3. 仓根的兄弟目录 `../grok-build`
    4. 仓根下的 `grok-build/`（有人把对照物放进工作区时）

用法：

    python scripts/arch-graph-grok.py --emit
    python scripts/arch-graph-grok.py --report
"""

from __future__ import annotations

import argparse
import os
import sys
import tomllib
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

REPO = Path(__file__).resolve().parent.parent
DIAGRAM = REPO / "docs" / "grok-build 架构图（自动生成）.md"

# 编排环那一截：Agent / 工具 / 工作流 / 会话壳。对照 WhyBuddy 时盯这一簇，
# 不要把 pager 的 700+ 个 rs 文件当成「我们也要长这么大」。
SPINE = (
    "xai-grok-agent",
    "xai-grok-tools",
    "xai-grok-tools-api",
    "xai-tool-runtime",
    "xai-tool-protocol",
    "xai-tool-types",
    "xai-workflow",
    "xai-grok-shell",
    "xai-agent-lifecycle",
    "xai-chat-state",
    "xai-grok-hooks",
    "xai-grok-mcp",
    "xai-grok-subagent-resolution",
    "xai-computer-hub-core",
    "xai-computer-hub-sdk",
    "xai-computer-hub-mcp-adapter",
    "xai-grok-config",
    "xai-grok-workspace",
    "xai-grok-sandbox",
    "xai-prompt-queue",
    "xai-grok-session-events",
)


@dataclass(frozen=True)
class Crate:
    name: str
    path: Path
    rel: str
    family: str
    description: str
    rs_files: int


@dataclass
class Graph:
    root: Path
    source_rev: str
    crates: Dict[str, Crate] = field(default_factory=dict)
    # (src, dst) 运行时内部边，不含 dev-dependencies
    edges: Set[Tuple[str, str]] = field(default_factory=set)
    workspace_members: int = 0


def _discover_root(explicit: Optional[str]) -> Path:
    candidates: List[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    env = os.environ.get("GROK_BUILD_ROOT", "").strip()
    if env:
        candidates.append(Path(env))
    candidates.append(REPO.parent / "grok-build")
    candidates.append(REPO / "grok-build")
    for p in candidates:
        if (p / "Cargo.toml").is_file() and (p / "crates").is_dir():
            return p.resolve()
    tried = " ; ".join(str(p) for p in candidates) or "(none)"
    raise SystemExit(f"找不到 grok-build（需要带 Cargo.toml + crates/）。试过：{tried}")


def _load_toml(path: Path) -> dict:
    return tomllib.loads(path.read_text(encoding="utf-8"))


def _family_of(rel: str) -> str:
    parts = Path(rel).parts
    if parts[0] == "crates" and len(parts) >= 2:
        return parts[1]  # codegen / common / build
    return parts[0]  # third_party / prod


def _count_rs(crate_dir: Path) -> int:
    n = 0
    for p in crate_dir.rglob("*.rs"):
        # 第三方 vendored / fuzz 语料不算 crate 自己的形状
        rel = p.relative_to(crate_dir).as_posix()
        if "/target/" in f"/{rel}" or rel.startswith("fuzz/"):
            continue
        n += 1
    return n


def _dep_tables(manifest: dict) -> Iterable[dict]:
    yield manifest.get("dependencies") or {}
    yield manifest.get("build-dependencies") or {}
    target = manifest.get("target") or {}
    if isinstance(target, dict):
        for spec in target.values():
            if isinstance(spec, dict):
                yield spec.get("dependencies") or {}
                yield spec.get("build-dependencies") or {}


def _dep_crate_name(key: str, spec) -> Optional[str]:
    """Cargo 依赖键 → 被依赖的 package 名。"""
    if spec is None or spec is True:
        return key
    if isinstance(spec, str):
        # "1.0" 这种 crates.io 版本，不是内部 crate
        return None
    if not isinstance(spec, dict):
        return None
    pkg = spec.get("package")
    name = pkg if isinstance(pkg, str) and pkg else key
    if spec.get("path") or spec.get("workspace") is True:
        return name
    return None


def _workspace_internal_names(root_toml: dict) -> Set[str]:
    """workspace.dependencies 里带 path 的，是内部 crate 的别名。"""
    names: Set[str] = set()
    deps = root_toml.get("workspace", {}).get("dependencies") or {}
    # 根文件也可能把内部 crate 写在 [workspace.dependencies] 顶层
    # （本仓 grok-build 就是这样）
    if not deps and "workspace" not in root_toml:
        deps = {}
    # 上面 get 已经拿到了。再并上根 toml 里直接的 workspace.dependencies。
    for key, spec in deps.items():
        if isinstance(spec, dict) and spec.get("path"):
            names.add(spec.get("package") or key)
    return names


def build_graph(root: Path) -> Graph:
    root_toml = _load_toml(root / "Cargo.toml")
    members = list(root_toml.get("workspace", {}).get("members") or [])
    source_rev = ""
    rev_file = root / "SOURCE_REV"
    if rev_file.is_file():
        source_rev = rev_file.read_text(encoding="utf-8").strip()

    g = Graph(root=root, source_rev=source_rev, workspace_members=len(members))
    path_by_name: Dict[str, Path] = {}

    for rel in members:
        crate_dir = root / rel
        manifest_path = crate_dir / "Cargo.toml"
        if not manifest_path.is_file():
            continue
        man = _load_toml(manifest_path)
        pkg = man.get("package") or {}
        name = pkg.get("name")
        if not name:
            continue
        g.crates[name] = Crate(
            name=name,
            path=crate_dir,
            rel=rel.replace("\\", "/"),
            family=_family_of(rel.replace("\\", "/")),
            description=(pkg.get("description") or "").strip(),
            rs_files=_count_rs(crate_dir),
        )
        path_by_name[name] = crate_dir

    internal = set(g.crates)
    internal |= _workspace_internal_names(root_toml)

    for name, crate in g.crates.items():
        man = _load_toml(crate.path / "Cargo.toml")
        for table in _dep_tables(man):
            if not isinstance(table, dict):
                continue
            for key, spec in table.items():
                dest = _dep_crate_name(key, spec)
                if dest and dest in g.crates and dest != name:
                    g.edges.add((name, dest))
                elif dest is None:
                    continue
                else:
                    # workspace = true 但键名就是内部 crate
                    if key in g.crates and key != name and (
                        isinstance(spec, dict) and spec.get("workspace") is True
                    ):
                        g.edges.add((name, key))
    return g


def _degrees(g: Graph) -> Tuple[Dict[str, int], Dict[str, int]]:
    inn = {n: 0 for n in g.crates}
    out = {n: 0 for n in g.crates}
    for a, b in g.edges:
        out[a] = out.get(a, 0) + 1
        inn[b] = inn.get(b, 0) + 1
    return inn, out


def _cycles(g: Graph) -> List[str]:
    """模块级环。Rust 编不过，这里只作对照——算出来就该是空。"""
    adj: Dict[str, List[str]] = defaultdict(list)
    for a, b in g.edges:
        adj[a].append(b)
    seen: Set[str] = set()
    stack: Set[str] = set()
    path: List[str] = []
    found: List[str] = []

    def dfs(n: str) -> None:
        if n in stack:
            i = path.index(n)
            found.append(" -> ".join(path[i:] + [n]))
            return
        if n in seen:
            return
        seen.add(n)
        stack.add(n)
        path.append(n)
        for m in sorted(adj.get(n, [])):
            dfs(m)
        path.pop()
        stack.remove(n)

    for n in sorted(g.crates):
        dfs(n)
    return sorted(set(found))


def _mid(name: str) -> str:
    return "c_" + name.replace("-", "_")


def _family_mermaid(g: Graph) -> str:
    counts: Dict[str, int] = defaultdict(int)
    for c in g.crates.values():
        counts[c.family] += 1
    fam_edges: Dict[Tuple[str, str], int] = defaultdict(int)
    for a, b in g.edges:
        fa, fb = g.crates[a].family, g.crates[b].family
        if fa != fb:
            fam_edges[(fa, fb)] += 1
    lines = ["flowchart TB"]
    for fam in sorted(counts):
        lines.append(f'  {fam}["{fam}<br/>{counts[fam]} 个 crate"]')
    for (a, b), n in sorted(fam_edges.items()):
        lines.append(f"  {a} -->|{n}| {b}")
    return "\n".join(lines)


def _spine_mermaid(g: Graph) -> str:
    present = [n for n in SPINE if n in g.crates]
    present_set = set(present)
    lines = ["flowchart LR"]
    for n in present:
        desc = g.crates[n].description or n
        # mermaid 标签里的引号会拆节点
        label = desc.replace('"', "'")
        if len(label) > 42:
            label = label[:40] + "…"
        lines.append(f'  {_mid(n)}["{n}<br/>{label}"]')
    for a, b in sorted(g.edges):
        if a in present_set and b in present_set:
            lines.append(f"  {_mid(a)} --> {_mid(b)}")
    return "\n".join(lines)


def _family_crate_mermaid(g: Graph, family: str, limit: int = 36) -> Optional[str]:
    """单个 family 内部的 crate 图。节点太多就只画被依赖最多的。"""
    members = [c.name for c in g.crates.values() if c.family == family]
    if len(members) < 2:
        return None
    inn, _out = _degrees(g)
    # 内部边
    internal = [(a, b) for a, b in g.edges if a in members and b in members]
    if family == "codegen" and len(members) > limit:
        # codegen 70+ 个节点会把 mermaid 撑爆。取入度最高的 + 组合根。
        ranked = sorted(members, key=lambda n: (-inn.get(n, 0), n))
        keep = set(ranked[:limit])
        # 入度为 0 的大块（shell / pager）也留着，否则图上看不见产品入口
        for n in members:
            if g.crates[n].rs_files >= 200:
                keep.add(n)
        members = [n for n in members if n in keep]
        internal = [(a, b) for a, b in internal if a in keep and b in keep]
    lines = ["flowchart TB"]
    for n in sorted(members):
        lines.append(f'  {_mid(n)}["{n}<br/>{g.crates[n].rs_files} rs · in {inn.get(n, 0)}"]')
    for a, b in sorted(internal):
        lines.append(f"  {_mid(a)} --> {_mid(b)}")
    return "\n".join(lines)


def render_doc(g: Graph) -> str:
    inn, out = _degrees(g)
    cycles = _cycles(g)
    by_family: Dict[str, List[Crate]] = defaultdict(list)
    for c in g.crates.values():
        by_family[c.family].append(c)
    leaves = sorted(n for n in g.crates if out[n] == 0)
    roots = sorted(n for n in g.crates if inn[n] == 0)
    top_in = sorted(g.crates, key=lambda n: (-inn[n], n))[:15]
    top_out = sorted(g.crates, key=lambda n: (-out[n], n))[:15]
    biggest = sorted(g.crates.values(), key=lambda c: (-c.rs_files, c.name))[:8]

    body: List[str] = [
        "# grok-build 架构图（自动生成）",
        "",
        "> ⚠ **这份文件是 `scripts/arch-graph-grok.py --emit` 生成的，别手改。**",
        "> grok-build 自己一张架构图都没有：边写在各 crate 的 `Cargo.toml` 里，",
        "> cargo 编译器强制。本文件只是把那些声明画出来，方便和 WhyBuddy 对照。",
        "> grok-build 源码不进本仓。",
        "",
        f"- 对照物路径：`{g.root}`",
        f"- `SOURCE_REV`：`{g.source_rev or '（无）'}`",
        f"- workspace members **{g.workspace_members}**，读到 crate **{len(g.crates)}**",
        f"- 内部运行时依赖边 **{len(g.edges)}**（含 build-dependencies，不含 dev-dependencies）",
        f"- crate 级循环依赖 **{len(cycles)}** 个（Rust 编不过，应当是 0）",
        "",
        "## 分层（目录就是层）",
        "",
        "| 层 | crate 数 | .rs 文件 | 是什么 |",
        "|---|---:|---:|---|",
    ]
    family_what = {
        "codegen": "产品：agent / tools / shell / pager / workspace",
        "common": "跨产品叶子：tool-runtime / protocol / tracing / compaction",
        "build": "构建期：proto 代码生成",
        "third_party": "vendor：mermaid 渲染、dagre、graphlib",
        "prod": "生产侧小包：cli-chat-proxy-types",
    }
    for fam in sorted(by_family):
        crates = by_family[fam]
        rs = sum(c.rs_files for c in crates)
        body.append(
            f"| `{fam}` | {len(crates)} | {rs} | {family_what.get(fam, '')} |"
        )
    body += [
        "",
        "```mermaid",
        _family_mermaid(g),
        "```",
        "",
        "## 编排环（对照 WhyBuddy 时看这一张）",
        "",
        "grok 的「魂」不在 pager 的 700 个 rs 文件里，在这一簇：",
        "`AgentDefinition` → 闭集工具 → `xai-workflow` 脚本编排 → shell 会话。",
        "`xai-workflow` 若画出零内部 crate 依赖，说明它是叶子引擎——脚本编排",
        "不该反向依赖某个具体 Agent。",
        "",
        "```mermaid",
        _spine_mermaid(g),
        "```",
        "",
        "## 被依赖最多的 crate（叶子越往上越值钱）",
        "",
        "| crate | 入度 | 出度 | .rs | 层 | 一句话 |",
        "|---|---:|---:|---:|---|---|",
    ]
    for n in top_in:
        c = g.crates[n]
        desc = (c.description or "").replace("|", "/")
        body.append(
            f"| `{n}` | {inn[n]} | {out[n]} | {c.rs_files} | {c.family} | {desc} |"
        )
    body += [
        "",
        "## 依赖别人最多的 crate（组合根 / 大块）",
        "",
        "| crate | 出度 | 入度 | .rs | 层 |",
        "|---|---:|---:|---:|---|",
    ]
    for n in top_out:
        c = g.crates[n]
        body.append(
            f"| `{n}` | {out[n]} | {inn[n]} | {c.rs_files} | {c.family} |"
        )
    body += [
        "",
        "## 体积最大的 crate",
        "",
        "形状不是均匀切小，是**两个巨石 + 一大批叶子**。巨石内部缠没关系，",
        "叶子被 cargo 焊死不可能反过来依赖巨石。",
        "",
        "| crate | .rs | 入度 | 出度 |",
        "|---|---:|---:|---:|",
    ]
    for c in biggest:
        body.append(f"| `{c.name}` | {c.rs_files} | {inn[c.name]} | {out[c.name]} |")
    body += [
        "",
        "## 叶子 crate（出度 0，谁都能安全依赖）",
        "",
        f"共 **{len(leaves)}** 个：",
        "",
        ", ".join(f"`{n}`" for n in leaves),
        "",
        "## 入度 0（没被其它 crate 依赖：组合根 / bin / 尚未挂上）",
        "",
        f"共 **{len(roots)}** 个：",
        "",
        ", ".join(f"`{n}`" for n in roots),
        "",
        "## 循环依赖",
        "",
    ]
    if cycles:
        for cyc in cycles:
            body.append(f"- `{cyc}`")
    else:
        body.append("（当前没有。这是 cargo 的底线，不是我们数出来的美德。）")

    for fam in ("common", "build", "third_party", "prod", "codegen"):
        mermaid = _family_crate_mermaid(g, fam)
        if not mermaid:
            continue
        note = ""
        if fam == "codegen":
            note = (
                "codegen 成员太多，图上只保留入度最高的一批和体积 ≥200 rs 的巨石；"
                "完整名单见下表。"
            )
        body += [
            "",
            f"## `{fam}` 内部",
            "",
        ]
        if note:
            body += [note, ""]
        body += [
            "```mermaid",
            mermaid,
            "```",
        ]

    body += [
        "",
        "## 全部 crate",
        "",
        "| crate | 层 | .rs | 入度 | 出度 | 路径 | 一句话 |",
        "|---|---|---:|---:|---:|---|---|",
    ]
    for name in sorted(g.crates):
        c = g.crates[name]
        desc = (c.description or "").replace("|", "/")
        body.append(
            f"| `{name}` | {c.family} | {c.rs_files} | {inn[name]} | {out[name]} | `{c.rel}` | {desc} |"
        )
    body.append("")
    return "\n".join(body)


def _report(g: Graph) -> None:
    inn, out = _degrees(g)
    print(
        f"crates {len(g.crates)}  edges {len(g.edges)}  "
        f"cycles {len(_cycles(g))}  rev {g.source_rev[:12] or '-'}"
    )
    print(f"leaves {sum(1 for n in g.crates if out[n] == 0)}  "
          f"roots {sum(1 for n in g.crates if inn[n] == 0)}")
    wf = g.crates.get("xai-workflow")
    if wf:
        internal = [b for a, b in g.edges if a == "xai-workflow"]
        print(f"xai-workflow out={out['xai-workflow']} -> {internal or '(none)'}")


def main(argv: Optional[List[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        fn = getattr(stream, "reconfigure", None)
        if callable(fn):
            try:
                fn(encoding="utf-8", errors="replace")
            except Exception:
                pass
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", help="grok-build 源码根目录")
    ap.add_argument("--emit", action="store_true", help="写 docs/grok-build 架构图（自动生成）.md")
    ap.add_argument("--report", action="store_true", help="人看的摘要")
    args = ap.parse_args(argv)

    g = build_graph(_discover_root(args.root))
    if args.emit:
        DIAGRAM.parent.mkdir(parents=True, exist_ok=True)
        DIAGRAM.write_text(render_doc(g), encoding="utf-8")
        print(f"已生成 {DIAGRAM.relative_to(REPO)}")
        _report(g)
        return 0
    _report(g)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
