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
    assert app_id not in store.get_backend().preview_sources()


# ────────────────────── ④ 两个来源的优先级链 ──────────────────────
#
# 卡片来源三级：e2b 真截图 > sheet 参照板 > 活渲染（前端 fallback）。
# 前两级都落在 generated_app_preview，这一组钉住"谁赢"与"输的那张还在不在"。


def test_e2b_shot_outranks_the_sheet(configured_store):
    """两张都有时取图给 e2b——它是真浏览器截的这个应用，参照板只是示意。"""
    app_id = store.save_app_or_version(_model(), goal="g", session_id="e1", preview_png_b64=PNG_A)
    assert store.save_app_shot(app_id, base64.b64decode(PNG_B)) is True
    assert store.get_app_preview_png(app_id) == base64.b64decode(PNG_B)


def test_backfilling_e2b_keeps_the_sheet(configured_store):
    """回填真截图**不能**抹掉参照板。

    两张并存是这条链的兜底前提：e2b 那路要 E2B key + 公网地址 + 沙盒跑通，
    哪天断了得有东西可退。覆盖式存储在那天就只剩活渲染了。
    """
    app_id = store.save_app_or_version(_model(), goal="g", session_id="e2", preview_png_b64=PNG_A)
    store.save_app_shot(app_id, base64.b64decode(PNG_B))
    assert store.get_app_preview_png(app_id, source="sheet") == base64.b64decode(PNG_A)
    assert store.get_app_preview_png(app_id, source="e2b") == base64.b64decode(PNG_B)


def test_named_source_does_not_silently_fall_back(configured_store):
    """指名要 e2b 而这条只有参照板 → None，不能偷偷给另一路那张。

    这个接口只为排查存在，"指名 e2b 拿到 sheet"会让排查得出反向结论。
    """
    app_id = store.save_app_or_version(_model(), goal="g", session_id="e3", preview_png_b64=PNG_A)
    assert store.get_app_preview_png(app_id, source="e2b") is None
    assert store.get_app_preview_png(app_id) == base64.b64decode(PNG_A)


def test_sheet_only_app_reports_sheet_source(configured_store):
    """没有真截图时摘要如实报 sheet——回填还没到（或没开）是常态，不是故障。"""
    app_id = store.save_app_or_version(_model(), goal="g", session_id="e4", preview_png_b64=PNG_A)
    row = next(r for r in store.list_apps() if r["id"] == app_id)
    assert row["has_preview"] is True
    assert row["preview_source"] == "sheet"


def test_preview_tag_changes_when_the_image_is_backfilled(configured_store):
    """回填后 preview_tag 必须变——它是缩略图 URL 的 `?v=`，而那条响应带
    immutable 强缓存。标签不变，浏览器就永远停在回填前那张图上。"""
    app_id = store.save_app_or_version(_model(), goal="g", session_id="e5", preview_png_b64=PNG_A)
    before = next(r for r in store.list_apps() if r["id"] == app_id)["preview_tag"]
    assert before.startswith("sheet.")

    store.save_app_shot(app_id, base64.b64decode(PNG_B))
    after = next(r for r in store.list_apps() if r["id"] == app_id)["preview_tag"]
    assert after.startswith("e2b.")
    assert after != before


def test_preview_tag_changes_when_the_same_source_is_rewritten(configured_store):
    """**同一个来源换了图，标签也必须变。**

    这是标签里带时刻位的唯一理由，只带来源盖不住：新版本先继承上一版的 e2b 图
    （来源 e2b），随后自己的回填到了（来源还是 e2b）——来源一个字没变，字节全
    变了。标签不变 = immutable 缓存把浏览器钉死在继承来的那张旧图上。
    """
    app_id = store.save_app_or_version(_model(), goal="g", session_id="e8", preview_png_b64=PNG_A)
    store.save_app_shot(app_id, base64.b64decode(PNG_A))
    before = next(r for r in store.list_apps() if r["id"] == app_id)["preview_tag"]

    store.save_app_shot(app_id, base64.b64decode(PNG_B))
    after = next(r for r in store.list_apps() if r["id"] == app_id)["preview_tag"]
    assert store.preview_source_of(before) == store.preview_source_of(after) == "e2b"
    assert after != before, "同来源换图后标签没变，强缓存会钉死在旧图上"


def test_new_version_inherits_both_sources_separately(configured_store):
    """新版本要把两张图分别继承过去。

    只继承"最好的那张"会让新版本丢掉参照板——随后 e2b 那路一旦不可用
    （key 撤了、图被删），这一版就直接掉到活渲染，而它本该有参照板兜着。
    """
    v1 = store.save_app_or_version(_model(), goal="g", session_id="e6", preview_png_b64=PNG_A)
    store.save_app_shot(v1, base64.b64decode(PNG_B))
    v2 = store.save_app_or_version(_model(entities=3), goal="g", session_id="e6")
    assert v2 != v1
    assert store.get_app_preview_png(v2, source="sheet") == base64.b64decode(PNG_A)
    assert store.get_app_preview_png(v2, source="e2b") == base64.b64decode(PNG_B)


def test_delete_takes_both_sources_with_it(configured_store):
    """删记录要把两张图都带走。只清一张会留下孤儿，而 preview_sources 是按
    "这个 app 有没有图"算的——孤儿会让已删除的应用在列表里继续显示 has_preview。"""
    app_id = store.save_app_or_version(_model(), goal="g", session_id="e7", preview_png_b64=PNG_A)
    store.save_app_shot(app_id, base64.b64decode(PNG_B))
    assert store.delete_app(app_id) is True
    assert store.get_app_preview_png(app_id) is None
    assert store.get_app_preview_png(app_id, source="sheet") is None
    assert store.get_app_preview_png(app_id, source="e2b") is None
    assert app_id not in store.get_backend().preview_sources()


# ────────────────────── ⑤ 老库就地补列 ──────────────────────


def test_existing_table_without_e2b_column_gets_migrated(tmp_path, monkeypatch):
    """**这条是反向验证**：上面所有用例都建的是新库，`create_all` 会照模型直接
    带上 e2b_png_b64——补列那一支根本没被跑过。

    生产（Neon）与本地 SQLite 里 generated_app_preview 都是**已经存在且没有这
    一列**的。create_all 只建不改，不显式 ALTER 的话所有 e2b 读写都会撞
    UndefinedColumn。这里手工造一张老表，再让后端初始化，钉住"列补上了 + 老数
    据还在 + e2b 能写能读"。

    顺带钉住写法：`add column if not exists` 只有 Postgres 认，SQLite 直接抛
    syntax error——所以实现走的是先 inspect 再 ALTER。
    """
    import sqlite3

    db = tmp_path / "legacy.db"
    con = sqlite3.connect(db)
    con.executescript(
        """
        create table generated_app (
            id varchar(36) primary key, root_id varchar(36), parent_id varchar(36),
            version integer, session_id varchar(64), goal text, product_name varchar(120),
            theme_id varchar(64), theme_label varchar(120), device varchar(16),
            landing_page_ref varchar(64), entity_count integer, page_count integer,
            gate_passed boolean, dedup_key varchar(80), created_at timestamp, model_json json
        );
        create table generated_app_preview (
            app_id varchar(36) primary key, png_b64 text, created_at timestamp
        );
        insert into generated_app_preview (app_id, png_b64, created_at)
            values ('legacy-app', 'SEVMTE8=', '2026-07-31T00:00:00+00:00');
        """
    )
    con.commit()
    con.close()

    monkeypatch.setattr(store.settings, "APP_STORE_DATABASE_URL", f"sqlite:///{db}")
    monkeypatch.setattr(store.settings, "APP_STORE_LOCAL_SQLITE", "")
    store.reset_backend_cache()
    try:
        backend = store.get_backend()
        # 老数据没被动过
        assert backend.get_preview("legacy-app", source="sheet") == "SEVMTE8="
        # 新列真的补上了，能写能读，且没顶掉老图
        backend.save_preview("legacy-app", PNG_B, source="e2b")
        assert backend.get_preview("legacy-app", source="e2b") == PNG_B
        assert backend.get_preview("legacy-app", source="sheet") == "SEVMTE8="
        assert backend.get_preview("legacy-app") == PNG_B  # 优先级：e2b 赢
        assert store.preview_source_of(backend.preview_sources()["legacy-app"]) == "e2b"
    finally:
        store.reset_backend_cache()
