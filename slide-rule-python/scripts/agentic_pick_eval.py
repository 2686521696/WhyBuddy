"""F2 agentic pick 对比评测：十话题 × 双模式（规则挑选 vs LLM 提案+门验收）。

跑法（仓库根目录，需 .env 带 LLM key）：
  cd slide-rule-python && .venv/bin/python scripts/agentic_pick_eval.py \
      [--topics N] [--parallel 5]

并发模型：每个 (话题, 模式) 用例一个独立子进程——模式开关
（SLIDERULE_AGENTIC_PICK）是进程级 env、会话存储是共享文件，进程内
并发必然串味/打架；子进程各带独立临时存储，父进程只做汇总。
并发度默认 5（LLM 网关承受力实测口径；开太高 429 限流反而变慢）。

对每个话题各跑两遍 drive_full_v5_session（同 max_loops），采集确定性指标：
  闭环证据 n/6、覆盖门、健康产物数/种类数、能力执行次数/去重数、
  耗时、agentic 决策台账条数。结果落 data/agentic-pick-eval.{json,md}
  ——用数据决定是否全面切换（北极星：AI 声称好不算数，脚本跑过才算数）。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# 会话存储隔离（必须在导入 services 前设好——persistence 读 env 定位存储；
# 子进程模式下会被 _spawn_case 的独立路径覆盖）
_TMP = tempfile.mkdtemp(prefix="agentic-pick-eval-")
os.environ.setdefault("SLIDERULE_SESSIONS_FILE", str(Path(_TMP) / "sessions.json"))
os.environ.setdefault("SLIDERULE_LLM_GENERATE_ENABLED", "1")

TOPICS = [
    "社区宠物医院预约问诊系统",
    "连锁健身房私教课排期与核销平台",
    "阳台农夫 Pro——城市家庭种植智能顾问与植物医生",
    "二手乐器寄卖与鉴定平台",
    "小型律所案件流程与文书协作系统",
    "校园失物招领与积分激励平台",
    "民宿房态管理与动态定价助手",
    "跨境电商退货逆向物流跟踪系统",
    "社区团购团长供货对账平台",
    "剧本杀门店场次编排与拼车组局系统",
]

MODES = ("rules", "agentic")


def _metric_row(state, duration_s: float) -> dict:
    from services.v5_publish_closure_response import derive_publish_closure_response

    closure = derive_publish_closure_response(state) or {}
    per_skill = closure.get("perSkillEvidence") or {}
    evidence_n = sum(
        1 for v in per_skill.values() if isinstance(v, dict) and v.get("status") == "ok"
    ) if isinstance(per_skill, dict) else 0
    stales = set(getattr(state, "staleArtifactIds", []) or [])
    healthy = [
        a for a in (getattr(state, "artifacts", []) or [])
        if (a.get("trustLevel") if isinstance(a, dict) else getattr(a, "trustLevel", None))
        in ("gated_pass", "audited")
        and (a.get("id") if isinstance(a, dict) else getattr(a, "id", None)) not in stales
    ]
    kinds = {
        (a.get("kind") if isinstance(a, dict) else getattr(a, "kind", None)) for a in healthy
    }
    runs = getattr(state, "capabilityRuns", []) or []
    cap_ids = [
        (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", ""))
        for r in runs
    ]
    gate = getattr(state, "coverageGate", None)
    gate_passed = bool(gate.get("passed") if isinstance(gate, dict) else getattr(gate, "passed", False)) if gate else False
    agentic_decisions = sum(
        1
        for d in (getattr(state, "decisionLedger", []) or [])
        if "agentic-pick" in str(d.get("id") if isinstance(d, dict) else getattr(d, "id", ""))
    )
    return {
        "closureEvidence": evidence_n,
        "closureBlocked": bool(closure.get("blocked")),
        "coverageGatePassed": gate_passed,
        "healthyArtifacts": len(healthy),
        "artifactKinds": len(kinds - {None}),
        "capabilityRuns": len(cap_ids),
        "distinctCapabilities": len(set(cap_ids)),
        "staleArtifacts": len(stales),
        "awaitReason": str(getattr(state, "awaitReason", None)),
        "agenticDecisions": agentic_decisions,
        "durationS": round(duration_s, 1),
    }


def run_one(topic: str, mode: str, max_loops: int) -> dict:
    os.environ["SLIDERULE_AGENTIC_PICK"] = "on" if mode == "agentic" else "off"
    from models.v5_state import V5SessionState
    from services.v5_full_driver import drive_full_v5_session

    sid = f"eval-{mode}-{abs(hash(topic)) % 99999}"
    state = V5SessionState(
        sessionId=sid,
        goal={"text": topic, "status": "clear"},
        runtimePhase="idle",
    )
    t0 = time.time()
    final = drive_full_v5_session(state, max_loops=max_loops, user_instruction=topic)
    return _metric_row(final, time.time() - t0)


def _spawn_case(topic: str, mode: str, max_loops: int) -> dict:
    """独立子进程跑单用例：模式开关/会话存储进程级隔离，互不串味。"""
    env = {
        **os.environ,
        "SLIDERULE_AGENTIC_PICK": "on" if mode == "agentic" else "off",
        "SLIDERULE_SESSIONS_FILE": str(
            Path(tempfile.mkdtemp(prefix=f"ape-{mode}-")) / "sessions.json"
        ),
        "SLIDERULE_LLM_GENERATE_ENABLED": "1",
    }
    try:
        proc = subprocess.run(
            [sys.executable, __file__, "--one", f"{mode}::{topic}",
             "--max-loops", str(max_loops)],
            capture_output=True, text=True, env=env, cwd=str(ROOT),
            timeout=1200,
        )
        # 子进程 stdout 最后一行是结果 JSON（前面可能有生成日志噪音）
        for line in reversed((proc.stdout or "").strip().splitlines()):
            line = line.strip()
            if line.startswith("{"):
                return json.loads(line)
        return {"error": f"no result json (rc={proc.returncode}): {(proc.stderr or '')[-160:]}"}
    except subprocess.TimeoutExpired:
        return {"error": "case timeout (1200s)"}
    except Exception as exc:
        return {"error": str(exc)[:200]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--topics", type=int, default=len(TOPICS))
    parser.add_argument("--max-loops", type=int, default=6)
    parser.add_argument("--parallel", type=int, default=5)
    parser.add_argument("--one", type=str, default=None, help="内部用：mode::topic 单用例")
    args = parser.parse_args()

    # 子进程入口：跑单用例，结果 JSON 打到 stdout 最后一行
    if args.one:
        mode, topic = args.one.split("::", 1)
        try:
            row = run_one(topic, mode, args.max_loops)
        except Exception as exc:
            row = {"error": str(exc)[:200]}
        print(json.dumps(row, ensure_ascii=False), flush=True)
        return

    topics = TOPICS[: args.topics]
    cases = [(topic, mode) for topic in topics for mode in MODES]
    results: dict[str, dict[str, dict]] = {t: {} for t in topics}
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, args.parallel)) as pool:
        futures = {
            pool.submit(_spawn_case, topic, mode, args.max_loops): (topic, mode)
            for topic, mode in cases
        }
        done = 0
        for fut in as_completed(futures):
            topic, mode = futures[fut]
            results[topic][mode] = fut.result()
            done += 1
            print(
                f"[{done}/{len(cases)}] {mode:8s} {topic[:24]} -> {results[topic][mode]}",
                flush=True,
            )
    print(f"total wall: {time.time() - t0:.0f}s", flush=True)

    out_json = ROOT / "data" / "agentic-pick-eval.json"
    out_json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")

    # 汇总表（markdown）
    keys = [
        "closureEvidence", "coverageGatePassed", "healthyArtifacts", "artifactKinds",
        "capabilityRuns", "distinctCapabilities", "durationS",
    ]
    lines = ["# F2 agentic pick 对比评测", "", f"话题 {len(topics)} 个 × 双模式，max_loops={args.max_loops}", ""]
    lines.append("| 话题 | 模式 | 闭环证据 | 覆盖门 | 产物 | 种类 | 执行数 | 去重能力 | 耗时s |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    agg = {m: {k: 0.0 for k in keys} | {"n": 0} for m in MODES}
    for topic, by_mode in results.items():
        for mode in MODES:
            row = by_mode.get(mode) or {}
            if "error" in row:
                lines.append(f"| {topic[:18]} | {mode} | 失败 | — | — | — | — | — | — |")
                continue
            lines.append(
                f"| {topic[:18]} | {mode} | {row['closureEvidence']}/6 | "
                f"{'过' if row['coverageGatePassed'] else '未过'} | {row['healthyArtifacts']} | "
                f"{row['artifactKinds']} | {row['capabilityRuns']} | "
                f"{row['distinctCapabilities']} | {row['durationS']} |"
            )
            for k in keys:
                agg[mode][k] += float(row[k])
            agg[mode]["n"] += 1
    lines.append("")
    lines.append("## 均值")
    lines.append("| 模式 | 闭环证据 | 覆盖门通过率 | 产物 | 种类 | 执行数 | 去重能力 | 耗时s |")
    lines.append("|---|---|---|---|---|---|---|---|")
    for mode in MODES:
        n = max(agg[mode]["n"], 1)
        lines.append(
            f"| {mode} | {agg[mode]['closureEvidence'] / n:.1f}/6 | "
            f"{agg[mode]['coverageGatePassed'] / n * 100:.0f}% | "
            f"{agg[mode]['healthyArtifacts'] / n:.1f} | {agg[mode]['artifactKinds'] / n:.1f} | "
            f"{agg[mode]['capabilityRuns'] / n:.1f} | {agg[mode]['distinctCapabilities'] / n:.1f} | "
            f"{agg[mode]['durationS'] / n:.0f} |"
        )
    out_md = ROOT / "data" / "agentic-pick-eval.md"
    out_md.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nJSON: {out_json}\nMD:   {out_md}")


if __name__ == "__main__":
    main()
