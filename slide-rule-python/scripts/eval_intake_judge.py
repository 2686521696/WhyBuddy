"""入站判定闸门的评测台。

    ./.venv/bin/python scripts/eval_intake_judge.py            # 跑全量
    ./.venv/bin/python scripts/eval_intake_judge.py --only real # 只跑某类
    ./.venv/bin/python scripts/eval_intake_judge.py --repeat 3  # 看稳定性

为什么要有这个：闸门的误伤成本极高（把人挡在核心功能外面），所以升级成
硬拦之前必须有真实数据。这里按三档分开算——三类错误的代价差一个数量级：
  🔴 把真需求判成非放行类     → 事故，人被挡在核心功能外面
  🟠 把超纲的放行             → 烧一整轮，交付一个做不出来的东西
  🟡 该提示的没提示           → 只是浪费一次推演

拒绝档（out_of_scope）另按 clinc/oos-eval（EMNLP 2019）的口径单独出召回与
精确率：总准确率会被样本配比稀释，真正要盯的是"超纲的抓住了几成""抓出来
的有几成是冤枉的"。

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
from concurrent.futures import ThreadPoolExecutor
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
    # 串行跑 104 条要 16 分钟（实测约 9.5s/条），一晚上调不了几轮。判定之间
    # 互相独立、没有共享状态，并发只是省墙钟时间，不改变任何一条的结果。
    # 默认 8：再高就开始撞网关限流，429 重试反而更慢。
    ap.add_argument("--workers", type=int, default=8, help="并发数（1 = 串行）")
    args = ap.parse_args()

    cases = load_cases(args.only)
    if not cases:
        print("没有匹配的用例")
        return 1
    print(f"用例 {len(cases)} 条 × {args.repeat} 轮  |  并发 {args.workers}  |  "
          f"模型 {os.getenv('LLM_MODEL') or '(未配置)'}\n")

    ok = 0
    total = 0
    elapsed: list[float] = []
    # 三类错误分开记——代价差一个数量级
    false_block: list[tuple] = []  # 真需求/真迭代被判成非放行类（事故）
    missed_oos: list[tuple] = []   # 超纲的被放行（烧一整轮 + 交付一个做不出的东西）
    false_pass: list[tuple] = []   # 其余该提示未提示（只是浪费）
    confusion: collections.Counter = collections.Counter()
    per_source: collections.Counter = collections.Counter()
    unstable: dict[str, set] = collections.defaultdict(set)

    def run_one(case: dict) -> tuple[dict, object, float]:
        t0 = time.time()
        # appSummary 必须跟着传：跨语境用例（已有应用 + 全新领域需求）
        # 判的就是"这句话跟当前应用是不是一回事"，不给摘要就无从比较。
        j = judge_turn(
            case["text"],
            has_app=bool(case.get("hasApp")),
            app_summary=str(case.get("appSummary") or ""),
        )
        return case, j, time.time() - t0

    jobs = [c for c in cases for _ in range(args.repeat)]
    if args.workers > 1:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            # map 保序：并发跑，但结果按用例顺序回来，输出和串行版一模一样，
            # 两版跑出来的报告可以直接 diff。
            results = list(pool.map(run_one, jobs))
    else:
        results = [run_one(c) for c in jobs]

    for case, j, dt in results:
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
        elif want == "out_of_scope" and got in _PASS:
            # 单独一档：这不是"浪费一次推演"，是**推演出一个做不出来的东西
            # 交给用户**。展会现场有人输入「3D 竞速游戏」拿到一套表单系统，
            # 就是这一格的漏判。
            missed_oos.append((case["id"], case["text"], want, got, j.confidence, j.reason))
            mark = "🟠"
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
    print(f"🟠 漏判超纲    {len(missed_oos)}  ← 会烧一整轮并交付一个做不出的东西")
    print(f"🟡 该提示未提示 {len(false_pass)}  ← 只是浪费一次推演，可接受")

    # oos-eval（clinc/oos-eval, EMNLP 2019）的口径：拒绝档单独算召回与精确率，
    # 不跟总准确率混在一起。总准确率会被样本配比稀释——真正要盯的是"超纲的
    # 抓住了几成"（召回）和"抓出来的里面有几成是冤枉的"（精确率）。
    oos_want = sum(1 for (w, g), n in confusion.items() for _ in range(n) if w == "out_of_scope")
    oos_got = sum(1 for (w, g), n in confusion.items() for _ in range(n) if g == "out_of_scope")
    oos_hit = confusion.get(("out_of_scope", "out_of_scope"), 0)
    if oos_want or oos_got:
        recall = oos_hit / oos_want if oos_want else 0.0
        precision = oos_hit / oos_got if oos_got else 0.0
        print(f"拒绝档        召回 {oos_hit}/{oos_want} = {recall * 100:.1f}%   "
              f"精确 {oos_hit}/{oos_got} = {precision * 100:.1f}%")
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
