"""把区块中文名从渲染器注册表搬进目录 JSON（真相源）。

    cd slide-rule-python
    .venv/bin/python scripts/sync_block_labels.py --check    # 只查差异，CI 用
    .venv/bin/python scripts/sync_block_labels.py            # 写回目录

## 为什么要搬

中文名一直是有的——`client/src/pages/sliderule/live-runtime/block-registry.tsx`
里每个区块都带 `label`（FilterBar → 「筛选条」，TrendChart → 「趋势图」），
111 个一个不缺。**但它只活在那一个 TSX 文件里**，于是：

  · `component-search.buildIndex(labelOf, …)` 靠调用方注入。组件库页面注入了
    真名字，而 `__tests__/component-search.test.ts` 注入的是 `() => undefined`
    ——**测出来的排序和用户看到的排序不是同一份**。这是 2026-08-09 排查
    「订单筛选」排序时发现的：我一度据此断定"区块没有中文名"，那个判断是错的，
    错在拿测试夹具当了产品现状。
  · Python 侧（拼提示词、门禁、装配）根本读不到中文名——那个 TSX 搬不过去。

目录 JSON 是两侧共用的唯一真相源，中文名理应待在那里。搬过去之后
`labelOf` 退化成可选覆盖，注入不注入都拿得到名字。

## 为什么是"搬"而不是"重新生成一份"

registry 里那 111 个名字是随渲染器一起写的，跟界面上真正显示的标题一致。
让模型另生成一份必然与之漂移，而且漂移看不出来。**已有的真话就别再编一遍。**

`--check` 是给 CI 的：以后在 registry 里改了名字忘了同步，这条先响。

## 落盘方式

按行插入，不重新序列化整份 JSON——原文件把短对象压在一行，`indent=2` 回写
会产生五千行重排（label_block_generality.py 里记着这笔账）。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "services" / "data" / "experience_block_catalog.json"
REGISTRY = (
    ROOT.parent / "client" / "src" / "pages" / "sliderule" / "live-runtime" / "block-registry.tsx"
)

#: BLOCK_DEFINITIONS 的条目形如 `    FilterBar: { render: …, label: "筛选条", … },`
#: 四空格缩进锚定的是注册表那张字面量表，避免匹配到组件内部的 `label:` 选项。
_ENTRY_RE = re.compile(r'^\s{4}(\w+):\s*\{[^\n]*?label:\s*"([^"]+)"', re.MULTILINE)

#: 块级键的缩进；propsSchema 内部也有 "type"，靠缩进区分。
_BLOCK_TYPE_LINE = '      "type": "'


def labels_from_registry() -> dict[str, str]:
    return {m[1]: m[2] for m in _ENTRY_RE.finditer(REGISTRY.read_text(encoding="utf-8"))}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只报差异，不写文件")
    args = ap.parse_args()

    labels = labels_from_registry()
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    blocks = catalog["blocks"]
    print(f"注册表 {len(labels)} 个中文名，目录 {len(blocks)} 个区块")

    missing = [b["type"] for b in blocks if b["type"] not in labels]
    stale = [
        b["type"]
        for b in blocks
        if b.get("label") and b["type"] in labels and b["label"] != labels[b["type"]]
    ]
    todo = [b["type"] for b in blocks if b["type"] in labels and b.get("label") != labels[b["type"]]]

    if missing:
        print(f"注册表里没有中文名的 {len(missing)} 个：{', '.join(missing)}")
    if stale:
        print(f"与注册表不一致的 {len(stale)} 个：{', '.join(stale)}")

    if args.check:
        if todo:
            print(f"\n目录落后 {len(todo)} 个中文名，跑一次本脚本同步", file=sys.stderr)
            return 1
        print("目录与注册表一致")
        return 0

    lines = CATALOG.read_text(encoding="utf-8").split("\n")
    out: list[str] = []
    wrote = 0
    prev_is_block_type = False
    for line in lines:
        # 幂等：只丢**紧跟在块级 type 后面**的那一行 label（正是本脚本写的位置）。
        #
        # ⚠ 第一版写的是"凡 6 空格缩进的 label 行一律丢"，一跑就删掉了 20 行
        # ——`pageRegions` 与 `pageKinds` 两段的中文名（「筛选区」「仪表盘」…）
        # 缩进完全相同。缩进不足以定位，得靠上一行是谁。
        if prev_is_block_type and line.startswith('      "label": "'):
            prev_is_block_type = False
            continue
        prev_is_block_type = line.startswith(_BLOCK_TYPE_LINE)
        out.append(line)
        if not prev_is_block_type:
            continue
        block_type = line[len(_BLOCK_TYPE_LINE) :].split('"', 1)[0]
        label = labels.get(block_type)
        if label is None:
            continue
        out.append(f'      "label": "{label}",')
        wrote += 1
    CATALOG.write_text("\n".join(out), encoding="utf-8")
    print(f"已写回 {wrote} 个中文名")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
