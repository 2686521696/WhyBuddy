"""FreeformInsight 视觉参照生成冒烟脚本 — 真实跑一次「先出参考图，再照图生成结构」。

用法：
    cd slide-rule-python
    .venv/bin/python scripts/freeform_vision_smoke.py
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


def main() -> int:
    n_root = _load_env_file(_ROOT / ".env")
    print(f"[smoke] env loaded: root .env={n_root} vars")
    print(f"[smoke] LLM_SUPPORTS_IMAGE_CONTENT_PARTS={os.environ.get('LLM_SUPPORTS_IMAGE_CONTENT_PARTS', '(unset)')}")

    from services.freeform_block import generate_freeform_block

    datamodel = {
        "entities": [
            {
                "id": "ticket",
                "label": "工单",
                "fields": [
                    {"id": "status", "label": "状态", "type": "enum"},
                    {"id": "slaMinutes", "label": "SLA剩余分钟", "type": "number"},
                    {"id": "priority", "label": "优先级", "type": "enum"},
                ],
            },
            {
                "id": "agent",
                "label": "客服",
                "fields": [
                    {"id": "activeCount", "label": "在线人数", "type": "number"},
                ],
            },
        ]
    }
    design_brief = "客户服务工单系统首页的核心运营洞察卡片：展示提交到解决的处理阶段分布"

    print("[smoke] calling generate_freeform_block(use_reference_image=True) — 先出参考图再照图生成结构...")
    t0 = time.time()
    content = generate_freeform_block(design_brief, datamodel, use_reference_image=True)
    elapsed = time.time() - t0
    print(f"[smoke] OK: {elapsed:.1f}s")

    out_path = Path(sys.argv[1] if len(sys.argv) > 1 else "freeform_vision_smoke.json")
    out_path.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[smoke] structure saved to {out_path}")

    def count_nodes(node):
        return 1 + sum(count_nodes(c) for c in node.get("children", []))

    def count_dataref(node):
        n = 1 if node.get("dataRef") else 0
        return n + sum(count_dataref(c) for c in node.get("children", []))

    root = content["root"]
    print(f"[smoke] nodes={count_nodes(root)} dataRef_nodes={count_dataref(root)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
