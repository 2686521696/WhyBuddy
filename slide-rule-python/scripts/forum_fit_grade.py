"""给 forum_topic 的话题打「SlideRule 能不能推演它」的分档，并写回库。

    cd slide-rule-python
    .venv/bin/python scripts/forum_fit_grade.py            # 只判还没判过的
    .venv/bin/python scripts/forum_fit_grade.py --all      # 全部重判（换了标准时）
    .venv/bin/python scripts/forum_fit_grade.py --report   # 不调模型，只看现状

## 这个分档要回答什么

SlideRule 产出的是**企业应用数字孪生**——五系统模型（数据实体 / 角色权限 /
工作流 / 页面 / AI 能力）。它能推演的是「有实体、有角色、有流转」的业务系统。
一个 3D 竞速游戏、一个 ESP32 桌宠、一个音频插件都不是这个形状。

所以「这批话题对项目有没有用」不是感觉问题，是覆盖率问题：多少条落在能力
圈内。落在圈内的才是可用的意图语料（域识别回归集、示例库候选、相关性校验
的标定集）；圈外的只能当竞品情报。

## 三条实现纪律

**① 分批不逐条。** 逐条 299 次调用，每次还要驮网关注入的几千 token 系统
提示词。25 条一批共 12 次，对这种粗分类精度完全够。

**② 每批立刻写库。** 第一版写在 scratchpad 里的脚本是跑完才落盘，中途
ReadTimeout 一次就得从头再来（真发生过，批 7 超时重试）。现在每批一落，
挂了重跑接着上次走。

**③ 判不出来的标 U，不猜。** 模型漏判某个序号时补一个 C 是最省事的做法，
也是最坏的：它会悄悄把一条本该入选的语料踢掉，而且看不出来。
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from forum_neon import FIT_GRADES, Store

BATCH = 25
RETRIES = 3

RUBRIC = """你在给一批参赛作品做能力圈归类。

判定基准产品叫 SlideRule：输入一句业务意图，输出一套「企业应用数字孪生」——
它生成的是五个系统的模型：数据实体表、角色权限、审批/流转工作流、页面布局、
AI 能力位。也就是说它只擅长**表单 + 台账 + 角色 + 流转**这一类业务系统。

给每个作品打一个档：
A = 正中靶心：本质就是一套业务系统（有明确的数据实体、有不同角色、有申请/
    审批/派单/流转/台账）。哪怕包装成小程序也算。
B = 半个：有结构化数据和管理界面，但没有多角色流转，主要价值在算法/内容/
    推荐/分析上。SlideRule 能推演出个骨架，但抓不住它真正的价值。
C = 圈外：游戏、3D、硬件固件、音视频处理、图像生成、纯创作工具、模拟器。
    没有"业务实体+角色"这个结构，SlideRule 推演不了。

只输出 JSON：{"items":[{"i":序号,"grade":"A|B|C","why":"12字以内"}]}
序号必须和输入一一对应，一条都不能少。"""


def classify(titles: list[tuple[int, str]], model: str) -> dict[int, tuple[str, str]]:
    import httpx

    resp = httpx.post(
        f'{os.environ["LLM_BASE_URL"].rstrip("/")}/chat/completions',
        headers={"Authorization": f'Bearer {os.environ["LLM_API_KEY"]}'},
        json={
            "model": model, "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": RUBRIC},
                {"role": "user", "content": "\n".join(f"{i}. {t}" for i, t in titles)},
            ],
        },
        timeout=300,
    )
    resp.raise_for_status()
    items = json.loads(resp.json()["choices"][0]["message"]["content"])["items"]
    out: dict[int, tuple[str, str]] = {}
    for it in items:
        grade = str(it.get("grade") or "").strip().upper()[:1]
        if grade in FIT_GRADES and grade != "U":
            out[int(it["i"])] = (grade, str(it.get("why") or "")[:60])
    return out


def write_back(db: Store, model: str, graded: dict[int, tuple[str, str]]) -> None:
    for topic_id, (grade, why) in graded.items():
        db.q(
            "update forum_topic set fit_grade = $1, fit_reason = $2, "
            "fit_model = $3, fit_at = now() where topic_id = $4",
            [grade, why, model, topic_id],
        )


def report(db: Store) -> None:
    rows = db.q(
        "select coalesce(fit_grade, 'U') as g, count(*)::int as n "
        "from forum_topic group by 1 order by 1"
    )
    total = sum(int(r["n"]) for r in rows) or 1
    print(f"\n共 {total} 条")
    for r in rows:
        g, n = r["g"], int(r["n"])
        bar = "█" * round(n / total * 36)
        print(f"  {g}  {n:>3} 帖  {bar:<36} {n / total * 100:5.1f}%  {FIT_GRADES.get(g, '')}")


def main() -> None:
    args = set(sys.argv[1:])
    db = Store()
    db.ensure_table()

    if "--report" in args:
        report(db)
        return

    where = "" if "--all" in args else "where fit_grade is null"
    rows: list[dict[str, Any]] = db.q(
        f"select topic_id, title from forum_topic {where} order by topic_id"
    )
    if not rows:
        print("没有待判定的话题（要重判全部加 --all）")
        report(db)
        return

    model = os.environ.get("LLM_MODEL") or ""
    if not model or not os.environ.get("LLM_API_KEY"):
        raise SystemExit("缺 LLM_MODEL / LLM_API_KEY")

    todo = [(int(r["topic_id"]), str(r["title"])) for r in rows]
    batches = (len(todo) + BATCH - 1) // BATCH
    print(f"待判 {len(todo)} 条，分 {batches} 批，模型 {model}")

    done = failed = 0
    for n, start in enumerate(range(0, len(todo), BATCH), 1):
        chunk = todo[start:start + BATCH]
        for attempt in range(RETRIES):
            try:
                t0 = time.perf_counter()
                graded = classify(chunk, model)
                # 每批立刻落库：中途挂掉重跑能接着上次走，不用从头再来
                write_back(db, model, graded)
                done += len(graded)
                miss = len(chunk) - len(graded)
                tail = f"，{miss} 条模型没给（留空，下次重跑会再判）" if miss else ""
                print(f"  批 {n}/{batches}  {len(graded)} 条 / "
                      f"{time.perf_counter() - t0:.0f}s{tail}", flush=True)
                break
            except Exception as exc:  # noqa: BLE001 — 单批失败不拖垮整轮
                print(f"  批 {n}/{batches} 第 {attempt + 1} 次失败："
                      f"{type(exc).__name__} {str(exc)[:100]}", flush=True)
                if attempt == RETRIES - 1:
                    failed += len(chunk)
                time.sleep(3)

    print(f"\n写回 {done} 条" + (f"，{failed} 条整批失败" if failed else ""))
    report(db)


if __name__ == "__main__":
    main()
