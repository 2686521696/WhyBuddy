"""命令跑完，沙盒里的工程目录跟写进去时比，哪些源码文件变了：交回给工人写成新的源码版本。

⚠ 2026-10-09：工程源码的权威在库里，每条命令开跑前工人按库里那版把文件写进沙盒——命令在沙盒里
  生成、改动的文件，下一条命令就被还原。官方脚手架（npm create vue、django-admin startproject、
  cargo new、dotnet new、composer create-project）因此全部白跑；`npm install chart.js` 改了 package.json，
  下一条命令又没了。2026-09-29 第 107 轮那次（python heredoc 改了脚本，下一条命令被还原）当时只做到
  「点名告诉模型」（project_runtime_worker._note_sandbox_only_edits）。这里把命令的结果收回成新版本：
  源码仍是权威，只是命令做的事也进了源码。

哪些算源码：先认项目自己的 .gitignore（git 的标准规则，按每一层的 .gitignore 算），再挡掉依赖、构建产物和
平台自己放进去的东西（下面三张表）。源码库只收文本：二进制、超大的文件不收，点名报回去，不假装收了。

本模块是叶子：脚本是字符串，在沙盒里用 python3 跑（stdin 进 JSON、stdout 出 JSON），本机测试直接跑同一份。
"""

from __future__ import annotations

#: 任何一层叫这个名字的目录都不收：依赖、构建产物、缓存、虚拟环境。
EXCLUDED_DIRS = (
    ".git", "node_modules", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".vite", ".turbo",
    ".parcel-cache", ".cache", "coverage", "target", "vendor", "venv", ".venv", "__pycache__",
    ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox", ".gradle", "obj", ".dart_tool", ".idea", ".vscode",
)
#: 这些前缀下的不收：平台放进去的技能、交付文件（产物库另收）、命令暂存。
EXCLUDED_PREFIXES = (".sliderule/", "output/", ".whybuddy")
#: 任何一层的「bin/Debug」「bin/Release」：.NET 的构建输出。bin 本身不能整个挡——Rails 的 bin/rails 是源码。
#: ⚠ 2026-10-09 真 E2B（dotnet new webapi -o api && dotnet build）：只挡根上的 bin/Debug，api/bin/Debug/net8.0/
#:   下的 api.deps.json、runtimeconfig.json 被当源码收了，dll 被报成「二进制没收」——全是噪音。
EXCLUDED_BUILD_PAIRS = (("bin", "Debug"), ("bin", "Release"))
#: 单个文件。修订标记是工人写的，不是源码——根上一份（project_runtime.REVISION_FILE），public/ 下一份
#: （workspace_provider.PROJECT_REVISION_FILE，Vite 从这儿发给探活）。两处都由测试钉着（§4）。
#: ⚠ 2026-10-09 第一版只挡了根上那份：真工人跑一条什么都没改的命令，也添了一版，收回的正是 public/ 下那份标记。
EXCLUDED_FILES = ("__whybuddy_revision.json", "public/__whybuddy_revision.json", ".DS_Store")

SCAN_SCRIPT = r'''
import hashlib, json, os, subprocess, sys, tempfile
req = json.load(sys.stdin)
root, synced = req["root"], req["synced"]
excluded_dirs, prefixes, files_out = set(req["excludedDirs"]), tuple(req["excludedPrefixes"]), set(req["excludedFiles"])
max_file, max_total, max_listed = req["maxFile"], req["maxTotal"], req["maxListed"]
skip_paths = set(req.get("skipPaths") or [])

pairs = {tuple(pair) for pair in req["excludedBuildPairs"]}

def excluded(path):
    parts = path.split("/")
    return (any(p in excluded_dirs for p in parts[:-1]) or path in files_out or path in skip_paths
            or any(path.startswith(p) for p in prefixes)
            or any((parts[i], parts[i + 1]) in pairs for i in range(len(parts) - 2)))

def git_list(rel):
    """rel 这一层（以及里面自带 .git 的子仓库）未被忽略的文件。项目自己的 .git 不碰：另起一个临时仓库。"""
    top = os.path.join(root, rel) if rel else root
    with tempfile.TemporaryDirectory() as gd:
        env = {**os.environ, "GIT_DIR": gd, "GIT_WORK_TREE": top}
        subprocess.run(["git", "init", "-q"], env=env, check=True, capture_output=True, timeout=30)
        out = subprocess.run(["git", "ls-files", "-z", "--others", "--exclude-standard"], env=env, cwd=top,
                             check=True, capture_output=True, timeout=120).stdout
    found = []
    for name in out.decode("utf-8", "surrogateescape").split("\0"):
        if not name:
            continue
        if name.endswith("/"):                      # 子目录自己 git init 过（create-next-app、cargo new）：钻进去
            if name.rstrip("/").split("/")[-1] not in excluded_dirs:
                found += git_list(rel + name)
        else:
            found.append(rel + name)
    return found

def walk_list():
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel = os.path.relpath(dirpath, root)
        rel = "" if rel == "." else rel.replace(os.sep, "/") + "/"
        dirnames[:] = [d for d in dirnames if d not in excluded_dirs]
        found += [rel + f for f in filenames]
    return found

try:
    listed, lister = git_list(""), "git"
except Exception:
    listed, lister = walk_list(), "walk"
listed = sorted(p for p in listed if not excluded(p))
changed, skipped, total, truncated = {}, [], 0, len(listed) > max_listed
present = set()
for path in listed[:max_listed]:
    full = os.path.join(root, path)
    if os.path.islink(full) or not os.path.isfile(full):
        continue
    present.add(path)
    size = os.path.getsize(full)
    if size > max_file:                            # 写进去的都不超过上限：超了就是新来的或长大了的
        skipped.append({"path": path, "reason": "too_large"})
        continue
    with open(full, "rb") as fh:
        data = fh.read()
    if hashlib.sha256(data).hexdigest() == synced.get(path):
        continue
    if b"\x00" in data:
        skipped.append({"path": path, "reason": "binary"})
        continue
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        skipped.append({"path": path, "reason": "binary"})
        continue
    if total + len(data) > max_total:
        skipped.append({"path": path, "reason": "project_too_large"})
        continue
    total += len(data)
    changed[path] = text
deleted = sorted(p for p in synced if not excluded(p) and not os.path.lexists(os.path.join(root, p)))
json.dump({"changed": changed, "deleted": deleted, "skipped": skipped[:50], "lister": lister,
           "truncated": truncated}, sys.stdout, ensure_ascii=False)
'''


def scan_request(root: str, synced_hashes: dict[str, str], *, max_file: int, max_total: int,
                 skip_paths=(), max_listed: int = 5000) -> dict:
    """喂给 SCAN_SCRIPT 的那一份 JSON（沙盒与本机测试同一个入口）。"""
    return {"root": root, "synced": dict(synced_hashes), "excludedDirs": list(EXCLUDED_DIRS),
            "excludedPrefixes": list(EXCLUDED_PREFIXES), "excludedFiles": list(EXCLUDED_FILES),
            "excludedBuildPairs": [list(pair) for pair in EXCLUDED_BUILD_PAIRS],
            "maxFile": max_file, "maxTotal": max_total, "maxListed": max_listed, "skipPaths": list(skip_paths)}
