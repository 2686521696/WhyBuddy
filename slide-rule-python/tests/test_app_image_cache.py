"""前端镜像（根目录 Dockerfile）只在前端的东西变了时才重编、重装、重推。

⚠ 2026-10-09 CI 日志（deploy-images run 660，一次只改了 Python 的提交）：前端镜像 4 分 15 秒——前端编译 81 秒、
  生产依赖 18 秒，全是白做。三处让缓存每次失效：
  1. `COPY . .` 把 Python 代码也拷进去，Python 一变这层就变；
  2. GIT_SHA 传 github.sha，每次提交都变，用到它的编译那步每次重跑；
  3. 运行阶段先拷 dist 再装生产依赖，dist 一变依赖就重装、整包重推。
  现在：Dockerfile.dockerignore 多排掉前端用不到的路径；CI 的版本号取「这些路径以外最后一次变化的提交」；
  运行阶段先装依赖、版本号放最后。本地实测：按这份清单由 BuildKit 导出的构建上下文真编一遍，dist 2269 个文件与
  完整上下文编出来的逐字节相同。

两边（忽略清单 / CI 算版本号的路径）各写一份，对不上不会报错：少排了是缓存白费，多排了是镜像缺东西或版本号说错。
第一版就整个排掉了 slide-rule-python，真编才发现前端 import 了 services/data 里两边共用的数据——第三条判据钉的是它。
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]


def _ignore_lines(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")]


def _app_matrix() -> dict:
    workflow = yaml.safe_load((REPO / ".github/workflows/deploy-images.yml").read_text(encoding="utf-8"))
    entries = workflow["jobs"]["build-push"]["strategy"]["matrix"]["include"]
    return next(entry for entry in entries if entry["dockerfile"] == "Dockerfile")


def _extras() -> tuple[set[str], set[str]]:
    base = set(_ignore_lines(REPO / ".dockerignore"))
    extra = [line for line in _ignore_lines(REPO / "Dockerfile.dockerignore") if line not in base]
    return ({line for line in extra if not line.startswith("!")},
            {line[1:] for line in extra if line.startswith("!")})


def test_the_app_ignore_file_keeps_everything_the_shared_one_excludes():
    """BuildKit 见到 Dockerfile.dockerignore 就不读根目录那份：那份里的每一条（.env、node_modules……）这里都得有。"""
    own = set(_ignore_lines(REPO / "Dockerfile.dockerignore"))
    missing = [line for line in _ignore_lines(REPO / ".dockerignore") if line not in own]
    assert not missing, f"Dockerfile.dockerignore 漏了根目录 .dockerignore 的：{missing}"


def test_the_release_ignores_exactly_the_paths_the_image_leaves_out():
    excluded, kept = _extras()
    matrix = _app_matrix()
    assert excluded, "前端镜像没有多排任何路径——只改 Python 的提交又会重编前端"
    assert set(matrix.get("unchanged_paths", "").split()) == excluded
    assert set(matrix.get("kept_paths", "").split()) == kept


def _referenced_python_paths() -> set[str]:
    """前端编译会读的 slide-rule-python 下的文件：vite / tsconfig 的别名，以及 client / server / shared 的 import。"""
    found: set[str] = set()
    literal = re.compile(r"""["'](?:\./|(?:\.\./)+)?slide-rule-python/([^"'?]+)""")
    for config in ("vite.config.ts", "tsconfig.json"):
        found |= set(literal.findall((REPO / config).read_text(encoding="utf-8")))
    imports = re.compile(r"""(?:from\s+|import\s*\(\s*|import\s+)["'][^"']*slide-rule-python/([^"'?]+)""")
    for root in ("client", "server", "shared"):
        for source in (REPO / root).rglob("*"):
            if source.suffix in {".ts", ".tsx", ".mts", ".js", ".mjs"} and "node_modules" not in source.parts:
                found |= set(imports.findall(source.read_text(encoding="utf-8", errors="ignore")))
    return found


def test_nothing_the_frontend_build_reads_is_left_out():
    excluded, kept = _extras()
    referenced = _referenced_python_paths()
    assert "services/data/product_archetypes.json" in referenced          # 前提：扫得到真机踩到的那一条
    dropped = sorted(path for path in referenced
                     if "slide-rule-python" in excluded
                     and not any(("slide-rule-python/" + path).startswith(k.rstrip("/") + "/") for k in kept))
    assert not dropped, f"前端编译要读、却被 Dockerfile.dockerignore 排掉了：{dropped}"


def _stage(name: str) -> list[str]:
    text = (REPO / "Dockerfile").read_text(encoding="utf-8")
    body = re.split(r"(?m)^FROM ", text)
    stage = next(part for part in body if re.match(rf"\S+ AS {name}\b", part))
    return [line.strip() for line in stage.splitlines() if line.strip() and not line.strip().startswith("#")]


def _index(lines: list[str], needle: str) -> int:
    return next(i for i, line in enumerate(lines) if needle in line)


def test_the_runtime_stage_installs_before_anything_that_changes_every_build():
    runtime = _stage("runtime")
    install = _index(runtime, "pnpm install --frozen-lockfile --prod")
    assert install < _index(runtime, "COPY --from=builder /app/dist")
    assert install < _index(runtime, "COPY --from=builder /app/scripts")
    assert install < _index(runtime, "ARG GIT_SHA")


def test_the_build_gets_the_content_release_not_the_push_sha():
    workflow = (REPO / ".github/workflows/deploy-images.yml").read_text(encoding="utf-8")
    assert re.search(r"GIT_SHA=\$\{\{\s*steps\.release\.outputs\.sha\s*\}\}", workflow)
    assert not re.search(r"GIT_SHA=\$\{\{\s*github\.sha", workflow)
