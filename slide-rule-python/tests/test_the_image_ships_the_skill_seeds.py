"""Python 镜像里必须有 skill_catalog_store 在 import 时读的那份 skills/。

⚠ 2026-09-30（排查用户本机「加载技能 skill_not_found」时翻出来）：services/skill_catalog_store.py
  模块级就 `load_github_seeds()`，路径是 `Path(__file__).parents[2] / "skills"`。在仓库里是
  <仓库根>/skills；镜像 WORKDIR /app、`COPY slide-rule-python/ ./`，同一个表达式落到 /skills——
  Dockerfile 从没拷过它。把源码树原样摆成镜像布局（/app/services/…、没有 /skills）一 import 就是
  FileNotFoundError: …/skills/seeds/index.json，rehearsal_control 在 app.py 顶层 import 它，整个后端起不来。

判据不重抄路径规则：按镜像的 WORKDIR 把模块真实的 parents 深度搬过去算，再看 Dockerfile 有没有
一条 COPY 把构建上下文（仓库根）的 skills/ 放到那里、.dockerignore 没有把它排掉。
删掉 Dockerfile 里 `COPY skills/ /skills/`，第一条变红。
"""

from __future__ import annotations

import fnmatch
from pathlib import Path, PurePosixPath

from services import skill_catalog_store

REPO = Path(__file__).resolve().parents[2]
DOCKERFILE = REPO / "slide-rule-python" / "Dockerfile"


def _final_stage() -> list[list[str]]:
    stages: list[list[list[str]]] = []
    for raw in DOCKERFILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        words = line.split()
        if words[0].upper() == "FROM":
            stages.append([])
        if stages:
            stages[-1].append(words)
    return stages[-1]


def _where_import_reads_seeds_in_the_image() -> PurePosixPath:
    module = Path(skill_catalog_store.__file__).resolve()
    package_root = REPO / "slide-rule-python"
    # 模块里真实用的那个目录，换成相对「它往上几层」的说法（不重抄 parents[2]）
    depth = len(module.relative_to(package_root).parts)
    assert skill_catalog_store._REPO_SKILLS == module.parents[depth] / "skills"
    stage = _final_stage()
    workdir = next(w[1] for w in stage if w[0].upper() == "WORKDIR")
    copies = [w for w in stage if w[0].upper() == "COPY" and w[1] == "slide-rule-python/"]
    assert copies and copies[0][2] in {"./", "."}, "包是拷进 WORKDIR 的——这是本判据的前提"
    in_image = PurePosixPath(workdir, *module.relative_to(package_root).parts)
    return in_image.parents[depth] / "skills"


def test_the_image_copies_skills_where_the_import_reads_them():
    target = _where_import_reads_seeds_in_the_image()
    copies = [w for w in _final_stage() if w[0].upper() == "COPY" and not w[1].startswith("--from")]
    dests = {PurePosixPath(w[-1].rstrip("/")) for w in copies if w[1].rstrip("/") == "skills"}
    assert target in dests, f"镜像里 import 读 {target}，Dockerfile 没有把 skills/ 拷过去"


def test_dockerignore_does_not_drop_the_seeds():
    """反向：拷了但构建上下文里被 .dockerignore 排掉，一样是空的。"""
    patterns = [p.strip() for p in (REPO / ".dockerignore").read_text(encoding="utf-8").splitlines()
                if p.strip() and not p.startswith("#")]
    for path in ("skills/seeds/index.json", "skills/seeds/office-skills.zip", "skills/sliderule.zip"):
        assert (REPO / path).is_file(), path
        assert not any(fnmatch.fnmatch(path, p) or fnmatch.fnmatch(path.split("/")[0], p.rstrip("/"))
                       for p in patterns), path
