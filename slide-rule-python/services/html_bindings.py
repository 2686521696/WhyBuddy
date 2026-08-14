"""第 6.5 步：给第 3 步那批 HTML 打上 data-* 绑定孔。

## 这一步为什么在这儿，不在第 3 步

第 3 步的头注写死了分工：

    第 3 步只出版式，洞留到第 6 步模型出来之后再打。

理由是它当时**打不了**：datamodel 还不存在，写 `data-field="vehicle.plate"`
是在引用一个还没被发明的 id，校验不了；而校验不了的绑定就是下一个 DANGLING
（旧模板库那些指向组件夹具的绑定，丢进真实话题必被结构闸拦下——本仓踩过）。

现在打得成：实体、字段、页面、角色、权限都在第 4~6 步定死并校验过了。

## 它取代的是什么

⚠ 新链路上 `enrich_freeform_blocks` / `enrich_monitor_page_overviews`
**不跑**。那两步存在的理由是「AI 不知道这一页该长什么样」，所以让它画一棵
自由树；而第 3 步已经出了真 HTML，问题不存在了。给它们补 stats/charts 好让
它们重新发明一遍版式，是把新链路的产出扔掉再走老路。

    老链路   一句话 → 五模型 → freeform 树（现画版式）→ 渲染
    新链路   spec → HTML（真版式）→ 反推模型 → **给 HTML 打孔** → 渲染

## 词汇照 docs/绑定契约草案-v1.md

那份草案把三种载体收成一套词汇，HTML 这一列就是下面这些。不自创：

    <tbody data-rows="vehicle" data-sort="created_at" data-order="desc" data-limit="8">
        逐行容器，第一个子元素是一行的模板
    <td data-field="plate">                     取当前行的某个字段
    <span data-value="vehicle" data-aggregate="count">   单值（聚合）
    <div data-chart="donut" data-entity="vehicle" data-dimension="status" data-metric="count">
    <button data-action="openRecord" data-entity="vehicle">   动作

G/G2 两组实验已经验过这套跑得通（G2「加字段自动多列」三份全过），
解释器原型在 experiments/visual-first/g2_render_test.mjs。

## 判据：作用域，不只是存在性

`data-field` 光"是个真字段"不够——它必须是**所在 data-rows 那个实体的**字段。
拿工单表里的一行去取客户的字段，字段是真的，取出来的是别人的数据。
这条跟自由树的 `rowsRef`/`fieldRef` 树级校验同一个口径（services/
freeform_block.py 的 check_field_refs_scoped），不另发明。
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

HTML_BINDINGS_VERSION = "html-bindings-v1"

#: 动作封闭词表——**Python 侧唯一一份**（2026-08-14 晚收拢）：
#: freeform_block.ActionRef 直接查这里校验，不再手抄第二份 Literal。
#: 跟前端 html-binding-runtime 的 ACTION_KINDS 一字不差，跨语言看门测试钉着
#: ——词表分叉就是下一个对不齐的地方。
#:
#: 总表由两个子表组合而成，每个词只出现一次（之前总表和转移子表重叠手写）。

#: 记录三种（openRecord/editRecord 要"当前行"）。
RECORD_ACTION_KINDS: tuple[str, ...] = ("createRecord", "openRecord", "editRecord")

#: 转移三种（2026-08-14 晚，权限 + 工作流那两只手伸进 HTML 页）：
#: 把当前行提交进审批流 / 通过 / 驳回。校验时要求：行内 + 模型真的声明了
#: 工作流——流程实例挂在具体那条记录上（entityRef），页头没有"当前行"可提交。
WORKFLOW_ACTION_KINDS: tuple[str, ...] = (
    "submitWorkflow", "approveWorkflow", "rejectWorkflow",
)

ACTION_KINDS: tuple[str, ...] = RECORD_ACTION_KINDS + WORKFLOW_ACTION_KINDS

AGGREGATES: tuple[str, ...] = ("count", "sum", "avg")

_TAG = re.compile(r"<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>")
_ATTR = re.compile(r'data-([a-z]+)="([^"]*)"')


class HtmlBindingsError(RuntimeError):
    """打孔失败。**不回落**——半套绑定比没有绑定更难查。"""


def _attrs(tag_body: str) -> Dict[str, str]:
    return {k: v for k, v in _ATTR.findall(tag_body)}


def scan_bindings(markup: str) -> List[Dict[str, Any]]:
    """扫出所有带 data-* 的标签，并算出每个标签所处的 data-rows 作用域。

    作用域靠一个标签栈算：进 `<tbody data-rows="vehicle">` 就压栈，
    遇到它的闭合标签就弹栈。**自闭合标签不压栈**（`<td ... />` 这种）。
    """
    out: List[Dict[str, Any]] = []
    stack: List[tuple[str, Optional[str]]] = []
    pos = 0
    text = markup or ""
    void = {"br", "hr", "img", "input", "meta", "link", "source", "col"}

    for m in re.finditer(r"<(/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*?)(/?)>", text):
        closing, tag, body, selfclose = m.group(1), m.group(2).lower(), m.group(3), m.group(4)
        if closing:
            while stack and stack[-1][0] != tag:
                stack.pop()
            if stack:
                stack.pop()
            continue
        attrs = _attrs(body)
        scope = next((s for _, s in reversed(stack) if s), None)
        if any(k in attrs for k in ("rows", "field", "value", "action", "chart", "fields")):
            out.append({"tag": tag, "attrs": attrs, "scope": scope, "pos": m.start()})
        if tag not in void and not selfclose:
            stack.append((tag, attrs.get("rows")))
        pos = m.end()
    del pos
    return out


def check_bindings(markup: str, model: Dict[str, Any]) -> List[Dict[str, str]]:
    """每个 data-* 都要指到真东西，且 data-field 必须在所在列表的作用域内。"""
    entities = {e["id"]: {f["id"] for f in e["fields"]} for e in model["datamodel"]["entities"]}
    problems: List[Dict[str, str]] = []

    for node in scan_bindings(markup):
        a, tag = node["attrs"], node["tag"]

        ent = a.get("rows") or a.get("value") or a.get("entity")
        if ent and ent not in entities:
            problems.append({
                "path": f"<{tag} data-*>",
                "message": f"实体 '{ent}' 不存在。真实实体：{sorted(entities)}",
            })

        if "field" in a:
            scope = node["scope"]
            if not scope:
                problems.append({
                    "path": f"<{tag} data-field={a['field']}>",
                    "message": "写在 data-rows 容器外面——没有「当前行」，取不到东西",
                })
            elif scope in entities and a["field"] not in entities[scope]:
                problems.append({
                    "path": f"<{tag} data-field={a['field']}>",
                    "message": f"'{a['field']}' 不是 '{scope}' 的字段"
                               f"（拿这张表的行去取别的表的字段，取出来是别人的数据）",
                })

        if "aggregate" in a:
            agg = a["aggregate"].split(":")[0]
            if agg not in AGGREGATES:
                problems.append({
                    "path": f"<{tag} data-aggregate={a['aggregate']}>",
                    "message": f"聚合只能是 {list(AGGREGATES)}",
                })

        if "action" in a:
            if a["action"] not in ACTION_KINDS:
                problems.append({
                    "path": f"<{tag} data-action={a['action']}>",
                    "message": f"动作只能是 {list(ACTION_KINDS)}",
                })
            if not a.get("entity"):
                problems.append({
                    "path": f"<{tag} data-action={a['action']}>",
                    "message": "带了 data-action 却没有 data-entity，不知道操作哪张表",
                })
            elif (
                a["action"] in ("openRecord", "editRecord") + WORKFLOW_ACTION_KINDS
                and not node["scope"]
            ):
                problems.append({
                    "path": f"<{tag} data-action={a['action']}>",
                    "message": f"{a['action']} 要「当前这一行」，必须写在 data-rows 容器内部",
                })
            if a["action"] in WORKFLOW_ACTION_KINDS and not (
                (model.get("workflow") or {}).get("nodes")
            ):
                problems.append({
                    "path": f"<{tag} data-action={a['action']}>",
                    "message": "这个应用没有声明工作流，转移动作无处可去",
                })

        if "chart" in a:
            dim, e2 = a.get("dimension"), a.get("entity")
            if e2 in entities and dim and dim not in entities[e2]:
                problems.append({
                    "path": f"<{tag} data-chart>",
                    "message": f"维度 '{dim}' 不是 '{e2}' 的字段",
                })
    return problems


def check_coverage(markup: str, model: Dict[str, Any]) -> List[Dict[str, str]]:
    """打完孔的页面得**真的能取到数**，不是打了几个孔就算数。

    ⚠ 这条守的是今天反复出现的那个形状：**闸全绿、东西没做**。
    一份一个孔都没打的 HTML，上面 check_bindings 会返回空列表（没有绑定
    就没有错误的绑定），看起来完美通过。
    """
    nodes = scan_bindings(markup)
    if not nodes:
        return [{"path": "page", "message": "整页一个 data-* 绑定都没有——渲染出来还是死的静态页"}]
    kinds = {k for n in nodes for k in n["attrs"] if k in ("rows", "value", "chart")}
    if not kinds:
        return [{"path": "page", "message": "只有 data-field/data-action，没有任何数据源"
                                            "（data-rows / data-value / data-chart），取不到数"}]
    return []


_SYSTEM = "你是前端工程师。只输出改造后的完整 HTML 文件内容，不要解释、不要 markdown 围栏。"


def build_prompt(markup: str, model: Dict[str, Any], page_id: str, feedback: str = "") -> List[Dict[str, str]]:
    import json as _json

    slim = {
        e["id"]: {f["id"]: f"{f.get('name')}({f.get('type')})" for f in e["fields"]}
        for e in model["datamodel"]["entities"]
    }
    fb = f"\n\n⚠ 上一版没通过机械校验，**只改这些地方**：\n{feedback.strip()}\n" if feedback.strip() else ""

    # 转移动作段：只有模型真的声明了工作流才出现——没有流程的应用里
    # 提这三个词，等于诱导 LLM 打出无处可去的按钮（校验器必拦，白耗重问）。
    wf_nodes = (model.get("workflow") or {}).get("nodes") or []
    wf_bound_pages = sorted({
        str(b.get("pageRef"))
        for b in ((model.get("appbundle") or {}).get("pageBindings") or [])
        if b.get("workflowRef") and b.get("pageRef")
    })
    if wf_nodes:
        node_names = "、".join(str(n.get("name") or n.get("id")) for n in wf_nodes[:6])
        this_page_bound = page_id in wf_bound_pages
        wf_section = f"""
    <button data-action="submitWorkflow" data-entity="<实体id>">
        把当前行提交进审批流。**必须写在 data-rows 容器内部**。
    <button data-action="approveWorkflow" / "rejectWorkflow" data-entity="<实体id>">
        通过 / 驳回当前行的流程。同样必须在行内。

本应用的审批流节点：{node_names}。绑定了流程的页面：{wf_bound_pages or '（无）'}。
{'这一页绑定了流程：列表行内适合加「提交审批」，审批处理视图适合加通过/驳回。'
 if this_page_bound else
 '⚠ 这一页没有绑定流程，**不要**使用上面三种转移动作。'}"""
    else:
        wf_section = ""

    body = f"""把下面这份**静态**页面改造成由数据驱动的模板。

版式一个像素都不要改：不增删元素、不改文案、不动 class。**只往标签上加
data-* 属性**，把写死的示例数据换成绑定孔。

绑定词汇（必须一字不差）：

    <tbody data-rows="<实体id>" data-sort="<字段id>" data-order="desc" data-limit="8">
        逐行容器。里面**只留一行**当模板，其余示例行删掉。
    <td data-field="<字段id>">
        取当前行的某个字段。**只能是所在 data-rows 那个实体的字段**——
        拿这张表的行去取别的表的字段，取出来是别人的数据。
    <span data-value="<实体id>" data-aggregate="count">
        单值。aggregate 可以是 count / sum:<字段id> / avg:<字段id>。
    <div data-chart="donut" data-entity="<实体id>" data-dimension="<字段id>" data-metric="count">
    <button data-action="openRecord" data-entity="<实体id>">
        记录动作三种：createRecord（不需要当前行）/ openRecord / editRecord。
        后两种要"当前这一行"，**必须写在 data-rows 容器内部**。{wf_section}

这个应用真实的实体与字段（**只能用这些 id，一个都不许新造**）：
{_json.dumps(slim, ensure_ascii=False, indent=1)}

硬性要求：

1. 这一页至少要有一个数据源（data-rows / data-value / data-chart），
   否则渲染出来还是一张死的静态页。
2. 表格、列表这类逐行内容一律用 data-rows + data-field；KPI 数字用 data-value。
3. 纯装饰文字（标题、说明、页脚）**不要绑定**。
4. 挑不到合适字段的地方就不绑，**不要造一个看着像的 id**。
{fb}
=== 页面 {page_id} 的 HTML ===
{markup}"""
    return [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": body}]


def _strip_fences(text: str) -> str:
    t = re.sub(r"^```(?:html)?\s*", "", (text or "").strip())
    t = re.sub(r"\s*```$", "", t)
    i = t.lower().find("<!doctype")
    if i < 0:
        i = t.lower().find("<html")
    return t[i:] if i > 0 else t


def bind_page(
    markup: str,
    model: Dict[str, Any],
    page_id: str,
    *,
    llm_call: Optional[Callable[..., Any]] = None,
    max_reask: int = 2,
) -> str:
    """给一页打孔。校验不过就把校验器原话喂回去重问，耗尽则抛。"""
    from .spec_page_html import validate_page_html

    if llm_call is None:
        from sliderule_llm.client import call_llm_with_retry

        def llm_call(messages, **kwargs):  # type: ignore[misc]
            return call_llm_with_retry(messages, max_attempts=3, backoff_ms=2000, **kwargs)

    feedback, last = "", "未调用"
    for attempt in range(max_reask + 1):
        resp = llm_call(build_prompt(markup, model, page_id, feedback), temperature=0.2)
        out = _strip_fences(getattr(resp, "content", "") or "")
        problems = (
            [{"path": "html", "message": p} for p in validate_page_html(out)]
            + check_bindings(out, model)
            + check_coverage(out, model)
        )
        if not problems:
            return out
        last = "；".join(f"{p['path']}：{p['message']}" for p in problems[:8])
        if attempt == max_reask:
            break
        feedback = last
    raise HtmlBindingsError(f"页面 {page_id} 打孔失败（重问 {max_reask} 次后）：{last}")


def bind_pages(
    pages_html: Dict[str, str],
    model: Dict[str, Any],
    *,
    max_workers: int = 6,
    llm_call: Optional[Callable[..., Any]] = None,
) -> Dict[str, Any]:
    """并发给每一页打孔。**单页失败不拖垮整批**（写法同 spec_page_html）。"""
    if not pages_html:
        return {"pages": {}, "failed": {}}
    from concurrent.futures import ThreadPoolExecutor, as_completed

    ok: Dict[str, str] = {}
    failed: Dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(max_workers, len(pages_html))) as pool:
        fut_to_id = {
            pool.submit(bind_page, html, model, pid, llm_call=llm_call): pid
            for pid, html in pages_html.items()
        }
        # ⚠ **as_completed，不是按提交顺序 `for pid, fut in futures`。**
        #
        # 这一条是 spec_page_html 已经付过学费的（那边注释里记着实测：
        # 五页分散在 347/347/348/369/369s 好，按提交顺序等就变成"憋着不动、
        # 然后哗啦一下全出来"）。这里 2026-08-14 复核时还留着老写法。
        #
        # ⚠ 对**总时长没有影响**——两种写法都要等全部完成。改它是因为这一步
        #   迟早要加「打好孔的页先亮起来」那种逐页回调（第 3 步的 on_page
        #   就是干这个的），到那时这一行会让所有回调堆到最后一起触发：
        #   **接线全通、判据全绿，效果被一行遍历顺序抵消掉**。趁现在起雷。
        #
        # ⚠ 代价与那边同源：产出顺序不再是页面顺序。ok 是 dict 不是 list，
        #   下游按 page_id 取；真正在乎顺序的导航由 page_shell 按 spec.pages
        #   重排（见 unify_shell），不靠这里。
        for fut in as_completed(fut_to_id):
            pid = fut_to_id[fut]
            try:
                ok[pid] = fut.result()
            except Exception as exc:  # noqa: BLE001 — 单页失败不拖垮整批
                failed[pid] = str(exc)[:200]
                print(f"[html_bindings] 页面 {pid} 打孔失败：{str(exc)[:160]}")
    return {"version": HTML_BINDINGS_VERSION, "pages": ok, "failed": failed}
