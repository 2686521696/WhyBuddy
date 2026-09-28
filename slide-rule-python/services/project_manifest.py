"""Pure source validation and hashing, independent of storage and providers.

Accept only regular UTF-8 text files in the first project format. There is no
archive extraction or symlink representation to turn a valid logical path into
a write outside the workspace. The provider must also reject live symlinks.
"""

import fnmatch
import hashlib
import json
import re
from collections.abc import Mapping

from models.project_runtime import ManifestFile, ProjectManifest

MAX_FILE_BYTES = 512 * 1024
MAX_PROJECT_BYTES = 8 * 1024 * 1024
MAX_PROJECT_FILES = 512


def source_path(path: str) -> str:
    if not isinstance(path, str) or not path or len(path) > 240:
        raise ValueError("invalid_project_path")
    parts = path.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("invalid_project_path")
    if re.search(r"[\\:\x00-\x1f\x7f]", path):
        raise ValueError("invalid_project_path")
    for part in parts:
        if part.casefold() in (".git", "node_modules", ".venv"):
            raise ValueError("reserved_project_path")
        if part.casefold().startswith(".env") and part.casefold() not in (".env.example", ".env.sample"):
            raise ValueError("project_secret_file_forbidden")
        if part.endswith((" ", ".")):
            raise ValueError("invalid_project_path")
    return path


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def build_manifest(files: Mapping[str, str]) -> ProjectManifest:
    if not isinstance(files, Mapping) or not files or len(files) > MAX_PROJECT_FILES:
        raise ValueError("invalid_project_file_count")
    entries: list[ManifestFile] = []
    folded: set[str] = set()
    total = 0
    for path, content in sorted(files.items()):
        path = source_path(path)
        if path.casefold() in folded:
            raise ValueError("ambiguous_project_path")
        folded.add(path.casefold())
        if not isinstance(content, str) or "\x00" in content:
            raise ValueError("project_text_file_required")
        size = len(content.encode("utf-8"))
        if size > MAX_FILE_BYTES:
            raise ValueError("project_file_too_large")
        total += size
        if total > MAX_PROJECT_BYTES:
            raise ValueError("project_too_large")
        entries.append(ManifestFile(path=path, sha256=content_hash(content), sizeBytes=size))
    # File/directory aliases are forbidden too: a plus a/b cannot be materialized.
    for entry in entries:
        parts = entry.path.casefold().split("/")
        if any("/".join(parts[:i]) in folded for i in range(1, len(parts))):
            raise ValueError("ambiguous_project_path")
    tree_hash = content_hash(canonical_json([entry.model_dump() for entry in entries]))
    return ProjectManifest(treeHash=tree_hash, totalBytes=total, files=entries)


def apply_file_changes(files: Mapping[str, str], changes: Mapping[str, str | None]) -> dict[str, str]:
    if not isinstance(changes, Mapping):
        raise ValueError("invalid_project_changes")
    updated = dict(files)
    for path, content in changes.items():
        source_path(path)
        if content is None:
            if path not in updated:
                raise ValueError("project_file_not_found")
            del updated[path]
        else:
            updated[path] = content
    build_manifest(updated)
    return updated


def prepare_source_patch(files: Mapping[str, str], changes: list[dict], *, live: bool = False) -> tuple[dict[str, str], list[str]]:
    """Validate the model's exact before/after contract before any side effect.

    A running Vite process can consume source/assets. Dependency and startup
    configuration changes need a separately managed reinstall/restart; silently
    writing them would make the saved revision differ from installed execution.
    """
    replacements = {}
    for change in changes:
        path = source_path(change["path"])
        if path.casefold() == "public/__whybuddy_revision.json":
            raise ValueError("project_reserved_revision_file")
        if path in replacements:
            raise ValueError("project_duplicate_change_path")
        actual = content_hash(files[path]) if path in files else None
        if change["expectedSha256"] != actual:
            raise ValueError("project_file_hash_conflict")
        replacements[path] = change["content"]
    changed = [path for path, content in replacements.items() if files.get(path) != content]
    if live and any(path != "index.html" and not path.startswith(("src/", "public/", "tests/")) for path in changed):
        raise ValueError("project_live_patch_requires_restart")
    return apply_file_changes(files, replacements), changed


def kernel_write_changes(files: Mapping[str, str], path: str, content: str, *, append: bool = False) -> list[dict]:
    """整文件写：服务端填当前哈希，模型只给路径和正文。

    ⚠ 2026-09-16 TicketStream：`project_patch` 要 expectedSha256 + approvalRef，
      模型连猜带截断，十几次 `project_tool_arguments_invalid` /
      `project_file_hash_conflict`。泄漏的 Manus 核和 grok/Claude 的 Write
      都是 path+content。哈希仍走 prepare_source_patch，只是不让模型填。
    """
    path = source_path(path)
    if append and path in files:
        content = files[path] + content
    return [{
        "path": path,
        "content": content,
        "expectedSha256": content_hash(files[path]) if path in files else None,
    }]


def kernel_str_replace_changes(files: Mapping[str, str], path: str, old: str, new: str,
                               *, replace_all: bool = False) -> list[dict]:
    """唯一旧串替换。0 次或多于 1 次都 fail-closed，不许默默改错处。

    ⚠ 2026-09-28 隔离真机第 92 轮 sr-20260928071407-JS538JZTFK（时间记录网页，追问「整体配色换成
      暖色调，按钮改成圆角」）：style.css 里同一个色值、同一句 `border-radius: 3px` 出现在好几条
      规则里。回执只有一个裸的 project_str_replace_ambiguous——几处、在哪几行、怎么办一个字没有，
      也没有「全部替换」可选。模型一轮里撞了 10 次，中间 grep 一次才摸到行号。
      现在：多处时照旧拒（不许默默改第一处），但说清几处、哪几行、两条出路；
      replace_all=True 是明说「每一处都换」（grok / Claude 的 Edit 都有这个开关）。
    """
    path = source_path(path)
    if path not in files:
        raise ValueError("project_file_not_found")
    if not isinstance(old, str) or not old:
        raise ValueError("project_str_replace_empty")
    if not isinstance(new, str):
        raise ValueError("project_text_file_required")
    body = files[path]
    found = body.count(old)
    if found == 0:
        exc = ValueError("project_str_replace_not_found")
        exc.hint = _not_found_hint(body, old)
        raise exc
    if found > 1 and not replace_all:
        exc = ValueError("project_str_replace_ambiguous")
        exc.hint = _ambiguous_hint(body, old, found)
        raise exc
    return [{
        "path": path,
        "content": body.replace(old, new) if replace_all else body.replace(old, new, 1),
        "expectedSha256": content_hash(body),
    }]


#: 模型把参数里的转义写成了字面字符：(写成的两个字符, 文件里真正的字符, 说法)。
_LITERAL_ESCAPES = (
    ("\\n", "\n", "\\n 应是换行"),
    ("\\t", "\t", "\\t 应是制表符"),
    ('\\"', '"', '\\" 应是引号 "'),
    ("\\'", "'", "\\' 应是引号 '"),
)


def _not_found_hint(body: str, old: str) -> str:
    """一处都对不上时，说对不上在哪——只报文件里的事实，不替模型改。

    ⚠ 2026-09-28 隔离真机第 95 轮 sr-20260928090643-EN9AKT1A92（信息安全培训 PPT，追问「每页右下角加页码」）：
      一轮 12 次 project_str_replace_not_found，回执里一个字的提示都没有。翻出来的旧串两种：
      一半把换行写成了字面的反斜杠 n（`footer(slide, 1)\\\\n\\\\ndef add_overview():`）；
      另一半凭印象猜空行数、猜 `footer(slide, 4)` 其实是 5。
      前一种：换成真换行就对上，照实说（不替它改——new_str 里的 \\\\n 可能正是 Python 字符串里要的）。
      后一种：第一行在文件里找得到，就给出那一行起文件里真正的样子。
    """
    # ⚠ 2026-09-28 隔离真机第 105 轮 sr-20260928125559-X5BR6CR7QA（差旅报销 Excel，追问「加一列自动判断是否超预算」）：
    #   三发全是 `\\"超预算\\"`——引号前多了一个字面的反斜杠，文件里是普通的 `"`。
    #   第一版只认 \\n，这三发就落到「第一行也找不到」，没说错在哪。
    escapes = [(pair, real, name) for pair, real, name in _LITERAL_ESCAPES if pair in old]
    unescaped = old
    for pair, real, _name in escapes:
        unescaped = unescaped.replace(pair, real)
    if escapes and unescaped in body:
        names = "、".join(name for _pair, _real, name in escapes)
        return (f"要换的那段里多了字面的反斜杠转义（{names}），文件里这些地方没有反斜杠。"
                f"去掉那些反斜杠就能对上（{body.count(unescaped)} 处）；new_str 里也同样检查一遍"
                "（除非那个反斜杠本来就该写进文件）。")
    lines = body.split("\n")
    wanted = [line for line in old.split("\n") if line.strip()]
    if not wanted:
        return "要换的那段只有空白，文件里对不上。"
    first = wanted[0].strip()
    at = [i for i, line in enumerate(lines) if line.strip() == first]
    if not at:
        return (f"要换的那段在文件里一处都没有，第一行「{first[:80]}」也找不到。"
                "先用 file_find_in_content 找到它、或按行号 file_read 看原文，照原文抄（空格、空行一个都不能差）。")
    span = max(old.count("\n") + 1, 2)
    actual = "\n".join(lines[at[0]:at[0] + span])[:500]
    where = "、".join(str(i + 1) for i in at[:5])
    return (f"第一行在第 {where} 行找得到，往下就对不上了。文件里从第 {at[0] + 1} 行起实际是：\n{actual}\n"
            "照这个原文抄（空格、空行、数字一个都不能差）。")


def _ambiguous_hint(body: str, old: str, found: int) -> str:
    lines, start = [], 0
    while len(lines) < 8:
        at = body.find(old, start)
        if at < 0:
            break
        lines.append(body.count("\n", 0, at) + 1)
        start = at + len(old)
    shown = "、".join(str(n) for n in lines) + ("……" if found > len(lines) else "")
    return (f"要换的那段在这个文件里出现了 {found} 处（第 {shown} 行），不知道该换哪一处，一处都没改。"
            "只改其中一处：把要换的那段带上那一处前后的几行，让它只匹配一次；"
            "每一处都要换（比如同一个色值用在好几条规则里）：加 replace_all=true。")


def workspace_file_path(file: str, files: Mapping[str, str] | None = None) -> str:
    """泄漏包用绝对路径；工程源码是相对路径。剥前缀，对不上再试去掉首段。"""
    raw = str(file or "").strip().replace("\\", "/")
    raw = raw.lstrip("/")
    for prefix in ("home/ubuntu/", "workspace/", "app/"):
        if raw.lower().startswith(prefix):
            raw = raw[len(prefix):]
    if files and raw not in files:
        parts = [part for part in raw.split("/") if part]
        for index in range(1, len(parts)):
            candidate = "/".join(parts[index:])
            if candidate in files:
                return source_path(candidate)
    return source_path(raw)


def file_content_matches(text: str, regex: str, *, limit: int = 40) -> list[dict]:
    try:
        pattern = re.compile(regex)
    except re.error as exc:
        raise ValueError("project_regex_invalid") from exc
    matches = []
    for line, body in enumerate(text.splitlines(), 1):
        if pattern.search(body) is None:
            continue
        matches.append({"line": line, "text": body[:240], "excerptTruncated": len(body) > 240})
        if len(matches) >= limit:
            break
    return matches


def file_tree_matches(
    files: Mapping[str, str],
    regex: str,
    *,
    directory: str = ".",
    glob: str = "*",
    limit: int = 40,
) -> list[dict]:
    """GitHub Grep：跨文件正则。单文件 file_find_in_content 不够。"""
    found = []
    for path in file_name_matches(sorted(files), directory, glob):
        for row in file_content_matches(files[path], regex, limit=limit - len(found)):
            found.append({"path": path, **row})
            if len(found) >= limit:
                return found
    return found


def file_name_matches(paths: list[str], directory: str, glob: str) -> list[str]:
    prefix = ""
    raw = str(directory or "").strip().replace("\\", "/").lstrip("/")
    if raw not in {"", ".", "*"}:
        for prefix_name in ("home/ubuntu/", "workspace/", "app/"):
            if raw.lower().startswith(prefix_name):
                raw = raw[len(prefix_name):]
        prefix = source_path(raw) if raw else ""
    found = []
    for path in paths:
        if prefix and path != prefix and not path.startswith(prefix + "/"):
            continue
        name = path.rsplit("/", 1)[-1]
        if fnmatch.fnmatch(name, glob) or fnmatch.fnmatch(path, glob):
            found.append(path)
    return found
