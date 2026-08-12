"""首页总览的 **HTML 载体**（2026-08-12）。

## 为什么换载体

现在这条路的产物是受限 JSON 节点树：11 个标签、54 条样式属性、4 种图表。
它比想象中能打——真跑一趟健身房话题，69 个节点画出了逐行列表 + 3 张 KPI +
4 步流程条 + 3 个图表，密度接近参照图。但天花板是实打实的：

    没有 table/thead/tr/td          表格只能用 div 拼个样子
    没有 img（除一个字面量）        头像、缩略图、封面出不来
    图表只有 bar/line/pie/donut     雷达、漏斗、仪表盘、热力条没有
    没有 transform/gridColumn/…     流程连接线、跨格布局做不了

这些不是提示词能补的，是词汇表里没有。换成 HTML，天花板一次性消失。

## 但换载体不能把保证一起换掉

这条链路最硬的一条纪律是**数字不能编**：受限树里每个数字必须挂 `dataRef`，
由运行时从真实行现算，LLM 写死的字面量会被 `check_numbers_grounded` 打回重问。
纯 HTML 一放开，这道闸就没了——我用原型验证过，第一次跑 LLM 自己算的
「处理中工单」就是 0，而同一页的环图从同一份数据算出 5，**同一页自相矛盾**。

所以这里的设计是：**HTML 只负责版式，一个数字都不写。**

    数字   <span data-fact="today_appointments"></span>   运行时填
    图表   <div data-chart="c_status" style="height:260px"></div>  运行时挂

HTML 里根本不出现数字，也就无从写错；数据变了页面跟着变。这跟 `dataRef` 是
同一条纪律的同一个形状——声明"要哪个数"，而不是"数是多少"。

## 校验也用同一把尺

"这段文字是不是在声称一个算出来的数" 这个判断，复用 `freeform_block` 里那个
`_NUMERIC_CLAIM_RES_MATCH`——它已经按真实误伤调过（「Top 5 客户」「2026 年度」
这类结构性数字放过）。换个载体不该换个判据，否则两边迟早漂。
"""

from __future__ import annotations

import html
import os
import re
from typing import Any, Dict, List, Optional, Tuple


class OverviewHtmlError(RuntimeError):
    """HTML 总览生成/校验失败（调用方应退回受限树那条路）。"""


#: 产物体量上限。参照原型：一页密集型总览约 10~20KB；给到 60KB 留足余量，
#: 再多基本是模型在灌重复样式，不如打回重问。
MAX_HTML_BYTES = 60_000

#: 开关。默认**关**——新旧两条路并存，出问题能立刻切回去，不是单向门。
_ENABLE_ENV = "SLIDERULE_OVERVIEW_HTML"


def overview_html_enabled() -> bool:
    return os.getenv(_ENABLE_ENV, "").strip().lower() in ("1", "true", "yes", "on")


# ── 事实与图表的声明 ────────────────────────────────────────────────────

def build_overview_facts(page: Dict[str, Any], datamodel: Dict[str, Any]) -> List[Dict[str, Any]]:
    """把这一页声明的 stats 翻成"可引用的事实"清单。

    只做**声明**不做计算——算数在运行时，跟 `dataRef` 完全一样的分工。
    `format` 从被聚合字段的声明里抄过来，运行时据此补 % / ¥ / 分。
    """
    entities = {e.get("id"): e for e in (datamodel.get("entities") or []) if e.get("id")}

    def field_of(entity_id: str, field_id: str) -> Dict[str, Any]:
        for f in (entities.get(entity_id) or {}).get("fields") or []:
            if f.get("id") == field_id:
                return f
        return {}

    facts: List[Dict[str, Any]] = []
    for stat in page.get("stats") or []:
        sid = str(stat.get("id") or "").strip()
        entity = str(stat.get("entity") or "").strip()
        if not sid or entity not in entities:
            continue
        metric = str(stat.get("metric") or "count").strip()
        prefix, _, mref = metric.partition(":")
        field_id = mref.rpartition(".")[2] if mref else ""
        facts.append({
            "id": sid,
            "label": str(stat.get("name") or sid),
            "entityRef": entity,
            "aggregate": "count" if prefix == "count" or not mref else f"{prefix}:{field_id}",
            "format": str(field_of(entity, field_id).get("format") or "") if field_id else "",
        })
    return facts


def build_overview_charts(page: Dict[str, Any], datamodel: Dict[str, Any]) -> List[Dict[str, Any]]:
    """这一页声明的 charts → 可引用的图表位清单。"""
    entity_ids = {e.get("id") for e in (datamodel.get("entities") or []) if e.get("id")}
    out: List[Dict[str, Any]] = []
    for chart in page.get("charts") or []:
        cid = str(chart.get("id") or "").strip()
        dim = str(chart.get("dimension") or "")
        entity = dim.partition(".")[0]
        if not cid or entity not in entity_ids:
            continue
        out.append({
            "id": cid,
            "title": str(chart.get("name") or cid),
            "type": str(chart.get("type") or "bar"),
            "entityRef": entity,
            "dimensionFieldId": dim.rpartition(".")[2],
            "metric": str(chart.get("metric") or "count"),
        })
    return out


# ── 校验 ────────────────────────────────────────────────────────────────

_SCRIPTISH_RE = re.compile(
    r"<\s*(script|iframe|object|embed|link|meta|base|form)\b"
    r"|\son[a-z]+\s*="
    r"|javascript\s*:",
    re.I,
)
#: 外链：任何 http(s):// 或协议相对 //host，无论出现在 src/href/url() 里。
#: 出口策略会挡外链，而且一个 CDN 字体就能让整页版式在离线环境塌掉。
_EXTERNAL_URL_RE = re.compile(r"""(?:src|href)\s*=\s*["']?\s*(?:https?:)?//""", re.I)
_CSS_EXTERNAL_RE = re.compile(r"""(?:url\(|@import)\s*["']?\s*(?:https?:)?//""", re.I)

_TAG_RE = re.compile(r"<[^>]+>")
_DATA_FACT_RE = re.compile(r"""data-fact\s*=\s*["']([^"']+)["']""", re.I)
_DATA_CHART_RE = re.compile(r"""data-chart\s*=\s*["']([^"']+)["']""", re.I)
_STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>.*?</style>", re.I | re.S)


def _text_nodes(markup: str) -> List[str]:
    """粗取文本节点。`<style>` 整段先挖掉——CSS 里的数字（`12px`）不是数据声明。"""
    body = _STYLE_BLOCK_RE.sub(" ", markup)
    return [
        html.unescape(chunk).strip()
        for chunk in _TAG_RE.split(body)
        if chunk and chunk.strip()
    ]


def validate_overview_html(
    markup: str,
    facts: List[Dict[str, Any]],
    charts: List[Dict[str, Any]],
) -> List[str]:
    """返回问题清单；空列表 = 通过。**问题要说得够具体，能直接回喂 reask。**"""
    problems: List[str] = []
    if not markup.strip():
        return ["产物为空"]
    if len(markup.encode("utf-8")) > MAX_HTML_BYTES:
        problems.append(
            f"HTML 超过 {MAX_HTML_BYTES} 字节上限（{len(markup.encode('utf-8'))}）——"
            "把重复的行内样式收进 <style> 里的类"
        )

    if _SCRIPTISH_RE.search(markup):
        problems.append(
            "出现了 script/iframe/on* 事件/javascript: —— 这一层不执行任何脚本，"
            "数字用 data-fact、图表用 data-chart，运行时会填"
        )
    if _EXTERNAL_URL_RE.search(markup) or _CSS_EXTERNAL_RE.search(markup):
        problems.append("引用了外部资源（CDN/字体/图片）—— 一个外链都不允许，离线也要能看")

    known_facts = {f["id"] for f in facts}
    for ref in set(_DATA_FACT_RE.findall(markup)):
        if ref not in known_facts:
            problems.append(
                f"data-fact=\"{ref}\" 不在事实清单里；可用的是：{sorted(known_facts) or '(无)'}"
            )
    known_charts = {c["id"] for c in charts}
    for ref in set(_DATA_CHART_RE.findall(markup)):
        if ref not in known_charts:
            problems.append(
                f"data-chart=\"{ref}\" 不在图表清单里；可用的是：{sorted(known_charts) or '(无)'}"
            )

    # 数字不能编：判据跟受限树那条路同一个函数，不另写一套
    from .freeform_block import _NUMERIC_CLAIM_RES_MATCH

    for text in _text_nodes(markup):
        if _NUMERIC_CLAIM_RES_MATCH(text):
            problems.append(
                f"文字里写死了数据声明「{text[:40]}」——具体数值只能来自真实数据，"
                "改成 <span data-fact=\"…\"></span>，标签文字放在相邻节点"
            )
            break  # 一条足够说明问题，不刷屏

    # 声明了却一个都没用上：这一页的内容清单是过了门禁的，漏掉就是少画东西
    used_facts = set(_DATA_FACT_RE.findall(markup))
    missing = known_facts - used_facts
    if missing:
        problems.append(f"这些 KPI 一个都没画：{sorted(missing)} —— 清单里的不能漏")
    missing_charts = known_charts - set(_DATA_CHART_RE.findall(markup))
    if missing_charts:
        problems.append(f"这些图表一个都没画：{sorted(missing_charts)} —— 清单里的不能漏")

    return problems


# ── 生成 ────────────────────────────────────────────────────────────────

def build_overview_html_prompt(
    design_brief: str,
    datamodel: Dict[str, Any],
    facts: List[Dict[str, Any]],
    charts: List[Dict[str, Any]],
    *,
    has_reference_image: bool,
) -> str:
    entity_lines = []
    for e in datamodel.get("entities") or []:
        fs = ", ".join(
            f'{f.get("id")}:{f.get("type")}'
            + (f'({f.get("format")})' if f.get("format") else "")
            for f in (e.get("fields") or [])
        )
        entity_lines.append(f'- {e.get("id")}「{e.get("name")}」: {fs}')

    fact_lines = [
        f'- data-fact="{f["id"]}" → 「{f["label"]}」'
        + (f'（{f["format"]}）' if f["format"] else "")
        for f in facts
    ]
    chart_lines = [
        f'- data-chart="{c["id"]}" → 「{c["title"]}」（{c["type"]} 图）'
        for c in charts
    ]

    ref_note = (
        "版式布局、卡片大小关系、密度、配色、圆角与留白节奏**照参考图还原**。"
        "图上的具体数字只是占位假象，一个都不能抄。\n"
        if has_reference_image
        else ""
    )

    return f"""{design_brief}

{ref_note}把这一页写成**一段 HTML**。

## 数据模型（只有这些实体和字段真实存在）
{chr(10).join(entity_lines)}

## 可以引用的数字（**只有这些**）
{chr(10).join(fact_lines) or "（这一页没有 KPI）"}

## 可以摆的图表（**只有这些**）
{chr(10).join(chart_lines) or "（这一页没有图表）"}

## 硬性要求

1. **只输出 HTML**，从 `<div class="ov-root">` 到对应的 `</div>`。不要 markdown 围栏、不要解释。
2. **一个数字都不要写。** 要显示某个 KPI 就摆一个空占位：
   `<span data-fact="xxx"></span>`，运行时会把真实数值（含单位）填进去。
   标签文字（「今日预约」）写在**相邻**节点里，不要写进占位标签内部。
3. **图表也只摆位置**：`<div data-chart="xxx" style="height:260px"></div>`，
   给一个明确高度，运行时会把真实图挂上去。不要自己写图表数据。
4. 样式写在开头一个 `<style>` 里，用**类名**组织，别把几十条样式全塞进 style 属性。
   类名统一加 `ov-` 前缀，避免跟外壳撞。
5. **零外链**：不许 CDN、不许 Google Fonts、不许外部图片、不许 `@import`。
6. **不许 `<script>`、不许 `on*` 事件属性**——这一层不执行任何脚本。
7. 这段 HTML 会嵌进一个**已经有左侧导航、顶栏和页面标题**的外壳里。
   只画内容区，不要再写页面级大标题，也不要自己搭导航。
8. 深浅色都要能看：颜色用 CSS 变量定义，`@media (prefers-color-scheme: dark)` 里换一套。
9. 目标观感：信息密度高的中文 B2B 后台总览。多栏栅格、状态用色块标签、
   表格紧凑、留白克制。不要营销落地页那一套（Hero/CTA/大标题）。

现在输出那段 HTML。"""


def _strip_fence(text: str) -> str:
    t = (text or "").strip()
    if t.startswith("```"):
        t = t.split("```", 2)[1]
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    return t.strip()


def generate_overview_html(
    design_brief: str,
    datamodel: Dict[str, Any],
    page: Dict[str, Any],
    *,
    reference_image_b64: Optional[str] = None,
    max_retries: int = 2,
    max_tokens: int = 20000,
    temperature: float = 0.7,
) -> Tuple[str, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """生成 + 校验一页总览 HTML。返回 (html, facts, charts)。

    校验不过就把**上次输出 + 具体问题**拼回去重问，跟受限树那条路同一套 reask
    语义。重试耗尽抛 `OverviewHtmlError`，调用方退回受限树——不能让这个新载体
    把一次本来能出总览的生成拖垮。
    """
    from sliderule_llm.client import LlmError, call_llm_with_retry

    facts = build_overview_facts(page, datamodel)
    charts = build_overview_charts(page, datamodel)
    prompt = build_overview_html_prompt(
        design_brief, datamodel, facts, charts,
        has_reference_image=bool(reference_image_b64),
    )

    if reference_image_b64:
        content: Any = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{reference_image_b64}"},
            },
        ]
    else:
        content = prompt

    convo: List[Dict[str, Any]] = [{"role": "user", "content": content}]
    last = "unknown"
    for _attempt in range(max_retries + 1):
        try:
            result = call_llm_with_retry(
                convo,
                max_attempts=2,
                backoff_ms=2000,
                temperature=temperature,
                max_tokens=max_tokens,
                on_delta=lambda _c: None,
            )
        except LlmError as exc:
            last = f"llm error: {str(exc)[:200]}"
            continue

        markup = _strip_fence(result.content or "")
        problems = validate_overview_html(markup, facts, charts)
        if not problems:
            return markup, facts, charts
        last = "；".join(problems[:4])
        convo = convo + [
            {"role": "assistant", "content": markup[:6000]},
            {
                "role": "user",
                "content": (
                    "你上次的输出有这些问题：\n"
                    + "\n".join(f"- {p}" for p in problems[:6])
                    + "\n重新输出完整的 HTML，只要那一段。"
                ),
            },
        ]

    raise OverviewHtmlError(f"{max_retries + 1} 次都没通过校验，最后一次：{last}")
