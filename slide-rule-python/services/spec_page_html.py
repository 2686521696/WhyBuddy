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

import os
import re
import time
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

这是**客户自己的产品**。页脚、logo、版权行、关于页里不许出现你（生成方）的名字、
品牌、域名或联系方式；除了上面指定的 Tailwind CDN 与 placehold.co，不要写任何
外部网址。产品名要从客户的业务里起，不要用你自己的名字。
</design_system>"""

#: 移动端（竖屏 1080×1920）的设计系统。壳的形状是**硬约束**，不是风格偏好：
#: 第 3.5 步 page_shell 要按它抠壳统一——桌面抠 <aside>+<header>，移动抠
#: <header>+页面级 <nav>（底部标签栏）。这里不写成 <nav>，3.5 就没得抠，
#: 菜单一致性那套判据对移动端整个失效。占位数据纪律与桌面同一份。
_DESIGN_SYSTEM_MOBILE = """## Design system

If the design system conflicts with other instructions, prioritize the design system.

<design_system>
移动端 App 风格（竖屏手机，视口 1080×1920），浅色底，单列布局。
顶部一个 <header>（左侧产品名，右侧当前登录角色），
底部一个固定的 <nav> 标签栏（bottom tab bar，每个页面入口是一个 <a>，图标在上文字在下）。
**不要左侧边栏（不要 <aside>）**，内容区是可上下滚动的单列卡片流。
触控目标要够大（按钮/列表项高度 ≥ 88px 视觉高度），正文字号偏大。
占位数据必须写成**可读的中文文字**，不许用灰色横条或色块代替：
日期写 20XX-XX-XX，金额写 ¥ ××,×××，百分比写 ××.×%，计数写 ×,×××，
人名写「张师傅」这类。列表要有真实的中文字段名。

这是**客户自己的产品**。页脚、logo、版权行、关于页里不许出现你（生成方）的名字、
品牌、域名或联系方式；除了上面指定的 Tailwind CDN 与 placehold.co，不要写任何
外部网址。产品名要从客户的业务里起，不要用你自己的名字。
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


def build_page_html_prompt(brief: str, *, device: str = "desktop") -> str:
    """create/text.py 的 USER_PROMPT，逐字对齐（image policy 取 disabled 那一支）。

    device（2026-08-14 晚加）：`"phone"` 时换移动端设计系统（竖屏 1080×1920、
    顶栏 + 底部标签栏、无侧栏）。词表沿用 device_policy 的 Device
    （"desktop"/"phone"），不另发明。
    """
    design = _DESIGN_SYSTEM_MOBILE if device == "phone" else _DESIGN_SYSTEM
    return f"""Generate UI for {brief}.
{_STACK}
{design}

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


#: 提示词里**明确要求或允许**的外部主机。只有这三类：
#:   · cdn.tailwindcss.com —— 栈约束点名要引的
#:   · placehold.co        —— 抄 screenshot-to-code 的 image policy 里写的占位图
#:   · fonts.google*       —— 「用现代专业字体」这条的常见实现；渲染器本来就 abort 它，
#:                            放进白名单纯粹是别让它变成噪音告警
_ALLOWED_HOSTS = (
    "cdn.tailwindcss.com",
    "placehold.co",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
)

#: 模型供应商自己的身份。这几个词出现在**客户的交付物**里永远是错的。
#: ⚠ 真机原文（2026-08-15，连锁药房那趟 p3 页脚）：
#:     © 2024 欧亿智能库存效期管理系统 | 全局同步延迟 < 1s | 唯一官方: https://www.rcouyi.com
#:   同一天还见过它拿这个名字当产品名：欧亿智造系统 / 欧亿口腔 / 欧亿医疗连锁。
#:   根源是中转站往请求里注入的人设（跟 agentic-pick 那次寒暄同源），
#:   只是这次泄漏到了产出里。
_VENDOR_IDENTITY = ("欧亿", "ouyi", "rcouyi")

#: 图标/组件库的公共 CDN。**不是品牌泄漏**，是依赖选择。
#: ⚠ 实测：35 份真机产出里，cdnjs 出现在 14 份、unpkg 出现在 3 份。
#:   把它们当硬失败等于每页都要重问，整步必挂——这条判据本身会变成事故。
_COMMON_CDN_HOSTS = ("cdnjs.cloudflare.com", "unpkg.com", "cdn.jsdelivr.net")

#: XML 命名空间**不是链接**。`xmlns="http://www.w3.org/2000/svg"` 是每个内联
#: SVG 都有的东西，扫 URL 时必须先排掉——第一版没排，真机 35 页里当场误报。
_XMLNS_RE = re.compile(r'xmlns(?::\w+)?\s*=\s*["\'][^"\']*["\']')

_URL_RE = re.compile(r"https?://([A-Za-z0-9.-]+)")


def scan_foreign_references(markup: str) -> List[str]:
    """扫产出里的**外部链接**与**模型供应商身份**。

    ## 为什么要有这条

    真机（连锁药房，2026-08-15）：模型把中转站自己的域名写进了客户的页脚。
    这跟外壳漂移不是一个量级——那是排版问题，这是**交付物里混进了第三方的
    品牌与链接**，直接发给客户就是事故。

    ## ⚠ 只拦两类，不拦「品牌名」本身

    这条**刻意不做**通用的品牌词过滤。同一天的产出里有
    士卓曼 (Straumann BLT)、诺贝尔 (Nobel Biocare)、Bio-Oss 骨粉、
    瑞士ITI种植体——那些是**正确的领域细节**，是这个模型最值钱的地方，
    拦掉就把好东西一起杀了。

    所以判据收窄成两条机械可判的：
      ① 白名单之外的外部主机（提示词只授权了 tailwind CDN 和 placehold.co）
      ② 模型供应商自己的身份（欧亿 / OuYi / rcouyi）——这个在客户产品里
        没有任何正当出现的理由

    ## ⚠ 分两档，因为上线前量了 35 份真机产出：**94% 会命中**

    第一版把所有命中都当阻断，等于每页都要重问、整步必挂——**这条判据本身
    会变成事故**（同 120s 落后者截止线那次：拿一批数据推的阈值套到另一批上）。
    拆开看三类性质完全不同：

      · `www.w3.org`                 内联 SVG 的 xmlns，**纯误报**，先抠掉再扫
      · cdnjs / unpkg                图标库 CDN，35 份里 17 份有。是**依赖选择**，
                                     不是品牌泄漏 → 只提醒，不阻断
      · 欧亿 / rcouyi.com            **真事故** → 阻断

    返回 (阻断项, 提醒项)。**只有阻断项进 validate_page_html。**
    """
    text = markup or ""
    blocking: List[str] = []
    notes: List[str] = []

    # ⚠ 先把 xmlns 抠掉再扫 URL，否则每个内联 SVG 都误报 w3.org。
    scannable = _XMLNS_RE.sub("", text)
    hosts = {
        host
        for host in _URL_RE.findall(scannable)
        if not any(host == a or host.endswith("." + a) for a in _ALLOWED_HOSTS)
    }
    cdn = sorted(
        h for h in hosts if any(h == c or h.endswith("." + c) for c in _COMMON_CDN_HOSTS)
    )
    other = sorted(hosts - set(cdn))

    if other:
        blocking.append(
            f"页面里出现了未授权的外部链接：{'、'.join(other[:5])}"
            f"（只允许 {'、'.join(_ALLOWED_HOSTS)}）"
        )
    if cdn:
        # 提醒不阻断：要不要收敛 CDN 依赖是**产品决策**，
        # 不该由一条校验规则替人做主，更不该拿它去打死整步。
        notes.append(f"页面引了公共 CDN：{'、'.join(cdn)}（不阻断，离线环境会掉样式）")

    low = text.lower()
    hit = [w for w in _VENDOR_IDENTITY if w in low or w in text]
    if hit:
        blocking.append(
            f"页面里出现了模型供应商的身份标识：{'、'.join(hit)}——"
            f"这是客户的产品，不许出现生成方的品牌、域名或联系方式"
        )
    return blocking, notes


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
    # 外链与供应商身份。放在最后：前面几条判的是「是不是一份完整页面」，
    # 这条判的是「这份页面能不能交给客户」。
    # ⚠ 只取阻断档；提醒档（公共 CDN）由调用方自己决定要不要打印，
    #   混进来会让 35 份真机产出里 94% 都触发重问。
    blocking, _notes = scan_foreign_references(text)
    problems.extend(blocking)
    return problems


def generate_page_html(
    page: Dict[str, Any],
    spec: Dict[str, Any],
    *,
    device: str = "desktop",
    llm_call: Optional[Callable[..., Any]] = None,
    max_attempts: int = 2,
) -> Dict[str, Any]:
    """一页 spec → 一份 HTML。失败抛 SpecPageHtmlError，**不回落占位**。

    返回 {"version", "pageId", "html", "brief", "prompt"}。
    """
    brief = build_page_brief(page, spec)
    prompt = build_page_html_prompt(brief, device=device)
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


def _straggler_idle_seconds() -> float:
    """落后者预算的**下限**（锚在上次有页落地）。

    120s 是量出来的，不是拍的：干净并发 5 页实测 200.8s 全部到齐，页与页之间
    最大间隔 43s（157.5 / 163.2 / 173.8 / 177.2 / 200.8）。120s 留了近三倍余量。

    ⚠ 它现在是**下限**而不是预算本身——见 `_straggler_budget`。改成下限之后
      这条线只会比原来更宽松，绝不会更严，所以它不可能引入新的误杀。

    ⚠ 调这个值前先想清楚锚点：它量的是「这批还在不在动」，不是「一共跑了多久」。
    """
    return float(os.getenv("SLIDERULE_SPEC_PAGE_STRAGGLER_IDLE_SECONDS", "120"))


def _straggler_multiplier() -> float:
    """预算 = 首页实测耗时 × 这个倍率。

    1.5 的来处：干净那批页间最大间隔 43s、首页 157.5s，比值 0.27。取 1.5 是
    留了五倍余量，同时仍远小于「一页从头重跑」的量级。
    """
    return float(os.getenv("SLIDERULE_SPEC_PAGE_STRAGGLER_MULTIPLIER", "1.5"))


def _straggler_max_seconds() -> float:
    """预算的**上限**：首页本身病态地慢时，不许把截止线撑到形同虚设。

    首页可能因为重试而耗到 990s（真机见过一次 331.1s 的空挂，重试 3 次）。
    没有上限的话预算会被它带到 1485s，这条线就白设了。
    """
    return float(os.getenv("SLIDERULE_SPEC_PAGE_STRAGGLER_MAX_SECONDS", "600"))


def _straggler_budget(first_page_seconds: float) -> float:
    """按首页实测耗时定这一批的落后者预算。

    ## 为什么要自适应

    固定 120s 在真机上把 5 页里的 4 页误杀了（2026-08-15 口腔连锁）：

        181.7s  页面步开始
        357.9s  p2 到 (+176.2s)   ← 上膛
        477.9s  整步结束           ← 357.9 + 120，算术分毫不差

    截止线**按设计动作了**，是 120s 这个数低于这条链路的正常页间方差。而
    120s 的来处是「干净那批页间最大间隔 43s」——那批**首页只要 157.5s**。
    同一个绝对值套到一个首页 176s、上游还在抖的批次上就不成立了：页间方差
    是跟着单页生成成本走的，不是一个跨环境的常数。

    所以改成**拿这一批自己的首页耗时当尺子**——它天然编码了当前模型、话题
    长度、上游拥塞的综合快慢，不需要我们替每种组合各拍一个数。

    ## 三个数怎么合成

        budget = min(max(下限, 首页耗时 × 倍率), 上限)

    下限保证它**永不比原来更严**（所以这次改动不可能引入新误杀）；上限保证
    一个病态的首页不会把线撑到形同虚设。

    ## 拿两批真机数据回算

    · 市政园林（当初促成这条线的那批）：首页 175.6s → 预算 263s。
      p3/p4/p5 的间隔 6.3 / 52.9 / 34.9s 全在预算内照常交付；p1 永远不来，
      在 760.4s 之后 263s 开火 ≈ 整步 533s，仍从 936s 里砍掉 400s。
      **这条线的原始用途完好。**
    · 口腔连锁（这次被误杀的那批）：首页 176.2s → 预算 264s，是原来的 2.2 倍。
    · 干净基线：首页 157.5s → 预算 236s，页间最大 43s，永不触发。

    ⚠ 首页取的是「**第一个完成的 future**」，成功失败都算，不是「第一个成功的页」。
      理由：这把尺子量的是「当前上游把一页跑完要多久」，一次带重试的失败同样
      是这个环境真实的耗时形状。而一个**秒失败**（比如校验不过）会把尺子量小——
      那一半由下限兜住，落回原来的 120s，不会更糟。
    """
    return min(
        max(_straggler_idle_seconds(), first_page_seconds * _straggler_multiplier()),
        _straggler_max_seconds(),
    )


def generate_pages_parallel(
    spec: Dict[str, Any],
    *,
    device: str = "desktop",
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

    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    ok: Dict[str, str] = {}
    failed: Dict[str, str] = {}
    # ⚠ **不用 `with`**：ThreadPoolExecutor.__exit__ 是 shutdown(wait=True)，
    #   它会一直等到所有线程跑完——那正是这条截止线要避免的事。用了 with，
    #   截止线只会让日志早一点写，墙钟一秒都省不下来。
    pool = ThreadPoolExecutor(max_workers=min(max_workers, len(pages)))
    try:
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
            pool.submit(
                generate_page_html, pg, spec, device=device, llm_call=llm_call
            ): str(pg.get("id") or "")
            for pg in pages
        }
        total = len(fut_to_id)
        done = 0
        pending = set(fut_to_id)
        batch_started = time.monotonic()
        # 首页落地之前用不上（那之前不设限），落地时按 _straggler_budget 改写。
        idle_budget = _straggler_idle_seconds()
        # 截止线**锚在"上一次有进展"上，不锚在整批开始**。
        #
        # 锚在开始的话，页数一多就必然误伤：6 页本来就比 3 页久，一个固定的
        # 总时长要么对小批太松、要么对大批太严。锚在"上次有页落地"则跟批量
        # 大小无关，量的是**这批还在不在动**。
        #
        # ★ 但它**只在第一页落地之后才上膛**（2026-08-14 当天真机修回来的）：
        #
        #   头一版从整批开跑就开始计时，结果 120s 的预算在第一张页到达之前
        #   就开火——真机 `got=0 failed=5 missingPages=p1..p5`，整条新链路
        #   被自己的截止线打死、回落老链路。
        #
        #   ⚠ 阈值是我从"页与页之间最大间隔 43s"推的，**而开跑到第一张页
        #     本来就要 150~175s**（单页基准 149.0s）。同一批数据里两个区间
        #     量的是不同的东西，我拿其中一个去卡另一个。
        #
        #   概念上也应当如此：「落后者」的前提是**别人已经到了**。一个都没到
        #   的时候大家都在飞，没有落后者可言。那一段的兜底是每页自己的
        #   LLM 超时与重试（call_llm_with_retry），不归这条线管。
        #
        # ★★ 首页落地的**同时**，顺手拿它的耗时把预算定下来（2026-08-15）。
        #    固定 120s 在真机上误杀了 5 页里的 4 页——不是逻辑错，是那个绝对值
        #    低于这条链路的正常页间方差。详见 `_straggler_budget` 的回算。
        last_progress: Optional[float] = None
        while pending:
            # last_progress 为 None = 还没有任何一页落地 → 不设限，等着
            budget = (
                None
                if last_progress is None
                else max(0.0, idle_budget - (time.monotonic() - last_progress))
            )
            waited, pending = wait(
                pending,
                timeout=budget,
                return_when=FIRST_COMPLETED,
            )
            if not waited:
                # 静默超过预算：剩下的按超时收尾。**不产出占位 HTML**——
                # 与单页失败同一条纪律，缺页由 failedPages / missingPages 说话。
                for fut in pending:
                    page_id = fut_to_id[fut]
                    # ⚠ 报**算出来的**预算，不是那个下限常数。排障时会拿它对
                    #   时间轴做算术（口腔连锁那次正是靠「357.9 + 120 = 477.9
                    #   分毫不差」定位的），印一个从没生效过的数会把人带沟里。
                    failed[page_id] = (
                        f"整批静默超过 {idle_budget:.1f}s（最后一页落地之后再无进展），"
                        f"按超时收尾"
                    )
                    print(f"[spec_page_html] 页面 {page_id} 触发落后者截止线，放弃等待")
                    fut.cancel()  # 只取消**还没开跑**的；已在跑的取消不掉
                break
            now = time.monotonic()
            if last_progress is None:
                first_page_seconds = now - batch_started
                idle_budget = _straggler_budget(first_page_seconds)
                print(
                    f"[spec_page_html] 首页 {first_page_seconds:.1f}s 落地 → "
                    f"落后者预算 {idle_budget:.0f}s"
                    f"（下限 {_straggler_idle_seconds():.0f}s ×{_straggler_multiplier()} "
                    f"上限 {_straggler_max_seconds():.0f}s）"
                )
            last_progress = now
            for fut in waited:
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
    finally:
        # ⚠ wait=False：**不等落后者**，那正是这条截止线的全部意义。
        #   cancel_futures 只能取消还没开跑的；已经在飞的 HTTP 请求停不掉
        #   （同 run_cancel 那条教训：线程里的活取消不了）。所以这里的语义
        #   诚实地说是「**不再等它**」，不是「已经把它停了」——它会在后台
        #   自己跑完然后被丢弃。
        pool.shutdown(wait=False, cancel_futures=True)
    return {"pages": ok, "failed": failed}
