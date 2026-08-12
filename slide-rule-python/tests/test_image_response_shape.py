"""生图响应的两种形态都要认（2026-08-12）。

## 这条护栏是怎么来的

真跑的报错就一个词：`'b64_json'`。那是 `payload["data"][0]["b64_json"]` 抛的
KeyError 的 repr——**请求成功了、图也生出来了**，却在解析这一步全丢，因为有些端点
忽略 `response_format`，无论要什么都返回 `{"data":[{"url": "https://…"}]}`。

而外层那句错误话术当时无论如何都写"已重试 3 次"，于是这次失败被读成"重试 3 次
白烧 55s"——其实解析失败是第 1 次就收工的，一次都没重试。一个错的计数把人引到
错的方向上找了半天网络问题，所以这两件事一起修、一起钉。
"""

import base64
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sliderule_llm import image_client  # noqa: E402
from sliderule_llm.image_client import (  # noqa: E402
    ImageGenError,
    MAX_IMAGE_BYTES,
    _extract_png,
)

PNG = b"\x89PNG\r\n\x1a\nfake"


def test_b64_形态照旧() -> None:
    payload = {"data": [{"b64_json": base64.b64encode(PNG).decode()}]}
    assert _extract_png(payload, timeout=5) == PNG


def test_url_形态也认_去把图取回来(monkeypatch: pytest.MonkeyPatch) -> None:
    """这是真跑挂掉的那一种。端点忽略 response_format 时只给 url。"""
    seen: dict[str, object] = {}

    class _Resp:
        def read(self, _n: int | None = None) -> bytes:
            return PNG

        def __enter__(self) -> "_Resp":
            return self

        def __exit__(self, *_: object) -> None:
            return None

    def fake_urlopen(url: object, timeout: float = 0) -> _Resp:
        seen["url"] = url
        seen["timeout"] = timeout
        return _Resp()

    monkeypatch.setattr(image_client.urllib.request, "urlopen", fake_urlopen)
    got = _extract_png({"data": [{"url": "https://img.example.com/a.png"}]}, timeout=7)
    assert got == PNG
    assert seen["url"] == "https://img.example.com/a.png"
    assert seen["timeout"] == 7, "取图没带超时 —— 对面挂住我们就跟着挂住"


def test_url_只放行_http_s() -> None:
    """那个地址不在我们控制之下：file:// / data: 一律不碰。"""
    for bad in ("file:///etc/passwd", "data:image/png;base64,AAAA", "ftp://x/y.png"):
        with pytest.raises(ImageGenError, match="协议不允许"):
            _extract_png({"data": [{"url": bad}]}, timeout=5)


def test_url_取回来的图有体量上限(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Big:
        def read(self, n: int | None = None) -> bytes:
            return b"x" * (n or 1)  # 恰好比上限多一个字节，触发那条闸

        def __enter__(self) -> "_Big":
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(image_client.urllib.request, "urlopen", lambda *a, **k: _Big())
    with pytest.raises(ImageGenError, match=str(MAX_IMAGE_BYTES)):
        _extract_png({"data": [{"url": "https://img.example.com/huge.png"}]}, timeout=5)


def test_两种都没有时报错要带上实际键名() -> None:
    """裸 KeyError 只会让人以为是网络问题。报错必须说"我拿到的是什么"。"""
    with pytest.raises(ImageGenError) as e:
        _extract_png({"data": [{"revised_prompt": "x", "id": "y"}]}, timeout=5)
    assert "revised_prompt" in str(e.value) and "id" in str(e.value)

    with pytest.raises(ImageGenError) as e2:
        _extract_png({"error": {"message": "quota"}}, timeout=5)
    assert "error" in str(e2.value), "顶层键名也要说出来"

    # data 是空列表 / 不是列表，都归到同一条诚实报错，不是 IndexError
    for payload in ({"data": []}, {"data": "nope"}):
        with pytest.raises(ImageGenError, match="data"):
            _extract_png(payload, timeout=5)


def test_解析失败不重试_而且错误话术要报真实次数(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """请求成功、解析失败 → 重发一次得到的是同一个响应，纯白烧。

    此前那句话无论如何都写"已重试 3 次"，把这次失败带偏成了网络问题。
    """
    calls = {"n": 0}

    class _Resp:
        def read(self) -> bytes:
            calls["n"] += 1
            return b'{"data":[{"url_x":"?"}]}'

        def __enter__(self) -> "_Resp":
            return self

        def __exit__(self, *_: object) -> None:
            return None

    monkeypatch.setattr(image_client.urllib.request, "urlopen", lambda *a, **k: _Resp())
    monkeypatch.setenv("IMAGE_API_URL", "https://api.example.com/v1/images/generations")
    monkeypatch.setenv("IMAGE_MODEL", "m")
    monkeypatch.setenv("IMAGE_API_KEY", "k")

    with pytest.raises(ImageGenError) as e:
        image_client.generate_image_png("画一张图")
    assert calls["n"] == 1, "解析失败不该重发 —— 重发拿到的是同一个响应"
    assert "试了 1 次" in str(e.value), f"错误话术还在谎报重试次数：{e.value}"
