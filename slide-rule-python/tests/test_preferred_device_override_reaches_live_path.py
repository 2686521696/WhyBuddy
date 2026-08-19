"""作曲家「应用 / Web」必须接到真正在跑的那条链上。

resolve_preferred_device 自己认 override 不够——得确认 drive-full 和
drive-full-stream **都**在引擎启动前 set。只改同步、流式才是主路径
（本仓身份透传/精修踩过）。
"""

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _code(mod) -> str:
    import inspect

    src = inspect.getsource(mod)
    return re.sub(r"#.*", "", re.sub(r'"""[\s\S]*?"""', "", src))


def test_spec_first_is_still_the_live_generator():
    from services import v5_capability_executor as ex

    code = _code(ex)
    assert "run_spec_first(" in code
    at_spec = code.index("run_spec_first(")
    at_legacy = code.find("generate_five_system_model(")
    assert at_legacy == -1 or at_spec < at_legacy


def test_sync_and_stream_routes_both_bind_the_override():
    from routes import sliderule_full as r

    code = _code(r)
    sync_at = code.index("def drive_full(")
    stream_at = code.index("def drive_full_stream(")
    sync = code[sync_at:stream_at]
    stream = code[stream_at : stream_at + 3500]
    assert "set_preferred_device_override" in sync
    assert "set_preferred_device_override" in stream
    assert "preferredDevice" in sync
    assert "preferredDevice" in stream


def test_override_reaches_spec_first_device_resolution(monkeypatch):
    """行为：set override 后 run_spec_first 认 phone，而不是话题里的「网站」。"""
    from services.device_policy import set_preferred_device_override
    from services import spec_first_pipeline as sfp

    captured: dict = {}

    monkeypatch.setattr(
        "services.spec_tree.generate_spec_tree",
        lambda *a, **k: {
            "appName": "x",
            "personas": [],
            "pages": [{"id": "p1", "name": "首页"}],
            "nodes": [],
        },
    )

    def _pages(spec, **kw):
        captured["device"] = kw.get("device")
        return {"pages": {"p1": "<html>1</html>"}, "failed": {}}

    monkeypatch.setattr("services.spec_page_html.generate_pages_parallel", _pages)
    monkeypatch.setattr(
        "services.page_shell.unify_shell",
        lambda pages, spec, **kw: {"pages": pages, "navItems": []},
    )
    monkeypatch.setattr("services.page_shell.check_shell_consistency", lambda *a, **k: [])
    monkeypatch.setattr(
        "services.html_structure.derive_structure", lambda *a, **k: {"entities": [], "pages": []}
    )
    monkeypatch.setattr("services.spec_semantics.derive_semantics", lambda *a, **k: {"roles": []})
    monkeypatch.setattr("services.model_assembly.assemble", lambda *a, **k: {"model": {"ok": 1}})
    monkeypatch.setattr(
        "services.html_bindings.bind_pages",
        lambda pages, model, **kw: {"pages": pages, "failed": {}},
    )

    set_preferred_device_override("phone")
    try:
        out = sfp.run_spec_first("做一个订单管理网站")
    finally:
        set_preferred_device_override(None)
        sfp.take_last_pages()

    assert captured.get("device") == "phone"
    assert out["device"] == "phone"
