"""生图冒烟脚本 — 用与应用完全相同的客户端/配置真实调一次生图接口。

用途：验证 IMAGE_API_KEY / IMAGE_API_URL / IMAGE_MODEL 这套配置是否真的能连通、
出的是不是一张真实 PNG，而不是假设"配了就能用"。
不依赖 dotenv 包：手动加载根目录 .env（已有环境变量优先）。

用法：
    cd slide-rule-python
    .venv/bin/python scripts/image_gen_smoke.py "输出路径.png"
"""

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


def main() -> int:
    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "image_gen_smoke.png")
    n_root = _load_env_file(_ROOT / ".env")
    print(f"[smoke] env loaded: root .env={n_root} vars")
    print(f"[smoke] IMAGE_API_URL={os.environ.get('IMAGE_API_URL', '(unset)')}")
    print(f"[smoke] IMAGE_MODEL={os.environ.get('IMAGE_MODEL', '(unset)')}")
    print(f"[smoke] IMAGE_API_KEY={'set(' + str(len(os.environ.get('IMAGE_API_KEY', ''))) + ' chars)' if os.environ.get('IMAGE_API_KEY') else '(unset)'}")

    from sliderule_llm.image_client import generate_image_png, ImageGenError  # noqa: E402

    prompt = (
        "为一个「客户服务工单系统」的工单详情页生成一张 Web 界面草样（UI mockup），干净的原型图。"
        "仅示意结构与版式，不要写任何具体数字/真实数据，占位文案用「示例客户」「示例工单」这类通用字样。"
        "浅色专业仪表盘风格：白色/浅灰背景，单一强调色克制使用，卡片白底细边框，图标简洁线性。"
        "布局要求：顶部导航 + 左侧工单信息卡 + 右侧处理时间线，右上角明显标注 PREVIEW。"
    )
    print("[smoke] calling generate_image_png (real HTTP call, may take up to 10min)...")
    t0 = time.time()
    try:
        png_bytes = generate_image_png(prompt)
    except ImageGenError as exc:
        print(f"[smoke] FAILED: {exc}")
        return 1
    elapsed = time.time() - t0
    out_path.write_bytes(png_bytes)
    print(f"[smoke] OK: {len(png_bytes)} bytes, {elapsed:.1f}s, saved to {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
