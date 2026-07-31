"""真发参照板并落盘 —— 改画布尺寸后唯一能验的方式。

尺寸这件事必须实测，而且**每换一次端点都要重测**：不同服务商对 size 的处理
可以完全相反。当前端点（api.xiaoleai.team）逐像素认 size，传什么回什么；上一
家（hello.vangularcode.asia）则无论传什么都回同一个 1672x941。所以改
_DEVICE_IMAGE_SIZE 或换端点之后要看两样东西——返回 PNG 的真实宽高，以及画面
上的中文标签糊不糊。后者只能人眼看，脚本负责把图落到盘上。

默认两档都发（桌面 + 手机），因为手机档现在传的是竖版尺寸，只测桌面档发现
不了竖版那一路的问题。

用法：
    cd slide-rule-python
    .venv/bin/python scripts/overview_sheet_probe.py <输出目录> [desktop|phone|all]
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

    from services.freeform_block import (
        _build_overview_sheet_prompt,
        _sheet_image_size_for_device,
    )
    from sliderule_llm.image_client import generate_image_png

    which = (sys.argv[2] if len(sys.argv) > 2 else "all").lower()
    devices = ["desktop", "phone"] if which == "all" else [which]

    rc = 0
    for device in devices:
        requested = _sheet_image_size_for_device(device)
        prompt = _build_overview_sheet_prompt(
            BRIEF, DATAMODEL, theme_id="tangerine", device=device
        )
        print(f"[probe] {device}: 请求尺寸 = {requested}，prompt {len(prompt)} 字")

        t0 = time.time()
        png = generate_image_png(prompt, size=requested)
        elapsed = time.time() - t0

        w, h = png_size(png)
        path = out_dir / f"sheet-{device}-{w}x{h}.png"
        path.write_bytes(png)
        print(f"[probe] {device}: 实收 {w}x{h}  {len(png) / 1024:.0f}KB  {elapsed:.1f}s")
        print(f"[probe] {device}: 落盘 {path}")

        # 期望值直接从常量算，不写死字面量——换尺寸时不用回来改这里。
        # 容 ±2px：端点自己有一两个像素的抖动（旧端点同一请求返回过 1672x941
        # 和 1671x941），卡死等值会天天误报，真正要看的是"有没有换档"。
        ew, eh = (int(x) for x in requested.split("x"))
        if abs(w - ew) > 2 or abs(h - eh) > 2:
            print(
                f"[probe] ⚠️ {device}: 实收 {w}x{h} 偏离请求的 {requested}"
                " —— 这家端点可能不认 size，或者换了档位。**别改常量去迁就它**，"
                "先照 _DEVICE_IMAGE_SIZE 上方那份记录整份重测。"
            )
            rc = 1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
