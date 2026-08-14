"""第 3 步：SPEC 的每一页 → HTML（直出，不经图）。

## 这一步在链路里的位置

    1 澄清+缺口+证据    ✅ 现成能力
    2 起草 SPEC         ✅ services/spec_tree.py
    3 **本文件**：spec 的每一页 → HTML
    4 HTML → 实体/字段/关联/页面结构
    5 (第4步产物 + SPEC) → 权限/工作流/不变式
    6 汇合 → 五系统模型 → 结构闸 → 设计

## 为什么不经图（2026-08-13 定）

原方案在这里插了两跳：按页写出图提示词 → 并发生图 → 图转 HTML。
实测把它砍了。**这个结论出现过两次，第一次不算数**，差别写在
docs/SlideRule V6.0 架构图.md 的 ⚑3：第一次 V 路的出图提示词是让一个 LLM
改写出来的（本仓记录过那种改写会掉东西），分辨率也只有 1536x1024，图转 HTML
更是随手写的一句，判据还是我自己造的数——那是拿一条被削弱的路去比。

第二次把 V 路修到它最好的状态（spec 确定性模板填空、2560x1440、图转 HTML 抄
screenshot-to-code 原版且带 detail:high），判据换成**渲染出来用眼睛看**
（渲染器本身也修过一轮，见 experiments/visual-first/render_pages.cjs）。
同条件下无图仍然更好，用户裁决：「很明显，是无图的生成的效果好」。

省下的是每轮约 120s 出图 + N 倍的图钱。

## 为什么这里**不**打 data-* 接线孔

08-12 写过一份 HTML 载体（backup/2026-08-12-before-revert 的
services/overview_html.py），带 data-fact / data-field / data-chart / data-rows
四种洞，运行时按 schema 填。那份是**下游版**：它的 `build_overview_facts(page,
datamodel)` 和 `_validate_rows` 都要拿 datamodel 去校验洞指向的实体字段存不存在。

第 3 步在上游，**datamodel 还不存在**——它要到第 4 步才从这份 HTML 反推出来。
这里写 `data-field="resident.name"` 是在引用一个还没被发明的 id，校验不了，
而校验不了的绑定就是下一个 DANGLING（这个形状仓里踩过：旧模板库那些指向
组件夹具的绑定，丢进真实话题必被结构闸拦下）。

所以分工是：**第 3 步只出版式，洞留到第 6 步模型出来之后再打。**

## 口径抄 screenshot-to-code 的 create/text.py，不自己另发明

抄的是 `Generate UI for {…}` + 栈 + design_system 块 + 三条 Instructions。
今天的教训正是「自己随手写一套」会让整轮对照失去意义——那条纪律写在
experiments/visual-first/runner.py:220：用成熟工具跑，被测的那条路才是在它
最好的状态下被测。这里同理：这一步现在是主链路，更不该用手写版。
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional

SPEC_PAGE_HTML_VERSION = "spec-page-html-v1"

#: 技术栈约束。逐字抄 screenshot-to-code backend/prompts/system_prompt.py 的
#: Tailwind 段 + create/text.py 的 build_selected_stack_policy。
#: ⚠ Tailwind 走 CDN，**渲染这份 HTML 的一方必须自己解决拿不到 CDN 的情况**
#:   （见 render_pages.cjs 那段：容器里 Chromium 出不了网，不本地喂就是零 CSS，
#:   而零 CSS 的页面看起来像"模型画坏了"——今天差点拿那批废图下结论）。
_STACK = (
    "Selected stack: html_tailwind.\n"
    "Use this script to include Tailwind: "
    '<script src="https://cdn.tailwindcss.com"></script>\n'
    "Return ONLY the full HTML file content. No explanation, no markdown fences."
)

#: design_system 块。走它 build_design_system_prompt_block 的形状（含冲突时的
#: 优先级声明），内容换成本仓的两条老经验：
#:   · 占位必须是**看得见的可读中文**——「不许用灰条/色块/留空」这条在参照图那边
#:     早就有（freeform_block.py:1224），改两段式时漏掉过一次，实测灰条当场复发
#:   · 表头要中文显示名——SAFEREND 那条同源（此前表头直接甩 lot_code / frozen）
_DESIGN_SYSTEM = """## Design system

If the design system conflicts with other instructions, prioritize the design system.

<design_system>
企业后台风格，浅色底，左侧固定菜单 + 顶部面包屑。占位数据必须写成**可读的中文文字**，
不许用灰色横条或色块代替：日期写 20XX-XX-XX，金额写 ¥ ××,×××，百分比写 ××.×%，
计数写 ×,×××，人名写「张师傅」这类。表格要有真实的中文列名。
</design_system>"""


class SpecPageHtmlError(RuntimeError):
    """这一步失败就如实失败，不回落占位。

    理由跟 spec_tree 那次同源：一份看起来像那么回事的假产物比没有更糟——
    它会让下游以为上游是厚的，而且**没有任何一处会发现它是假的**。
    """


def build_page_brief(page: Dict[str, Any], spec: Dict[str, Any]) -> str:
    """把 spec 的一页摊成自然语言，喂给出 HTML 的那一步。

    只用 spec 里**这一页真的覆盖到**的需求节点（coversNodes），不把整棵树倒进去：
    倒整棵树会让每一页都长得一样，而 spec 的页面清单本来就是按职责切好的。
    """
    by_id = {str(n.get("id")): n for n in (spec.get("nodes") or [])}
    lines = [
        f"页面：{page.get('name', '')}",
        f"使用者：{page.get('audience', '')}",
        f"用途：{page.get('purpose', '')}",
        "这一页要承载的需求：",
    ]
    for ref in page.get("coversNodes") or []:
        node = by_id.get(str(ref))
        if not node:
            continue
        detail = node.get("acceptance") or node.get("notes") or ""
        lines.append(f"- {node.get('title', '')}：{detail}")
    return "\n".join(lines)


def build_page_html_prompt(brief: str) -> str:
    """create/text.py 的 USER_PROMPT，逐字对齐（image policy 取 disabled 那一支）。"""
    return f"""Generate UI for {brief}.
{_STACK}
{_DESIGN_SYSTEM}

# Instructions

- Make sure to make it look modern and sleek.
- Use modern, professional fonts and colors.
- Follow UX best practices.
- Image generation is disabled for this request. Do not call generate_images. \
Use provided media, CSS effects, or placeholder URLs (https://placehold.co)."""


def _strip_fences(text: str) -> str:
    out = re.sub(r"^```(?:html)?\s*", "", (text or "").strip())
    out = re.sub(r"\s*```$", "", out)
    low = out.lower()
    idx = low.find("<!doctype")
    if idx < 0:
        idx = low.find("<html")
    return out[idx:] if idx > 0 else out


#: 一份能用的页面至少要有的东西。**每一条都能机械判**，没有「看着够不够丰富」
#: 这种判断——今天在这上面栽过三次（数字段 / 数语义标签 / 拿坏渲染器截图）。
#: ⚠ 这里刻意**不判丰富度**：丰富度得渲染出来用眼睛看，机械判据只负责挡住
#:   「明显不是一份完整页面」的东西。
def validate_page_html(markup: str) -> List[str]:
    problems: List[str] = []
    text = markup or ""
    low = text.lower()
    if "<html" not in low:
        problems.append("不是一份完整 HTML 文档（找不到 <html>）")
    if "</html>" not in low:
        # 截断是这条链上真实发生过的失败形态：推理模型思考吃光 max_tokens，
        # 正文写一半就停，而 finish_reason 不会喊。收尾标签是最便宜的判据。
        problems.append("HTML 没有收尾（找不到 </html>），多半是被截断了")
    if "cdn.tailwindcss.com" not in low:
        problems.append("没有引入 Tailwind，栈约束没被遵守")
    if not re.search(r"[一-鿿]", text):
        problems.append("整页没有一个中文字符，占位文案没按设计系统写")
    # 「只示意不写真实数据」的反面：模型有时会返回一段解释再跟 HTML
    if low.strip().startswith(("here", "sure", "好的", "以下")):
        problems.append("正文前面带了解释性文字，没有按要求只返回 HTML")
    return problems


def generate_page_html(
    page: Dict[str, Any],
    spec: Dict[str, Any],
    *,
    llm_call: Optional[Callable[..., Any]] = None,
    max_attempts: int = 2,
) -> Dict[str, Any]:
    """一页 spec → 一份 HTML。失败抛 SpecPageHtmlError，**不回落占位**。

    返回 {"version", "pageId", "html", "brief", "prompt"}。
    """
    brief = build_page_brief(page, spec)
    prompt = build_page_html_prompt(brief)
    if llm_call is None:
        # ⚠ 用带重试的那个，不是裸 call_llm（2026-08-13 修）。
        #
        # 病灶：真机跑六页时一次 httpx.RemoteProtocolError（网关断开）就把
        # **整轮**打死了——前面那 70 秒的 SPEC 白跑。而那是个瞬时错误，
        # 重跑一次就好。
        #
        # 下面 max_attempts 那个循环治的是**校验不过**（HTML 被截断、没引
        # Tailwind…），跟网络断开是两回事：网络类错误连 HTML 都没拿到，
        # 拿什么去校验？两者混在一个计数里，等于一次网络抖动就吃掉一次
        # 宝贵的重问额度。
        #
        # 仓里现成的 call_llm_with_retry 已经把这件事分好了：LlmError 带
        # transient 标志（429/524/5xx/连接断开为 True，401/404 为 False），
        # 只对瞬时错误重试，还带 gRPC hedging 语义治长尾慢请求。
        # ⚠ 所以**不引 tenacity / backoff**：那会是个新依赖，且只覆盖重试
        # 不覆盖对冲，比现有的弱。
        from sliderule_llm.client import call_llm_with_retry

        def llm_call(messages, **kwargs):  # type: ignore[misc]
            return call_llm_with_retry(messages, max_attempts=3, backoff_ms=2000, **kwargs)

    last: List[str] = []
    for _ in range(max(1, max_attempts)):
        response = llm_call(
            [
                {"role": "system", "content": "You are an expert at building front-ends."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
        )
        html = _strip_fences(getattr(response, "content", "") or "")
        last = validate_page_html(html)
        if not last:
            return {
                "version": SPEC_PAGE_HTML_VERSION,
                "pageId": str(page.get("id") or ""),
                "html": html,
                "brief": brief,
                "prompt": prompt,
            }
    raise SpecPageHtmlError(
        f"页面 {page.get('id')} 的 HTML 未通过校验：{'；'.join(last)}"
    )


def generate_pages_parallel(
    spec: Dict[str, Any],
    *,
    max_workers: int = 6,
    llm_call: Optional[Callable[..., Any]] = None,
    on_page: Optional[Callable[[str, str, int, int], None]] = None,
) -> Dict[str, Any]:
    """把 spec 的每一页并发生成 HTML。**单页失败不拖垮整批。**

    ## 为什么要有这个函数

    调用方原本自己写 `pool.map(lambda pg: generate_page_html(pg, spec), pages)`
    ——`pool.map` 的语义是**任何一个 worker 抛异常，整个迭代就抛**。六页里挂
    一页，另外五页的成果一起丢，而它们已经烧掉了几分钟。页数越多越容易踩：
    六页比三页翻倍。

    写法照 `freeform_block.refine_sheet_prompts_parallel`（本仓已有的同型
    并发批量）：逐个 future 取结果，失败的位置单独记账，不抛。

    ## 跟 fail-open 的区别

    这里**不 fail-open**。失败的页不产出占位 HTML，而是如实记进 `failed`，
    由调用方决定是整轮停还是带着缺页往下走——第 4 步那条页面覆盖判据会发现
    缺页（喂几份出几页），所以缺页不会被静默吞掉。

    ## on_page：一页好了就交出去，别等整批

    `on_page(page_id, html, done, total)` 每落地一页调一次。有它是因为这一步
    是整条链上**第一个产出可以直接看的东西**的地方——一份能独立打开的 HTML，
    比模型早四五分钟。攒齐再交等于把这四五分钟白白变成转圈。

    ⚠ 回调里的异常**吞掉不外抛**：它是"顺带推给前端看"，不是产出的一部分。
    让一个 UI 推送失败去打死已经生成好的页面，是拿次要的东西赔主要的。
    （同款判断见 app_preview.OverviewPreviewSink：出图失败是 fail-open 的
    正常结局，调用方不需要为此加判断。）

    返回 {"pages": {pageId: html}, "failed": {pageId: 原因}}。
    """
    pages = list(spec.get("pages") or [])
    if not pages:
        return {"pages": {}, "failed": {}}

    from concurrent.futures import ThreadPoolExecutor, as_completed

    ok: Dict[str, str] = {}
    failed: Dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=min(max_workers, len(pages))) as pool:
        # ⚠ **as_completed，不是按提交顺序 for fut in futures。** 这条是真机
        #   量出来的（2026-08-14，宠物医院一轮）：
        #
        #       [347s] p1  [347s] p2  [348s] p3   ← 三页挤在同一秒
        #       [369s] p4  [369s] p5              ← 又两页挤在一起
        #
        #   五页是并发跑的，可 `fut.result()` **按提交顺序阻塞**：p1 慢，
        #   p2/p3 早就好了也得等它。用户看到的就是"画完了才一起显示"，
        #   而 on_page 这个 sink 存在的全部意义正是"一页好了就交出去"——
        #   接线全通、判据全绿，效果被一行遍历顺序抵消掉。
        #
        #   ⚠ 代价是**产出顺序不再是 spec 的页面顺序**。ok 是 dict 不是 list，
        #     下游按 page_id 取，所以不受影响；真正在乎顺序的是导航，而导航由
        #     page_shell 按 spec.pages 重排（见 unify_shell）——不靠这里。
        fut_to_id = {
            pool.submit(generate_page_html, pg, spec, llm_call=llm_call): str(pg.get("id") or "")
            for pg in pages
        }
        total = len(fut_to_id)
        done = 0
        for fut in as_completed(fut_to_id):
            page_id = fut_to_id[fut]
            done += 1
            try:
                html = fut.result()["html"]
                ok[page_id] = html
                if on_page is not None:
                    try:
                        on_page(page_id, html, done, total)
                    except Exception as sink_exc:  # noqa: BLE001 — 见 docstring
                        print(f"[spec_page_html] 页面回调失败（不影响产出）：{str(sink_exc)[:120]}")
            except Exception as exc:  # noqa: BLE001 — 单页失败不拖垮整批
                failed[page_id] = str(exc)[:200]
                print(f"[spec_page_html] 页面 {page_id} 生成失败：{str(exc)[:160]}")
    return {"pages": ok, "failed": failed}
