"""E17③ 证据上下文管道 A/B：baseline（管道关）vs piped（管道开），数据签字。

跑法（仓库根目录，需 .env 带 LLM key）：
  cd slide-rule-python && .venv/bin/python scripts/evidence_context_ab.py \
      [--topics N] [--parallel 3]

两臂唯一差异 = 子进程 env SLIDERULE_EVIDENCE_CONTEXT（off/on），
其余全同（rules 模式、同 max_loops/max_turns、同模拟业主）。
评审复用 ② 的盲评机器：甲/乙匿名 + 确定性换位 + 双向复核
（原序/换序判决一致才记 strict win）。

裁决规则（预登记，跑完照读）：
- piped strict wins > baseline strict wins → 管道数据签字，默认开维持；
- 打平 → 维持默认开（管道有明确机制理由：综合各方结论此前吃不到各方结论），
  但如实记录"内容质量未测出显著差异"；
- piped strict wins < baseline → 默认改关，回炉复盘注入格式。
结果落 data/evidence-context-ab.{json,md}。
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from agentic_pick_eval import TOPICS, _spawn_case  # noqa: E402
from content_quality_eval import judge_topic  # noqa: E402

ARMS: tuple[str, str] = ("baseline", "piped")
ARM_ENV = {
    "baseline": {"SLIDERULE_EVIDENCE_CONTEXT": "off"},
    "piped": {"SLIDERULE_EVIDENCE_CONTEXT": "on"},
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topics", type=int, default=len(TOPICS))
    parser.add_argument("--max-loops", type=int, default=6)
    parser.add_argument("--max-turns", type=int, default=3)
    parser.add_argument("--parallel", type=int, default=3)
    args = parser.parse_args()

    topics = TOPICS[: args.topics]
    dump_dir = Path(tempfile.mkdtemp(prefix="evidence-ab-"))
    cases = [(t, arm) for t in topics for arm in ARMS]
    dump_paths = {
        (t, arm): str(dump_dir / f"{abs(hash((t, arm))) % 999999}.json") for t, arm in cases
    }

    print(f"[phase1] {len(cases)} runs (2 arms), parallel={args.parallel}", flush=True)
    t0 = time.time()
    rows: dict[str, dict[str, dict]] = {t: {} for t in topics}
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        futures = {
            pool.submit(
                _spawn_case,
                t,
                "rules",  # 两臂都是规则模式：变量只有证据管道
                args.max_loops,
                args.max_turns,
                dump_paths[(t, arm)],
                ARM_ENV[arm],
            ): (t, arm)
            for t, arm in cases
        }
        done = 0
        for fut in as_completed(futures):
            t, arm = futures[fut]
            rows[t][arm] = fut.result()
            done += 1
            print(f"[{done}/{len(cases)}] {arm:9s} {t[:22]} -> {rows[t][arm]}", flush=True)

    print(f"[phase2] judging {len(topics)} topics x2 rounds", flush=True)
    judged: list[dict] = []
    for t in topics:
        dumps = {}
        for arm in ARMS:
            p = Path(dump_paths[(t, arm)])
            if p.exists():
                dumps[arm] = json.loads(p.read_text(encoding="utf-8"))
        if len(dumps) != len(ARMS):
            judged.append({"topic": t, "error": "missing dumps", "strictWinner": "无效"})
            continue
        result = judge_topic(t, dumps, arms=ARMS)
        judged.append(result)
        print(f"[judge] {t[:22]} -> {result['strictWinner']} {result['avgScore']}", flush=True)

    wins = {arm: sum(1 for j in judged if j.get("strictWinner") == arm) for arm in ARMS}
    ties = sum(1 for j in judged if j.get("strictWinner") == "平")
    if wins["piped"] > wins["baseline"]:
        verdict = "管道数据签字：默认开维持（piped 严格胜出）"
    elif wins["piped"] == wins["baseline"]:
        verdict = "打平：维持默认开（机制理由成立），如实记录内容质量未测出显著差异"
    else:
        verdict = "piped 严格败诉：默认应改关，回炉复盘注入格式"
    payload = {
        "arms": ARMS,
        "topics": len(topics),
        "strictWins": wins,
        "ties": ties,
        "verdict": verdict,
        "judged": judged,
        "runs": rows,
        "wallS": round(time.time() - t0),
    }
    out_json = ROOT / "data" / "evidence-context-ab.json"
    out_json.parent.mkdir(exist_ok=True)
    out_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# E17 证据上下文管道 A/B（盲评 + 双向复核）",
        "",
        f"话题 {len(topics)} 个 × 双臂（baseline=管道关 / piped=管道开），"
        "其余变量全同（rules 模式）。strict win = 原序/换序两次盲评一致。",
        "",
        "| 话题 | strict 胜者 | baseline 均分 | piped 均分 | 两次判决 |",
        "|---|---|---|---|---|",
    ]
    for j in judged:
        avg = j.get("avgScore") or {}
        lines.append(
            f"| {j['topic'][:18]} | {j.get('strictWinner')} | {avg.get('baseline', '—')} | "
            f"{avg.get('piped', '—')} | {' / '.join(j.get('votes') or ['—'])} |"
        )
    lines += [
        "",
        f"## 终局：baseline {wins['baseline']} 胜 · piped {wins['piped']} 胜 · 平 {ties}",
        "",
        f"**裁决（规则预登记在脚本头）：{verdict}**",
    ]
    out_md = ROOT / "data" / "evidence-context-ab.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nJSON: {out_json}\nMD:   {out_md}\n{verdict}")


if __name__ == "__main__":
    main()
