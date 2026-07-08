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
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        pid = pd.get("id") or pd.get("name")
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

    # 7. appbundle.invariants（改进②，可选）：老模型没有该字段 → 不罚；出现即校验——
    #    refs 必须解析到本模型内的实体/字段/角色/权限/流程节点，systems 必须是已知系统名。
    #    宽泛口号（无 refs）也算失败：不变式的价值就在于可对照模型检查。
    #    落在 appbundle（总装段）而非顶层：随 per-skill 证据通道原样到达客户端。
    known_ref_ids = field_refs | role_ids | perm_ids | page_ids | workflow_ids
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
                    f"invariant ref '{ref}' not found in model (entity/field/role/permission/page/workflow node)",
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
