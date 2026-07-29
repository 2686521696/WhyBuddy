"""门禁：实体字段的 type 必须落在封闭合法域内（2026-07-29）。

## 为什么补这条

组件覆盖率审查时顺手验了一下"门禁会不会拦住不认识的字段类型"，答案是
**不会**——喂 boolean/datetime/file 三个进去，findings 一条都没有、全放行。
FIELD_TYPES 此前只在技能 binding 那里用过，实体字段的 type 一路没人查，
所谓"合法域"其实只是 prompt 里的一句约定。

## 漏掉的代价：静默降级

不是"模型写错了没人说"这么轻。前端 field-value-type 对认不出的类型一律
`return "text"`，于是一个 `file` 字段会安安静静变成普通文本输入框——
用户以为这儿能传附件，实际只能打字。不报错、不提示、测试也全绿，
只有真去用的人才会发现不对。这类不喊疼的错误最贵。

## 边界：缺省不罚

datamodel 字段语义那一段的既有口径是"出现即校验、缺省不罚"（老模型零破坏）。
不写 type 的字段按 string 处理，跟以前一样过门——这条测试也把它钉住，
免得日后有人把校验收紧成"必须显式声明"，把历史模型全判死。
"""

import copy
import json
from pathlib import Path

import pytest

from services.schema_legal import FIELD_TYPES
from services.v5_model_gate import validate_five_system_model

FIXTURE = Path(__file__).resolve().parent.parent / "services" / "data" / "builtin_domain_models.json"


def _base_model() -> dict:
    """拿一份**冻结的、确定能过门**的真实模型当基线。

    不手搓最小模型：门禁在六段任一为空时会提前 return，手搓的夹具很容易
    在走到字段语义那一段之前就短路，于是测试看着通过、其实什么都没校验到
    （第一版就是这么骗过自己的——appbundle 给了空字典，直接早退）。
    """
    models = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return copy.deepcopy(next(iter(models.values())))


def _with_first_field_type(value) -> dict:
    m = _base_model()
    field = m["datamodel"]["entities"][0]["fields"][0]
    if value is None:
        field.pop("type", None)
    else:
        field["type"] = value
    return m


def _type_findings(verdict: dict) -> list:
    return [f for f in verdict["findings"] if str(f.get("path", "")).endswith(".type")]


def test_baseline_fixture_passes():
    """基线必须先过门，否则下面每条断言都是在测别的东西。"""
    assert validate_five_system_model(_base_model())["passed"]


@pytest.mark.parametrize("bad", ["file", "boolean", "datetime", "image", "json"])
def test_illegal_field_type_is_rejected(bad):
    verdict = validate_five_system_model(_with_first_field_type(bad))
    assert not verdict["passed"], f"{bad} 不该过门"
    hits = _type_findings(verdict)
    assert hits, f"{bad} 被拦下了，但没有指向 .type 的 finding"
    # 报错要点名合法集合——只说"非法"没法让模型自我修正
    assert "/".join(FIELD_TYPES) in hits[0]["message"]


@pytest.mark.parametrize("good", list(FIELD_TYPES))
def test_every_legal_type_passes(good):
    """合法域里的每一个都要放行——参数化跟着 FIELD_TYPES 走，
    日后往账本里加类型，这条会自动覆盖到，不用记得改测试。"""
    verdict = validate_five_system_model(_with_first_field_type(good))
    assert not _type_findings(verdict), f"{good} 是合法类型却被拦"


def test_type_check_is_case_insensitive():
    """模型偶尔会吐 `TEXT`/`Date`。大小写不是错，不该因此拦人。"""
    assert not _type_findings(validate_five_system_model(_with_first_field_type("TEXT")))
    assert not _type_findings(validate_five_system_model(_with_first_field_type(" Date ")))


def test_missing_type_still_passes():
    """缺省不罚：老模型不写 type 的照旧当 string。"""
    verdict = validate_five_system_model(_with_first_field_type(None))
    assert verdict["passed"]
    assert not _type_findings(verdict)
