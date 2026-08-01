"""应用中心卡片缩略图（首页参照板落库 → 贴图）的覆盖。

背景：应用中心此前每张卡挂一个真的 AppRuntimeScreen 活渲染，实测「同屏 14 张
卡、最长单任务 4106ms」。生成这个应用时本来就画过一张首页参照板（给设计 LLM
照着排版式），画完即丢——现在把它落进库当卡片缩略图。

这份测试盯三件事：
  ① 收集槽的取舍规则（哪一张代表这个应用），以及"不传槽就什么都不收"；
  ② 图不进任何列表/摘要载荷——那是这次改动的性能前提，不是细节；
  ③ 版本/fork/幂等重存不会把已有的图弄丢。

②③ 在两个后端各跑一遍（JSON 兜底 + SQLAlchemy），因为它们是各写各的实现。
"""

import base64

import pytest

import services.app_store as store
from services.app_preview import OverviewPreviewSink

# 一张"图"——这些用例只关心字节能原样进出，不关心它是不是合法 PNG
PNG_A = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"A" * 64).decode("ascii")
PNG_B = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"B" * 64).decode("ascii")


def _model(name: str = "园务通", entities: int = 1, landing: str = "p0") -> dict:
    return {
        "datamodel": {"entities": [{"id": f"e{i}", "name": f"E{i}", "fields": []} for i in range(entities)]},
        "page": {"pages": [{"id": "p0", "kind": "monitor"}, {"id": "p1", "kind": "workbench"}]},
        "appbundle": {
            "landingPageRef": landing,
            "preferredDevice": "desktop",
            "appIdentity": {"productName": name, "theme": "forest", "generatedTheme": {"label": "forest·测试"}},
        },
    }


@pytest.fixture(params=["jsonfile", "sqlite"])
def configured_store(request, tmp_path, monkeypatch):
    """同一批断言在两个后端各跑一遍（口径与 test_app_store 一致）。"""
    if request.param == "jsonfile":
        monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", None)
        monkeypatch.setattr(store.settings, "APP_STORE_FILE", str(tmp_path / "apps.json"))
        monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    else:
        monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", f"sqlite:///{tmp_path / 'apps.db'}")
        monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    yield request.param
    store.reset_backend_cache()


# ────────────────────── ① 收集槽的取舍规则 ──────────────────────


def test_sink_prefers_the_landing_page():
    """落地页那张顶掉先到的——卡片该显示的是用户点开应用第一眼看到的页。"""
    sink = OverviewPreviewSink()
    sink.offer("p_other", PNG_A, is_landing=False)
    assert sink.png_b64 == PNG_A  # 落地页那张还没来，先收着
    sink.offer("p0", PNG_B, is_landing=True)
    assert sink.png_b64 == PNG_B and sink.page_id == "p0"


def test_sink_keeps_the_landing_page_against_later_offers():
    """收到落地页那张之后谁也顶不掉——否则后面随便哪一页都能把首页挤掉。"""
    sink = OverviewPreviewSink()
    sink.offer("p0", PNG_A, is_landing=True)
    sink.offer("p9", PNG_B, is_landing=False)
    assert sink.png_b64 == PNG_A and sink.page_id == "p0"


def test_sink_keeps_only_one_image():
    """只留一张。多留的没人用，而每张约 1MB。"""
    sink = OverviewPreviewSink()
    sink.offer("p1", PNG_A)
    sink.offer("p2", PNG_B)
    assert sink.png_b64 == PNG_A


def test_sink_ignores_missing_images():
    """生图失败/预算撞顶都是 fail-open 的正常结局，调用方不该为此加判断。"""
    sink = OverviewPreviewSink()
    sink.offer("p0", None, is_landing=True)
    sink.offer("p1", "")
    assert sink.png_b64 is None and sink.page_id == ""


def test_enrich_without_sink_leaves_the_model_untouched(monkeypatch):
    """**不传槽就什么都不收，也什么都不往 model 上挂。**

    这是防的具体事故：enrich_monitor_page_overviews 另有两个脚本调用方，其中
    scripts/enrich_builtin_domain_models.py 写的是仓库里冻结的 builtin 域夹具。
    只要图借道 model 传递，忘摘一次就是往 git 里提交几 MB base64。
    """
    from services import freeform_block

    monkeypatch.setattr(freeform_block, "_generate_overview_sheet_b64", lambda *a, **k: PNG_A)
    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    monkeypatch.setattr(
        freeform_block, "generate_freeform_block",
        lambda *a, **k: {"root": {"kind": "section", "children": []}},
    )
    model = _model()
    model["page"]["pages"][0]["stats"] = [{"id": "s1", "label": "在养面积", "entityRef": "e0"}]

    before = set(model)
    freeform_block.enrich_monitor_page_overviews(model)  # 不传 preview_sink
    # 先确认这一轮**真的走到了生图那一步**，否则下面两条是空过的
    assert model["page"]["pages"][0].get("freeformOverview"), "这一轮没真生成，断言会空过"
    assert set(model) == before, "不传槽时 model 上不该多出任何键"
    assert PNG_A not in repr(model), "图不该以任何形式留在 model 里"


def test_enrich_hands_the_landing_sheet_to_the_sink(monkeypatch):
    """传了槽就能收到——并且收到的是落地页那一页的。"""
    from services import freeform_block

    monkeypatch.setattr(freeform_block, "_supports_image_content_parts", lambda: True)
    monkeypatch.setattr(
        freeform_block, "generate_freeform_block",
        lambda *a, **k: {"root": {"kind": "section", "children": []}},
    )
    # 两页都是总览页，各出各的图；p0 是落地页
    sheets = {"p_side": PNG_B, "p0": PNG_A}
    calls = []

    def fake_sheet(design_brief, datamodel, **kwargs):
        return sheets[calls.pop(0)]

    model = _model()
    model["page"]["pages"] = [
        {"id": "p_side", "kind": "monitor", "stats": [{"id": "s", "label": "L", "entityRef": "e0"}]},
        {"id": "p0", "kind": "monitor", "stats": [{"id": "s2", "label": "L2", "entityRef": "e0"}]},
    ]
    calls[:] = ["p_side", "p0"]
    monkeypatch.setattr(freeform_block, "_generate_overview_sheet_b64", fake_sheet)
    # 预算默认可能不够两页，明确放开，让两页都真去"生图"
    monkeypatch.setenv(freeform_block._ENRICH_MAX_REF_IMAGES_ENV, "5")

    sink = OverviewPreviewSink()
    freeform_block.enrich_monitor_page_overviews(model, preview_sink=sink)
    assert sink.page_id == "p0" and sink.png_b64 == PNG_A


# ────────────────────── ② 图不进摘要载荷 ──────────────────────


def test_preview_never_rides_along_in_listings(configured_store):
    """列表/摘要里只有 has_preview 这个布尔，没有图本体。

    这条是整个改动的性能前提，不是风格问题：一张图约 1MB，应用中心一次列
    200 个应用，图跟着摘要走就是 200MB 过网——比它要治的活渲染还糟。
    """
    app_id = store.save_app_or_version(
        _model(), goal="公园养护", session_id="s1", preview_png_b64=PNG_A
    )
    rows = store.list_apps()
    row = next(r for r in rows if r["id"] == app_id)
    assert row["has_preview"] is True
    assert PNG_A not in repr(rows), "图不该出现在列表载荷里"
    # 摘要里连列名都不该有——避免将来谁顺手把它塞进 _summary
    assert not {"png_b64", "preview_png", "preview"} & set(row)

    versions = store.list_versions(row["root_id"])
    assert all(v["has_preview"] for v in versions)
    assert PNG_A not in repr(versions)


def test_apps_without_preview_report_false(configured_store):
    """老记录（改动之前落的库）如实报 false，前端据此回落活渲染。"""
    app_id = store.save_app(_model("无图应用"), goal="g", session_id="s2")
    row = next(r for r in store.list_apps() if r["id"] == app_id)
    assert row["has_preview"] is False
    assert store.get_app_preview_png(app_id) is None


def test_preview_roundtrips_as_png_bytes(configured_store):
    """取图接口给的是 PNG 原始字节（路由直接当 image/png 回）。"""
    app_id = store.save_app_or_version(_model(), goal="g", session_id="s3", preview_png_b64=PNG_A)
    assert store.get_app_preview_png(app_id) == base64.b64decode(PNG_A)


# ────────────────────── ③ 版本 / fork / 幂等不丢图 ──────────────────────


def test_new_version_inherits_the_previous_preview(configured_store):
    """精修产生新版本时通常不重跑生图。不继承的话，每精修一次卡片就掉回活渲染
    一次——而这一版跟上一版长得基本一样，上一版那张图对它仍然是诚实的。"""
    v1 = store.save_app_or_version(_model(), goal="g", session_id="s4", preview_png_b64=PNG_A)
    changed = _model(entities=3)  # 模型变了 → 走 save_version
    v2 = store.save_app_or_version(changed, goal="g", session_id="s4")
    assert v2 != v1
    assert store.get_app_preview_png(v2) == base64.b64decode(PNG_A)


def test_new_version_with_its_own_preview_wins(configured_store):
    """这一版真重画了就用自己的，不要继承来的旧图。"""
    store.save_app_or_version(_model(), goal="g", session_id="s5", preview_png_b64=PNG_A)
    v2 = store.save_app_or_version(_model(entities=3), goal="g", session_id="s5", preview_png_b64=PNG_B)
    assert store.get_app_preview_png(v2) == base64.b64decode(PNG_B)


def test_idempotent_resave_does_not_wipe_the_preview(configured_store):
    """同一个模型再落一次（没带图）不能把已有的图清掉。

    这条路上大部分调用根本没生成图（重开夹具、纯精修），"没传即无图"会让
    卡片莫名其妙掉回活渲染。
    """
    app_id = store.save_app_or_version(_model(), goal="g", session_id="s6", preview_png_b64=PNG_A)
    again = store.save_app_or_version(_model(), goal="g", session_id="s6")
    assert again == app_id
    assert store.get_app_preview_png(app_id) == base64.b64decode(PNG_A)


def test_fork_inherits_the_source_preview(configured_store):
    """副本的 model_json 就是源的拷贝，源那张图对副本同样诚实。"""
    src = store.save_app_or_version(_model(), goal="g", session_id="s7", preview_png_b64=PNG_A)
    dup = store.fork_app(src, new_name="园务通 副本")
    assert dup and store.get_app_preview_png(dup) == base64.b64decode(PNG_A)


def test_delete_takes_the_preview_with_it(configured_store):
    """删记录不删图会留下永远没人引用的孤儿（每个约 1MB）。"""
    app_id = store.save_app_or_version(_model(), goal="g", session_id="s8", preview_png_b64=PNG_A)
    assert store.delete_app(app_id) is True
    assert store.get_app_preview_png(app_id) is None
    assert app_id not in store.get_backend().preview_ids()
