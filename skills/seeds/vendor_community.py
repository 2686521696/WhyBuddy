# -*- coding: utf-8 -*-
"""按 index.json 打出民间 / 非官方种子 zip。

官方 anthropics 包仍走 vendor_anthropic.py。这里只打 index 里
archive 不是 anthropics/skills 的条目。

⚠ 2026-09-20：GitHub 上「380 份 / 181 份 / 1000+」那种目录墙不能整包搬。
2026-07-27 已经 yank 过 889 张社区卡片。这里只进手艺包：
完整 SKILL.md、仓根有 LICENSE、不强制第三方 key、不抢控制面调度。
"""

from __future__ import annotations

import io
import json
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from urllib.request import urlopen

OUT = Path(__file__).resolve().parent
INDEX = OUT / "index.json"
ANTHROPIC_MARK = "anthropics/skills"


def _packages() -> list[dict[str, str]]:
    raw = json.loads(INDEX.read_text(encoding="utf-8"))
    packages = raw.get("packages") if isinstance(raw, dict) else raw
    if not isinstance(packages, list):
        raise SystemExit("skill_seed_index_empty")
    return [item for item in packages if ANTHROPIC_MARK not in str(item.get("archive") or "")]


def _archive(url: str) -> zipfile.ZipFile:
    last: Exception | None = None
    for attempt in range(1, 4):
        try:
            dest = Path(tempfile.gettempdir()) / f"sliderule-skill-archive-{attempt}.zip"
            with urlopen(url, timeout=180) as resp, dest.open("wb") as out:
                while True:
                    chunk = resp.read(1024 * 256)
                    if not chunk:
                        break
                    out.write(chunk)
            return zipfile.ZipFile(dest)
        except Exception as exc:
            last = exc
            time.sleep(2 * attempt)
    raise SystemExit(f"archive_download_failed:{url}:{last}")


def _license_bytes(archive: zipfile.ZipFile) -> bytes:
    names = archive.namelist()
    for name in names:
        tail = name.rsplit("/", 1)[-1].lower()
        if tail in {"license", "license.md", "license.txt"} and name.count("/") <= 1:
            return archive.read(name)
    raise SystemExit("missing_repo_license")


ROOT_KEEP_DIRS = frozenset(
    {"scripts", "resources", "standards", "templates", "references"}
)
ROOT_SKIP_DIRS = frozenset({"dev", "viewer", "assets", "integrations", ".git"})


def _find_skill_md(names: list[str], slug: str, path: str = "") -> str:
    # ⚠ 2026-10-01：alirezarezvani/claude-skills 同一份 financial-analyst 有 finance/skills/、.gemini/skills/、
    #   .codex/skills/ 三处，按 /skills/<slug>/ 找会拿到 zip 里先出现的那份（.gemini 的只有 SKILL.md、没有脚本）。
    #   索引可以用 path 钉死仓内目录。
    if path:
        wanted = path.strip("/").lower() + "/skill.md"
        for name in names:
            rel = name.replace("\\", "/").split("/", 1)[-1].lower()
            if rel == wanted:
                return name
        return ""
    needle = f"/skills/{slug}/skill.md"
    for name in names:
        lower = name.lower()
        if lower.endswith(needle) or lower == needle.lstrip("/"):
            return name
    # 仓根 SKILL.md：GitHub zip 形如 office-skills-main/SKILL.md
    for name in names:
        parts = name.replace("\\", "/").split("/")
        if len(parts) == 2 and parts[1].lower() == "skill.md":
            return name
    return ""


def _keep_root_rel(rel: str) -> bool:
    parts = [part for part in rel.replace("\\", "/").split("/") if part]
    if not parts:
        return False
    if any(part.lower() in ROOT_SKIP_DIRS for part in parts):
        return False
    if len(parts) == 1:
        return True
    return parts[0].lower() in ROOT_KEEP_DIRS


def _pack(archive: zipfile.ZipFile, slug: str, license_blob: bytes,
          path: str = "", exclude: tuple[str, ...] = ()) -> None:
    names = archive.namelist()
    skill_md = _find_skill_md(names, slug, path)
    if not skill_md:
        raise SystemExit(f"missing_skill_md:{slug}")
    prefix = skill_md[: -len("SKILL.md")]
    root = skill_md.replace("\\", "/").count("/") == 1
    members = [name for name in names if name.startswith(prefix) and not name.endswith("/")]
    dest = OUT / f"{slug}.zip"
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as out:
        have_license = False
        wrote = 0
        for name in members:
            rel = name[len(prefix) :]
            if root and not _keep_root_rel(rel):
                continue
            # ⚠ 2026-10-01：在克隆目录里试跑过脚本，__pycache__/*.pyc 跟着进了 ui-ux-pro-max.zip。编译缓存一律不进包。
            if "__pycache__" in rel.split("/") or rel.endswith(".pyc"):
                continue
            # 索引里的 exclude：商店单文件上限 512KB（skill_package_format），超的数据文件和上游自测不进包
            if any(rel == item or rel.startswith(item.rstrip("/") + "/") for item in exclude):
                continue
            packed = f"{slug}/{rel}"
            out.writestr(packed, archive.read(name))
            wrote += 1
            if packed.rsplit("/", 1)[-1].lower() in {"license", "license.md", "license.txt"}:
                have_license = True
        if wrote == 0:
            raise SystemExit(f"empty_skill_zip:{slug}")
        if not have_license:
            out.writestr(f"{slug}/LICENSE", license_blob)
    print(dest.name, dest.stat().st_size)


def _checkout_archive(directory: Path) -> zipfile.ZipFile:
    """本地 git 克隆当成 GitHub zip 用（顶层多一层「仓名-main/」，跟 codeload 的形状一样）。

    ⚠ 2026-10-01：codeload.github.com 在受限出口下 403，git clone 通。"""
    buf = io.BytesIO()
    top = directory.name + "-main"
    with zipfile.ZipFile(buf, "w") as out:
        for file in sorted(directory.rglob("*")):
            if file.is_file() and ".git" not in file.relative_to(directory).parts:
                out.write(file, f"{top}/{file.relative_to(directory).as_posix()}")
    buf.seek(0)
    return zipfile.ZipFile(buf)


def _repo_of(url: str) -> str:
    # https://codeload.github.com/<owner>/<repo>/zip/refs/heads/main → owner/repo
    parts = url.split("codeload.github.com/", 1)[-1].split("/")
    return "/".join(parts[:2])


def main(argv: list[str] | None = None) -> None:
    """``--checkout owner/repo=/path/to/clone`` 可给多次：那个仓不下载，用本地克隆打。"""
    args = list(sys.argv[1:] if argv is None else argv)
    checkouts: dict[str, Path] = {}
    while args:
        flag = args.pop(0)
        if flag != "--checkout" or not args or "=" not in args[0]:
            raise SystemExit("usage: vendor_community.py [--checkout owner/repo=/path] ...")
        repo, where = args.pop(0).split("=", 1)
        checkouts[repo.strip()] = Path(where).expanduser().resolve()
    cache: dict[str, zipfile.ZipFile] = {}
    licenses: dict[str, bytes] = {}
    for item in _packages():
        slug = str(item.get("slug") or "").strip()
        url = str(item.get("archive") or "").strip()
        if not slug or not url:
            raise SystemExit("seed_row_incomplete")
        if (OUT / f"{slug}.zip").is_file():
            print(f"{slug}.zip skip")
            continue
        if url not in cache:
            local = checkouts.get(_repo_of(url))
            cache[url] = _checkout_archive(local) if local else _archive(url)
            licenses[url] = _license_bytes(cache[url])
        _pack(cache[url], slug, licenses[url], str(item.get("path") or ""),
              tuple(str(x) for x in item.get("exclude") or ()))


if __name__ == "__main__":
    main()
