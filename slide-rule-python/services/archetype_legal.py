# -*- coding: utf-8 -*-
"""产品原型账本——「什么算闭环」的单一真相源加载器（2026-08-30）。

## 为什么有这个文件

2026-08-29 夜真机跑通一条完整推演之后量出来的瓶颈：

    REQUIRED_EVIDENCE_KEYS = ["datamodel","rbac","workflow","page","aigc","appbundle"]
    RUNTIME_CLOSURE_EDGES  = datamodel→rbac, datamodel→page, rbac→workflow,
                             workflow→page, page→appbundle, aigc→appbundle

这两个常量写死在 `v5_capability_executor` 里，而**六样缺一样就不算闭环**。
后果不是"生成得不好看"，是**结构性封顶**：

    小游戏      没有实体表、没有角色权限、没有审批流   → 永远 0/6，不可能 gate_passed
    手表表盘    没有页面导航壳、没有工作流             → 同上

**不是不允许它生成，是不允许它闭环。** 而闭环是这个产品的全部意义
（北极星：AI 说做完了不算数，过了闸的产物才算数）。

`v5_capability_executor` 的模块头自己写着「the metamodel is domain-agnostic」
——那句话是对的但不完整：**它对领域无关（采购/工单/翻译都能套），对产品原型
不是无关的**（游戏套不上）。六系统是「有数据表、有角色、有流程、有页面」那类
东西的正确定义，错的是把一个原型的定义写成了全局常量。

## 抄的是本仓自己的账本模式

`schema_legal.py` 把「什么写法合法」从四处手抄收成一本账（E40.1）。这里同一套路：
把「什么算闭环」从跨两门语言的 10 处手抄收成一本账。

    Python 侧 5 处   v5_capability_executor(REQUIRED_EVIDENCE_KEYS / RUNTIME_CLOSURE_EDGES)
                     v5_full_driver(_SKILL_EMIT_ORDER)
                     turn_narration(_SKILL_EMIT_ORDER)   ← 第二份 _SKILL_EMIT_ORDER
                     v5_llm_generate(_REQUIRED_SECTIONS)
    TS 侧 5+ 处      client/src/lib/skills/page/pageSkill.ts
                     client/src/lib/skills/appbundle/appBundleSkill.ts

**对外名字一律不变**（`REQUIRED_EVIDENCE_KEYS` 等仍在原处、仍是 list），
老引用零改动——跟 `schema_legal` 当初一样。变的只是它们的**来源**。

## ⚠ wired=false 的原型不许被选中

`casual_game` / `glance_app` 今天是 **契约声明，生成侧未接**。选中它们会
fail-closed 并说清原因，**不许静静退回默认原型**——那就是本仓踩了三次的
「装在不通电的插座上」：契约有了、测试有了、看着像能用，实际什么也没接。

判据 `test_未接通的原型选中即失败` 钉着这一条。

## 用法

    from .archetype_legal import required_evidence, closure_edges
    required_evidence()                  # 默认原型的六样
    required_evidence("casual_game")     # 抛 ArchetypeNotWired
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Tuple

_PATH = Path(__file__).resolve().parent / "data" / "product_archetypes.json"

with _PATH.open(encoding="utf-8") as _f:
    _LEDGER: Dict[str, Any] = json.load(_f)

ARCHETYPE_LEDGER_VERSION: int = int(_LEDGER.get("version", 0))

#: 默认原型 = 没有显式声明时用哪一个。今天的产品链路全部走它。
DEFAULT_ARCHETYPE: str = str(_LEDGER.get("defaultArchetype") or "")

_ARCHETYPES: Dict[str, Dict[str, Any]] = {
    k: v for k, v in (_LEDGER.get("archetypes") or {}).items() if not k.startswith("$")
}

if not DEFAULT_ARCHETYPE or DEFAULT_ARCHETYPE not in _ARCHETYPES:
    raise ValueError(
        f"product_archetypes.json 的 defaultArchetype 无效：{DEFAULT_ARCHETYPE!r}"
    )


class ArchetypeNotWired(ValueError):
    """选了一个契约已声明、但生成侧还产不出这些段的原型。

    ⚠ 这条**故意是异常而不是回落默认**。回落会让「游戏跑出了一个后台系统」
      看起来像成功——那正是这仓最贵的一类事故（第一条：装在不通电的插座上，
      三次都靠真机日志才发现）。宁可当场失败，也不端出一个假的绿灯。
    """


class UnknownArchetype(ValueError):
    """账本里没有这个原型。拼错的原型名不许静静退回默认。"""


def archetype_names() -> Tuple[str, ...]:
    """账本里声明过的全部原型，含未接通的。"""
    return tuple(sorted(_ARCHETYPES))


def wired_archetypes() -> Tuple[str, ...]:
    """生成侧真的能产出的原型。今天只有一个。"""
    return tuple(sorted(k for k, v in _ARCHETYPES.items() if v.get("wired") is True))


def is_wired(name: str) -> bool:
    return bool(_spec_raw(name).get("wired") is True)


def label(name: str | None = None) -> str:
    return str(_spec_raw(name or DEFAULT_ARCHETYPE).get("label") or "")


def _spec_raw(name: str) -> Dict[str, Any]:
    """不检查 wired——给 `is_wired` / `label` 这类元数据查询用。"""
    spec = _ARCHETYPES.get(name)
    if spec is None:
        raise UnknownArchetype(
            f"未知的产品原型 {name!r}；账本里有：{', '.join(archetype_names())}"
        )
    return spec


def _spec(name: str | None) -> Dict[str, Any]:
    """取原型定义，未接通的当场失败。"""
    key = name or DEFAULT_ARCHETYPE
    spec = _spec_raw(key)
    if spec.get("wired") is not True:
        raise ArchetypeNotWired(
            f"产品原型 {key!r}（{spec.get('label')}）契约已声明，但生成侧还产不出它的段："
            f"{', '.join(spec.get('requiredEvidence') or [])}。"
            f"今天能用的：{', '.join(wired_archetypes())}。"
        )
    return spec


def required_evidence(name: str | None = None) -> List[str]:
    """这个原型闭环要哪几样证据。**返回新 list**——调用方切片、追加都不该污染账本。"""
    return list(_spec(name).get("requiredEvidence") or [])


def closure_edges(name: str | None = None) -> List[Dict[str, Any]]:
    """技能之间的闭环边。深拷贝，理由同上。"""
    return [dict(e) for e in (_spec(name).get("closureEdges") or [])]


def resolve(state: Any = None, payload: Dict[str, Any] | None = None) -> str:
    """这一轮该按哪个原型闭环。

    ⚠ 今天恒定返回默认原型——**这不是占位符，是有意的**：选择通道（范围卡上
      的原型选择）还没做，而在没有选择通道的时候读一个用户传不进来的字段，
      等于给自己一个「已经支持了」的错觉。等选择通道落地，改这一个函数即可，
      其余消费点一行都不用动。

      这正是本仓第一条的正向用法：先确认哪条链真的在跑，再把开关装上去。
    """
    for src in (payload or {}, getattr(state, "goal", None) or {}):
        if isinstance(src, dict):
            raw = str(src.get("productArchetype") or src.get("product_archetype") or "").strip()
            if raw:
                # 拼错不许静静退回默认（同 §14.6 那 28 份手抄开关的教训）
                _spec_raw(raw)
                return raw
    return DEFAULT_ARCHETYPE


# ── 设备形态 ────────────────────────────────────────────────────────────────
#
# 与产品原型同账本、不同小节：两者都是「这个产品能做出什么形状」，
# 但**互相正交**——同一个 archetype 可以有手机档和桌面档。
#
# 手抄现场（2026-08-30 数）：
#     v5_model_gate:1205   supported_devices = ("desktop", "phone")     闸的合法域
#     intake_judge:425     _VALID_DEVICES = {"desktop","phone","unspecified"}  判定输出域
#     intake_judge:233     _DEVICE_RUBRIC                                提示词里的姿态描述
# 三处形态各异（元组 / 集合＋哨兵 / 散文），所以"搜同一串字面量"根本对不上，
# 加一个 watch 必然漏。现在同源。

_DEVICES: Dict[str, Any] = _LEDGER.get("deviceForms") or {}
_FORMS: Dict[str, Dict[str, Any]] = {
    k: v for k, v in (_DEVICES.get("forms") or {}).items() if not k.startswith("$")
}

#: 判定专用哨兵：「没有姿态信号」。**不是设备**——闸不接受它，只有判定输出用。
JUDGE_UNSPECIFIED: str = str(_DEVICES.get("judgeSentinel") or "unspecified")


def device_order() -> Tuple[str, ...]:
    """提示词里的条目顺序。**只含接通的**，且顺序来自账本。

    ⚠ 改这个顺序 = 改提示词 = 可能改判定结果。判据 `test_rubric_逐字不变` 会红。
    """
    order = [str(x) for x in (_DEVICES.get("$order") or [])]
    wired = {k for k, v in _FORMS.items() if v.get("wired") is True}
    # 账本里 $order 没列到的接通设备也要出现，否则加了设备却不进提示词 = 白加
    return tuple([d for d in order if d in wired] + sorted(wired - set(order)))


def supported_devices() -> Tuple[str, ...]:
    """闸的合法域：接通的设备，**不含哨兵**。"""
    return tuple(sorted(k for k, v in _FORMS.items() if v.get("wired") is True))


def valid_judge_devices() -> set:
    """判定输出域 = 接通的设备 + 哨兵。"""
    return set(supported_devices()) | {JUDGE_UNSPECIFIED}


def device_rubric_bullets() -> str:
    """提示词里的设备条目，从账本生成。

    ⚠ 只生成**条目**。rubric 里那五行「容易判错的例子」是标定过的，
      手写留在 `intake_judge`——生成它等于把标定丢给了模板。
    """
    lines = [
        f"  · {name} —— {_FORMS[name].get('posture', '')}"
        for name in device_order()
    ]
    lines.append(f"  · {JUDGE_UNSPECIFIED} —— {_DEVICES.get('sentinelPosture', '')}")
    return "\n".join(lines)


def default_device() -> str:
    """判不出姿态时的兜底档。**必须是接通的**，判据钉着。"""
    return str(_DEVICES.get("defaultDevice") or "desktop")
