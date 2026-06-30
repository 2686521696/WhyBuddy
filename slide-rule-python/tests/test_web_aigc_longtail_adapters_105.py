"""Python tests for 105 web-aigc longtail adapter cutover (web-qa, open, device/location, orchestration).

Proves Python-owned behavior for the facades.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.web_aigc_web_qa_adapter import (  # noqa: E402
    WEB_QA_ADAPTER_CONTRACT_VERSION,
    execute_web_qa_runtime_bridge,
)
from services.web_aigc_open_adapter import execute_open_runtime_bridge  # noqa: E402
from services.web_aigc_device_location_adapter import execute_device_location_runtime_bridge  # noqa: E402
from services.web_aigc_orchestration_adapter import execute_orchestration_runtime_bridge  # noqa: E402


def test_web_qa_python_facade_exercises_owned_path():
    resp = execute_web_qa_runtime_bridge({"question": "what is python cutover?"}).model_dump()
    assert resp["ok"] is True
    assert resp["status"] == "success"
    assert "python web-qa facade" in resp["answer"].lower()
    assert resp["metadata"]["pythonFacade"] is True


def test_open_python_facade_for_page_and_report():
    p = execute_open_runtime_bridge({"nodeType": "open_page", "input": {"pageId": "dash"}}).model_dump()
    assert p["ok"] is True
    assert p["status"] == "completed"
    assert p["kind"] in ("open_page", "open_report")

    r = execute_open_runtime_bridge({"nodeType": "open_report", "input": {"reportType": "final_report"}}).model_dump()
    assert r["ok"] is True


def test_device_location_python_facade():
    d = execute_device_location_runtime_bridge({"nodeType": "get_device_info", "input": {"clientHints": {"platform": "win"}}}).model_dump()
    assert d["ok"] is True
    assert d["nodeType"] == "get_device_info"
    assert d["status"] == "completed"
    assert d["metadata"]["pythonOwned"] is True

    l = execute_device_location_runtime_bridge({"nodeType": "get_location_info"}).model_dump()
    assert l["ok"] is True
    assert l["nodeType"] == "get_location_info"


def test_orchestration_python_facade():
    o = execute_orchestration_runtime_bridge({"input": {"query": "jump to foo"}}).model_dump()
    assert o["ok"] is True
    assert o["status"] == "completed"
    assert "python" in o["runtime"]["source"].lower()
