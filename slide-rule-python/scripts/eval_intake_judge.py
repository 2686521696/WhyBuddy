"""入站判定闸门的评测台。

    ./.venv/bin/python scripts/eval_intake_judge.py            # 跑全量
    ./.venv/bin/python scripts/eval_intake_judge.py --only real # 只跑某类
    ./.venv/bin/python scripts/eval_intake_judge.py --repeat 3  # 看稳定性

为什么要有这个：闸门的误伤成本极高（把人挡在核心功能外面），所以升级成
硬拦之前必须有真实数据。这里按「误拦」和「漏放」分开算——两类错误的代价
完全不对等：把真需求判成 off_topic 是事故，把闲聊放过去只是浪费一次推演。

借的是 openai-guardrails 的评测形态（JSONL 用例 + 批量比对），但没引它的包
——那玩意儿要装 43 个依赖含整套 spaCy，而这个文件自己就够用。
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv  # noqa: E402

_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_ROOT.parent / ".env")
load_dotenv(_ROOT / ".env", override=False)

from services.intake_judge import judge_turn  # noqa: E402

CASES = _ROOT / "tests" / "data" / "intake_judge_cases.jsonl"

# 放行侧的判决——判成这两类就是"让它进推演"
_PASS = {"real", "iteration"}


def load_cases(only: str | None) -> list[dict]:
    rows = [
        json.loads(line)
        for line in CASES.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if only:
        rows = [r for r in rows if r["expect"] == only or r["id"].startswith(only)]
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只跑某个 expect 类别或 id 前缀")
    ap.add_argument("--repeat", type=int, default=1, help="每条重复几次（看判定稳定性）")
    ap.add_argument("--verbose", action="store_true", help="逐条打印")
    args = ap.parse_args()

    cases = load_cases(args.only)
    if not cases:
        print("没有匹配的用例")
        return 1
    print(f"用例 {len(cases)} 条 × {args.repeat} 轮  |  模型 {os.getenv('LLM_MODEL') or '(未配置)'}\n")

    ok = 0
    total = 0
    elapsed: list[float] = []
    # 两类错误分开记——代价不对等
    false_block: list[tuple] = []  # 真需求/真迭代被判成非放行类（事故）
    false_pass: list[tuple] = []   # 该提示的被放行（只是浪费）
    confusion: collections.Counter = collections.Counter()
    per_source: collections.Counter = collections.Counter()
    unstable: dict[str, set] = collections.defaultdict(set)

    for case in cases:
        for _ in range(args.repeat):
            t0 = time.time()
            # appSummary 必须跟着传：跨语境用例（已有应用 + 全新领域需求）
            # 判的就是"这句话跟当前应用是不是一回事"，不给摘要就无从比较。
            j = judge_turn(
                case["text"],
                has_app=bool(case.get("hasApp")),
                app_summary=str(case.get("appSummary") or ""),
            )
            dt = time.time() - t0
            elapsed.append(dt)
            total += 1
            per_source[j.source] += 1
            unstable[case["id"]].add(j.verdict)
            want, got = case["expect"], j.verdict
            confusion[(want, got)] += 1
            if got == want:
                ok += 1
                mark = "  "
            elif want in _PASS and got not in _PASS:
                false_block.append((case["id"], case["text"], want, got, j.confidence, j.reason))
                mark = "🔴"
            else:
                false_pass.append((case["id"], case["text"], want, got, j.confidence))
                mark = "🟡"
            if args.verbose or mark != "  ":
                print(f"{mark} {case['id']:10} 期望={want:10} 实得={got:10} "
                      f"conf={j.confidence:.2f} {dt:4.1f}s  {case['text'][:32]}")
                if mark == "🔴" and j.reason:
                    print(f"     判定理由: {j.reason[:80]}")

    print(f"\n{'─' * 62}")
    print(f"准确率        {ok}/{total} = {ok / total * 100:.1f}%")
    print(f"🔴 误拦真需求  {len(false_block)}  ← 这类是事故，必须为 0 才能考虑开阻断")
    print(f"🟡 该提示未提示 {len(false_pass)}  ← 只是浪费一次推演，可接受")
    if elapsed:
        srt = sorted(elapsed)
        print(f"耗时          中位 {srt[len(srt) // 2]:.1f}s  最慢 {srt[-1]:.1f}s")
    print(f"判定来源      {dict(per_source)}")

    flaky = {k: v for k, v in unstable.items() if len(v) > 1}
    if flaky:
        print(f"\n判定不稳定（同一输入多轮结果不一致）{len(flaky)} 条:")
        for k, v in sorted(flaky.items()):
            print(f"  {k}: {sorted(v)}")

    if len(confusion) > 1:
        print("\n混淆分布（期望 → 实得）:")
        for (want, got), n in sorted(confusion.items(), key=lambda x: -x[1]):
            if want != got:
                print(f"  {want:10} → {got:10}  {n}")

    return 0 if not false_block else 2


if __name__ == "__main__":
    raise SystemExit(main())
