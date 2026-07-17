"""E31 附件提取管线单测：分路/预算/诚实降级（LLM 与沙盒全 monkeypatch）。"""

from types import SimpleNamespace

import pytest

from services import attachment_extract as mod


# ── 分路 ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "name,kind",
    [
        ("photo.PNG", "image"),
        ("scan.jpeg", "image"),
        ("anim.gif", "image"),
        ("doc.pdf", "pdf"),
        ("notes.txt", None),
        ("archive.zip", None),
        ("noext", None),
    ],
)
def test_classify(name, kind):
    assert mod.classify_attachment(name) == kind


def test_unknown_type_honest_fail():
    result = mod.extract_attachment("data.bin", b"xx")
    assert result["ok"] is False and result["kind"] == "other"


def test_empty_file_honest_fail():
    result = mod.extract_attachment("a.png", b"")
    assert result["ok"] is False


# ── 图片：视觉 LLM ──────────────────────────────────────────────────────


def _cfg(**over):
    base = dict(api_key="k", supports_image_content_parts=True)
    base.update(over)
    return SimpleNamespace(**base)


def test_image_too_large():
    result = mod.extract_image("a.png", b"x" * (mod.MAX_IMAGE_BYTES + 1))
    assert result["ok"] is False and "过大" in result["detail"]


def test_image_no_key(monkeypatch):
    import sliderule_llm.config as cfg_mod

    monkeypatch.setattr(cfg_mod, "get_llm_config", lambda: _cfg(api_key=""))
    result = mod.extract_image("a.png", b"png")
    assert result["ok"] is False and "未配置" in result["detail"]


def test_image_channel_without_vision_fail_closed(monkeypatch):
    import sliderule_llm.config as cfg_mod

    monkeypatch.setattr(
        cfg_mod, "get_llm_config", lambda: _cfg(supports_image_content_parts=False)
    )
    result = mod.extract_image("a.png", b"png")
    assert result["ok"] is False
    assert "LLM_SUPPORTS_IMAGE_CONTENT_PARTS" in result["detail"]


def test_image_happy_path(monkeypatch):
    import sliderule_llm.client as client_mod
    import sliderule_llm.config as cfg_mod

    monkeypatch.setattr(cfg_mod, "get_llm_config", lambda: _cfg())
    captured = {}

    def fake_call(messages, **kw):
        captured["messages"] = messages
        return SimpleNamespace(content="登录页原型：手机号+验证码，底部注册入口")

    monkeypatch.setattr(client_mod, "call_llm", fake_call)
    result = mod.extract_image("ui.png", b"\x89PNG fake")
    assert result["ok"] is True and "登录页" in result["context"]
    # 图片以 data URL content part 发送
    user = captured["messages"][-1]["content"]
    assert any(p.get("type") == "image_url" for p in user)


def test_image_llm_failure_honest(monkeypatch):
    import sliderule_llm.client as client_mod
    import sliderule_llm.config as cfg_mod

    monkeypatch.setattr(cfg_mod, "get_llm_config", lambda: _cfg())

    def boom(messages, **kw):
        raise RuntimeError("gateway 522")

    monkeypatch.setattr(client_mod, "call_llm", boom)
    result = mod.extract_image("ui.png", b"png")
    assert result["ok"] is False and "522" in result["detail"]


# ── PDF：E2B 沙盒（+ 蒸馏）─────────────────────────────────────────────


def test_pdf_no_e2b_key(monkeypatch):
    monkeypatch.delenv("E2B_API_KEY", raising=False)
    result = mod.extract_pdf("a.pdf", b"pdf")
    assert result["ok"] is False and "E2B" in result["detail"]


def test_pdf_happy_path(monkeypatch):
    monkeypatch.setenv("E2B_API_KEY", "k")
    monkeypatch.setattr(mod, "_pdf_sandbox_extract", lambda data: {"text": "第一章 需求"})
    result = mod.extract_pdf("a.pdf", b"pdf")
    assert result == {"ok": True, "context": "第一章 需求", "detail": "", "chars": 6}


def test_pdf_scanned_no_text(monkeypatch):
    monkeypatch.setenv("E2B_API_KEY", "k")
    monkeypatch.setattr(mod, "_pdf_sandbox_extract", lambda data: {"text": "  "})
    result = mod.extract_pdf("a.pdf", b"pdf")
    assert result["ok"] is False and "扫描件" in result["detail"]


def test_pdf_sandbox_error_honest(monkeypatch):
    monkeypatch.setenv("E2B_API_KEY", "k")
    monkeypatch.setattr(
        mod, "_pdf_sandbox_extract", lambda data: {"error": "PdfStreamError: bad xref"}
    )
    result = mod.extract_pdf("a.pdf", b"pdf")
    assert result["ok"] is False and "PdfStreamError" in result["detail"]


def test_pdf_long_text_distilled(monkeypatch):
    monkeypatch.setenv("E2B_API_KEY", "k")
    monkeypatch.setattr(
        mod, "_pdf_sandbox_extract", lambda data: {"text": "长" * 9000}
    )
    monkeypatch.setattr(mod, "_distill_with_llm", lambda name, raw: "蒸馏后的要点")
    result = mod.extract_pdf("a.pdf", b"pdf")
    assert result["ok"] is True and result["context"] == "蒸馏后的要点"
    assert "蒸馏" in result["detail"]


def test_pdf_distill_failure_clips(monkeypatch):
    monkeypatch.setenv("E2B_API_KEY", "k")
    monkeypatch.setattr(
        mod, "_pdf_sandbox_extract", lambda data: {"text": "长" * 9000}
    )
    monkeypatch.setattr(mod, "_distill_with_llm", lambda name, raw: None)
    result = mod.extract_pdf("a.pdf", b"pdf")
    assert result["ok"] is True
    assert len(result["context"]) <= mod.MAX_CONTEXT_CHARS + 20  # 截断注记
    assert "截断" in result["detail"] or "截断" in result["context"]


# ── 路由契约（raw bytes + ?name）────────────────────────────────────────


def test_route_contract(monkeypatch):
    from fastapi.testclient import TestClient

    from app import app

    monkeypatch.setattr(
        mod, "extract_attachment", lambda name, data: {
            "ok": True, "kind": "pdf", "context": "抽出来的内容", "detail": "", "chars": 6,
        },
    )
    client = TestClient(app)
    res = client.post(
        "/api/sliderule/attachments/extract?name=spec.pdf",
        content=b"%PDF-fake",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True and body["name"] == "spec.pdf" and body["kind"] == "pdf"
    assert "elapsedMs" in body


def test_route_requires_name():
    from fastapi.testclient import TestClient

    from app import app

    client = TestClient(app)
    res = client.post("/api/sliderule/attachments/extract", content=b"x")
    assert res.status_code == 400
