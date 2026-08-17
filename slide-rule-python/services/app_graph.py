# -*- coding: utf-8 -*-
"""把五系统模型摊成一张**显式的图**：谁引用谁（2026-08-17）。

## 为什么要有它

这个系统的核心不是那几页 HTML。HTML 是木偶——只有样子，自己不会动，
既读不了数据也写不了。真正让它动起来的是**数据模型 + 权限 + 工作流**：
它们不在页面上，却伸进页面的每一处，决定哪里显示什么、谁能点、点了走到哪。

这张网本来就存在，只是**一直是隐式的**：它散落在 `v5_model_gate` 的十几处
DANGLING 检查里——闸每次都在走这些边，走完就丢，没人把图本身拿出来用。
于是"改了这一块，还牵扯到哪些东西"这个问题，在代码里问不出来。

本模块把边显式化。它不新增任何规则，**只是把闸已经在走的边摆到台面上**。

## ⚠ 节点必须带 kind 前缀

实体 `order` 和页面 `order` 在各自的域里都合法，裸 id 会**悄悄合并成一个
节点**——那种错在图上看不出来，只会让影响面算错。所以一律
`entity:order` / `page:p1` / `role:mgr` / `perm:order:read` / `wf:n1` /
`aigc:c1` / `field:order.amount`。

## ⚠ 无界闭包会吞掉整个**连通分量**，所以必须限跳数

原本我写的是"这张网强连通，无界闭包必然覆盖全图"。**写判据一验就翻了**：
订单页出发走十二跳只覆盖 11/15 个节点，客户那一簇（`entity:cust` /
`field:cust.phone` / `perm:cust:read` / `page:p2`）一个都够不着——两簇之间
没有共享的字段、权限或角色。

所以准确的说法是：**图按实体簇天然分块，簇内连通、簇间隔离**。
无界闭包吞掉的是整个连通分量，不是全图。

这反而是影响分析真正的价值所在——改订单页无论走多少跳都碰不到客户那一簇，
那一簇本来就不该重算。而簇**内部**确实连通，改一个字段无界扩散会把这一簇
整个卷进来，所以 `impacted_closure` 仍然强制要传跳数：
"牵扯到什么"这句话在图上**只有带半径才有意义**。

## 边的方向：引用者 → 被引用者

    page:p1        → field:order.amount     （页面绑了这个字段）
    page:p1        → perm:order:read        （这一页上的动作要这个权限）
    wf:n1          → role:mgr               （这个节点派给这个角色）
    aigc:c1        → field:order.amount     （能力吃这个字段）
    perm:order:read→ entity:order           （权限属于这个实体）
    field:o.amount → entity:order           （字段属于这个实体）

于是两个方向各有各的问法：

    顺着边走（dependencies）：这个东西**依赖**谁 —— 我改了它，我引的还在吗
    逆着边走（dependents）  ：谁**依赖**这个东西 —— 我改了它，谁会被弄坏
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


def _as_dict(x: Any) -> Dict[str, Any]:
    return x if isinstance(x, dict) else {}


def _as_list(x: Any) -> List[Any]:
    return x if isinstance(x, list) else []


def _sid(kind: str, ident: Any) -> str:
    return f"{kind}:{ident}"


def build_app_graph(model: Dict[str, Any]) -> Dict[str, Any]:
    """五系统模型 → `{"nodes": {id: {kind, name}}, "edges": [(src, dst, label)]}`。

    ⚠ 节点集**复用 v5_model_gate 的 collector**，不在这里另抄一份 id 提取逻辑。
      两份提取迟早漂移，而漂移的表现是"图上少了个点，影响面算漏了"——
      没有任何一处会报错。本仓在「修复器认 AIGC 能力 id、门禁不认」上
      栽过一次同款（见 _resolvable_refs 的注释）。
    """
    from .v5_model_gate import (
        _collect_aigc_capability_ids,
        _collect_datamodel_field_refs,
        _collect_page_ids,
        _collect_permission_ids,
        _collect_role_ids,
        _collect_workflow_ids,
    )

    m = _as_dict(model)
    datamodel, rbac = _as_dict(m.get("datamodel")), _as_dict(m.get("rbac"))
    workflow, page = _as_dict(m.get("workflow")), _as_dict(m.get("page"))
    aigc, appbundle = _as_dict(m.get("aigc")), _as_dict(m.get("appbundle"))

    nodes: Dict[str, Dict[str, Any]] = {}
    edges: List[Tuple[str, str, str]] = []

    def add_node(kind: str, ident: Any, name: Any = None) -> Optional[str]:
        if ident is None or str(ident).strip() == "":
            return None
        nid = _sid(kind, ident)
        if nid not in nodes:
            nodes[nid] = {"kind": kind, "name": str(name) if name else str(ident)}
        elif name and nodes[nid]["name"] == str(ident):
            nodes[nid]["name"] = str(name)
        return nid

    def add_edge(src: Optional[str], dst: Optional[str], label: str) -> None:
        # ⚠ 只连**两端都在图里**的边。指向不存在的 id 是悬空引用，那是闸的活
        #   （DANGLING），不是图的活。在这里悄悄补一个节点会把"引用坏了"
        #   变成"图上多一个孤点"，把真问题藏起来。
        if src and dst and src in nodes and dst in nodes:
            edges.append((src, dst, label))

    # ── 点 ──────────────────────────────────────────────────────────
    for e in _as_list(datamodel.get("entities")):
        ed = _as_dict(e)
        add_node("entity", ed.get("id"), ed.get("name"))
        for f in _as_list(ed.get("fields")):
            fd = _as_dict(f)
            if ed.get("id") and fd.get("id"):
                add_node("field", f"{ed['id']}.{fd['id']}", fd.get("name"))
    for r in _as_list(rbac.get("roles")):
        rd = _as_dict(r)
        add_node("role", rd.get("id") if rd else r, rd.get("name") if rd else None)
    for p in _collect_permission_ids(rbac):
        add_node("perm", p)
    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        add_node("page", pd.get("id"), pd.get("name"))
    for n in _as_list(workflow.get("nodes")):
        nd = _as_dict(n)
        add_node("wf", nd.get("id"), nd.get("name"))
    for c in _as_list(aigc.get("capabilities")):
        cd = _as_dict(c)
        add_node("aigc", cd.get("id"), cd.get("name"))

    # ── 边 ──────────────────────────────────────────────────────────
    # 字段 → 所属实体；权限 → 所属实体（权限形如 `<实体id>:<动作>`）
    for nid, meta in list(nodes.items()):
        if meta["kind"] == "field":
            ent = nid.split(":", 1)[1].split(".", 1)[0]
            add_edge(nid, _sid("entity", ent), "belongs_to")
        elif meta["kind"] == "perm":
            ent = nid.split(":", 1)[1].split(":", 1)[0]
            add_edge(nid, _sid("entity", ent), "on_entity")

    for p in _as_list(page.get("pages")):
        pd = _as_dict(p)
        pid = _sid("page", pd.get("id"))
        for fb in _as_list(pd.get("fieldBindings")):
            add_edge(pid, _sid("field", fb), "binds_field")
        for ap in _as_list(pd.get("actionPermissions")):
            add_edge(pid, _sid("perm", ap), "needs_perm")

    for n in _as_list(workflow.get("nodes")):
        nd = _as_dict(n)
        add_edge(_sid("wf", nd.get("id")), _sid("role", nd.get("assigneeRole")), "assigned_to")

    for c in _as_list(aigc.get("capabilities")):
        cd = _as_dict(c)
        cid = _sid("aigc", cd.get("id"))
        for fb in _as_list(cd.get("inputFields")):
            add_edge(cid, _sid("field", fb), "reads_field")
        out = cd.get("outputField")
        if out:
            add_edge(cid, _sid("field", out), "writes_field")
        for rr in _as_list(cd.get("roleRefs")):
            add_edge(cid, _sid("role", rr), "for_role")

    for pb in _as_list(appbundle.get("pageBindings")):
        bd = _as_dict(pb)
        pid = _sid("page", bd.get("pageRef"))
        add_edge(pid, _sid("wf", bd.get("workflowRef")), "drives_workflow")
    for rr in _as_list(appbundle.get("roleRefs")):
        add_edge(_sid("role", rr), _sid("role", rr), "bundled")  # 自环：只为标记它在册

    return {"nodes": nodes, "edges": edges}


def _adjacency(graph: Dict[str, Any]) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
    fwd: Dict[str, Set[str]] = {}
    rev: Dict[str, Set[str]] = {}
    for src, dst, _label in graph.get("edges") or []:
        if src == dst:
            continue  # 自环不参与传播，否则闭包里全是它自己
        fwd.setdefault(src, set()).add(dst)
        rev.setdefault(dst, set()).add(src)
    return fwd, rev


def impacted_closure(
    graph: Dict[str, Any],
    seeds: Iterable[str],
    *,
    hops: int,
    direction: str = "both",
) -> Set[str]:
    """从 seeds 出发走 `hops` 跳，返回**受影响的节点集合**（含 seeds 本身）。

    `direction`：

        "dependents"    只逆着边走 —— 谁依赖我。改了我，**谁会被弄坏**
        "dependencies"  只顺着边走 —— 我依赖谁。改了我，**我引的还在吗**
        "both"          两边都走

    ⚠ `hops` **是必填的**，不给默认值。这张网强连通，无界闭包最后必然
      覆盖全图——那时"影响面"等于"全部"，跟不做影响分析没区别。
      "牵扯到什么"这句话在图上只有带半径才有意义。

    ⚠ 不在图里的 seed 直接忽略，不报错也不硬塞。硬塞会让一个拼错的 id
      变成一个孤立节点，闭包算出来只有它自己，看起来像"影响面很小"——
      那是最坏的一种错：**看着正常**。
    """
    if hops < 0:
        raise ValueError("hops 不能是负数")
    nodes = graph.get("nodes") or {}
    fwd, rev = _adjacency(graph)
    frontier = {s for s in seeds if s in nodes}
    seen: Set[str] = set(frontier)
    for _ in range(hops):
        nxt: Set[str] = set()
        for n in frontier:
            if direction in ("both", "dependencies"):
                nxt |= fwd.get(n, set())
            if direction in ("both", "dependents"):
                nxt |= rev.get(n, set())
        nxt -= seen
        if not nxt:
            break
        seen |= nxt
        frontier = nxt
    return seen


def segments_touched(graph: Dict[str, Any], node_ids: Iterable[str]) -> Set[str]:
    """一批节点落在哪几个五系统段上。

    这是把图上的结论**翻回段的语言**——精修沿用、判作用域那些地方问的
    还是"哪几段要重新生成"。
    """
    kind_to_segment = {
        "entity": "datamodel",
        "field": "datamodel",
        "role": "rbac",
        "perm": "rbac",
        "page": "page",
        "wf": "workflow",
        "aigc": "aigc",
    }
    nodes = graph.get("nodes") or {}
    out: Set[str] = set()
    for nid in node_ids:
        meta = nodes.get(nid)
        if meta:
            seg = kind_to_segment.get(meta["kind"])
            if seg:
                out.add(seg)
    return out
