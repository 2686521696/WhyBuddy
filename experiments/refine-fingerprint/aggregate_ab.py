# -*- coding: utf-8 -*-
"""把多轮 A/B 的 runs/ 聚合成一张表 —— 并**顺带把网关故障率量出来**。

## 跟 analyze_ids.py 的分工

`analyze_ids.py` 是**单次**两版模型的显微镜（三把尺子 + 逐类 id/名字）。
这个脚本是**多次**的望远镜：每轮只取"逐类 id 保住率"这一个标量，然后按臂
汇总成 mean ± 全距，让 n=1 的"方向"变成有幅度的结论。

⚠ 逐类 id 保住率的算法**直接从 analyze_ids 导入**，不重写一份。
   同一个指标两处实现是本仓纪律四点名的形态（"改一条不改另一条不会报错，
   只会有一半不生效"）——这里更阴，两份算法算出不同的数还都像对的。

## 第二件事：网关故障率（交接文档说"没有任何地方统计"）

跑 A/B 会顺手产出十几轮真机日志，那正是统计这个的样本，白扔可惜。
从 run.log 里挖三类，都是这个中转站已知会犯的：

    [llm-retry] 第 N/3 次失败      → 连接层失败（RemoteProtocolError 等）
    客服话术特征                    → 网关把自己的问候语当结果返回（文档记过两次）
    结构/JSON 解析失败              → 拿到 200 但不是要的东西

⚠ 这三类都**不该**用来判 A/B 成败——它们是环境噪声，不是处理效应。分开报，
  是为了回答"这轮数据可不可信"，以及给那条一直没人量的隐患一个初值。
"""
import json
import os
import re
import sys
from collections import defaultdict

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from analyze_ids import pairs_of_class, CLASSES  # noqa: E402


def keep_rate(m1, m2, path):
    """一类对象的 id 保住率与名字保住率。分母用两版里较大的个数——
    个数本身会变（3 实体 → 5 实体），用较大者才不会把"变多了"读成"保住了"。"""
    a, b = pairs_of_class(m1, path), pairs_of_class(m2, path)
    ia, ib = {i for i, _ in a if i}, {i for i, _ in b if i}
    na, nb = {x for _, x in a if x}, {x for _, x in b if x}
    di = max(len(ia), len(ib))
    dn = max(len(na), len(nb))
    return {
        "id": (len(ia & ib) / di) if di else None,
        "name": (len(na & nb) / dn) if dn else None,
        "n1": len(a),
        "n2": len(b),
    }


GATEWAY_PATTERNS = {
    "llm_retry_fail": re.compile(r"\[llm-retry\] 第 \d+/\d+ 次失败"),
    # 网关问候语。文档记过两次真实样本：「你好！我是 OuYi（欧亿 AI 助手）…」
    "gateway_boilerplate": re.compile(r"OuYi|欧亿|我是[^\n]{0,12}(AI )?助手"),
    "json_parse_fail": re.compile(r"json.{0,20}(解析失败|parse\s*(error|failed)|not valid)", re.I),
    "reuse_applied": re.compile(r"精修沿用上一版模型段：(.+)"),
    "freeze_on": re.compile(r"精修 id 冻结："),
    "freeze_off": re.compile(r"id 冻结被开关关掉"),
}


def mine_log(path):
    out = defaultdict(int)
    reused = []
    if not os.path.exists(path):
        return out, reused
    text = open(path, encoding="utf-8", errors="replace").read()
    for name, pat in GATEWAY_PATTERNS.items():
        found = pat.findall(text)
        out[name] = len(found)
        if name == "reuse_applied":
            reused = [f if isinstance(f, str) else f[0] for f in found]
    out["lines"] = text.count("\n")
    return out, reused


def fmt(v):
    return "—" if v is None else f"{v:.2f}"


def main():
    runs_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(_HERE, "runs")
    if not os.path.isdir(runs_dir):
        print(f"没有这个目录：{runs_dir}")
        return 1

    per_arm = defaultdict(lambda: defaultdict(list))
    gw = defaultdict(lambda: defaultdict(int))
    reuse_log = defaultdict(list)
    counted = defaultdict(int)
    skipped = []

    for name in sorted(os.listdir(runs_dir)):
        d = os.path.join(runs_dir, name)
        if not os.path.isdir(d):
            continue
        arm = name.split("-")[0]
        f1, f2 = os.path.join(d, "model_round1.json"), os.path.join(d, "model_round2.json")

        g, reused = mine_log(os.path.join(d, "run.log"))
        for k, v in g.items():
            gw[arm][k] += v
        if reused:
            reuse_log[arm].append((name, reused))

        # ⚠ 只统计**自证通过**的轮次（OK 标记由 ab_multi_run 写）。少了这一条，
        #   开关没生效的那轮会被当成正常数据混进来，直接污染两臂对比。
        if not os.path.exists(os.path.join(d, "OK")):
            skipped.append(name)
            continue
        if not (os.path.exists(f1) and os.path.exists(f2)):
            skipped.append(name)
            continue

        m1, m2 = json.load(open(f1)), json.load(open(f2))
        counted[arm] += 1
        for label, path in CLASSES:
            r = keep_rate(m1, m2, path)
            if r["id"] is not None:
                per_arm[arm][label].append(r["id"])

    print(f"runs 目录：{runs_dir}")
    print(f"纳入统计：{dict(counted)}    跳过（未自证/不全）：{skipped or '无'}\n")

    arms = [a for a in ("off", "on") if a in per_arm]
    if not arms:
        print("没有可统计的轮次。")
        return 1

    print("=" * 78)
    print("逐类 id 保住率（每轮一个值，下面是 mean，括号内为各轮原始值）")
    print("=" * 78)
    hdr = f"{'对象':<24}{'OFF mean':<11}{'ON mean':<11}{'差值':<9}"
    print(hdr)
    print("-" * 78)
    for label, _ in CLASSES:
        vals = {a: per_arm[a].get(label, []) for a in arms}
        means = {a: (sum(v) / len(v) if v else None) for a, v in vals.items()}
        off_m, on_m = means.get("off"), means.get("on")
        delta = (on_m - off_m) if (off_m is not None and on_m is not None) else None
        star = ""
        if delta is not None and delta >= 0.3:
            star = "  ★"
        print(f"{label:<24}{fmt(off_m):<11}{fmt(on_m):<11}{fmt(delta):<9}{star}")
        for a in arms:
            raw = "、".join(f"{v:.2f}" for v in vals[a]) or "—"
            print(f"{'':<24}  {a}: {raw}")

    print("\n" + "=" * 78)
    print("词表覆盖：哪些类被 model_id_lexicon 真正干预了")
    print("=" * 78)
    print("  被干预  : datamodel.entities / rbac.roles / workflow.nodes")
    print("  跟随    : rbac.permissions（形状 <实体id>:动作，跟实体走）")
    print("  未干预  : page.pages / aigc.capabilities")
    print("  ⚠ 未干预的两类若也出现大幅差异，那是运气或间接效应，不能算作疗效。")

    print("\n" + "=" * 78)
    print("环境噪声：网关故障（不参与 A/B 判定，只回答『这批数据可不可信』）")
    print("=" * 78)
    for a in arms:
        g = gw[a]
        print(f"  {a:<4} 连接层重试失败 {g['llm_retry_fail']:<4} "
              f"网关问候语 {g['gateway_boilerplate']:<4} "
              f"JSON解析失败 {g['json_parse_fail']:<4} "
              f"（日志 {g['lines']} 行）")

    print("\n" + "=" * 78)
    print("逐段沿用真的发生了吗（id 冻结的机制性证据，比指纹数字更能归因）")
    print("=" * 78)
    for a in arms:
        if reuse_log[a]:
            for run, segs in reuse_log[a]:
                print(f"  {a:<4} {run}: 沿用 {segs}")
        else:
            print(f"  {a:<4} 没有任何一轮发生逐段沿用")

    # ★ 2026-08-17 多轮跑出来的假设，单轮那次没碰到：
    #   **第二轮新增实体 ⇒ 沿用失败**。
    #
    #   on-2 真机：round1 entities=2 → round2 entities=3，三次沿用尝试全被同一条
    #   拒绝：page.pages[...].actionPermissions：'community_branch:read' not found
    #   in rbac.permissions。权限按 <实体id>:动作 铸，新生成的 page 引用新实体的
    #   权限，而沿用的是**旧 rbac**，里面没有这条。
    #
    #   ⚠ 这不是 id 漂移，**冻结救不了**：冻结保的是"已有 id 别改名"，管不了
    #     "新增了一个东西"。沿用是整段照搬，整段照搬天然容纳不了增量。
    #     所以 on 臂也会退让到空——这条推翻了"冻结开着就不会退让"的隐含假设。
    print("\n" + "=" * 78)
    print("假设：第二轮新增实体 ⇒ 沿用失败（冻结救不了的那一类）")
    print("=" * 78)
    # ⚠ 四格表**只统计 on 臂**。off 臂里退让是被 id 漂移过度决定的（每个 id 都
    #   重铸，任何沿用都过不了闸），把它混进来只会稀释信号，得出"新增不新增都退让"
    #   的假结论。这正是这一整天反复栽的形态：两个变量混在一起读一个数。
    print(f"  {'轮次':<10}{'实体 r1→r2':<14}{'新增?':<8}{'沿用结果':<28}")
    print("  " + "-" * 62)
    tab = {"新增+退让": 0, "新增+沿用": 0, "未增+退让": 0, "未增+沿用": 0}
    for name in sorted(os.listdir(runs_dir)):
        d = os.path.join(runs_dir, name)
        f1, f2 = os.path.join(d, "model_round1.json"), os.path.join(d, "model_round2.json")
        if not (os.path.exists(f1) and os.path.exists(f2) and os.path.exists(os.path.join(d, "OK"))):
            continue
        m1, m2 = json.load(open(f1)), json.load(open(f2))
        e1 = len(pairs_of_class(m1, ["datamodel", "entities"]))
        e2 = len(pairs_of_class(m2, ["datamodel", "entities"]))
        text = open(os.path.join(d, "run.log"), encoding="utf-8", errors="replace").read()
        retreated = "精修沿用逐段退让到空" in text
        m = GATEWAY_PATTERNS["reuse_applied"].search(text)
        result = "退让到空" if retreated else (f"沿用 {m.group(1)[:20]}" if m else "未发生沿用")
        grew = e2 > e1
        if name.split("-")[0] == "on":
            tab[("新增" if grew else "未增") + "+" + ("退让" if retreated else "沿用")] += 1
        print(f"  {name:<10}{f'{e1}→{e2}':<14}{'是' if grew else '否':<8}{result:<28}")
    print("\n  四格表（**只含 on 臂**）：", json.dumps(tab, ensure_ascii=False))
    print("  假设成立的形状：新增+退让 与 未增+沿用 占绝大多数，另两格接近 0。")
    print("  ⚠ off 臂被排除：那里退让是被 id 漂移过度决定的，混进来会稀释信号。")

    # 开关自证的汇总：ON 臂每轮都该有 freeze_on、且绝不该有 freeze_off
    print("\n" + "=" * 78)
    print("开关自证汇总（正反两条都要对）")
    print("=" * 78)
    for a in arms:
        g = gw[a]
        print(f"  {a:<4} 冻结生效行 {g['freeze_on']:<4} 冻结关闭行 {g['freeze_off']:<4}")
    print("  期望：on 臂 生效>0 且 关闭=0；off 臂 关闭>0 且 生效=0")
    return 0


if __name__ == "__main__":
    sys.exit(main())
