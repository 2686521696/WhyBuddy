"""
Five-system structural closure gate (the moat).

Validates that an LLM-generated five-system model is *structurally* closed:
every cross-system reference must resolve to a real node. This is the depth
that separates "AI can name the modules" (anyone can) from "the five systems
are wired by one model and verifiable".

Contract (see docs/Intent-to-App 五系统闭包样板 · SPEC.md, 验收标准 4):
    validate_five_system_model(model) -> {"passed": bool, "findings": [...]}
    Any dangling cross-reference => passed=False + a precise
    PUBLISH_DANGLING_CROSSREF finding naming the exact ref + path.

The model shape this gate expects (also the shape the LLM generator targets):

    {
      "datamodel": {"entities": [{"id","name","fields":[{"id","name","type"}]}]},
      "rbac":      {"roles": ["applicant", ...],
                    "permissions": ["purchase:create", ...],
                    "menus": [{"id","label","roleRefs":["applicant"],"permissionRefs":[...]}]},
      "workflow":  {"nodes": [{"id","name","assigneeRole":"dept_manager"}],
                    "transitions": [{"from","to","condition"?}]},
      "page":      {"pages": [{"id","name","fieldBindings":["purchase_request.amount"],
                               "actionPermissions":["purchase:approve_dept"]}]},
      "aigc":      {"capabilities": [{"id","name","inputFields":["purchase_request.amount"],
                                      "outputField":"purchase_request.reason","roleRefs":[...]}]},
      "appbundle": {"pageBindings": [{"pageRef","workflowRef"?}],
                    "roleRefs": [...], "dataModelRefs": ["purchase_request"]}
    }

All checks are pure + deterministic. No LLM, no IO.
"""

from __future__ import annotations

from typing import Any, Dict, List

SKILL_KEYS = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]

DANGLING = "PUBLISH_DANGLING_CROSSREF"
MISSING_SECTION = "PUBLISH_MISSING_SKILL_SECTION"
EMPTY_SECTION = "PUBLISH_EMPTY_SKILL_SECTION"

# 合法域一律来自单一真相源 services/data/five_system_legal.json（E40.1）——
# 此处 re-export 保持历史名字，修复器/测试的既有 import 零改动。
# 加枚举改 JSON，不改这里；四方一致性由 parity 测试锁死。
from .schema_legal import (  # noqa: F401 — re-export 即接口
    CHART_TYPES,
    FIELD_TONES,
    NUMBER_FORMATS,
    PAGE_KINDS,
    STAT_FORMATS,
    STRING_FORMATS,
)


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _finding(code: str, path: str, message: str, ref: str = "", skill: str = "") -> Dict[str, Any]:
    return {"code": code, "path": path, "message": message, "ref": ref, "affectedSkill": skill}


def _collect_datamodel_field_refs(datamodel: Dict[str, Any]) -> set:
    """Return the set of fully-qualified field refs: 'entityId.fieldId' + bare 'entityId'."""
    refs: set = set()
    for entity in _as_list(datamodel.get("entities")):
        e = _as_dict(entity)
        eid = str(e.get("id") or e.get("name") or "").strip()
        if not eid:
            continue
        refs.add(eid)
        for field in _as_list(e.get("fields")):
            f = _as_dict(field)
            fid = str(f.get("id") or f.get("name") or "").strip()
            if fid:
                refs.add(f"{eid}.{fid}")
    return refs


def _collect_field_types(datamodel: Dict[str, Any]) -> Dict[str, str]:
    """'entityId.fieldId' → 字段类型（小写）。页面范式绑定校验用。"""
    types: Dict[str, str] = {}
    for entity in _as_list(datamodel.get("entities")):
        e = _as_dict(entity)
        eid = str(e.get("id") or e.get("name") or "").strip()
        if not eid:
            continue
        for field in _as_list(e.get("fields")):
            f = _as_dict(field)
            fid = str(f.get("id") or f.get("name") or "").strip()
            if fid:
                types[f"{eid}.{fid}"] = str(f.get("type") or "string").strip().lower()
    return types


def _collect_role_ids(rbac: Dict[str, Any]) -> set:
    roles: set = set()
    for role in _as_list(rbac.get("roles")):
        if isinstance(role, str):
            roles.add(role.strip())
        elif isinstance(role, dict):
            rid = str(role.get("id") or role.get("name") or "").strip()
            if rid:
                roles.add(rid)
    return roles


def _collect_permission_ids(rbac: Dict[str, Any]) -> set:
    perms: set = set()
    for perm in _as_list(rbac.get("permissions")):
        if isinstance(perm, str):
            perms.add(perm.strip())
        elif isinstance(perm, dict):
            pid = str(perm.get("id") or perm.get("name") or "").strip()
            if pid:
                perms.add(pid)
    return perms


def _collect_page_ids(page: Dict[str, Any]) -> set:
    ids: set = set()
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        pid = str(pd.get("id") or pd.get("name") or "").strip()
        if pid:
            ids.add(pid)
    return ids


def _iter_workflow_chains(workflow: Dict[str, Any]):
    """Yield (path_label, chain_dict) for the primary chain + optional extra chains.

    多链路（改进①，见 docs/reverse-eval-ai-artist-saas.md）：顶层 id/nodes/transitions
    仍是主链路（老模型/老消费者零破坏），`chains` 携带资金/治理/补偿等附加链路，
    结构与主链路同构。
    """
    yield "workflow", workflow
    for i, chain in enumerate(_as_list(workflow.get("chains"))):
        cd = _as_dict(chain)
        label = str(cd.get("id") or cd.get("name") or i)
        yield f"workflow.chains[{label}]", cd


def _collect_workflow_ids(workflow: Dict[str, Any]) -> set:
    """Workflow is referenced by its top-level id, chain ids, and/or node ids."""
    ids: set = set()
    for _path, chain in _iter_workflow_chains(workflow):
        wid = str(chain.get("id") or chain.get("name") or "").strip()
        if wid:
            ids.add(wid)
        for node in _as_list(chain.get("nodes")):
            nd = _as_dict(node)
            nid = str(nd.get("id") or nd.get("name") or "").strip()
            if nid:
                ids.add(nid)
    return ids


def _collect_aigc_capability_ids(aigc: Dict[str, Any]) -> set:
    ids: set = set()
    for cap in _as_list(aigc.get("capabilities")):
        cid = str(_as_dict(cap).get("id") or "").strip()
        if cid:
            ids.add(cid)
    return ids


def collect_invariant_ref_ids(model: Any) -> set:
    """不变式 refs 的合法解析域：实体/字段/角色/权限/页面/流程节点/AIGC 能力。

    门禁第 7 节与 v5_model_repair 共用本函数——两边各自维护集合曾导致
    奇偶不齐（修复器认 AIGC 能力 id、门禁不认 → 合法不变式被误拦，
    线上案例 ref 'vocal_pitch_coach'）。合法域只在这里改。
    """
    m = _as_dict(model)
    return (
        _collect_datamodel_field_refs(_as_dict(m.get("datamodel")))
        | _collect_role_ids(_as_dict(m.get("rbac")))
        | _collect_permission_ids(_as_dict(m.get("rbac")))
        | _collect_page_ids(_as_dict(m.get("page")))
        | _collect_workflow_ids(_as_dict(m.get("workflow")))
        | _collect_aigc_capability_ids(_as_dict(m.get("aigc")))
    )


def validate_five_system_model(model: Any) -> Dict[str, Any]:
    """Structural closure gate. Returns {'passed': bool, 'findings': [...]}.

    passed=True iff all six sections exist + are non-empty AND every cross-system
    reference resolves. Fail-closed: any problem => passed=False with precise findings.
    """
    findings: List[Dict[str, Any]] = []
    m = _as_dict(model)

    # 1. All six sections present + non-empty.
    for skill in SKILL_KEYS:
        if skill not in m:
            findings.append(_finding(MISSING_SECTION, skill, f"missing skill section: {skill}", skill=skill))
        elif not _as_dict(m.get(skill)):
            findings.append(_finding(EMPTY_SECTION, skill, f"empty skill section: {skill}", skill=skill))
    if findings:
        # Structure incomplete — no point checking cross-refs against absent sections.
        return {"passed": False, "findings": findings}

    datamodel = _as_dict(m.get("datamodel"))
    rbac = _as_dict(m.get("rbac"))
    workflow = _as_dict(m.get("workflow"))
    page = _as_dict(m.get("page"))
    aigc = _as_dict(m.get("aigc"))
    appbundle = _as_dict(m.get("appbundle"))

    field_refs = _collect_datamodel_field_refs(datamodel)
    role_ids = _collect_role_ids(rbac)
    perm_ids = _collect_permission_ids(rbac)
    page_ids = _collect_page_ids(page)
    workflow_ids = _collect_workflow_ids(workflow)
    entity_ids = {r for r in field_refs if "." not in r}

    # Minimum viable content: each section must carry the primitives others reference.
    if not field_refs:
        findings.append(_finding(EMPTY_SECTION, "datamodel.entities", "datamodel has no entities/fields", skill="datamodel"))
    if not role_ids:
        findings.append(_finding(EMPTY_SECTION, "rbac.roles", "rbac has no roles", skill="rbac"))
    if not page_ids:
        findings.append(_finding(EMPTY_SECTION, "page.pages", "page has no pages", skill="page"))

    # 1.5 datamodel 字段语义（加厚 schema 一期，可选字段）：出现即校验、缺省不罚
    #     （老模型零破坏）。enum options：非空、id 非空且唯一、tone ∈ 合法域、
    #     只允许出现在 enum 字段上；format：合法域且与字段类型匹配
    #     （number → money/percent/progress/score/rating；string/text → masked）。
    for entity in _as_list(datamodel.get("entities")):
        ed = _as_dict(entity)
        eid = ed.get("id") or ed.get("name") or "<unnamed>"
        for field in _as_list(ed.get("fields")):
            fd = _as_dict(field)
            fid = fd.get("id") or fd.get("name") or "<unnamed>"
            fpath = f"datamodel.entities[{eid}].fields[{fid}]"
            ftype = str(fd.get("type") or "string").strip().lower()
            if "options" in fd:
                if ftype != "enum":
                    findings.append(_finding(
                        DANGLING, f"{fpath}.options",
                        f"options declared on non-enum field (type '{ftype}')",
                        ref=ftype, skill="datamodel",
                    ))
                opts = [_as_dict(o) for o in _as_list(fd.get("options"))]
                if not opts:
                    findings.append(_finding(
                        EMPTY_SECTION, f"{fpath}.options",
                        "enum options declared but empty", skill="datamodel",
                    ))
                seen_option_ids: set = set()
                for od in opts:
                    oid = str(od.get("id") or "").strip()
                    if not oid:
                        findings.append(_finding(
                            EMPTY_SECTION, f"{fpath}.options",
                            "enum option has no id", skill="datamodel",
                        ))
                        continue
                    if oid in seen_option_ids:
                        findings.append(_finding(
                            DANGLING, f"{fpath}.options",
                            f"duplicate enum option id '{oid}'",
                            ref=oid, skill="datamodel",
                        ))
                    seen_option_ids.add(oid)
                    tone = str(od.get("tone") or "").strip()
                    if tone and tone not in FIELD_TONES:
                        findings.append(_finding(
                            DANGLING, f"{fpath}.options[{oid}].tone",
                            f"option tone '{tone}' is not one of {'/'.join(FIELD_TONES)}",
                            ref=tone, skill="datamodel",
                        ))
            fmt = str(fd.get("format") or "").strip()
            if fmt:
                allowed = (
                    NUMBER_FORMATS if ftype == "number"
                    else STRING_FORMATS if ftype in ("string", "text")
                    else ()
                )
                if fmt not in allowed:
                    findings.append(_finding(
                        DANGLING, f"{fpath}.format",
                        f"field format '{fmt}' is not valid for type '{ftype}'",
                        ref=fmt, skill="datamodel",
                    ))

    # 2. workflow node assigneeRole ∈ rbac.roles — 主链路与附加链路（chains）同一标准
    for chain_path, chain in _iter_workflow_chains(workflow):
        for node in _as_list(chain.get("nodes")):
            nd = _as_dict(node)
            role = str(nd.get("assigneeRole") or "").strip()
            if role and role not in role_ids:
                findings.append(_finding(
                    DANGLING, f"{chain_path}.nodes[{nd.get('id') or nd.get('name')}].assigneeRole",
                    f"workflow node assignee role '{role}' not found in rbac.roles",
                    ref=role, skill="workflow",
                ))

    # 3. page fieldBindings ∈ datamodel fields; actionPermissions ∈ rbac.permissions
    field_types = _collect_field_types(datamodel)
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        pid = pd.get("id") or pd.get("name")
        # 页面范式（加厚 schema 二期，可选字段）：出现即校验、缺省不罚。
        # kind 合法域；kanban 必须带 enum 的 statusField、calendar 必须带
        # date 的 dateField（colorBy 可选但出现必须是 enum 字段）。
        kind = str(pd.get("kind") or "").strip()
        if kind and kind not in PAGE_KINDS:
            findings.append(_finding(
                DANGLING, f"page.pages[{pid}].kind",
                f"page kind '{kind}' is not one of {'/'.join(PAGE_KINDS)}",
                ref=kind, skill="page",
            ))

        def _check_view_binding(key: str, required_type: str, required: bool) -> None:
            ref = str(pd.get(key) or "").strip()
            if not ref:
                if required:
                    findings.append(_finding(
                        EMPTY_SECTION, f"page.pages[{pid}].{key}",
                        f"page kind '{kind}' requires '{key}' (a {required_type} field of this page's entity)",
                        skill="page",
                    ))
                return
            if ref not in field_types:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].{key}",
                    f"page {key} '{ref}' not found in datamodel fields",
                    ref=ref, skill="page",
                ))
            elif field_types[ref] != required_type:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].{key}",
                    f"page {key} '{ref}' must be a {required_type} field (got '{field_types[ref]}')",
                    ref=ref, skill="page",
                ))

        _check_view_binding("statusField", "enum", required=kind == "kanban")
        _check_view_binding("dateField", "date", required=kind == "calendar")
        _check_view_binding("colorBy", "enum", required=False)
        for fb in _as_list(pd.get("fieldBindings")):
            ref = str(fb).strip()
            if ref and ref not in field_refs:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].fieldBindings",
                    f"page field binding '{ref}' not found in datamodel fields",
                    ref=ref, skill="page",
                ))
        for ap in _as_list(pd.get("actionPermissions")):
            ref = str(ap).strip()
            if ref and perm_ids and ref not in perm_ids:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].actionPermissions",
                    f"page action permission '{ref}' not found in rbac.permissions",
                    ref=ref, skill="page",
                ))
        # 库无关图表声明（schema 丰富一期，可选字段）：dimension / sum 指标
        # 必须解析到 datamodel 字段；type 限定在渲染层支持的形态集合。
        for chart in _as_list(pd.get("charts")):
            cd = _as_dict(chart)
            cid = cd.get("id") or cd.get("name") or "<unnamed>"
            ctype = str(cd.get("type") or "").strip()
            if ctype and ctype not in CHART_TYPES:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].charts[{cid}].type",
                    f"chart type '{ctype}' is not one of {'/'.join(CHART_TYPES)}",
                    ref=ctype, skill="page",
                ))
            dim = str(cd.get("dimension") or "").strip()
            if not dim or dim not in field_refs:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].charts[{cid}].dimension",
                    f"chart dimension '{dim or '<missing>'}' not found in datamodel fields",
                    ref=dim, skill="page",
                ))
            metric = str(cd.get("metric") or "").strip()
            if metric.startswith("sum:"):
                mref = metric[4:].strip()
                if mref not in field_refs:
                    findings.append(_finding(
                        DANGLING, f"page.pages[{pid}].charts[{cid}].metric",
                        f"chart sum metric '{mref}' not found in datamodel fields",
                        ref=mref, skill="page",
                    ))
            elif metric and metric != "count":
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].charts[{cid}].metric",
                    f"chart metric '{metric}' must be 'count' or 'sum:<entity.field>'",
                    ref=metric, skill="page",
                ))
        # KPI 统计卡声明（加厚 schema 一期，可选字段）：entity 必须是真实实体；
        # sum/avg 指标必须解析到 datamodel 字段；format 限定渲染层支持的集合。
        for stat in _as_list(pd.get("stats")):
            sd = _as_dict(stat)
            sid = sd.get("id") or sd.get("name") or "<unnamed>"
            entity_ref = str(sd.get("entity") or "").strip()
            if not entity_ref or entity_ref not in entity_ids:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].stats[{sid}].entity",
                    f"stat entity '{entity_ref or '<missing>'}' not found in datamodel entities",
                    ref=entity_ref, skill="page",
                ))
            metric = str(sd.get("metric") or "").strip()
            if metric.startswith("sum:") or metric.startswith("avg:"):
                mref = metric[4:].strip()
                if mref not in field_refs:
                    findings.append(_finding(
                        DANGLING, f"page.pages[{pid}].stats[{sid}].metric",
                        f"stat {metric[:3]} metric '{mref}' not found in datamodel fields",
                        ref=mref, skill="page",
                    ))
            elif metric != "count":
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].stats[{sid}].metric",
                    f"stat metric '{metric or '<missing>'}' must be 'count', 'sum:<entity.field>' or 'avg:<entity.field>'",
                    ref=metric, skill="page",
                ))
            sfmt = str(sd.get("format") or "").strip()
            if sfmt and sfmt not in STAT_FORMATS:
                findings.append(_finding(
                    DANGLING, f"page.pages[{pid}].stats[{sid}].format",
                    f"stat format '{sfmt}' is not one of {'/'.join(STAT_FORMATS)}",
                    ref=sfmt, skill="page",
                ))

    # 4. aigc inputFields/outputField ∈ datamodel fields; roleRefs ∈ rbac.roles
    for cap in _as_list(aigc.get("capabilities")):
        cd = _as_dict(cap)
        cid = cd.get("id") or cd.get("name")
        for fld in _as_list(cd.get("inputFields")) + ([cd.get("outputField")] if cd.get("outputField") else []):
            ref = str(fld).strip()
            if ref and ref not in field_refs:
                findings.append(_finding(
                    DANGLING, f"aigc.capabilities[{cid}].fields",
                    f"aigc field '{ref}' not found in datamodel fields",
                    ref=ref, skill="aigc",
                ))
        for rr in _as_list(cd.get("roleRefs")):
            ref = str(rr).strip()
            if ref and ref not in role_ids:
                findings.append(_finding(
                    DANGLING, f"aigc.capabilities[{cid}].roleRefs",
                    f"aigc role ref '{ref}' not found in rbac.roles",
                    ref=ref, skill="aigc",
                ))

    # 4.5 aigc.pipelines（编排一期，可选段）：步骤必须解析到能力 id；
    #     相邻步字段级衔接——上一步 outputField 必须出现在下一步 inputFields
    #     （编排经数据模型字段接线，这是可校验的硬语义，不是松散文案）。
    cap_by_id: Dict[str, Dict[str, Any]] = {}
    for cap in _as_list(aigc.get("capabilities")):
        cd = _as_dict(cap)
        cid = str(cd.get("id") or "").strip()
        if cid:
            cap_by_id[cid] = cd
    for pipe in _as_list(aigc.get("pipelines")):
        pd = _as_dict(pipe)
        pid = pd.get("id") or pd.get("name") or "<unnamed>"
        steps = [str(s).strip() for s in _as_list(pd.get("steps")) if str(s).strip()]
        if len(steps) < 2:
            findings.append(_finding(
                EMPTY_SECTION, f"aigc.pipelines[{pid}].steps",
                "pipeline needs at least 2 steps (a single capability is not an orchestration)",
                skill="aigc",
            ))
            continue
        resolved = True
        for step in steps:
            if step not in cap_by_id:
                findings.append(_finding(
                    DANGLING, f"aigc.pipelines[{pid}].steps",
                    f"pipeline step '{step}' not found in aigc.capabilities",
                    ref=step, skill="aigc",
                ))
                resolved = False
        if not resolved:
            continue
        for prev_id, next_id in zip(steps, steps[1:]):
            prev_out = str(cap_by_id[prev_id].get("outputField") or "").strip()
            next_inputs = {str(f).strip() for f in _as_list(cap_by_id[next_id].get("inputFields"))}
            if prev_out and prev_out not in next_inputs:
                findings.append(_finding(
                    DANGLING, f"aigc.pipelines[{pid}].steps[{prev_id}→{next_id}]",
                    f"pipeline handoff broken: '{prev_id}' outputField '{prev_out}' "
                    f"is not an inputField of '{next_id}'",
                    ref=prev_out, skill="aigc",
                ))

    # 5. rbac.menus.roleRefs ∈ roles; permissionRefs ∈ permissions
    for menu in _as_list(rbac.get("menus")):
        md = _as_dict(menu)
        mid = md.get("id") or md.get("label")
        for rr in _as_list(md.get("roleRefs")):
            ref = str(rr).strip()
            if ref and ref not in role_ids:
                findings.append(_finding(
                    DANGLING, f"rbac.menus[{mid}].roleRefs",
                    f"menu role ref '{ref}' not found in rbac.roles",
                    ref=ref, skill="rbac",
                ))
        for pr in _as_list(md.get("permissionRefs")):
            ref = str(pr).strip()
            if ref and perm_ids and ref not in perm_ids:
                findings.append(_finding(
                    DANGLING, f"rbac.menus[{mid}].permissionRefs",
                    f"menu permission ref '{ref}' not found in rbac.permissions",
                    ref=ref, skill="rbac",
                ))

    # 6. appbundle: pageRef ∈ pages, workflowRef ∈ workflow, roleRefs ∈ roles, dataModelRefs ∈ entities
    for pb in _as_list(appbundle.get("pageBindings")):
        bd = _as_dict(pb)
        pref = str(bd.get("pageRef") or "").strip()
        if pref and pref not in page_ids:
            findings.append(_finding(
                DANGLING, "appbundle.pageBindings.pageRef",
                f"appbundle pageRef '{pref}' not found in page.pages", ref=pref, skill="appbundle",
            ))
        wref = str(bd.get("workflowRef") or "").strip()
        if wref and wref not in workflow_ids:
            findings.append(_finding(
                DANGLING, "appbundle.pageBindings.workflowRef",
                f"appbundle workflowRef '{wref}' not found in workflow", ref=wref, skill="appbundle",
            ))
    for rr in _as_list(appbundle.get("roleRefs")):
        ref = str(rr).strip()
        if ref and ref not in role_ids:
            findings.append(_finding(
                DANGLING, "appbundle.roleRefs",
                f"appbundle roleRef '{ref}' not found in rbac.roles", ref=ref, skill="appbundle",
            ))
    for dr in _as_list(appbundle.get("dataModelRefs")):
        ref = str(dr).strip()
        if ref and ref not in entity_ids:
            findings.append(_finding(
                DANGLING, "appbundle.dataModelRefs",
                f"appbundle dataModelRef '{ref}' not found in datamodel entities", ref=ref, skill="appbundle",
            ))

    # 6.5 appbundle.appIdentity（E40.2，可选）：应用身份段——产品名 + 主题 +
    #    图标 + 导航形态。老模型没有该字段 → 不罚；出现即校验：三个枚举必须
    #    在真相源账本内（渲染层只认账本值，非法值 = 渲染不出来的假承诺）。
    from .schema_legal import IDENTITY_ICONS, IDENTITY_NAVS, IDENTITY_THEMES

    identity = _as_dict(appbundle.get("appIdentity"))
    if identity:
        for key, legal, label in (
            ("theme", IDENTITY_THEMES, "identity theme"),
            ("icon", IDENTITY_ICONS, "identity icon"),
            ("nav", IDENTITY_NAVS, "identity nav"),
        ):
            value = str(identity.get(key) or "").strip()
            if value and value not in legal:
                findings.append(_finding(
                    DANGLING, f"appbundle.appIdentity.{key}",
                    f"{label} '{value}' is not one of {'/'.join(legal)}",
                    ref=value, skill="appbundle",
                ))
        name = identity.get("productName")
        if name is not None and not str(name).strip():
            findings.append(_finding(
                DANGLING, "appbundle.appIdentity.productName",
                "identity productName must be a non-empty string when declared",
                ref="", skill="appbundle",
            ))

    # 7. appbundle.invariants（改进②，可选）：老模型没有该字段 → 不罚；出现即校验——
    #    refs 必须解析到本模型内的实体/字段/角色/权限/流程节点，systems 必须是已知系统名。
    #    宽泛口号（无 refs）也算失败：不变式的价值就在于可对照模型检查。
    #    落在 appbundle（总装段）而非顶层：随 per-skill 证据通道原样到达客户端。
    known_ref_ids = collect_invariant_ref_ids(m)
    for inv in _as_list(appbundle.get("invariants")):
        iv = _as_dict(inv)
        iid = str(iv.get("id") or iv.get("statement") or "").strip()[:60] or "<unnamed>"
        refs = [str(r).strip() for r in _as_list(iv.get("refs")) if str(r).strip()]
        if not str(iv.get("statement") or "").strip():
            findings.append(_finding(
                EMPTY_SECTION, f"invariants[{iid}].statement",
                "invariant has no statement", skill="invariants",
            ))
        if not refs:
            findings.append(_finding(
                DANGLING, f"invariants[{iid}].refs",
                "invariant has no refs — ungrounded constraints are not checkable",
                skill="invariants",
            ))
        for ref in refs:
            if ref not in known_ref_ids:
                findings.append(_finding(
                    DANGLING, f"invariants[{iid}].refs",
                    f"invariant ref '{ref}' not found in model (entity/field/role/permission/page/workflow node/aigc capability)",
                    ref=ref, skill="invariants",
                ))
        for system in _as_list(iv.get("systems")):
            sname = str(system).strip()
            if sname and sname not in SKILL_KEYS:
                findings.append(_finding(
                    DANGLING, f"invariants[{iid}].systems",
                    f"invariant system '{sname}' is not one of {SKILL_KEYS}",
                    ref=sname, skill="invariants",
                ))

    return {"passed": len(findings) == 0, "findings": findings}
