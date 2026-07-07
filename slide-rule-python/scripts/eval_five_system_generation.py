"""
Multi-domain five-system generation quality harness (T3 eval).

For each domain intent it runs the REAL LLM pipeline:
    generate_five_system_model(intent)  ->  validate_five_system_model(model)
sequentially (the router rate-limits; do NOT parallelize), then writes an
honest Markdown report (gate pass/fail, counts, domain-fit spot signals,
cross-ref integrity, latency) to docs/five-system-generation-eval.md.

Usage (from slide-rule-python/, with LLM env loaded):
    set -a && . ./.env && set +a
    python3 scripts/eval_five_system_generation.py
    python3 scripts/eval_five_system_generation.py --domains "宠物医院预约" --out /tmp/eval.md

Honesty rules:
  - generation failure (LLM None) and gate failure are reported as-is;
  - domain-fit is a heuristic spot signal (keyword match) + the raw names are
    listed so a human can judge; no score inflation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_HERE = Path(__file__).resolve()
sys.path.insert(0, str(_HERE.parent.parent))  # slide-rule-python/

from services.v5_llm_generate import generate_five_system_model  # noqa: E402
from services.v5_model_gate import validate_five_system_model, DANGLING  # noqa: E402
from services.v5_content_quality import analyze_content_quality  # noqa: E402
from services.v5_llm_judge import judge_content_quality  # noqa: E402

REPO_ROOT = _HERE.parent.parent.parent
DEFAULT_OUT = REPO_ROOT / "docs" / "five-system-generation-eval.md"

# 5 novel domains — none of these match the deterministic fixture markers
# (purchase/leave/ticket/onboarding), so every one exercises the real LLM path.
DEFAULT_DOMAINS: List[Dict[str, Any]] = [
    {
        "name": "连锁健身房",
        "intent": "做一个连锁健身房管理系统，包含私教排期、会员卡核销和器材保养",
        "keywords": ["健身", "门店", "私教", "会员", "器材", "课", "教练", "排期", "核销", "保养",
                     "gym", "member", "trainer", "coach", "equipment", "branch", "store",
                     "session", "schedul", "card", "maintenance", "checkin", "redemption"],
    },
    {
        "name": "跨境物流报关",
        "intent": "构建跨境物流报关平台，覆盖运单管理、报关单申报、关税核算与清关状态跟踪",
        "keywords": ["报关", "物流", "清关", "关税", "货", "运单", "申报", "口岸", "HS", "税",
                     "customs", "declaration", "shipment", "cargo", "freight", "logistics",
                     "tariff", "clearance", "waybill", "consign", "duty", "hs_code", "broker"],
    },
    {
        "name": "医院药房库存",
        "intent": "开发医院药房库存管理系统，支持药品入库出库、批号效期预警和处方调剂发药",
        "keywords": ["药", "处方", "库存", "批号", "效期", "医院", "入库", "出库", "盘点", "调剂",
                     "pharmacy", "drug", "medicine", "medication", "prescription", "inventory",
                     "stock", "batch", "expiry", "hospital", "dispens", "warehouse"],
    },
    {
        "name": "餐饮加盟督导",
        "intent": "搭建餐饮连锁加盟督导系统，包含巡店检查、整改跟踪和门店评分排名",
        "keywords": ["加盟", "门店", "督导", "巡店", "餐", "菜", "整改", "评分", "检查", "排名",
                     "franchise", "store", "inspect", "supervis", "restaurant", "audit",
                     "rectif", "menu", "food", "score", "rank", "visit"],
    },
    {
        "name": "物业报修工单",
        "intent": "做一个物业报修工单系统，业主提交报修、物业派单维修、完工验收与回访评价",
        "keywords": ["报修", "工单", "物业", "维修", "业主", "楼", "设备", "派单", "验收", "回访",
                     "property", "repair", "ticket", "work_order", "workorder", "maintenance",
                     "resident", "tenant", "owner", "dispatch", "building", "acceptance"],
    },
]

# Names that signal a generic (non-domain) template — reported honestly as a smell.
GENERIC_TOKENS = ["item", "record", "data", "object", "entity", "info", "base",
                  "main", "common", "misc", "sample", "demo", "generic", "thing"]


def _load_env_file() -> None:
    """Best-effort .env load so the script works without `set -a && . ./.env`."""
    if os.getenv("LLM_API_KEY"):
        return
    env_path = _HERE.parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def _as_list(v: Any) -> List[Any]:
    return v if isinstance(v, list) else []


def _as_dict(v: Any) -> Dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _name_of(node: Any) -> str:
    d = _as_dict(node)
    return str(d.get("name") or d.get("id") or d.get("label") or "").strip()


def _id_and_name(node: Any) -> str:
    d = _as_dict(node)
    nid = str(d.get("id") or "").strip()
    name = str(d.get("name") or d.get("label") or "").strip()
    return f"{nid} {name}".strip()


def _count_model(model: Dict[str, Any]) -> Dict[str, int]:
    entities = _as_list(_as_dict(model.get("datamodel")).get("entities"))
    rbac = _as_dict(model.get("rbac"))
    workflow = _as_dict(model.get("workflow"))
    pages = _as_list(_as_dict(model.get("page")).get("pages"))
    caps = _as_list(_as_dict(model.get("aigc")).get("capabilities"))
    bundle = _as_dict(model.get("appbundle"))
    return {
        "entities": len(entities),
        "fields": sum(len(_as_list(_as_dict(e).get("fields"))) for e in entities),
        "roles": len(_as_list(rbac.get("roles"))),
        "permissions": len(_as_list(rbac.get("permissions"))),
        "menus": len(_as_list(rbac.get("menus"))),
        "workflow_nodes": len(_as_list(workflow.get("nodes"))),
        "transitions": len(_as_list(workflow.get("transitions"))),
        "pages": len(pages),
        "aigc_capabilities": len(caps),
        "page_bindings": len(_as_list(bundle.get("pageBindings"))),
    }


def _count_cross_refs(model: Dict[str, Any]) -> int:
    """Total cross-system references the gate checks (denominator for integrity)."""
    total = 0
    workflow = _as_dict(model.get("workflow"))
    for node in _as_list(workflow.get("nodes")):
        if _as_dict(node).get("assigneeRole"):
            total += 1
    for p in _as_list(_as_dict(model.get("page")).get("pages")):
        pd = _as_dict(p)
        total += len(_as_list(pd.get("fieldBindings")))
        total += len(_as_list(pd.get("actionPermissions")))
    for cap in _as_list(_as_dict(model.get("aigc")).get("capabilities")):
        cd = _as_dict(cap)
        total += len(_as_list(cd.get("inputFields")))
        total += 1 if cd.get("outputField") else 0
        total += len(_as_list(cd.get("roleRefs")))
    rbac = _as_dict(model.get("rbac"))
    for menu in _as_list(rbac.get("menus")):
        md = _as_dict(menu)
        total += len(_as_list(md.get("roleRefs")))
        total += len(_as_list(md.get("permissionRefs")))
    bundle = _as_dict(model.get("appbundle"))
    for pb in _as_list(bundle.get("pageBindings")):
        bd = _as_dict(pb)
        total += 1 if bd.get("pageRef") else 0
        total += 1 if bd.get("workflowRef") else 0
    total += len(_as_list(bundle.get("roleRefs")))
    total += len(_as_list(bundle.get("dataModelRefs")))
    return total


def _domain_fit(model: Dict[str, Any], keywords: List[str]) -> Dict[str, Any]:
    """Spot signal: do entity/role/node names reflect the domain vs a generic template?"""
    kw = [k.lower() for k in keywords]

    def hits(texts: List[str]) -> int:
        return sum(1 for t in texts if any(k in t.lower() for k in kw))

    def generic_hits(texts: List[str]) -> List[str]:
        import re

        out = []
        for t in texts:
            # Whole-token match only ("maintenance" must NOT hit "main").
            tokens = set(re.split(r"[^a-z0-9]+", t.lower()))
            if tokens & set(GENERIC_TOKENS):
                out.append(t)
        return out

    entities = [_id_and_name(e) for e in _as_list(_as_dict(model.get("datamodel")).get("entities"))]
    roles = []
    for r in _as_list(_as_dict(model.get("rbac")).get("roles")):
        roles.append(r if isinstance(r, str) else _id_and_name(r))
    nodes = [_id_and_name(n) for n in _as_list(_as_dict(model.get("workflow")).get("nodes"))]
    pages = [_id_and_name(p) for p in _as_list(_as_dict(model.get("page")).get("pages"))]
    caps = [_id_and_name(c) for c in _as_list(_as_dict(model.get("aigc")).get("capabilities"))]

    return {
        "entities": entities, "roles": roles, "nodes": nodes, "pages": pages, "caps": caps,
        "entity_hits": hits(entities), "role_hits": hits(roles),
        "node_hits": hits(nodes), "page_hits": hits(pages), "cap_hits": hits(caps),
        "generic_names": generic_hits(entities + roles + nodes + pages + caps),
    }


def run_domain(domain: Dict[str, Any], judge: bool = False) -> Dict[str, Any]:
    intent = domain["intent"]
    t0 = time.time()
    model = generate_five_system_model(intent)  # real LLM; None on failure (fail-closed)
    latency = time.time() - t0
    result: Dict[str, Any] = {
        "name": domain["name"],
        "intent": intent,
        "latency_s": round(latency, 1),
        "generated": model is not None,
        "gate_passed": False,
        "findings": [],
        "counts": {},
        "cross_refs_total": 0,
        "dangling": 0,
        "fit": None,
        "content": None,
        "judge": None,
    }
    if model is None:
        return result
    gate = validate_five_system_model(model)
    result["gate_passed"] = bool(gate.get("passed"))
    result["findings"] = gate.get("findings") or []
    result["counts"] = _count_model(model)
    result["cross_refs_total"] = _count_cross_refs(model)
    result["dangling"] = sum(1 for f in result["findings"] if f.get("code") == DANGLING)
    result["fit"] = _domain_fit(model, domain["keywords"])
    result["content"] = analyze_content_quality(model)
    if judge:
        result["judge"] = judge_content_quality(model, intent)  # None = 评审失败（如实标注）
    return result


def _fmt_names(names: List[str], limit: int = 12) -> str:
    if not names:
        return "—"
    shown = [n.replace("|", "/") for n in names[:limit]]
    suffix = f" …(+{len(names) - limit})" if len(names) > limit else ""
    return "、".join(shown) + suffix


def render_report(results: List[Dict[str, Any]], model_id: str) -> str:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines: List[str] = []
    lines.append("# 五系统模型多域生成质量评测（Five-System Generation Eval）")
    lines.append("")
    lines.append(f"- 运行时间：{now}")
    lines.append(f"- 生成模型：`{model_id or 'unknown'}`（真实 LLM，串行逐域，路由限流约束）")
    lines.append("- 管线：`generate_five_system_model(intent)` → `validate_five_system_model(model)`"
                 "（结构闭包 gate，任何悬挂交叉引用即 fail）")
    lines.append("- 领域适配为启发式抽查信号（关键词命中 + 原始命名列表），供人工复核；不做打分粉饰。")
    lines.append("")
    lines.append("## 汇总")
    lines.append("")
    has_judge = any(r.get("judge") is not None for r in results)
    judge_head = " LLM评审(覆盖/常识/命名) |" if has_judge else ""
    judge_sep = "---|" if has_judge else ""
    lines.append(f"| 领域 | 生成 | Gate | 内容质量 |{judge_head} 耗时(s) | 实体 | 字段 | 角色 | 权限 | 流程节点 | 转移 | 页面 | AIGC能力 | 交叉引用(悬挂/总数) | 实体域命中 |")
    lines.append(f"|---|---|---|---|{judge_sep}---|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        c = r["counts"] or {}
        fit = r["fit"] or {}
        if not r["generated"]:
            fail_judge = " — |" if has_judge else ""
            lines.append(f"| {r['name']} | ❌ 失败 | — | — |{fail_judge} {r['latency_s']} | — | — | — | — | — | — | — | — | — | — |")
            continue
        gate = "✅ PASS" if r["gate_passed"] else "❌ FAIL"
        content = r.get("content") or {}
        c_fails = content.get("hardFailCount", 0)
        c_warns = sum(1 for f in content.get("findings", []) if f.get("severity") == "warn")
        content_cell = ("❌ " if c_fails else "✅ ") + f"{c_fails} fail / {c_warns} warn"
        judge_cell = ""
        if has_judge:
            j = r.get("judge")
            if j:
                d = j["dims"]
                judge_cell = (f" {d['requirement_coverage']['score']}/{d['domain_sense']['score']}"
                              f"/{d['naming_quality']['score']} (均{j['avg']}) |")
            else:
                judge_cell = " ⚠️ 评审失败 |"
        ent_fit = f"{fit.get('entity_hits', 0)}/{c.get('entities', 0)}"
        lines.append(
            f"| {r['name']} | ✅ | {gate} | {content_cell} |{judge_cell} {r['latency_s']} | {c.get('entities', 0)} | {c.get('fields', 0)} "
            f"| {c.get('roles', 0)} | {c.get('permissions', 0)} | {c.get('workflow_nodes', 0)} "
            f"| {c.get('transitions', 0)} | {c.get('pages', 0)} | {c.get('aigc_capabilities', 0)} "
            f"| {r['dangling']}/{r['cross_refs_total']} | {ent_fit} |"
        )
    lines.append("")

    for r in results:
        lines.append(f"## {r['name']}")
        lines.append("")
        lines.append(f"- 意图：{r['intent']}")
        lines.append(f"- 生成耗时：{r['latency_s']}s")
        if not r["generated"]:
            lines.append("- **生成失败**：LLM 未返回完整六段模型（fail-closed，未注入任何证据）。")
            lines.append("")
            continue
        c = r["counts"]
        fit = r["fit"] or {}
        gate_line = "**PASS**（0 悬挂引用）" if r["gate_passed"] else \
            f"**FAIL**（{len(r['findings'])} 条 findings，其中悬挂引用 {r['dangling']} 条）"
        lines.append(f"- Gate：{gate_line}")
        lines.append(f"- 交叉引用完整性：共 {r['cross_refs_total']} 条被检引用，悬挂 {r['dangling']} 条"
                     f"（解析率 {100.0 * (1 - r['dangling'] / r['cross_refs_total']):.1f}%）"
                     if r["cross_refs_total"] else "- 交叉引用完整性：模型未声明任何交叉引用（异常，模板嫌疑）")
        lines.append(f"- 规模：{c['entities']} 实体 / {c['fields']} 字段 / {c['roles']} 角色 / "
                     f"{c['permissions']} 权限 / {c['menus']} 菜单 / {c['workflow_nodes']} 流程节点 / "
                     f"{c['transitions']} 转移 / {c['pages']} 页面 / {c['aigc_capabilities']} AIGC 能力 / "
                     f"{c['page_bindings']} 装配绑定")
        lines.append("- 领域适配抽查：")
        lines.append(f"  - 实体命中 {fit.get('entity_hits', 0)}/{c['entities']}：{_fmt_names(fit.get('entities', []))}")
        lines.append(f"  - 角色命中 {fit.get('role_hits', 0)}/{c['roles']}：{_fmt_names(fit.get('roles', []))}")
        lines.append(f"  - 流程节点命中 {fit.get('node_hits', 0)}/{c['workflow_nodes']}：{_fmt_names(fit.get('nodes', []))}")
        lines.append(f"  - 页面命中 {fit.get('page_hits', 0)}/{c['pages']}：{_fmt_names(fit.get('pages', []))}")
        lines.append(f"  - AIGC 能力命中 {fit.get('cap_hits', 0)}/{c['aigc_capabilities']}：{_fmt_names(fit.get('caps', []))}")
        generic = fit.get("generic_names") or []
        if generic:
            lines.append(f"  - ⚠️ 泛化命名嫌疑（{len(generic)}）：{_fmt_names(generic, 8)}")
        else:
            lines.append("  - 泛化命名嫌疑：无")
        content = r.get("content") or {}
        cm = content.get("metrics") or {}
        c_findings = content.get("findings") or []
        c_fails = content.get("hardFailCount", 0)
        lines.append("- 内容质量（确定性启发式，零 LLM）：")
        shape = ("纯线性（无分支）" if cm.get("workflowLinear") else f"{cm.get('branchNodes', 0)} 个分支节点")
        reject = "有回退边" if cm.get("hasBackEdge") else f"{cm.get('terminals', 0)} 个终态"
        lines.append(f"  - 流程形状：{shape} · {reject}")
        lines.append(
            f"  - 可达性/权限：不可达页面 {cm.get('unreachablePages', 0)} · 空页面 {cm.get('emptyPages', 0)}"
            f" · 满权角色 {cm.get('overPrivilegedRoles', 0)} · 孤儿权限 {cm.get('orphanPermissions', 0)}"
            f" · 无用角色 {cm.get('unusedRoles', 0)} · 孤儿实体 {cm.get('orphanEntities', 0)}"
        )
        if c_findings:
            lines.append(f"  - 结论：{'❌' if c_fails else '✅'} {c_fails} fail / "
                         f"{sum(1 for f in c_findings if f.get('severity') == 'warn')} warn")
            for f in c_findings[:10]:
                icon = "❌" if f.get("severity") == "fail" else "⚠️"
                lines.append(f"    - {icon} `{f.get('code')}` — {f.get('detail')}")
        else:
            lines.append("  - 结论：✅ 无 finding")
        judge = r.get("judge")
        if judge:
            d = judge["dims"]
            lines.append(f"- LLM 评审（1-5 量表 · temperature 0 · 同模型自评有自恋偏差，用于回归比对而非绝对分）：")
            zh = {"requirement_coverage": "需求覆盖度", "domain_sense": "行业常识", "naming_quality": "命名质量"}
            for dim, label in zh.items():
                entry = d[dim]
                lines.append(f"  - {label}：**{entry['score']}/5**")
                for reason in entry.get("reasons", []):
                    lines.append(f"    - {reason}")
                for miss in entry.get("missed", []) or []:
                    lines.append(f"    - ❗漏建模：{miss}")
        elif judge is None and r.get("judge_attempted"):
            lines.append("- LLM 评审：⚠️ 评审调用失败（fail-closed，不编分数）")
        if r["findings"]:
            lines.append(f"- Gate findings（前 {min(10, len(r['findings']))} 条）：")
            for f in r["findings"][:10]:
                lines.append(f"  - `{f.get('code')}` @ `{f.get('path')}` ref=`{f.get('ref')}` — {f.get('message')}")
        lines.append("")

    passed = sum(1 for r in results if r["gate_passed"])
    generated = sum(1 for r in results if r["generated"])
    content_fails = sum((r.get("content") or {}).get("hardFailCount", 0) for r in results)
    content_warns = sum(
        1
        for r in results
        for f in (r.get("content") or {}).get("findings", [])
        if f.get("severity") == "warn"
    )
    lines.append("## 结论（诚实版）")
    lines.append("")
    lines.append(f"- 生成成功 {generated}/{len(results)}，Gate 通过 {passed}/{len(results)}。")
    lines.append(f"- 内容质量回归门：hard-fail {content_fails} 条 / warn {content_warns} 条"
                 "（fail = 用户一上手就撞墙，如页面全员不可达；warn = 深度短板，盯趋势）。")
    if passed < len(results):
        lines.append("- 未通过项如实保留在上表；gate 失败即 fail-closed（0/6，不注入证据、不降级伪造）。")
    lines.append("- 关键词命中是抽查下限而非上限：中文实体名可能用同义词（如“课程”对“排期”），"
                 "请结合原始命名列表人工复核。")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Five-system multi-domain generation eval (real LLM)")
    parser.add_argument("--domains", nargs="*", default=None,
                        help="Override domain intents (names default to the intent text)")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Markdown report path")
    parser.add_argument("--sleep", type=float, default=2.0, help="Seconds between domains (rate-limit)")
    parser.add_argument("--content-gate", action="store_true",
                        help="内容质量回归门：任一领域出现 hard-fail 级 finding 则退出码 1")
    parser.add_argument("--judge", action="store_true",
                        help="附加 LLM-as-judge 三维评分（每域多一次真实 LLM 调用）")
    args = parser.parse_args()

    _load_env_file()
    if not os.getenv("LLM_API_KEY"):
        print("[eval] WARNING: LLM_API_KEY not set — generation will fail-closed (report will say so).")

    domains: List[Dict[str, Any]]
    if args.domains:
        domains = [{"name": d[:16], "intent": d, "keywords": []} for d in args.domains]
    else:
        domains = DEFAULT_DOMAINS

    results: List[Dict[str, Any]] = []
    for i, domain in enumerate(domains):
        print(f"[eval] ({i + 1}/{len(domains)}) {domain['name']} — generating (real LLM, sequential)…", flush=True)
        result = run_domain(domain, judge=args.judge)
        if args.judge:
            result["judge_attempted"] = True
        status = ("gate PASS" if result["gate_passed"] else
                  ("gate FAIL" if result["generated"] else "GENERATION FAILED"))
        print(f"[eval]   -> {status} in {result['latency_s']}s "
              f"(dangling {result['dangling']}/{result['cross_refs_total']})", flush=True)
        results.append(result)
        if i + 1 < len(domains):
            time.sleep(args.sleep)

    report = render_report(results, os.getenv("LLM_MODEL", ""))
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(report, encoding="utf-8")
    print(f"[eval] report written: {out_path}")
    content_fails = sum((r.get("content") or {}).get("hardFailCount", 0) for r in results)
    if content_fails:
        print(f"[eval] content-quality hard fails: {content_fails}")
    if args.content_gate and content_fails:
        print("[eval] CONTENT GATE FAILED (--content-gate)")
        return 1
    # Also dump raw JSON next to the report for debugging (not committed by default).
    print(json.dumps(
        [{k: v for k, v in r.items() if k not in ("fit", "findings")} for r in results],
        ensure_ascii=False, indent=None,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
