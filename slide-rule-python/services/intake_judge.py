"""入站判定闸门：这一轮用户说的，是真需求 / 真迭代，还是别的。

背景（真实成本）：一轮推演约 20 分钟 + 一次完整 LLM 推演 + 最多 9 张生图。
在此之前任何输入都会直接进推演——"你好""今天天气怎么样"照样烧这些。而
前端唯一的启发式 `looksLikeNewAppIntent`（useSlideRuleSession.ts）只做
"新话题 vs 迭代"的路由，从不拒绝任何东西，而且它的 `false` 语义重载：
"这是迭代"和"这我没认出来"返回值一模一样，二分类装不下这个问题。

设计取舍（2026-07-27 调研三个开源方案后的结论）：
- NeMo Guardrails / semantic-router 的话题围栏靠向量匹配少样本例句，
  Parlant 的规则匹配也走向量（nano-vectordb）——但本项目的 LLM 网关
  普遍没有 /embeddings 端点（.env 里 RAG_VECTOR_ENABLED=false 就是这个
  原因），这条路对相当一部分用户直接不可用。
- guardrails-ai/RestrictToTopic 要 transformers+torch，openai-guardrails
  要 43 个包含整套 spaCy（实测依赖解析）——为一道闸门装这些不合算。
- 三者的输出都是二元 flagged/Pass-Fail，都不产出面向用户的引导话术，
  而"引导用户去发真实需求"恰恰是这里最需要的那一格。
所以：不引任何依赖，只借两个结构——RestrictToTopic 的「确定性层在前、
不确定才花钱调 LLM」，以及 Parlant 的「规则带条件与优先级、每轮只把相关
的送进模型」（见 _RULES / _applicable_rules，不是一个巨型 prompt）。

纪律：
- **fail-open**：判定本身出任何问题（LLM 挂了/超时/返回不合法）一律放行。
  闸门自己坏了不能变成产品坏了。
- **第一版不阻断**：只产出 action=hint，由前端决定怎么提示；用户永远有
  "仍然推演"的逃生口。误判率在真实数据上收敛之前不升级成硬拦——这个
  项目刚被 _recognize_domain 的静默误判坑过（要翻译平台拿到工单系统），
  把人挡在核心功能外面的代价更大。
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

Verdict = Literal["real", "iteration", "vague", "off_topic", "meta"]
Action = Literal["proceed", "hint"]

_ENABLED_ENV = "SLIDERULE_INTAKE_JUDGE_ENABLED"
_BLOCKING_ENV = "SLIDERULE_INTAKE_JUDGE_BLOCKING"


def judge_enabled() -> bool:
    """默认开（判定本身不阻断，开着只多一次 1~2s 的调用换到诊断数据）。
    显式 0/false/no/off 关掉。"""
    raw = (os.getenv(_ENABLED_ENV) or "").strip().lower()
    return raw not in ("0", "false", "no", "off")


def blocking_enabled() -> bool:
    """第一版默认关：判定只提示不拦。误判率收敛后再显式打开。"""
    raw = (os.getenv(_BLOCKING_ENV) or "").strip().lower()
    return raw in ("1", "true", "yes", "on")


# ── 第 0 层：确定性预判（零成本零延迟，只挡闭眼都知道的）────────────
# 纪律：这一层只处理"绝不可能是需求"的形状，宁可漏也不能误伤——真需求
# 落到这里被拦，用户就没有第二次机会了。

_GREETING_RE = re.compile(
    r"^(你好+|您好|哈喽|hello|hi|hey|在吗|在么|有人吗|early|测试|test|"
    r"謝謝|谢谢|thanks?|thx|ok|okay|好的|嗯+|哦+|额+|1+)[\s!！?？.。,，~、]*$",
    re.IGNORECASE,
)
_PUNCT_ONLY_RE = re.compile(r"^[\s\W_]+$", re.UNICODE)
# 只短路 1~2 个有效字的输入。阈值曾经是 4，评测台抓到它把「你是谁」（3 字）
# 判成了 vague——用户问"你是谁"却被回"再多说两句，比如涉及哪些角色"。
# 3 字以上交给 LLM：这类输入判起来很便宜，而 LLM 判得明显更准。
_MIN_MEANINGFUL_CHARS = 3


@dataclass
class Judgement:
    """一次判定的完整结果。action 与 verdict 分开，是为了让阻断策略能独立
    演进——把 blocking 打开只改 _resolve_action，不动判定本身。"""

    verdict: Verdict
    action: Action
    reason: str = ""
    guidance: str = ""
    rewrite: list[str] = field(default_factory=list)
    confidence: float = 1.0
    source: str = "llm"  # precheck | llm | degraded
    degraded_reason: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "verdict": self.verdict,
            "action": self.action,
            "reason": self.reason,
            "guidance": self.guidance,
            "rewrite": list(self.rewrite),
            "confidence": self.confidence,
            "source": self.source,
            "degradedReason": self.degraded_reason,
        }


def precheck(text: str) -> Optional[Judgement]:
    """确定性层。命中返回判定，否则 None（交给 LLM 层）。"""
    t = (text or "").strip()
    if not t:
        return Judgement(
            verdict="vague", action="hint", source="precheck",
            reason="输入为空",
            guidance="说说你想做什么系统吧——一句话就行，比如「社区宠物诊所的预约与分诊」。",
        )
    if _PUNCT_ONLY_RE.match(t):
        return Judgement(
            verdict="vague", action="hint", source="precheck",
            reason="只有标点或符号",
            guidance="没读到内容。用一句话描述你想理顺的业务流程就可以。",
        )
    if _GREETING_RE.match(t):
        return Judgement(
            verdict="meta", action="hint", source="precheck",
            reason="纯问候语",
            guidance="你好。我是把一句话推演成可运行系统的——说说你手头有什么流程想理顺？",
            rewrite=["社区宠物诊所的预约与分诊系统", "二手乐器寄售与鉴定平台"],
        )
    if len(re.sub(r"[\s\W_]", "", t, flags=re.UNICODE)) < _MIN_MEANINGFUL_CHARS:
        return Judgement(
            verdict="vague", action="hint", source="precheck",
            reason="内容过短，无法判断意图",
            guidance="再多说两句？比如涉及哪些角色、要走什么流程。",
        )
    return None


# ── 第 1 层：规则表（Parlant 式 condition/action + 适用域 + 优先级）──
# 不写成一个巨型 prompt 的原因：规则一多就会互相干扰，而这个项目已经在
# 域识别器上踩过"规则太糙导致误判"的坑（"sla" 命中 translation）。这里每
# 条规则带适用域，每轮只把相关的拼进 prompt——规则增长时干扰面不扩大。


@dataclass(frozen=True)
class JudgeRule:
    id: str
    scope: Literal["always", "new_session", "has_app"]
    condition: str
    verdict: Verdict
    priority: int  # 越大越优先；同轮多条命中时供模型裁决参考


_RULES: tuple[JudgeRule, ...] = (
    JudgeRule(
        id="meta_product_question", scope="always", priority=90,
        condition="在问这个产品本身（怎么收费、你是谁、能做什么、怎么用、有什么限制），"
                  "而不是要造一个系统。注意：这类话里也常出现「系统」二字，别被字面骗了。",
        verdict="meta",
    ),
    JudgeRule(
        id="off_topic_chitchat", scope="always", priority=80,
        condition="闲聊、常识问答、算术、天气、情绪表达等，与「把某个业务流程做成系统」无关。",
        verdict="off_topic",
    ),
    JudgeRule(
        id="new_business_need", scope="new_session", priority=70,
        condition="描述了一个想被系统化的业务场景或流程。**不要求**出现「系统/应用/平台」"
                  "这类载体名词——「我们店里排班总是乱，想弄个东西管一管」「把公司报销"
                  "流程数字化」都算真需求。",
        verdict="real",
    ),
    JudgeRule(
        # 2026-07-28：已有应用时 real 压根不在候选判定里——模型只能在
        # iteration/vague/meta/off_topic 里选，于是「另外再做一套幼儿园接送打卡」
        # 这种全新领域的需求要么被塞进 iteration，要么被判 vague 弹提示条
        # （误拦真需求）。实测 9/9 全错，8 条判 vague；模型自己在 reason 里写
        # 「当前判定类别中没有"新建系统"选项」。这条规则就是把那个选项补回来。
        # 优先级高于 iteration：先问"是不是同一件事"，再谈"是不是在改它"。
        id="new_unrelated_need", scope="has_app", priority=75,
        condition="虽然已经有一个应用，但这句话描述的是**另一个业务领域**的新需求"
                  "（换了行业/换了对象/明说「另外做一套」「新开个话题」「这个先放着」）。"
                  "判据是业务领域相不相干，不是句子长短：「再给我做一套幼儿园接送打卡」"
                  "对一个药店进销存应用来说就是全新需求。"
                  "注意与 iteration 的边界：同一领域内加功能（药店应用里「再加中药饮片"
                  "批号追溯」）仍是 iteration，不是新需求。",
        verdict="real",
    ),
    JudgeRule(
        id="iteration_on_current_app", scope="has_app", priority=70,
        condition="针对当前已生成的应用提修改、增删、追问或反馈。包括很短的祈使句"
                  "（「把侧栏改成深色」）、纯评价（「这个配色太素了」）、版本操作"
                  "（「回到上一版」）——它们都不像需求描述，但都是有效迭代。"
                  "**前提是说的还是当前这个应用**：换了业务领域的走上面那条 real，"
                  "不要因为「会话里已经有应用」就默认什么都算迭代。",
        verdict="iteration",
    ),
    JudgeRule(
        id="too_vague", scope="always", priority=40,
        condition="确实是想做点什么，但信息少到无法开始（「做个系统」「帮我搞个东西」"
                  "「再搞个别的」）。只有在既判不出具体业务、也判不出要改什么时才用这条。"
                  "**说清了业务领域和主要环节就不算 vague**——角色、字段、页面这些细节"
                  "本来就是推演过程要问的，不是入站门槛。实测教训：「农机租赁调度，机主"
                  "挂单、农户下单、作业验收」被判 vague，理由是「缺少角色权限和验收流程」"
                  "——那是推演的活，不是拦人的理由。",
        verdict="vague",
    ),
)


def _applicable_rules(has_app: bool) -> tuple[JudgeRule, ...]:
    """按会话状态挑规则——空会话不谈迭代，已有应用不谈新建。"""
    scope = "has_app" if has_app else "new_session"
    return tuple(r for r in _RULES if r.scope in ("always", scope))


def _rules_block(has_app: bool) -> str:
    lines = []
    for rule in sorted(_applicable_rules(has_app), key=lambda r: -r.priority):
        lines.append(f"- {rule.verdict} (priority {rule.priority}): {rule.condition}")
    return "\n".join(lines)


_REQUIRED_KEYS = ("verdict", "reason", "confidence")


def build_messages(text: str, *, has_app: bool, app_summary: str = "") -> list[dict[str, str]]:
    """拼判定用的对话。带上会话状态与当前应用摘要——判「是不是真迭代」
    必须知道现在这个应用是什么，否则「加个杯测记录」这种话无从判断。"""
    verdicts = sorted({r.verdict for r in _applicable_rules(has_app)})
    context = (
        f"用户当前已经有一个生成好的应用：{app_summary or '（未提供摘要）'}"
        if has_app
        else "用户还没有任何应用，这是一轮全新的开始。"
    )
    # 已有应用时先做一次领域比对再选类别。只把 real 加进候选还不够——实测
    # 模型拿到候选后仍以 0.99 的置信度全判 iteration，因为"会话里已经有应用"
    # 这句铺垫压过了一切。必须把比对写成一个显式步骤，模型才会真去比。
    domain_step = (
        "\n\n判之前先做一步：把用户这句话说的**业务领域**跟上面那个应用比一比。\n"
        "  - 不是同一个领域（换了行业、换了服务对象、或明说「另外做一套」「新开个话题」）"
        "→ 这是 real，一个全新需求，跟现有应用无关。\n"
        "  - 是同一个领域（在现有应用上加功能、改规则、调页面）→ 这才是 iteration。\n"
        f"当前应用的领域是：{app_summary or '（未提供摘要，此时按语义判断）'}"
        if has_app
        else ""
    )
    system = (
        "你是一个推演产品的入站判定器。这个产品把用户一句话的业务需求推演成"
        "可运行的系统（含数据模型、权限、流程、页面）。一轮推演成本很高，"
        "所以要先判断这一轮输入属于哪一类。\n\n"
        f"当前会话状态：{context}{domain_step}\n\n"
        f"判定类别（只能选其一）：\n{_rules_block(has_app)}\n\n"
        "输出严格的 JSON，不要任何解释文字或代码块标记：\n"
        "{\n"
        f'  "verdict": {"|".join(verdicts)},\n'
        '  "reason": "一句中文，说明为什么这样判",\n'
        '  "confidence": 0.0 到 1.0 的小数,\n'
        '  "guidance": "给用户看的引导话术（verdict 不是 real/iteration 时必填，'
        '中文，友好、具体、不说教，直接告诉他可以怎么说）",\n'
        '  "rewrite": ["改写示例1", "改写示例2"]\n'
        "}\n\n"
        "判定纪律：\n"
        "- 拿不准就往宽了判（real/iteration）。误拦一个真需求的代价，远大于"
        "放过一句闲聊。\n"
        "- confidence 要诚实：模棱两可就给 0.5 以下，不要为了显得确定而虚高。\n"
        "- guidance 要针对用户这句话本身说，不要套模板。"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": (text or "").strip()[:2000]},
    ]


_VALID_VERDICTS = {"real", "iteration", "vague", "off_topic", "meta"}


def _coerce(payload: dict[str, Any], *, has_app: bool) -> Judgement:
    """把 LLM 输出收敛成合法判定。任何不合法的字段都退回放行侧，不猜。"""
    verdict = str(payload.get("verdict") or "").strip()
    if verdict not in _VALID_VERDICTS:
        raise ValueError(f"verdict 非法: {verdict[:40]!r}")
    # 空会话不可能是 iteration——没有"现有应用"可改，这个方向的收敛是安全的。
    if verdict == "iteration" and not has_app:
        verdict = "real"
    # 反方向**不能**收敛（2026-07-28 移除）：原来这里有一句
    #     elif verdict == "real" and has_app: verdict = "iteration"
    # 它假设"已经有应用了就不可能再提新需求"，可用户完全可以在一个药店进销存
    # 应用旁边说「另外再给我做一套幼儿园接送打卡」。实测 9/9 跨领域新需求全被
    # 这行改写掉——模型 reason 里明明白白写着「属于全新需求」，verdict 却被
    # 覆盖成 iteration，理由和标签自相矛盾。规则表把 real 加回候选也没用，
    # 因为改写发生在模型输出之后。判"是不是同一件事"是模型的活，不是这里的。
    try:
        confidence = float(payload.get("confidence"))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = min(1.0, max(0.0, confidence))
    rewrite = payload.get("rewrite")
    rewrite = [str(x)[:80] for x in rewrite][:3] if isinstance(rewrite, list) else []
    return Judgement(
        verdict=verdict,  # type: ignore[arg-type]
        action=_resolve_action(verdict, confidence),  # type: ignore[arg-type]
        reason=str(payload.get("reason") or "")[:200],
        guidance=str(payload.get("guidance") or "")[:400],
        rewrite=rewrite,
        confidence=confidence,
        source="llm",
    )


# 低于这个置信度不提示——模型自己都不确定，就别去打扰用户。
_HINT_CONFIDENCE_FLOOR = 0.6


def _resolve_action(verdict: Verdict, confidence: float) -> Action:
    """判决 → 动作。这是唯一决定"要不要打扰用户"的地方；第一版永远不返回
    阻断动作，blocking 开关留给误判率收敛之后。"""
    if verdict in ("real", "iteration"):
        return "proceed"
    if confidence < _HINT_CONFIDENCE_FLOOR:
        return "proceed"  # 判不准就别提示，宁可放过
    return "hint"


def judge_turn(
    text: str,
    *,
    has_app: bool = False,
    app_summary: str = "",
    llm_json_fn: Optional[Any] = None,
) -> Judgement:
    """判定一轮输入。**任何异常都不外抛**——出问题一律放行（fail-open）。

    llm_json_fn 只为测试注入；生产走 sliderule_llm.structured。"""
    if not judge_enabled():
        return Judgement(verdict="real" if not has_app else "iteration",
                         action="proceed", source="degraded",
                         degraded_reason="judge disabled by env")

    hit = precheck(text)
    if hit is not None:
        return hit

    fallback_verdict: Verdict = "iteration" if has_app else "real"
    try:
        messages = build_messages(text, has_app=has_app, app_summary=app_summary)
        if llm_json_fn is not None:
            payload = llm_json_fn(messages)
        else:
            from sliderule_llm.structured import structured_llm_json

            payload = structured_llm_json(
                messages, required_keys=_REQUIRED_KEYS,
                temperature=0.0, max_tokens=800, max_retries=1,
            )
        if not isinstance(payload, dict):
            raise ValueError("payload 不是对象")
        return _coerce(payload, has_app=has_app)
    except Exception as exc:  # noqa: BLE001 — 闸门坏了不能变成产品坏了
        return Judgement(
            verdict=fallback_verdict, action="proceed", source="degraded",
            degraded_reason=f"{type(exc).__name__}: {str(exc)[:160]}",
        )
