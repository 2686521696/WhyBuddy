"""把库里存量的 PNG 缩略图重新编码成 WebP（2026-08-02）。

新写入的缩略图已经是 WebP（services/thumb_image），但改动之前落的那些还是 PNG，
每张 805~857KB。这个脚本把它们就地换掉——**分辨率不动，只换编码**。

    cd slide-rule-python
    .venv/bin/python scripts/thumb_recompress.py --dry-run   # 只看能省多少
    .venv/bin/python scripts/thumb_recompress.py             # 真写

--dry-run 是默认关的反面：默认**只看不写**，要加 --apply 才真改。缩略图是线上
数据，误跑一次没有回头路（原始 PNG 不会另存一份）。

顺带：这个脚本的输出就是压缩比的实测依据。单测里**不**断言压缩比——合成夹具
造不出真实缩略图那种体积，在它上面断言比例是自欺欺人（见 tests/test_thumb_image
里那段说明）。
"""

from __future__ import annotations

import argparse
import base64
import sys
from pathlib import Path

_PY_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_PY_DIR))


def _load_env() -> None:
    """按 .env 配好存储后端——脚本跟服务读同一份配置。"""
    import os

    for path in (_PY_DIR.parent / ".env", _PY_DIR / ".env"):
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            continue
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="真的写回去（默认只看不写）")
    ap.add_argument("--limit", type=int, default=0, help="只处理前 N 条（调试用）")
    args = ap.parse_args()

    _load_env()
    from services import app_store as store
    from services.thumb_image import sniff_media_type, to_webp

    backend = store.get_backend()
    tags = backend.preview_sources()
    ids = sorted(tags)
    if args.limit:
        ids = ids[: args.limit]
    if not ids:
        print("库里没有缩略图，无事可做")
        return 0

    print(f"{'app_id':<10}{'来源':<7}{'原始':>10}{'WebP':>10}{'倍数':>7}")
    total_before = total_after = 0
    changed = 0
    for app_id in ids:
        for src in store.PREVIEW_SOURCE_PRIORITY:
            b64 = backend.get_preview(app_id, source=src)
            if not b64:
                continue
            raw = base64.b64decode(b64)
            if sniff_media_type(raw) == "image/webp":
                continue  # 已经换过了
            out = to_webp(raw)
            total_before += len(raw)
            total_after += len(out)
            ratio = len(raw) / max(1, len(out))
            print(
                f"{app_id[:8]:<10}{src:<7}{len(raw)//1024:>8}KB{len(out)//1024:>8}KB"
                f"{ratio:>6.1f}x"
            )
            if args.apply and len(out) < len(raw):
                backend.save_preview(
                    app_id, base64.b64encode(out).decode("ascii"), source=src
                )
                changed += 1

    if total_before == 0:
        print("\n所有缩略图都已经是 WebP，无事可做")
        return 0
    mb = lambda n: n / 1024 / 1024  # noqa: E731
    print(
        f"\n合计 {mb(total_before):.1f}MB → {mb(total_after):.1f}MB"
        f"（小 {total_before / max(1, total_after):.1f} 倍）"
    )
    # 5Mbps = 640KB/s，应用中心首屏要把所有卡的图都拉一遍
    for label, n in (("改前", total_before), ("改后", total_after)):
        print(f"  {label}：5Mbps 出口上冷启动一次 ≈ {n / 1024 / 640:.1f}s")
    if args.apply:
        print(f"\n已写回 {changed} 张")
    else:
        print("\n（--dry-run 模式，什么都没写。要真改加 --apply）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
