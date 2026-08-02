"""E2B 真截图回填（应用中心卡片来源的第一级）的覆盖。

卡片来源三级，靠前的更可信：
  ① e2b 真截图（本模块）  ② 生成时那张参照板  ③ 前端活渲染

① 要起一个 E2B 沙盒、装 playwright、开真浏览器，一张约 45~60s，且 E2B 按用量
计费。所以它是**落库之后异步**跑的、**默认关**的，而且任何一环断了都得干净地
退回 ②。这份测试盯的就是这几条边界，不测截图本身（那要真沙盒）。
"""

import base64

import pytest

import services.app_shot_backfill as backfill
import services.app_store as store


@pytest.fixture(autouse=True)
def _clean_scheduler():
    backfill._reset_for_tests()
    yield
    backfill._reset_for_tests()


@pytest.fixture
def enabled(monkeypatch):
    """开关开 + 能力可用。两者分开控制，下面的用例各关一个。"""
    monkeypatch.setenv(backfill._ENABLE_ENV, "true")
    monkeypatch.setattr(
        "services.app_screenshot.e2b_screenshot_available", lambda: True
    )


# ────────────────────── ① 默认关 / 两道闸 ──────────────────────


def test_disabled_by_default(monkeypatch):
    """没设开关 = 不花这个钱。E2B 按用量计费，而这条路径是"每落一个应用烧一个
    沙盒"——默认开会让所有部署在毫不知情的情况下开始计费。"""
    monkeypatch.delenv(backfill._ENABLE_ENV, raising=False)
    monkeypatch.setattr("services.app_screenshot.e2b_screenshot_available", lambda: True)
    assert backfill.backfill_enabled() is False
    assert backfill.schedule_app_shot("app-1", "sess-1") is False


def test_enabled_switch_alone_is_not_enough(monkeypatch):
    """开关开了但环境截不了图（缺 E2B key 或公网地址）→ 一个沙盒都不该起。

    分两层判断而不是合成一个，是为了日志里能分清"没开"和"没配"。
    """
    monkeypatch.setenv(backfill._ENABLE_ENV, "true")
    monkeypatch.setattr("services.app_screenshot.e2b_screenshot_available", lambda: False)
    assert backfill.backfill_enabled() is False
    assert backfill.schedule_app_shot("app-1", "sess-1") is False


def test_enabled_needs_both(enabled):
    assert backfill.backfill_enabled() is True


# ────────────────────── ② 排队的边界 ──────────────────────


def test_missing_session_is_not_scheduled(enabled):
    """截图是"用真浏览器打开这个会话当前的应用"，没有会话就没有可截的 URL。

    存量应用按 app_id 直接渲染的路由还不存在——这也是这条路只覆盖新生成应用
    的原因，不是疏漏。
    """
    assert backfill.schedule_app_shot("app-1", None) is False
    assert backfill.schedule_app_shot("app-1", "") is False
    assert backfill.schedule_app_shot(None, "sess-1") is False


def test_same_app_is_not_queued_twice(enabled, monkeypatch):
    """同一个 app_id 只排一次。幂等落库（save_app_or_version 的 dedup 分支）
    会对同一条记录反复调用这里，不去重就是反复烧沙盒。"""
    started = __import__("threading").Event()
    release = __import__("threading").Event()

    def slow_capture(session_id, device=None):
        started.set()
        release.wait(timeout=5)
        return None

    monkeypatch.setattr("services.app_screenshot.capture_app_screenshot", slow_capture)
    assert backfill.schedule_app_shot("app-dup", "sess-1") is True
    assert started.wait(timeout=5), "第一条没跑起来，后面的断言会空过"
    assert backfill.schedule_app_shot("app-dup", "sess-1") is False
    release.set()


def test_queue_is_bounded(enabled, monkeypatch):
    """队列有界：真堆积说明截图比生成还慢，丢新请求比无限堆内存正确——
    丢掉的那一条只是少一张更好的图，卡片仍有参照板。"""
    release = __import__("threading").Event()
    monkeypatch.setattr(
        "services.app_screenshot.capture_app_screenshot",
        lambda session_id, device=None: (release.wait(timeout=5), None)[1],
    )
    accepted = [backfill.schedule_app_shot(f"app-{i}", "s") for i in range(backfill._MAX_PENDING + 3)]
    assert accepted.count(True) == backfill._MAX_PENDING
    assert accepted.count(False) == 3
    release.set()


# ────────────────────── ③ 成功 / 失败各自的落点 ──────────────────────


def _wait_until(pred, timeout=5.0):
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        if pred():
            return True
        time.sleep(0.02)
    return False


def test_successful_shot_lands_as_e2b_source(enabled, monkeypatch, tmp_path):
    """截到了 → 写进库的 e2b 槽，并且顶掉参照板成为取图默认。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    try:
        sheet = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"S" * 32).decode("ascii")
        shot = b"\x89PNG\r\n\x1a\n" + b"E" * 32
        app_id = store.save_app_or_version(
            {"datamodel": {"entities": []}, "page": {"pages": []},
             "appbundle": {"appIdentity": {"productName": "T"}}},
            goal="g", session_id="sess-x", preview_png_b64=sheet,
        )
        monkeypatch.setattr(
            "services.app_screenshot.capture_app_screenshot",
            lambda session_id, device=None: shot,
        )
        assert backfill.schedule_app_shot(app_id, "sess-x", "desktop") is True
        assert _wait_until(lambda: store.get_app_preview_png(app_id) == shot), "回填没落库"
        # 参照板还在——e2b 那路哪天断了得有东西可退
        assert store.get_app_preview_png(app_id, source="sheet") == base64.b64decode(sheet)
    finally:
        store.reset_backend_cache()


def test_failed_shot_leaves_the_sheet_alone(enabled, monkeypatch, tmp_path):
    """截图失败（沙盒起不来/超时/页面没渲染出来）不是异常，是"这个应用暂时
    没有真截图"。卡片必须原样留在参照板上，不能被打成无图。"""
    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
    monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    try:
        sheet = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"S" * 32).decode("ascii")
        app_id = store.save_app_or_version(
            {"datamodel": {"entities": []}, "page": {"pages": []},
             "appbundle": {"appIdentity": {"productName": "T"}}},
            goal="g", session_id="sess-y", preview_png_b64=sheet,
        )
        monkeypatch.setattr(
            "services.app_screenshot.capture_app_screenshot",
            lambda session_id, device=None: None,
        )
        assert backfill.schedule_app_shot(app_id, "sess-y") is True
        assert _wait_until(lambda: backfill.pending_count() == 0), "任务没跑完"
        assert store.get_app_preview_png(app_id) == base64.b64decode(sheet)
    finally:
        store.reset_backend_cache()


def test_capture_exception_does_not_escape(enabled, monkeypatch):
    """后台线程里抛出去没人接。异常必须在 _run 里被吞掉，且把 app_id 从在飞
    集合里摘干净——否则这个应用之后永远排不进队。"""
    monkeypatch.setattr(
        "services.app_screenshot.capture_app_screenshot",
        lambda session_id, device=None: (_ for _ in ()).throw(RuntimeError("sandbox boom")),
    )
    assert backfill.schedule_app_shot("app-boom", "sess-1") is True
    assert _wait_until(lambda: backfill.pending_count() == 0), "在飞集合没清干净"
    # 清干净了才能再排一次
    monkeypatch.setattr(
        "services.app_screenshot.capture_app_screenshot", lambda session_id, device=None: None
    )
    assert backfill.schedule_app_shot("app-boom", "sess-1") is True


# ────────────────────── ④ 截图画幅跟卡片对齐 ──────────────────────


def test_shot_canvas_matches_the_reference_sheet_sizes():
    """真截图与参照板的画幅必须逐字相等。

    两个来源贴的是同一张卡（object-fit: cover），画幅不一致就会在回填那一刻
    "画面跳一下"——一路被裁一路不被裁。参照板尺寸的权威在
    freeform_block._DEVICE_IMAGE_SIZE，这里从那份定义反解出来比，不写死字面值。
    """
    from services.app_screenshot import _SHOT_CANVAS
    from services.freeform_block import _DEVICE_IMAGE_SIZE

    for device, size in _DEVICE_IMAGE_SIZE.items():
        w, h = (int(x) for x in size.split("x"))
        assert _SHOT_CANVAS[device] == (w, h), f"{device} 档画幅跟参照板对不上"


def test_shot_canvas_is_not_the_render_canvas():
    """**不能照 AppRuntimeScreen 的 DEVICE_SPECS 抄。**

    那是渲染画布（手机 390×844 = 0.462），而卡片是 9:16 = 0.5625。照渲染画布
    截出来的图贴进卡片会被 cover 上下各裁掉约 18%——2026-08-01 那个比例 bug
    的同款。这条用例把两者的区别钉死，免得以后有人"统一"过去。
    """
    from services.app_screenshot import _SHOT_CANVAS

    w, h = _SHOT_CANVAS["phone"]
    assert round(w / h, 4) == 0.5625, "手机档必须是 9:16，不是 390/844"
    dw, dh = _SHOT_CANVAS["desktop"]
    assert round(dw / dh, 4) == round(16 / 9, 4)


def test_unknown_device_falls_back_to_desktop():
    """认不出档位按桌面处理——跟前端 aspectForDevice 同一个取向，也是保守的
    那一边：错判成桌面只是图偏宽，错判成手机会把宽版应用压进竖条里。"""
    from services.app_screenshot import _SHOT_CANVAS, _shot_canvas

    assert _shot_canvas(None) == _SHOT_CANVAS["desktop"]
    assert _shot_canvas("") == _SHOT_CANVAS["desktop"]
    assert _shot_canvas("watch") == _SHOT_CANVAS["desktop"]
    assert _shot_canvas("PHONE") == _SHOT_CANVAS["phone"]
