"""量"生成出来的页面是不是越来越像"。

## 为什么要有这个

给生成契约加约束（槽位形态说明、逐条槽位理由、总览页禁令……）都在减少
模型犯错，但同一批改动也可能顺手把多样性压没了——"每个 app 长得一样"正是
这个项目一路在治的病（首页固定骨架、参照板五段常量让两个完全不同业务的
出图提示词逐字相同 87%）。

加约束时凭感觉判断"应该不会变雷同吧"没有意义，所以拿数据说话。

## 量什么

分两块，因为它们的版式由**不同的 LLM、不同的机制**决定：

- **业务页**（workbench/kanban/calendar/wizard…）：版式 = page.layout 的 5 槽位
  摆法，由五系统生成 LLM 在纯文字契约下决定。槽位形态说明影响的是这一块。
- **总览页**（monitor/dashboard）：版式 = freeformOverview 设计树，由设计 LLM
  照参照图排。首页视觉个性全在这里，槽位说明**影响不到**它（骨架整段不渲染）。

两块分开报，否则一块变雷同会被另一块稀释掉、看不出来。

## 怎么读

「不同摆法 / 页面总数」越接近 1 越多样，越接近 0 说明大家长一个样。
另外列出每个槽位的类型分布：如果某个槽位在所有页面上都是同一种积木，
那一行就是雷同的来源。

## 用法

    .venv/bin/python scripts/layout_diversity_report.py <model.json...|目录>

    # 例：把今天所有轮次一起比
    .venv/bin/python scripts/layout_diversity_report.py /tmp/.../scratchpad/*/model.json

单份文件也能跑（只报当次内部的多样性）；要看"改动前后是否变雷同"，
把两组分别跑一次对比数字。
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

OVERVIEW_KINDS = {"monitor", "dashboard"}
# 与 AppRuntimeScreen 的渲染顺序一致，报表按这个顺序列槽位
SLOT_ORDER = ("summary", "primary", "secondary", "activity", "content")


def _business_shape(page: dict) -> str:
    """业务页的版式指纹：哪个槽位放了哪几种积木（按类型，不按 id）。

    用**类型**而不是 id：两页各有一个 FilterBar 但 id 不同，画出来是一样的
    摆法，按 id 比会把它们算成两种，多样性虚高。
    """
    by_id = {str(b.get("id")): str(b.get("type") or "?") for b in (page.get("blocks") or [])}
    layout = page.get("layout") or {}
    parts = []
    for slot in SLOT_ORDER:
        ids = layout.get(slot)
        if not isinstance(ids, list) or not ids:
            continue
        types = [by_id.get(str(i), "?") for i in ids]
        parts.append(f"{slot}:{'+'.join(types)}")
    return " | ".join(parts) or "(无 layout)"


def _overview_shape(page: dict) -> str:
    """总览页的版式指纹：设计树里"内容块"的出现序列。

    不用节点总数/深度这类标量——它们对"排布方式"不敏感（同样 38 个节点可以
    是完全不同的两种版式）。改用**内容种类的出现顺序**：图表、嵌入积木、挂了
    dataRef 的数字、纯文本，各自出现在什么位置。这才是"这一页长什么样"。
    """
    seq: list[str] = []

    def walk(node, depth: int) -> None:
        if depth > 8 or not isinstance(node, (dict, list)):
            return
        if isinstance(node, list):
            for item in node:
                walk(item, depth + 1)
            return
        ref = node.get("blockRef")
        if isinstance(ref, dict) and ref.get("type"):
            seq.append(f"blk:{ref['type']}")
        elif node.get("chart"):
            seq.append("chart")
        elif node.get("dataRef"):
            seq.append("num")
        for value in node.values():
            if isinstance(value, (dict, list)):
                walk(value, depth + 1)

    walk((page.get("freeformOverview") or {}).get("root"), 0)
    return ">".join(seq) or "(无设计树)"


def _load(paths: list[str]) -> list[tuple[str, dict]]:
    out = []
    for raw in paths:
        p = Path(raw)
        files = sorted(p.rglob("model.json")) if p.is_dir() else [p]
        for f in files:
            try:
                out.append((f.parent.name or f.name, json.loads(f.read_text(encoding="utf-8"))))
            except (OSError, ValueError) as exc:
                print(f"跳过 {f}: {exc}")
    return out


def _report(label: str, shapes: list[tuple[str, str, str]]) -> None:
    """shapes: [(来源, 页面id, 指纹)]"""
    if not shapes:
        print(f"\n【{label}】没有这类页面\n")
        return
    distinct = {s for _, _, s in shapes}
    ratio = len(distinct) / len(shapes)
    verdict = "多样" if ratio >= 0.7 else ("偏同质" if ratio >= 0.4 else "⚠ 高度雷同")
    print(f"\n【{label}】页面 {len(shapes)} 个，不同摆法 {len(distinct)} 种"
          f"　多样度 {ratio:.2f} —— {verdict}")
    counts = Counter(s for _, _, s in shapes)
    for shape, n in counts.most_common():
        flag = "  ← 重复最多" if n > 1 and n == counts.most_common(1)[0][1] else ""
        print(f"    ×{n}  {shape[:150]}{flag}")


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    models = _load(args)
    if not models:
        print("没读到任何 model.json")
        return 1
    print(f"读入 {len(models)} 份模型: {', '.join(src for src, _ in models)}")

    biz: list[tuple[str, str, str]] = []
    ovw: list[tuple[str, str, str]] = []
    slot_types: dict[str, Counter] = defaultdict(Counter)

    for src, m in models:
        for page in (m.get("page") or {}).get("pages") or []:
            kind = str(page.get("kind") or "")
            pid = str(page.get("id") or "?")
            if kind in OVERVIEW_KINDS and page.get("freeformOverview"):
                ovw.append((src, pid, _overview_shape(page)))
                continue
            biz.append((src, pid, _business_shape(page)))
            by_id = {str(b.get("id")): str(b.get("type") or "?") for b in (page.get("blocks") or [])}
            for slot in SLOT_ORDER:
                for bid in (page.get("layout") or {}).get(slot) or []:
                    slot_types[slot][by_id.get(str(bid), "?")] += 1

    _report("业务页 · 5 槽位摆法（受槽位形态说明影响）", biz)
    _report("总览页 · 首页设计版式（不受槽位说明影响，视觉个性在这）", ovw)

    if slot_types:
        print("\n【各槽位的积木类型分布】某槽位若恒为同一种，那一行就是雷同来源")
        for slot in SLOT_ORDER:
            c = slot_types.get(slot)
            if not c:
                continue
            total = sum(c.values())
            kinds = len(c)
            detail = "、".join(f"{t}×{n}" for t, n in c.most_common())
            mark = "  ⚠ 恒定" if kinds == 1 and total > 2 else ""
            print(f"    {slot:<10} {kinds} 种 / {total} 次　{detail}{mark}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
