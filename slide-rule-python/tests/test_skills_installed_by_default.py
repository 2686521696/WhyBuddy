# -*- coding: utf-8 -*-
"""技能默认全装：架上的都装着，装表只记用户自己卸掉的。

⚠ 2026-10-10 用户截图（技能页，新账号）：24 份全是「+ 安装」、「已安装 0」，说「技能默认全部安装」。
  之前装表是「开」名单：没行就是没装 → 新账号模型的技能目录是空的、工程电脑里一份技能文件都没有。
  现在反过来（skill_catalog_store 模块头 UNINSTALLED_MARK）。

正反成对（CLAUDE.md 三）：
  新账号什么都没点 → 货架全是已装、模型目录全有、沙盒文件图全有；
  卸掉一份 → 三处都没有它，别的不受影响、别的账号不受影响；重新装 → 回来；
  卸载之后才上架的新技能 → 照样默认装着（存的是「关」名单，不是开局拍的快照）；
  下架的 → 照样不出现；没有账号 → 什么都没装。
走的是真表、真种子包（不重抄判定逻辑，§一之二），HTTP 那条走真路由函数。
"""

from __future__ import annotations

import io
import zipfile
from types import SimpleNamespace

import pytest

from services.identity_store import IdentityStore, _SqlExecutor
from services.skill_catalog_store import (
    SkillCatalogStore,
    load_github_seeds,
    reset_skill_catalog_cache,
)
from services.skill_hydrate import files_for_owner, sandbox_relpath


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "fs")
    monkeypatch.setenv("S3_FS_ROOT", str(tmp_path / "oss"))
    reset_skill_catalog_cache()
    yield f"sqlite:///{tmp_path / 'id.db'}"
    reset_skill_catalog_cache()


def _store(url: str) -> SkillCatalogStore:
    ident = IdentityStore(_SqlExecutor(url), is_sqlite=True)
    store = SkillCatalogStore(ident._x, is_sqlite=True)
    store.ensure_seed()
    return store


SEEDS = {meta["slug"] for meta in load_github_seeds()}


def test_a_new_account_has_every_skill_on_the_shelf_installed(db):
    store = _store(db)
    shelf = store.catalog_for_owner("new-user")
    assert SEEDS <= {pkg["slug"] for pkg in shelf}
    assert [pkg["slug"] for pkg in shelf if not pkg["installed"]] == []
    # 不只是页面上打勾：模型的技能目录、工程电脑里的文件都有（「函数写对了 ≠ 被用到了」）。
    assert SEEDS <= {info.name for info in store.installed_skill_infos("new-user")}
    files = files_for_owner("new-user", store=store)
    for slug in SEEDS:
        assert sandbox_relpath(slug, "SKILL.md") in files, slug
    assert store.is_installed("new-user", "humanizer-zh")


def test_uninstall_takes_it_out_everywhere_and_survives_a_restart(db):
    store = _store(db)
    store.uninstall(owner_id="alice", skill_id="humanizer-zh")

    restarted = _store(db)    # 换一个进程：卸载记在库里，不在内存
    shelf = {pkg["slug"]: pkg["installed"] for pkg in restarted.catalog_for_owner("alice")}
    assert shelf["humanizer-zh"] is False
    assert shelf["copywriting"] is True                       # 别的不受影响
    assert "humanizer-zh" not in {i.name for i in restarted.installed_skill_infos("alice")}
    assert sandbox_relpath("humanizer-zh", "SKILL.md") not in files_for_owner("alice", store=restarted)
    assert not restarted.is_installed("alice", "humanizer-zh")
    assert restarted.installed_skill_files("alice", "humanizer-zh") is None   # 包里的文件也不再对他开放
    # 别的账号不受影响。
    assert restarted.is_installed("bob", "humanizer-zh")

    restarted.install(owner_id="alice", skill_id="humanizer-zh")
    assert "humanizer-zh" in {i.name for i in restarted.installed_skill_infos("alice")}
    assert {p["slug"]: p["installed"] for p in restarted.catalog_for_owner("alice")}["humanizer-zh"] is True


def _zip(slug: str, description: str = "新上架") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr(f"{slug}/SKILL.md", f"---\nname: {slug}\ndescription: {description}\n---\n\n# {slug}\n")
    return buf.getvalue()


def test_a_skill_shelved_later_is_installed_for_everyone_too(db):
    """存的是「关」名单：开局拍快照的写法，这里会红。"""
    from services.skill_blob_store import blob_put

    store = _store(db)
    store.uninstall(owner_id="alice", skill_id="copywriting")
    digest = blob_put("skills/brand-new/1.0.0.zip", _zip("brand-new"))
    store.upsert_package(slug="brand-new", name="brand-new", description="新上架", version="1.0.0",
                         oss_key="skills/brand-new/1.0.0.zip", sha256=digest)
    names = {i.name for i in store.installed_skill_infos("alice")}
    assert "brand-new" in names and "copywriting" not in names


def test_retired_and_anonymous_stay_out(db, monkeypatch):
    store = _store(db)
    monkeypatch.setattr("services.skill_catalog_store.is_retired_skill", lambda slug: slug == "copywriting")
    assert "copywriting" not in {p["slug"] for p in store.list_installed("alice")}
    assert store.list_installed("") == []
    assert files_for_owner("", store=store) == {}


def test_the_http_routes_flip_the_shelf(db, monkeypatch):
    """真路由函数：卸载 → 货架那一格变「安装」；再装 → 变回来。"""
    import routes.skill_store as route

    store = _store(db)
    monkeypatch.setattr(route, "_store", lambda: store)
    viewer = SimpleNamespace(id="carol")
    before = {p["slug"]: p["installed"] for p in route.list_skills(viewer)["skills"]}
    assert before["accessibility"] is True
    route.uninstall_skill("accessibility", viewer, {})
    assert {p["slug"]: p["installed"] for p in route.list_skills(viewer)["skills"]}["accessibility"] is False
    route.install_skill("accessibility", viewer, {})
    assert {p["slug"]: p["installed"] for p in route.list_skills(viewer)["skills"]}["accessibility"] is True


def test_unpacked_packages_are_cached_by_content(db, monkeypatch):
    """24 份默认全装以后每回合都要开包：同一份 (oss_key, sha256) 只取一次；换了内容照样重取。"""
    from services import skill_catalog_store as mod
    from services.skill_blob_store import blob_put

    store = _store(db)
    digest = blob_put("skills/cached/1.0.0.zip", _zip("cached"))
    pkg = store.upsert_package(slug="cached", name="cached", description="x", version="1.0.0",
                               oss_key="skills/cached/1.0.0.zip", sha256=digest)
    calls: list[str] = []
    real = mod.blob_get
    monkeypatch.setattr(mod, "blob_get", lambda key: calls.append(key) or real(key))
    assert store.skill_info(pkg).name == "cached"
    assert store.skill_info(pkg).name == "cached"
    assert calls == ["skills/cached/1.0.0.zip"]
    # 反向：同一把键下换了字节（同版本重传，sha256 变了）不许吃旧缓存——只按键记就会红。
    fresh = _zip("cached", "v2")
    digest2 = blob_put("skills/cached/1.0.0.zip", fresh)
    assert digest2 != digest
    pkg2 = store.upsert_package(slug="cached", name="cached", description="x", version="1.0.0",
                                oss_key="skills/cached/1.0.0.zip", sha256=digest2)
    assert store.skill_info(pkg2).description == "v2"
    assert calls == ["skills/cached/1.0.0.zip", "skills/cached/1.0.0.zip"]


def test_hydrating_every_default_skill_takes_a_few_writes_not_one_per_skill(db):
    """开工程时把全部默认技能写进沙盒：真种子 24 份，几批写完；每批在工程清单的闸以内、一份技能不拆开。"""
    from services.project_manifest import build_manifest
    from services.skill_hydrate import SKILL_SANDBOX_PREFIX, hydrate_owner_into

    store = _store(db)
    batches: list[dict[str, str]] = []

    def write(handle, batch):
        build_manifest(batch)          # 产线 write_files 第一行就是它：超 8MiB / 512 份会抛
        batches.append(batch)

    import services.skill_hydrate as hydrate
    real = hydrate.get_skill_catalog_store
    hydrate.get_skill_catalog_store = lambda: store
    try:
        written = hydrate_owner_into(write, object(), "new-user")
    finally:
        hydrate.get_skill_catalog_store = real
    expected = files_for_owner("new-user", store=store)
    assert written == len(expected) > 200
    assert 1 < len(batches) <= 4, len(batches)          # 一份一批的话是 24+
    prefix = SKILL_SANDBOX_PREFIX + "/"
    owner_of = {}
    for i, batch in enumerate(batches):
        for path in batch:
            owner_of.setdefault(path[len(prefix):].split("/", 1)[0], set()).add(i)
    assert all(len(where) == 1 for where in owner_of.values())      # 一份技能不跨批
