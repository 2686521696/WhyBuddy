"""对照实验：spec 单独推五系统模型 vs spec + 参照图一起推。

## 要回答的问题

「AI 看不到页面长什么样，逻辑关联关系推得不准」——这是一句主观感受，
这个脚本把它变成可复核的数。

## 两组差在哪（只差这一处）

    A 组（基线，系统今天真实在跑的）
        system: schema_instruction_for(goal)
        user:   _build_user_content(goal)

    B 组
        system: 同上，**一字不改**
        user:   同上 + spec_tree 的结构化节点 + 4 张参照图

契约（system）完全一致，模型、温度、预算一致。**唯一变量是"多了证据"。**
这一点必须守住，否则测出来的差异归不了因。

## 为什么不比"看着更好"

看的人已经知道哪份是哪组。所以判据全部前置写死在 metrics.py 里，
名词表在跑之前从 spec 抽一次、两组共用。

## 方差

同一输入下 completion_tokens 能从 1455 跳到 5495（同日实测）。所以
--n 默认 3，报中位数；看一发就下结论一定被噪声骗。

用法：
    python experiments/visual-first/runner.py --n 3
    python experiments/visual-first/runner.py --n 1 --only B   # 单跑一组
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import pathlib
import statistics
import sys
import time

_HERE = pathlib.Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent
sys.path.insert(0, str(_ROOT / "slide-rule-python"))

for line in (_ROOT / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
# 实验只读 LLM，不该碰任何存储：把库网关摘掉，免得试验数据落进生产。
os.environ["APP_STORE_HTTP_API_URL"] = ""
os.environ["APP_STORE_HTTP_API_KEY"] = ""
os.environ["SLIDERULE_SESSION_LOCAL_IMPORT"] = "0"

from metrics import measure  # noqa: E402
from services.v5_llm_generate import (  # noqa: E402
    _build_user_content,
    schema_instruction_for,
)
from services.v5_model_gate import validate_five_system_model  # noqa: E402
from sliderule_llm.config import default_max_tokens, get_llm_config  # noqa: E402

MATERIALS = _HERE / "materials"
RUNS = _HERE / "runs"


def load_goal() -> str:
    brief = json.loads((MATERIALS / "clarified_brief.json").read_text(encoding="utf-8"))
    for key in ("intent", "goal", "brief", "summary", "text"):
        v = brief.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return json.dumps(brief, ensure_ascii=False)


def load_spec_digest() -> str:
    """spec 树里跟"要做什么"有关的那几类节点，压成一段文本。"""
    tree = json.loads((MATERIALS / "spec_tree.json").read_text(encoding="utf-8"))
    nodes = tree.get("nodes") or []
    seq = list(nodes.values()) if isinstance(nodes, dict) else nodes
    lines = []
    for n in seq:
        if n.get("type") not in ("requirement", "design"):
            continue
        lines.append(f"- [{n.get('type')}] {n.get('title','')}")
        if n.get("acceptance"):
            lines.append(f"    验收：{n['acceptance']}")
        if n.get("detail"):
            lines.append(f"    要点：{n['detail']}")
    return "\n".join(lines)


def load_images() -> list[tuple[str, str]]:
    out = []
    for p in sorted((MATERIALS / "previews").glob("*.png")):
        out.append((p.stem, base64.b64encode(p.read_bytes()).decode("ascii")))
    return out


def derive_terms(goal: str, spec: str) -> list[str]:
    """从 spec 抽一份业务名词表——**只抽一次，两组共用，且早于任何产出**。

    缓存到 materials/terms.json：重跑实验时尺子不能变，否则前后两次的数没法比。
    """
    cache = MATERIALS / "terms.json"
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))["terms"]
    from sliderule_llm.client import call_llm_json

    parsed, _ = call_llm_json(
        [
            {
                "role": "system",
                "content": "你从产品需求里抽业务名词。只输出 JSON，不要解释。",
            },
            {
                "role": "user",
                "content": f"产品意图：\n{goal}\n\n需求节点：\n{spec}\n\n"
                '抽出这个系统**必须**建模的业务名词（实体名与关键字段名，中文，'
                '2-6 字，不要动词、不要形容词、不要"系统/功能/页面"这类元词）。'
                '只输出 JSON：{"terms":["客户","跟进记录",...]}，20-35 个。',
            },
        ],
        temperature=0.0,
    )
    terms = [t for t in (parsed.get("terms") or []) if isinstance(t, str)]
    cache.write_text(
        json.dumps({"terms": terms, "derivedFrom": "spec only"}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    return terms


def run_a(goal: str) -> dict | None:
    """基线：系统今天真实在跑的那条路，一字不改。"""
    from services.v5_llm_generate import generate_five_system_model

    return generate_five_system_model(goal)


def run_b(
    goal: str, spec: str, images: list[tuple[str, str]], failures: list[str] | None = None
) -> dict | None:
    """spec + 图。system 契约与 A 完全一致，只在 user 消息上加证据。

    ## 重试预算必须跟 A 对齐（2026-08-13 修，第一轮跑完才发现）

    `generate_five_system_model` 里有这么一行：

        attempts = 1 if use_parallel else (2 if llm_json_fn is None else 1)

    **注入 llm_json_fn 会把外层重试从 2 次砍成 1 次。** 第一轮 B 组 3 跑挂 2，
    挂的是我这个台子，不是这条路线——A 有两次机会，B 只有一次，还不算 A 的
    结构化通道内部那 2 次错误回喂。这么比出来的失败率没有意义。

    所以这里自己补上外层重试，并把 shape 回喂提到 2，让两组的预算量级对齐。
    """
    from services.v5_llm_generate import generate_five_system_model
    from sliderule_llm.client import call_llm_json_with_shape

    _REQUIRED = ("datamodel", "rbac", "workflow", "page", "aigc", "appbundle")

    def fn(g: str):
        parts: list[dict] = [
            {
                "type": "text",
                "text": _build_user_content(g)
                + "\n\n以下是这个产品的需求树节点（权威语义来源）：\n"
                + spec
                + "\n\n随附 "
                + str(len(images))
                + " 张该产品的界面草样。**它们是结构证据，不是取值来源**："
                "从图里读「有哪些实体、哪些列表、哪些字段同时出现、有哪些动作、"
                "页面之间怎么跳」；图上的具体文字（客户A、示例公司、占位）都是"
                "刻意的占位符，一律不要当成枚举值或默认值——枚举值只能来自上面"
                "的需求树。图与需求树冲突时，以需求树为准。",
            }
        ]
        for name, b64 in images:
            parts.append({"type": "text", "text": f"界面草样：{name}"})
            parts.append(
                {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
            )
        try:
            parsed, _ = call_llm_json_with_shape(
                [
                    {"role": "system", "content": schema_instruction_for(g)},
                    {"role": "user", "content": parts},
                ],
                required_keys=_REQUIRED,
                max_shape_retries=2,
                temperature=0.2,
                backoff_ms=2000,
            )
        except Exception as exc:  # noqa: BLE001 — 失败原因要留证，不能只看到"没模型"
            if failures is not None:
                failures.append(str(exc)[:4000])
            raise
        return parsed if isinstance(parsed, dict) else None

    # 外层两次，对齐 A 的 `attempts=2`（见上面 docstring）
    for _ in range(2):
        model = generate_five_system_model(goal, llm_json_fn=fn)
        if model:
            return model
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=3, help="每组跑几次（方差大，默认 3 取中位数）")
    ap.add_argument("--only", choices=["A", "B"], default=None)
    args = ap.parse_args()

    cfg = get_llm_config()
    print(f"模型 {cfg.model} @ {cfg.base_url} | effort={cfg.reasoning_effort} "
          f"| max_tokens={default_max_tokens()} | 支持图={cfg.supports_image_content_parts}",
          flush=True)
    if not cfg.supports_image_content_parts:
        print("⚠ 当前通道未声明支持图片输入，B 组会失败。检查 LLM_SUPPORTS_IMAGE_CONTENT_PARTS", flush=True)

    goal = load_goal()
    spec = load_spec_digest()
    images = load_images()
    print(f"意图 {len(goal)} 字 | spec 摘要 {len(spec)} 字 | 参照图 {len(images)} 张", flush=True)
    if not images:
        print("⚠ 没找到参照图（materials/previews/*.png）——B 组无从谈起", flush=True)

    terms = derive_terms(goal, spec)
    print(f"业务名词表（只从 spec 抽，两组共用）{len(terms)} 个: {'、'.join(terms[:12])}…", flush=True)

    stamp = time.strftime("%Y%m%d-%H%M%S")
    outdir = RUNS / stamp
    outdir.mkdir(parents=True, exist_ok=True)
    (outdir / "terms.json").write_text(json.dumps(terms, ensure_ascii=False, indent=1), encoding="utf-8")

    results: dict[str, list[dict]] = {"A": [], "B": []}
    groups = [args.only] if args.only else ["A", "B"]
    for group in groups:
        for i in range(args.n):
            t0 = time.time()
            try:
                fails: list[str] = []
                model = run_a(goal) if group == "A" else run_b(goal, spec, images, fails)
                if fails:
                    (outdir / f"fail_{group}{i+1}.txt").write_text(
                        "\n\n---\n\n".join(fails), encoding="utf-8")
            except Exception as exc:  # noqa: BLE001 — 一次失败不该带走整场
                print(f"[{group}{i+1}] 抛异常：{str(exc)[:200]}", flush=True)
                model = None
            el = time.time() - t0
            if not model:
                print(f"[{group}{i+1}] 生成失败  {el:.0f}s", flush=True)
                results[group].append({"ok": False, "seconds": el})
                continue
            gate = validate_five_system_model(model)
            m = measure(model, gate, terms)
            m.update({"ok": True, "seconds": round(el, 1)})
            results[group].append(m)
            (outdir / f"model_{group}{i+1}.json").write_text(
                json.dumps(model, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            print(
                f"[{group}{i+1}] {el:5.0f}s  闸findings={m['gate_findings']:<3} "
                f"实体={m['entities']:<3} 字段={m['fields']:<4} ref={m['ref_fields']:<3}"
                f"(悬空{m['ref_dangling']}) 流程={m['wf_nodes']}/{m['wf_transitions']}"
                f"{'连通' if m['wf_connected'] else '断裂'} "
                f"spec覆盖={m['coverage']:.0%} 臆造={m['fabrication_hits']}",
                flush=True,
            )

    (outdir / "raw.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")

    def med(group: str, key: str):
        vals = [r[key] for r in results[group] if r.get("ok") and isinstance(r.get(key), (int, float))]
        return statistics.median(vals) if vals else None

    print("\n" + "=" * 76)
    print(f"{'指标':<22}{'A 纯 spec':>16}{'B spec+图':>16}   说明")
    rows = [
        ("闸 findings", "gate_findings", "越少越好"),
        ("实体数", "entities", ""),
        ("字段数", "fields", ""),
        ("ref 字段数", "ref_fields", "关联密度"),
        ("ref 悬空数", "ref_dangling", "越少越好"),
        ("流程节点", "wf_nodes", ""),
        ("流程转移", "wf_transitions", ""),
        ("权限数", "permissions", ""),
        ("页面动作被覆盖", "page_actions_covered", ""),
        ("页面数", "pages", ""),
        ("区块数", "blocks", ""),
        ("字段绑定", "field_bindings", ""),
        ("spec 覆盖率", "coverage", "越高越好"),
        ("臆造命中", "fabrication_hits", "越少越好"),
        ("耗时 s", "seconds", ""),
    ]
    for label, key, note in rows:
        a, b = med("A", key), med("B", key)
        fa = "-" if a is None else (f"{a:.0%}" if key == "coverage" else f"{a:g}")
        fb = "-" if b is None else (f"{b:.0%}" if key == "coverage" else f"{b:g}")
        print(f"{label:<22}{fa:>16}{fb:>16}   {note}")
    print("=" * 76)
    print(f"中位数，各 n={args.n}。原始数据 {outdir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
