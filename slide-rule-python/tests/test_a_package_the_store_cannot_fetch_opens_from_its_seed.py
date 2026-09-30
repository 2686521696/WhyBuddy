"""表里有包行、OSS 取不到字节时，沙盒开箱和 file_read 也用仓库里同名的种子包。

⚠ 2026-09-30 用户本机截图（@office-skills 写《员工入职管理系统方案》）：本机 .env 的
  APP_STORE_HTTP_API_URL 指着线上库，包行的 oss_key 指向线上 MinIO；本机没配 S3_ENDPOINT，
  blob 走本地 fs，取不到。skill() 那一支有种子兜底，沙盒开箱（files_for_package）没有——
  模型在沙盒里 `find -name SKILL.md` 一个没有。兜底挪进 SkillCatalogStore.unpack_package。

判据走真 SkillCatalogStore.unpack_package + 真 skill_hydrate.files_for_package，
blob 用一个不存在的 fs 键（本机那一发的形状：包行在、字节不在）。
把 unpack_package 里 except 那支删掉，前两条变红。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from services import skill_catalog_store as store_module
from services import skill_hydrate
from services.skill_catalog_store import SkillCatalogStore, seed_readiness
from services.skill_package_format import unpack_skill_zip

ZIP = Path(__file__).resolve().parents[2] / "skills" / "seeds" / "office-skills.zip"
LIVE_ROW = {"id": "office-skills", "slug": "office-skills", "version": "1.0.0",
            "ossKey": "skills/office-skills/1.0.0.zip", "sha256": "0" * 64}


@pytest.fixture()
def unreachable_blob(monkeypatch, tmp_path):
    monkeypatch.setenv("S3_ENDPOINT", "fs")
    monkeypatch.setenv("S3_FS_ROOT", str(tmp_path / "empty"))

    def missing(key):
        raise FileNotFoundError(key)

    monkeypatch.setattr(store_module, "blob_get", missing)
    return SkillCatalogStore.__new__(SkillCatalogStore)   # 不建表：只测开箱这一刀


def test_the_seed_opens_when_the_blob_is_gone(unreachable_blob):
    files = unreachable_blob.unpack_package(LIVE_ROW)
    assert files == unpack_skill_zip(ZIP.read_bytes()) and "SKILL.md" in files


def test_the_sandbox_gets_the_skill_files(unreachable_blob):
    """§三：接在沙盒开箱那条路上，不只是函数写对了。"""
    files = skill_hydrate.files_for_package(LIVE_ROW, store=unreachable_blob)
    assert ".sliderule/skills/office-skills/SKILL.md" in files


def test_a_package_without_a_seed_still_fails(unreachable_blob):
    """反向：用户自己上传、仓库里没有种子的包，取不到就是取不到，不许编出东西来。"""
    with pytest.raises(FileNotFoundError):
        unreachable_blob.unpack_package({**LIVE_ROW, "slug": "my-own-upload", "id": "my-own-upload"})


def test_a_seed_name_cannot_walk_out_of_the_seed_dir(unreachable_blob):
    """反向：slug 里带路径的不许拿去拼磁盘路径。"""
    with pytest.raises(FileNotFoundError):
        unreachable_blob.unpack_package({**LIVE_ROW, "slug": "../sliderule"})


def test_startup_can_say_whether_the_seeds_are_there():
    ready = seed_readiness()
    assert ready["officeSkills"] is True and ready["readable"] == ready["indexed"] > 0
