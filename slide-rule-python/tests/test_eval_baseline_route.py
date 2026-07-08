"""GET /api/sliderule/eval-baseline（主线观察台基线卡数据源）的单元测试。

覆盖：正常读取返回原文、文件缺失/损坏/非 dict 一律 404 fail-closed。
"""

import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import app  # noqa: E402
import routes.sliderule_full as full  # noqa: E402


@pytest.fixture()
def client():
    return TestClient(app)


def test_baseline_served_verbatim(tmp_path, monkeypatch, client):
    payload = {"generatedAt": "2026-07-07 09:55 UTC", "model": "gpt-5.5", "domains": [{"name": "x"}]}
    path = tmp_path / "baseline.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(full, "EVAL_BASELINE_PATH", path)
    res = client.get("/api/sliderule/eval-baseline")
    assert res.status_code == 200
    assert res.json() == payload


def test_missing_or_corrupt_baseline_is_404(tmp_path, monkeypatch, client):
    monkeypatch.setattr(full, "EVAL_BASELINE_PATH", tmp_path / "absent.json")
    assert client.get("/api/sliderule/eval-baseline").status_code == 404

    bad = tmp_path / "bad.json"
    bad.write_text("not json", encoding="utf-8")
    monkeypatch.setattr(full, "EVAL_BASELINE_PATH", bad)
    assert client.get("/api/sliderule/eval-baseline").status_code == 404

    arr = tmp_path / "arr.json"
    arr.write_text("[1,2]", encoding="utf-8")
    monkeypatch.setattr(full, "EVAL_BASELINE_PATH", arr)
    assert client.get("/api/sliderule/eval-baseline").status_code == 404
