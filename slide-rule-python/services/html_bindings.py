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
        逐行容器，带 data-field / data-cell 的子元素是一行的模板。
        当前时间线、absolute 装饰不是模板（2026-08-31 会聚通：把 now-line
        放成第一个子元素，运行时按实体数克隆红线、房间行被擦掉）。
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

#: 整页「能取到数」的数据源。check_coverage / 提示词硬性要求 / 前端
#: hasAnyDataSource 必须认同一份——漏一个，那种页打对了孔也会被判死。
#:
#: ⚠ 2026-08-15 加了 data-record（详情卡/表单/向导），scan 和 check_bindings
#:   都认了，check_coverage 还只认 rows/value/chart。真机 CareBridge /
#:   妇幼保健站 p2：表单只有 field+createRecord，或按第 2 条写了 data-record，
#:   覆盖闸一律「没有任何数据源」，重问 2 次仍挂。前端徽标同一漏。
DATA_SOURCE_KEYS: tuple[str, ...] = ("rows", "record", "value", "chart")

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
        if any(k in attrs for k in ("rows", "record", "field", "value", "action", "chart", "fields")):
            out.append({"tag": tag, "attrs": attrs, "scope": scope, "pos": m.start()})
        if tag not in void and not selfclose:
            # ⚠ `data-record` 与 `data-rows` **同样开作用域**（2026-08-15）。
            #   照 petite-vue：它的 v-scope 和 v-for 走同一个
            #   createScopedContext（walk.ts:44 / for.ts:105），差别只在要不要
            #   循环。我们原来只认 rows，于是详情卡没有合法写法——真机上模型
            #   把 data-field 打在容器外面，重问两次都改不对，整页 bind 失败。
            stack.append((tag, attrs.get("rows") or attrs.get("record")))
        pos = m.end()
    del pos
    return out


def check_bindings(markup: str, model: Dict[str, Any]) -> List[Dict[str, str]]:
    """每个 data-* 都要指到真东西，且 data-field 必须在所在列表的作用域内。"""
    entities = {e["id"]: {f["id"] for f in e["fields"]} for e in model["datamodel"]["entities"]}
    problems: List[Dict[str, str]] = []

    for node in scan_bindings(markup):
        a, tag = node["attrs"], node["tag"]

        # ⚠ record 也要算：漏了它 `data-record="不存在的实体"` 会静默放行，
        #   然后运行时取不到数据、页面一片空白而没有任何一处报错。
        ent = a.get("rows") or a.get("record") or a.get("value") or a.get("entity")
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
                    "message": "写在作用域外面——没有「当前这条」，取不到东西。"
                               "列表用 data-rows，单条记录（详情卡/表单）用 data-record",
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
    kinds = {k for n in nodes for k in n["attrs"] if k in DATA_SOURCE_KEYS}
    if not kinds:
        sources = " / ".join(f"data-{k}" for k in DATA_SOURCE_KEYS)
        return [{"path": "page", "message": (
            "只有 data-field/data-action，没有任何数据源"
            f"（{sources}），取不到数。"
            "表单/向导用 data-record，列表用 data-rows，不要只打动作孔。"
        )}]
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

先分清这两个——**它们是「要不要循环」的差别，不是「能不能取字段」的差别**：

    <tbody data-rows="<实体id>" data-sort="<字段id>" data-order="desc" data-limit="8">
        **列表**：逐行容器。里面**只留一行**当模板，其余示例行删掉。
        ⚠ 那一行必须带着 data-field / data-cell。当前时间线、absolute
        定位装饰、pointer-events-none 遮罩都不是行模板——留在容器里当
        兄弟，不要放成第一个子元素，也不要当成「只留一行」里的那一行。
    <div data-record="<实体id>">
        **单条**：详情卡、主从视图的右侧面板、编辑表单、"当前选中那条"的
        摘要区——这些地方**不要循环**，用它开一个作用域就行。
        想指定是哪一条加 data-record-id="<行id>"，不写就是第一条。

    <td data-field="<字段id>">
        取**当前作用域**那条记录的字段。作用域可以是一行（data-rows），
        也可以是一条记录（data-record），两种写法完全一样。
        ⚠ 字段必须属于开作用域的那个实体——拿这张表的行去取别的表的字段，
          取出来是别人的数据。
        ⚠ **两个作用域都不在里面就不要写 data-field**：没有"当前这条"，
          取不到东西。这种地方要么套一个 data-record，要么干脆不绑。
    <span data-value="<实体id>" data-aggregate="count">
        单值。aggregate 可以是 count / sum:<字段id> / avg:<字段id>。
    <div data-chart="donut" data-entity="<实体id>" data-dimension="<字段id>" data-metric="count">
    <button data-action="openRecord" data-entity="<实体id>">
        记录动作三种：createRecord（不需要当前行）/ openRecord / editRecord。
        后两种要"当前这一行"，**必须写在 data-rows 容器内部**。{wf_section}

这个应用真实的实体与字段（**只能用这些 id，一个都不许新造**）：
{_json.dumps(slim, ensure_ascii=False, indent=1)}

硬性要求：

1. 这一页至少要有一个数据源（{" / ".join(f"data-{k}" for k in DATA_SOURCE_KEYS)}），
   否则渲染出来还是一张死的静态页。
2. 挑容器：**多条**用 data-rows，**一条**用 data-record，**聚合数字**用 data-value。
   判断方法：这块地方在页面上会不会重复出现多份？会 → data-rows；
   只有一份、展示某一个对象 → data-record；是个统计数 → data-value。
3. 纯装饰文字（标题、说明、页脚）**不要绑定**。
4. 挑不到合适字段的地方就不绑，**不要造一个看着像的 id**。
5. 这是客户自己的产品：**不许**往页面里加你（生成方）的名字、品牌、域名或
   联系方式，也不许加任何新的外部网址。原页面的品牌与页脚原样保留。
   ⚠ 真机踩过：打完孔的页脚变成了「© 2024 欧亿智能… 唯一官方: https://www.rcouyi.com」。
6. 原页面里带 ``hidden`` / ``aria-hidden="true"`` / ``data-state="closed"`` 的
   浮层，打孔时**不许剥掉**，也不许改成看得见的右侧「编辑表单」面板。
   打开态抽屉关不掉，脚本已经被摘了。
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


_FORM_OPEN = re.compile(r"<form\b([^>]*)>", re.I)
_FORM_CLOSE = re.compile(r"</form>", re.I)
_ENTITY_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
_WRITE_ENTITY_A = re.compile(
    r'data-action="(?:createRecord|editRecord)"[^>]*data-entity="([^"]+)"'
)
_WRITE_ENTITY_B = re.compile(
    r'data-entity="([^"]+)"[^>]*data-action="(?:createRecord|editRecord)"'
)


def stamp_implicit_form_record(markup: str) -> str:
    """给漏写 ``data-record`` 的表单盖上单条作用域。

    对照三处成熟口径，不自创「表单要不要有数据源」：

    - WHATWG HTML **form owner**：控件归属于最近的 ``<form>``，表单本身
      就是一条记录的容器（html.spec.whatwg.org/#form-owner）。
    - HTMX：``hx-post`` 挂在 form 上，表单是请求单元，不必再套一层
      列表作用域（bigskysoftware/htmx）。
    - petite-vue：``<div v-scope>`` **可以省略值**，仍然
      ``createScopedContext``（walk.ts）——作用域在，数据从父级/表单来。

    ⚠ 只在能 **fail-closed** 推出唯一实体时盖：表单里恰好一个
    createRecord/editRecord 的 data-entity，且有 data-field。
    两个实体或只有动作孔 → 不猜，交给覆盖闸拦。
    已经写了 data-record / data-rows 的表单不动。
    """
    text = markup or ""
    if not text or "<form" not in text.lower():
        return text

    pieces: List[str] = []
    pos = 0
    for open_m in _FORM_OPEN.finditer(text):
        attrs = _attrs(open_m.group(1))
        if "rows" in attrs or "record" in attrs:
            continue
        close_m = _FORM_CLOSE.search(text, open_m.end())
        if not close_m:
            continue
        inner = text[open_m.end() : close_m.start()]
        if re.search(r"<form\b", inner, re.I):
            continue
        entities = set(_WRITE_ENTITY_A.findall(inner)) | set(_WRITE_ENTITY_B.findall(inner))
        form_ent = attrs.get("entity")
        if form_ent:
            if entities and form_ent not in entities:
                continue
            entities = {form_ent} | entities
        if len(entities) != 1 or "data-field=" not in inner:
            continue
        ent = next(iter(entities))
        if not _ENTITY_ID.match(ent):
            continue
        pieces.append(text[pos:open_m.start()])
        pieces.append(f"<form{open_m.group(1)} data-record=\"{ent}\">")
        pos = open_m.end()
    if not pieces:
        return text
    pieces.append(text[pos:])
    return "".join(pieces)


def bind_page(
    markup: str,
    model: Dict[str, Any],
    page_id: str,
    *,
    llm_call: Optional[Callable[..., Any]] = None,
    max_reask: int = 2,
) -> str:
    """给一页打孔。校验不过就把校验器原话喂回去重问，耗尽则抛。"""
    from .spec_page_html import neutralize_foreign_urls, validate_page_html

    if llm_call is None:
        from sliderule_llm.client import call_llm_with_retry

        def llm_call(messages, **kwargs):  # type: ignore[misc]
            return call_llm_with_retry(messages, max_attempts=3, backoff_ms=2000, **kwargs)

    feedback, last = "", "未调用"
    for attempt in range(max_reask + 1):
        resp = llm_call(build_prompt(markup, model, page_id, feedback), temperature=0.2)
        out = neutralize_foreign_urls(
            stamp_implicit_form_record(_strip_fences(getattr(resp, "content", "") or ""))
        )
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
        # ⚠ 同 model_assembly 那条：重问留痕。这一步真机跑过 50s 与 102s
        #   两种，差一倍而日志说不出是重问还是上游慢。
        print(f"[html_bindings] 页面 {page_id} 重问第 {attempt + 1} 次：{last[:200]}")
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
