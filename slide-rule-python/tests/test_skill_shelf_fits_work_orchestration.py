"""技能货架只留 Work 编排用得上的；下架的在线上库里也挡住；新进的在沙盒里真能跑。

⚠ 2026-10-01 用户：「审查当前系统中的 skills，只保留符合编排流程的 skills，并去 GitHub 找符合 Work 模式编排的加进来」。
  105 份种子里 83 份是工程手艺包（Rust / Saga / Nx / PCI …）；webapp-testing 在沙盒里注定起不来
  （Chromium 缺 libnspr4，见 project_tool_contracts 里第 81～83 轮那段）；file-conversion 把用户文件发给第三方。
  隔离真机 175 轮里模型真正加载过的是 office-skills / frontend-design / pptx-* / data-storytelling …这十几份。

线上库里已经有那 87 份的包行、有人装过——只删 index.json 管不到它们（ensure_seed 只往里加、不往外删），
installed_skill_infos 照样列给模型。所以第一组造的就是线上那个形状：包行 + 安装行先在，再看挡没挡住。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from services.control_skills import build_skill_message
from services.identity_store import IdentityStore, _SqlExecutor
from services.skill_catalog_store import (
    SkillCatalogStore,
    load_github_seeds,
    load_seed_retired,
    local_seed_skill_info,
    reset_skill_catalog_cache,
)
from services.skill_hydrate import files_for_owner, files_for_package

SEEDS = Path(__file__).resolve().parents[2] / "skills" / "seeds"
FIXTURE_ZIP = Path(__file__).parent / "fixtures" / "round80_webapp_testing_skill.zip"


@pytest.fixture
def catalog(tmp_path, monkeypatch):
    monkeypatch.setenv("S3_ENDPOINT", "fs")
    monkeypatch.setenv("S3_FS_ROOT", str(tmp_path / "oss"))
    reset_skill_catalog_cache()
    ident = IdentityStore(_SqlExecutor(f"sqlite:///{tmp_path / 'id.db'}"), is_sqlite=True)
    store = SkillCatalogStore(ident._x, is_sqlite=True)
    yield store
    reset_skill_catalog_cache()


def _shelve_like_production(store: SkillCatalogStore, slug: str, data: bytes, owner: str) -> None:
    """线上那个形状：下架前就在架上、也有人装了。直接写表，不走 install()（install 现在会拒）。"""
    from services.skill_blob_store import blob_put
    key = f"skills/{slug}/1.0.0.zip"
    digest = blob_put(key, data)
    store.upsert_package(slug=slug, name=slug, description="x", version="1.0.0", oss_key=key,
                         sha256=digest, skill_id=slug)
    ph = store._x.ph
    store._x.execute(f"insert into wb_skill_install (owner_id, skill_id, version, installed_at) "
                     f"values ({ph(1)},{ph(2)},{ph(3)},{ph(4)})", [owner, slug, "1.0.0", "2026-09-28T00:00:00Z"])


# ── 一、下架的：线上库里已有的包行和安装记录也挡住 ─────────────────────────────


def test_a_retired_skill_already_installed_reaches_nobody(catalog):
    _shelve_like_production(catalog, "webapp-testing", FIXTURE_ZIP.read_bytes(), "alice")
    assert "webapp-testing" not in {pkg["slug"] for pkg in catalog.catalog_for_owner("alice")}   # 货架
    assert catalog.list_installed("alice") == []                                                  # 已安装
    assert [info.name for info in catalog.installed_skill_infos("alice")] == []                  # 交给模型的目录
    assert files_for_owner("alice", store=catalog) == {}                                         # 沙盒开箱
    with pytest.raises(ValueError, match="skill_not_in_catalog"):
        catalog.install(owner_id="bob", skill_id="webapp-testing")                               # 再装


def test_a_kept_skill_installed_the_same_way_still_reaches_the_model(catalog):
    """反向：同一个造法、换成保留的那份——四处都在。否则上一条只证明了「什么都不列」。"""
    _shelve_like_production(catalog, "office-skills", (SEEDS / "office-skills.zip").read_bytes(), "alice")
    assert [pkg["slug"] for pkg in catalog.list_installed("alice")] == ["office-skills"]
    assert [info.name for info in catalog.installed_skill_infos("alice")] == ["office-skills"]
    assert ".sliderule/skills/office-skills/SKILL.md" in files_for_owner("alice", store=catalog)


def test_retired_seeds_are_gone_and_every_kept_seed_ships():
    retired = load_seed_retired()
    slugs = {meta["slug"] for meta in load_github_seeds()}
    assert len(retired) == 87 and slugs.isdisjoint(retired)
    assert all(why.strip() for why in retired.values())                     # 每一条都写了为什么
    for slug in retired:
        assert not (SEEDS / f"{slug}.zip").exists(), slug
        assert local_seed_skill_info(slug) is None, slug                     # @ 点名也拿不到种子正文
    for slug in slugs:
        assert local_seed_skill_info(slug) is not None, slug


# ── 二、新进的：在沙盒那个目录形状里真跑得起来 ─────────────────────────────────


def _materialize(tmp_path: Path, slug: str) -> Path:
    """按开箱的方式（files_for_package）把技能写到工作区，返回工作区根。"""
    pkg = {"slug": slug}

    class Seeds:
        def unpack_package(self, _pkg):
            from services.skill_catalog_store import local_seed_files
            return local_seed_files(slug)

    for rel, text in files_for_package(pkg, store=Seeds()).items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    return tmp_path


def test_ui_ux_pro_max_runs_the_command_its_message_tells_the_model(tmp_path):
    """⚠ 正文写的是 `python "${CLAUDE_PLUGIN_ROOT}/.claude/skills/ui-ux-pro-max/scripts/search.py"`——
    沙盒里没这个变量。照回执里那条命令原样在工作区根跑，要出一套设计系统（不联网、只用标准库）。"""
    root = _materialize(tmp_path, "ui-ux-pro-max")
    message = build_skill_message(local_seed_skill_info("ui-ux-pro-max"))
    assert "${CLAUDE_PLUGIN_ROOT}" not in message
    script = ".sliderule/skills/ui-ux-pro-max/scripts/search.py"
    assert f'python "{script}"' in message
    out = subprocess.run([sys.executable, script, "saas dashboard analytics", "--design-system"],
                         cwd=root, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr[-400:]
    assert "COLORS" in out.stdout and "#" in out.stdout


def test_the_placeholder_is_left_alone_without_a_sandbox_directory():
    """反向：没有沙盒路径的技能（path 不是 .sliderule/skills/<名>/SKILL.md）不编目录。"""
    info = local_seed_skill_info("ui-ux-pro-max")
    bare = type(info)(**{**info.__dict__, "path": ""}) if hasattr(info, "__dict__") else info
    if getattr(bare, "path", "x"):
        pytest.skip("SkillInfo 不可复制")
    assert "${CLAUDE_PLUGIN_ROOT}" in build_skill_message(bare)


def test_financial_analyst_scripts_run_on_their_own_sample(tmp_path):
    root = _materialize(tmp_path, "financial-analyst")
    base = ".sliderule/skills/financial-analyst/"
    out = subprocess.run([sys.executable, base + "scripts/ratio_calculator.py", base + "assets/sample_financial_data.json",
                          "--format", "json"], cwd=root, capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr[-400:]
    assert json.loads(out.stdout)


def test_new_seeds_fit_the_package_limits_and_carry_a_license():
    from services.skill_package_format import MAX_FILE_BYTES, unpack_skill_zip
    for slug in ("humanizer-zh", "ui-ux-pro-max", "financial-analyst", "copywriting", "data-visualization-discipline"):
        files = unpack_skill_zip((SEEDS / f"{slug}.zip").read_bytes())
        assert "LICENSE" in files, slug
        assert all(len(text.encode()) <= MAX_FILE_BYTES for text in files.values()), slug


def test_no_seed_ships_compiled_caches():
    """⚠ 2026-10-01 第一次打 ui-ux-pro-max 时，克隆目录里试跑留下的 __pycache__/*.pyc 跟着进了包。"""
    import zipfile
    for zip_path in sorted(SEEDS.glob("*.zip")):
        with zipfile.ZipFile(zip_path) as archive:
            bad = [n for n in archive.namelist() if "__pycache__" in n or n.endswith(".pyc")]
        assert bad == [], (zip_path.name, bad[:3])


# ── 三、存储不可写时新种子照样上架（第 176 轮）──────────────────────────────────


def _forbidden(*_a, **_k):
    """第 176 轮后端日志原样：seed upload stopped at humanizer-zh: HTTPError: HTTP Error 403: Forbidden"""
    from urllib.error import HTTPError
    raise HTTPError("http://minio/sliderule-skills/skills/humanizer-zh/1.0.0.zip", 403, "Forbidden", {}, None)


def test_a_read_only_store_still_shelves_new_seeds_and_the_model_gets_them(catalog, monkeypatch):
    monkeypatch.setattr("services.skill_catalog_store.blob_put", _forbidden)
    catalog.ensure_seed()
    shelf = {pkg["slug"] for pkg in catalog.list_packages()}
    assert {meta["slug"] for meta in load_github_seeds()} <= shelf
    # 2026-10-10 起架上的默认都装着（skill_catalog_store 模块头 UNINSTALLED_MARK），不用先 install。
    infos = {info.name: info for info in catalog.installed_skill_infos("alice")}   # blob 取不到 → 种子兜底
    assert {meta["slug"] for meta in load_github_seeds()} <= set(infos)
    assert "Humanizer-zh" in infos["humanizer-zh"].body
    assert ".sliderule/skills/humanizer-zh/SKILL.md" in files_for_owner("alice", store=catalog)


def test_a_writable_store_still_gets_the_bytes(catalog, monkeypatch):
    """反向：能写的存储照旧把字节传上去，不因为有了兜底就不传。"""
    puts: list[str] = []
    from services import skill_catalog_store as mod
    real = mod.blob_put
    monkeypatch.setattr(mod, "blob_put", lambda key, data: puts.append(key) or real(key, data))
    catalog.ensure_seed()
    assert "skills/humanizer-zh/1.0.0.zip" in puts
