"""真发一张三区参照板并落盘 —— 改画布尺寸后唯一能验的方式。

尺寸这件事必须实测：这个生图端点认的是一份白名单尺寸，而且传进去的尺寸
**不等于**返回的尺寸（1792x1024 传进去实收 1672x941）。所以改
_SHEET_IMAGE_SIZE 之后要看两样东西——返回 PNG 的真实宽高，以及画面上的
中文标签糊不糊。后者只能人眼看，脚本负责把图落到盘上。

用法：
    cd slide-rule-python
    .venv/bin/python scripts/overview_sheet_probe.py <输出目录>
"""

import os
import struct
import sys
import time
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
_ROOT = _PY_DIR.parent
sys.path.insert(0, str(_PY_DIR))


def _load_env_file(path: Path) -> None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in os.environ:
            os.environ[k] = v


def png_size(data: bytes) -> tuple[int, int]:
    """从 PNG 头直接读宽高——不信任请求里传的尺寸（端点会自己降档）。"""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是 PNG")
    w, h = struct.unpack(">II", data[16:24])
    return w, h


BRIEF = (
    "精品咖啡烘焙工作室的经营总览首页：进行中烘焙、可用生豆重量、平均杯测评分"
    "三个关键指标，下面是烘焙批次状态分布与出豆重量趋势，底部一条最近烘焙动态。"
)
DATAMODEL = {
    "entities": [
        {
            "id": "roast_batch",
            "name": "烘焙批次",
            "fields": [
                {"id": "batch_code", "name": "批次号", "type": "string"},
                {"id": "roast_date", "name": "烘焙日期", "type": "date"},
                {"id": "yield_weight", "name": "出豆重量", "type": "number"},
                {
                    "id": "roast_status",
                    "name": "烘焙状态",
                    "type": "enum",
                    "options": [
                        {"id": "draft", "label": "草稿"},
                        {"id": "reviewing", "label": "待审核"},
                        {"id": "roasting", "label": "烘焙中"},
                        {"id": "cupping", "label": "待杯测"},
                        {"id": "done", "label": "已完成"},
                    ],
                },
            ],
        }
    ]
}


def main() -> int:
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "sheet-probe")
    out_dir.mkdir(parents=True, exist_ok=True)
    _load_env_file(_ROOT / ".env")

    from services.freeform_block import _SHEET_IMAGE_SIZE, _build_overview_sheet_prompt
    from sliderule_llm.image_client import generate_image_png

    print(f"[probe] 请求尺寸 = {_SHEET_IMAGE_SIZE}")
    prompt = _build_overview_sheet_prompt(BRIEF, DATAMODEL, theme_id="tangerine")
    print(f"[probe] prompt 长度 = {len(prompt)} 字")

    t0 = time.time()
    png = generate_image_png(prompt, size=_SHEET_IMAGE_SIZE)
    elapsed = time.time() - t0

    w, h = png_size(png)
    path = out_dir / f"sheet-{w}x{h}.png"
    path.write_bytes(png)
    print(f"[probe] 实收 {w}x{h}  {len(png) / 1024:.0f}KB  {elapsed:.1f}s")
    print(f"[probe] 落盘 {path}")
    # 容 ±2px：同一个请求尺寸实测返回过 1672x941 和 1671x941，端点自己有
    # 一个像素的抖动。卡死等值会天天误报，真正要看的是"有没有换档"。
    if abs(w - 1672) > 2 or abs(h - 941) > 2:
        print("[probe] ⚠️ 实收尺寸偏离预期的 1672x941 —— 端点档位可能变了")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
