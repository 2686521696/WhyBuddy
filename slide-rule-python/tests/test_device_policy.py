import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.device_policy import (  # noqa: E402
    DEVICE_AUTHORITY,
    normalize_model_preferred_device,
    resolve_preferred_device,
)


def test_explicit_desktop_goal_overrides_phone_model_choice():
    assert resolve_preferred_device("做一个 PC 端采购审批网页", "phone") == "desktop"


def test_explicit_phone_goal_overrides_desktop_model_choice():
    assert resolve_preferred_device("做一个移动端巡检小程序", "desktop") == "phone"


def test_conflicting_explicit_devices_preserve_valid_model_choice():
    goal = "同时提供 PC 网页和手机 App"

    assert resolve_preferred_device(goal, "desktop") == "desktop"
    assert resolve_preferred_device(goal, "phone") == "phone"


def test_neutral_goal_preserves_valid_five_system_model_choice():
    goal = "做一个社区活动报名和核销系统"

    assert resolve_preferred_device(goal, "desktop") == "desktop"
    assert resolve_preferred_device(goal, "phone") == "phone"


def test_missing_invalid_and_tablet_choices_fall_back_to_desktop():
    goal = "做一个设备维护记录系统"

    assert resolve_preferred_device(goal, None) == "desktop"
    assert resolve_preferred_device(goal, "") == "desktop"
    assert resolve_preferred_device(goal, "tablet") == "desktop"
    assert resolve_preferred_device(goal, "watch") == "desktop"


def test_normalization_writes_one_authoritative_device_without_losing_model_data():
    model = {
        "datamodel": {"entities": [{"id": "ticket"}]},
        "appbundle": {"preferredDevice": "desktop", "landingPageRef": "home"},
    }

    result = normalize_model_preferred_device("做一个手机报修 App", model)

    assert result is model
    assert result["datamodel"] == {"entities": [{"id": "ticket"}]}
    assert result["appbundle"]["landingPageRef"] == "home"
    assert result["appbundle"]["preferredDevice"] == "phone"
    assert result["appbundle"]["deviceAuthority"] == DEVICE_AUTHORITY == "single-v1"


def test_normalization_repairs_a_non_mapping_appbundle():
    model = {"appbundle": None}

    result = normalize_model_preferred_device("做一个库存系统", model)

    assert result["appbundle"] == {
        "preferredDevice": "desktop",
        "deviceAuthority": "single-v1",
    }
