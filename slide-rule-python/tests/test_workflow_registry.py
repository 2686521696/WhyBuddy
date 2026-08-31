from __future__ import annotations

import inspect

import pytest

from services.capability_plan import NEW_RUN, PRODUCT_REHEARSAL, TOOLS
from services.workflow_registry import (
    WorkflowPreset,
    register_workflow,
    select_workflow,
    workflow_for,
    workflow_names,
)


def test_product_rehearsal_is_the_compatibility_default():
    preset = workflow_for("product_rehearsal")
    assert preset.name == PRODUCT_REHEARSAL
    assert preset.stages == NEW_RUN
    assert preset.tools == TOOLS


def test_workflow_registry_rejects_duplicates_and_bad_stage_contracts():
    with pytest.raises(ValueError, match="already registered"):
        register_workflow(WorkflowPreset("product-rehearsal", ("spec",)))
    with pytest.raises(ValueError, match="normalized"):
        register_workflow(WorkflowPreset("Game Prototype", ("goal",)))
    with pytest.raises(ValueError, match="non-empty"):
        register_workflow(WorkflowPreset("empty-workflow", ()))


def test_workflow_registry_keeps_custom_presets_isolated():
    register_workflow(WorkflowPreset("custom-prototype", ("goal", "scene")))
    assert workflow_for("custom_prototype").stages == ("goal", "scene")
    assert "custom-prototype" in workflow_names()


def test_select_workflow_has_no_goal_parameter():
    """话题词不进这个函数。加回 goal 参数 = 再给关键词分流开口。"""
    assert "goal" not in inspect.signature(select_workflow).parameters
    with pytest.raises(TypeError):
        select_workflow("门店巡检与离线复核")  # type: ignore[misc]


def test_select_workflow_is_the_product_rehearsal_calendar():
    assert select_workflow(device="tablet").name == PRODUCT_REHEARSAL
    assert select_workflow(device="phone").stages == NEW_RUN
    assert select_workflow(device="desktop").tools == TOOLS


def test_select_workflow_tools_override_does_not_invent_a_sixth():
    reduced = select_workflow(tools=("spec", "pages", "closure", "invented"))
    assert reduced.tools == ("spec", "pages", "closure")
    assert "specfirst.bind" not in reduced.stages
    assert "specfirst.structure" not in reduced.stages


def test_select_workflow_reads_policy_pack_when_tools_omitted():
    """删掉 allowed_tools 调用、改回写死五件套，这条必须红。"""
    src = inspect.getsource(select_workflow)
    assert "allowed_tools(" in src
    assert "product_rehearsal_plan(" in src
    business = select_workflow(archetype="business_app", device="desktop")
    assert business.tools == TOOLS
