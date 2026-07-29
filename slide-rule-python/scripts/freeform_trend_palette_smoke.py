"""真跑一次：色板合规机械校验 + KPI 环比/迷你走势线。

两件事一起验，因为它们都只在**真实生成**里才看得出来：
- 色板：上一轮实测 tangerine 主题的产出里主色一次没用、蓝色占 60%，
  guard 加上之后要看它到底有没有拦住（或者纠偏）。
- 走势线：schema 允许了不等于模型会用，要数一数真实产出里挂了几处
  trendFieldRef。之前 blockRef 就栽在这——加了字段、真跑 0 次，因为
  prompt 没告诉模型有哪些可用的候选。

用法：
    cd slide-rule-python
    .venv/bin/python scripts/freeform_trend_palette_smoke.py [out.json] [domain]

domain 给 builtin_domain_models.json 里的键（比如 service_ticket）时，改用那份
真实数据模型生成——产物可以直接塞回 fixture 用浏览器截图看渲染效果；不给就用
本文件内置的电商模型（只验生成侧，不进浏览器）。
"""

import json
import os
import sys
import time
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
_ROOT = _PY_DIR.parent
sys.path.insert(0, str(_PY_DIR))


def _load_env_file(path: Path) -> int:
    loaded = 0
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return 0
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
            loaded += 1
    return loaded


# 刻意用 tangerine：上次跑偏的就是它，暖橙系最容易被模型改判成"仪表盘就该是蓝的"。
THEME_ID = "tangerine"

DATAMODEL = {
    "entities": [
        {
            "id": "order",
            "label": "订单",
            "fields": [
                {"id": "amount", "label": "订单金额", "type": "number"},
                {"id": "placed_at", "label": "下单时间", "type": "date"},
                {
                    "id": "status",
                    "label": "状态",
                    "type": "enum",
                    "options": [
                        {"id": "paid", "label": "已支付"},
                        {"id": "shipped", "label": "已发货"},
                        {"id": "done", "label": "已完成"},
                    ],
                },
            ],
        },
        {
            "id": "customer",
            "label": "客户",
            "fields": [
                {"id": "name", "label": "客户名", "type": "string"},
                {"id": "joined_at", "label": "注册时间", "type": "date"},
                {"id": "ltv", "label": "累计消费", "type": "number"},
            ],
        },
    ]
}

BRIEF = "电商后台首页的核心经营总览：今日成交、客单价、新增客户等关键指标一览"


def _walk(node):
    yield node
    for c in node.get("children", []) or []:
        yield from _walk(c)


def _builtin_datamodel(domain: str) -> dict:
    path = _PY_DIR / "services" / "data" / "builtin_domain_models.json"
    models = json.loads(path.read_text(encoding="utf-8"))
    if domain not in models:
        raise SystemExit(f"unknown domain '{domain}'. available: {sorted(models)}")
    return models[domain]["datamodel"]


def main() -> int:
    _load_env_file(_ROOT / ".env")

    from services.freeform_block import _theme_palette, generate_freeform_block
    from services.palette_guard import extract_hex_colors, palette_report

    datamodel, brief = DATAMODEL, BRIEF
    if len(sys.argv) > 2:
        domain = sys.argv[2]
        datamodel = _builtin_datamodel(domain)
        brief = f"{domain} 首页的核心运营总览：关键指标一览"
        print(f"[smoke] datamodel from builtin domain '{domain}'")

    theme = _theme_palette(THEME_ID)
    print(f"[smoke] theme={THEME_ID} primary={theme.get('primary')}")

    t0 = time.time()
    content = generate_freeform_block(brief, datamodel, theme_id=THEME_ID, device="desktop")
    print(f"[smoke] generated in {time.time() - t0:.1f}s")

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "freeform_trend_palette_smoke.json")
    out.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[smoke] saved to {out}")

    nodes = list(_walk(content["root"]))
    trend_nodes = [n for n in nodes if (n.get("dataRef") or {}).get("trendFieldRef")]
    dataref_nodes = [n for n in nodes if n.get("dataRef")]
    print(f"[smoke] nodes={len(nodes)} dataRef={len(dataref_nodes)} withTrend={len(trend_nodes)}")
    for n in trend_nodes:
        d = n["dataRef"]
        print(
            f"[smoke]   trend: {d['entityRef']}.{d.get('aggregate')} "
            f"over {d['trendFieldRef']} grain={d.get('trendGrain') or 'day(默认)'}"
        )

    # 色板体检：这是 guard 之后的**最终产出**，等于给防线本身做验收。
    # 色板口径跟 generate_freeform_block 里那段完全一致（primary + charts）。
    palette = [theme["primary"], *theme["charts"]]
    report = palette_report(extract_hex_colors(content), palette, theme["primary"])
    print(
        f"[smoke] palette: non_neutral={report.non_neutral} "
        f"primary_uses={report.primary_uses} dominant_uses={report.dominant_uses} "
        f"hue_ok={report.hue_ok} primary_ok={report.primary_ok}"
    )
    if report.off_palette:
        print(f"[smoke]   off-palette 残留: {report.off_palette[:8]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
