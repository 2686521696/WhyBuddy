"""设备档判定的评测台（2026-07-30）。

    ./.venv/bin/python scripts/eval_intake_device.py
    ./.venv/bin/python scripts/eval_intake_device.py --repeat 3 --workers 8

跟 eval_intake_judge.py 分开，是因为两条轴正交：判词问"这一轮该不该跑"，
设备档问"该按哪种姿态设计版式"。混在一张表里，off_topic 那批用例的设备档
无意义，会把分母污染。

三档错误的代价不对等，所以分开算：
  🔴 判反了（desktop↔phone）  → 下游按错的姿态设计整套版式，最贵
  🟠 该判出来的判成 unspecified → 退回两档都生成，只是没省到时间
  🟡 该 unspecified 的硬猜了     → 有一半概率蒙对，但蒙错就是 🔴 的后果

另出「明说档」与「硬负样本」两组分项：前者是底线（用户都明说了还判错就没
救了），后者是这套判据的真正考点（带现场词的后台需求、带后台词的现场需求）。
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_ROOT.parent / ".env")
load_dotenv(_ROOT / ".env", override=False)

from services.intake_judge import judge_turn  # noqa: E402

CASES = _ROOT / "tests" / "data" / "intake_device_cases.jsonl"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, default=1)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    rows = [json.loads(l) for l in CASES.read_text(encoding="utf-8").splitlines() if l.strip()]
    jobs = [r for r in rows for _ in range(args.repeat)]
    print(f"用例 {len(rows)} 条 × {args.repeat} 轮  |  并发 {args.workers}  |  "
          f"模型 {os.getenv('LLM_MODEL') or '(未配置)'}\n")

    def run(case: dict):
        t0 = time.time()
        j = judge_turn(case["text"], has_app=False)
        return case, j, time.time() - t0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(run, jobs))

    ok = 0
    flipped: list[tuple] = []
    gave_up: list[tuple] = []
    over_guessed: list[tuple] = []
    confusion: collections.Counter = collections.Counter()
    by_group: dict[str, list[bool]] = collections.defaultdict(list)
    unstable: dict[str, set] = collections.defaultdict(set)
    elapsed: list[float] = []

    for case, j, dt in results:
        want, got = case["expect"], j.device
        elapsed.append(dt)
        confusion[(want, got)] += 1
        unstable[case["id"]].add(got)
        group = ("明说" if case["id"].startswith("dev_explicit") else
                 "硬负样本" if case["id"].startswith("dev_hard") else
                 "无信号" if case["id"].startswith("dev_unspec") else "常规")
        hit = got == want
        by_group[group].append(hit)
        if hit:
            ok += 1
            mark = "  "
        elif {want, got} == {"desktop", "phone"}:
            flipped.append((case["id"], case["text"], want, got, j.device_reason))
            mark = "🔴"
        elif got == "unspecified":
            gave_up.append((case["id"], case["text"], want, got, j.device_reason))
            mark = "🟠"
        else:
            over_guessed.append((case["id"], case["text"], want, got, j.device_reason))
            mark = "🟡"
        if args.verbose or mark != "  ":
            print(f"{mark} {case['id']:22} 期望={want:12} 实得={got:12} {dt:5.1f}s  {case['text'][:30]}")
            if mark == "🔴":
                print(f"     判定理由: {j.device_reason[:90]}")

    total = len(results)
    print(f"\n{'─' * 66}")
    print(f"准确率              {ok}/{total} = {ok / total * 100:.1f}%")
    print(f"🔴 判反(desk↔phone)  {len(flipped)}  ← 最贵：下游按错的姿态设计整套版式")
    print(f"🟠 该判出来却弃权     {len(gave_up)}  ← 退回两档都生成，没省到时间但不出错")
    print(f"🟡 该弃权却硬猜       {len(over_guessed)}  ← 蒙对一半，蒙错等于 🔴")
    print("\n分项:")
    for g in ("明说", "硬负样本", "常规", "无信号"):
        v = by_group.get(g) or []
        if v:
            print(f"  {g:8} {sum(v)}/{len(v)} = {sum(v) / len(v) * 100:5.1f}%")
    if elapsed:
        srt = sorted(elapsed)
        print(f"\n耗时                中位 {srt[len(srt) // 2]:.1f}s  最慢 {srt[-1]:.1f}s"
              f"  （复用入站判定的同一次调用，零额外往返）")
    flaky = {k: v for k, v in unstable.items() if len(v) > 1}
    if flaky:
        print(f"\n判定不稳定 {len(flaky)} 条:")
        for k, v in sorted(flaky.items()):
            print(f"  {k}: {sorted(v)}")
    wrong = {k: v for k, v in confusion.items() if k[0] != k[1]}
    if wrong:
        print("\n混淆分布（期望 → 实得）:")
        for (w, g), n in sorted(wrong.items(), key=lambda x: -x[1]):
            print(f"  {w:12} → {g:12} {n}")
    return 0 if not flipped else 2


if __name__ == "__main__":
    raise SystemExit(main())
