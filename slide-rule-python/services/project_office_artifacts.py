"""Office deliverables live next to source, not inside the UTF-8 revision tree.

⚠ 2026-09-20 真机 sr-20260920090915-OFFICEAT：bash 写出了 generate_deck.py，
  python-pptx 的 .pptx 停在 E2B 磁盘上。主机源码库是 dict[str,str]，
  file_read run.log 得到 project_file_not_found，右边只剩 Vite 登录页。

  产物按解码后的文件字节做 CAS。generate_deck.py 继续只活在文本 revision。
  收集失败 fail-open；有没有交付物 fail-closed。
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Mapping
from urllib.parse import unquote, urlsplit

from services.deliverable_kind import (
    OFFICE_FILE_NOT_TEXT,
    TEXT_DELIVERABLE_EXTENSIONS,
    deliverable_suffix,
    is_auto_collected_text,
    is_deliverable_bytes,
    is_office_zip_bytes,
    office_artifact_suffix,
    office_preview_payload,
)
from services.project_manifest import source_path
from services.project_store import ProjectNotFound, ProjectStoreUnavailable

MAX_OFFICE_ARTIFACT_BYTES = 8 * 1024 * 1024
MAX_PROJECT_OFFICE_BYTES = 32 * 1024 * 1024
_DDL = (
    "create table if not exists wb_project_office_artifact("
    "id varchar(80) primary key, project_id varchar(80) not null, path varchar(240) not null, "
    "sha256 varchar(64) not null, size_bytes integer not null, created_at text not null)",
    "create table if not exists wb_project_office_content("
    "hash varchar(64) primary key, size_bytes integer not null, content text not null)",
    "create table if not exists wb_project_office_preview("
    "artifact_id varchar(80) primary key, kind varchar(32) not null, "
    "sha256 varchar(64) not null, size_bytes integer not null, content text not null)",
    "create table if not exists wb_project_office_budget("
    "project_id varchar(80) primary key, reserved_bytes bigint not null)",
    # ⚠ 2026-09-30 隔离真机第 140 轮（租房指南 Word，两轮追问各改一次）：wb_project_office_artifact
    #   一条路径一行，追问改完就把 sha 覆盖掉——上一版文件在界面上再也找不回来，「版本切换」无从谈起。
    #   字节本来是 CAS（wb_project_office_content 按 hash 存、从不删），缺的只是「这条路径先后指过哪些 hash」。
    "create table if not exists wb_project_office_version("
    "artifact_id varchar(80) not null, project_id varchar(80) not null, path varchar(240) not null, "
    "sha256 varchar(64) not null, size_bytes integer not null, captured_at text not null, "
    "primary key(artifact_id, sha256))",
)


def decode_office_write(content: str, *, encoding: str | None) -> bytes:
    if str(encoding or "").strip() != "base64":
        raise ValueError(OFFICE_FILE_NOT_TEXT)
    try:
        data = base64.b64decode(content, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError(OFFICE_FILE_NOT_TEXT) from exc
    if not is_office_zip_bytes(data):
        raise ValueError(OFFICE_FILE_NOT_TEXT)
    if not 4 <= len(data) <= MAX_OFFICE_ARTIFACT_BYTES:
        raise ValueError("project_office_file_too_large")
    return data


def accepted_preview_pdf(data: bytes | None) -> bytes | None:
    """沙盒转出来的 PDF。不是 %PDF、或超过产物上限，就当没有。"""
    if not isinstance(data, (bytes, bytearray)):
        return None
    blob = bytes(data)
    if not blob.startswith(b"%PDF") or not 5 <= len(blob) <= MAX_OFFICE_ARTIFACT_BYTES:
        return None
    return blob


def try_host_pdf(data: bytes, path: str) -> bytes | None:
    """有 soffice 才转。没有或失败返回 None——预览 fail-open。"""
    suffix = office_artifact_suffix(path)
    if suffix is None:
        return None
    binary = shutil.which("soffice") or shutil.which("libreoffice")
    if not binary:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="wb_office_") as folder:
            src = Path(folder) / f"in{suffix}"
            src.write_bytes(data)
            subprocess.run(
                [binary, "--headless", "--norestore", "--convert-to", "pdf",
                 "--outdir", folder, str(src)],
                check=False, capture_output=True, timeout=60,
            )
            pdfs = list(Path(folder).glob("*.pdf"))
            if not pdfs:
                return None
            pdf = pdfs[0].read_bytes()
            if not pdf.startswith(b"%PDF") or len(pdf) > MAX_OFFICE_ARTIFACT_BYTES:
                return None
            return pdf
    except (OSError, subprocess.SubprocessError):
        return None


class ProjectOfficeArtifactStore:
    def __init__(self, store):
        self.store = store
        for sql in _DDL:
            store._q(sql)

    def _require_project(self, project_id: str, owner_id: str) -> None:
        self.store.get_project(project_id, owner_id=owner_id)

    def put(self, project_id: str, *, owner_id: str, path: str, data: bytes) -> dict:
        self._require_project(project_id, owner_id)
        rel = source_path(str(path or "").replace("\\", "/").lstrip("/"))
        if deliverable_suffix(rel) is None:
            raise ValueError("project_office_path_required")
        payload = bytes(data)
        # 办公文件认 zip 包，文本交付物认 UTF-8（deliverable_kind.TEXT_DELIVERABLE_EXTENSIONS 头注）。
        if not is_deliverable_bytes(rel, payload):
            raise ValueError("project_office_zip_required")
        if not 4 <= len(payload) <= MAX_OFFICE_ARTIFACT_BYTES:
            raise ValueError("project_office_file_too_large")
        digest = hashlib.sha256(payload).hexdigest()
        existing = self.store._q(
            "select id,sha256,size_bytes from wb_project_office_artifact "
            "where project_id=$1 and path=$2",
            [project_id, rel],
        )
        if existing and existing[0]["sha256"] == digest:
            self._ensure_preview(existing[0]["id"], payload, rel)
            return self._row(existing[0]["id"])
        if existing and existing[0]["sha256"] != digest:
            # 文件字节变了，旧的 HTML/PDF 预览还指着上一份。
            self.store._q(
                "delete from wb_project_office_preview where artifact_id=$1",
                [existing[0]["id"]],
            )
        if not self.store._q("select hash from wb_project_office_content where hash=$1", [digest]):
            self.store._q(
                "insert into wb_project_office_budget(project_id,reserved_bytes) "
                "select $1,0 where not exists("
                "select 1 from wb_project_office_budget where project_id=$1)",
                [project_id],
            )
            grew = self.store._q(
                "update wb_project_office_budget set reserved_bytes=reserved_bytes+$1 "
                "where project_id=$2 and reserved_bytes+$1<=$3 returning project_id",
                [len(payload), project_id, MAX_PROJECT_OFFICE_BYTES],
            )
            if not grew:
                raise ValueError("project_office_budget")
            self.store._q(
                "insert into wb_project_office_content(hash,size_bytes,content) values($1,$2,$3) "
                "on conflict(hash) do nothing",
                [digest, len(payload), base64.b64encode(payload).decode("ascii")],
            )
        identity = json.dumps([project_id, rel, digest], separators=(",", ":"))
        artifact_id = existing[0]["id"] if existing else "art-" + hashlib.sha256(
            identity.encode()
        ).hexdigest()[:40]
        captured = datetime.now(timezone.utc).isoformat()
        if existing:
            self.store._q(
                "update wb_project_office_artifact set sha256=$1,size_bytes=$2,created_at=$3 "
                "where id=$4",
                [digest, len(payload), captured, artifact_id],
            )
        else:
            self.store._q(
                "insert into wb_project_office_artifact"
                "(id,project_id,path,sha256,size_bytes,created_at) values($1,$2,$3,$4,$5,$6)",
                [artifact_id, project_id, rel, digest, len(payload), captured],
            )
        self._record_version(artifact_id, project_id, rel, digest, len(payload), captured)
        self._ensure_preview(artifact_id, payload, rel)
        return self._row(artifact_id)

    def _record_version(self, artifact_id: str, project_id: str, path: str, sha256: str,
                        size_bytes: int, captured: str) -> None:
        """这条路径指过的一份字节。同一份再次出现（恢复旧版）只把时间挪到最新。"""
        self.store._q(
            "insert into wb_project_office_version"
            "(artifact_id,project_id,path,sha256,size_bytes,captured_at) values($1,$2,$3,$4,$5,$6) "
            "on conflict(artifact_id,sha256) do update set captured_at=excluded.captured_at",
            [artifact_id, project_id, path, sha256, size_bytes, captured],
        )

    def versions(self, project_id: str, artifact_id: str, *, owner_id: str) -> list[dict]:
        """这份文件先后收回过的版本，新的在前；当前那份标 current。

        记版本之前收回的文件没有记录：把当前这份补记一条，列表至少有它自己。
        """
        self._require_project(project_id, owner_id)
        meta = self._row(artifact_id)
        if meta["projectId"] != project_id:
            raise ProjectNotFound("project_office_artifact_not_found")
        rows = self.store._q(
            "select sha256,size_bytes,captured_at from wb_project_office_version "
            "where artifact_id=$1 order by captured_at desc",
            [artifact_id],
        )
        if not any(row["sha256"] == meta["sha256"] for row in rows):
            self._record_version(artifact_id, project_id, meta["path"], meta["sha256"],
                                 meta["sizeBytes"], meta["createdAt"])
            rows = [{"sha256": meta["sha256"], "size_bytes": meta["sizeBytes"],
                     "captured_at": meta["createdAt"]}, *rows]
        total = len(rows)
        return [{"sha256": row["sha256"], "sizeBytes": row["size_bytes"], "capturedAt": row["captured_at"],
                 "number": total - index, "current": row["sha256"] == meta["sha256"]}
                for index, row in enumerate(rows)]

    def get_version_bytes(self, project_id: str, artifact_id: str, sha256: str, *,
                          owner_id: str) -> tuple[dict, bytes]:
        """这份文件的某一个历史版本。只认这条路径真的指过的 hash——不许拿任意 hash 去读别人的字节。"""
        self._require_project(project_id, owner_id)
        meta = self._row(artifact_id)
        if meta["projectId"] != project_id:
            raise ProjectNotFound("project_office_artifact_not_found")
        known = self.store._q(
            "select 1 as ok from wb_project_office_version where artifact_id=$1 and sha256=$2",
            [artifact_id, sha256],
        )
        if not known and sha256 != meta["sha256"]:
            raise ProjectNotFound("project_office_version_not_found")
        rows = self.store._q(
            "select content,size_bytes from wb_project_office_content where hash=$1", [sha256])
        if not rows:
            raise ProjectStoreUnavailable("project_office_content_missing")
        data = base64.b64decode(rows[0]["content"], validate=True)
        if hashlib.sha256(data).hexdigest() != sha256:
            raise ProjectStoreUnavailable("project_office_content_corrupt")
        return {**meta, "sha256": sha256, "sizeBytes": len(data)}, data

    def files_as_of(self, project_id: str, *, owner_id: str, before: str | None) -> dict[str, bytes]:
        """每份办公文件在某个时刻之前最后收回的那一版（before=None 就是当前版）。复刻历史源码版本用。

        那个时刻还没收回过的文件不算；记版本之前收回、又没有版本记录的，只认得当前那一份。
        """
        out: dict[str, bytes] = {}
        for meta in self.list(project_id, owner_id=owner_id):
            sha = meta["sha256"]
            if before is not None:
                rows = self.store._q(
                    "select sha256 from wb_project_office_version where artifact_id=$1 and captured_at<$2 "
                    "order by captured_at desc limit 1",
                    [meta["artifactId"], before],
                )
                if rows:
                    sha = rows[0]["sha256"]
                elif str(meta["createdAt"]) >= before:
                    continue
            _meta, data = self.get_version_bytes(project_id, meta["artifactId"], sha, owner_id=owner_id)
            out[meta["path"]] = data
        return out

    def restore_version(self, project_id: str, artifact_id: str, sha256: str, *, owner_id: str) -> dict:
        """把某个历史版本重新设为当前。历史不丢：当前那份仍在版本列表里。"""
        meta, data = self.get_version_bytes(project_id, artifact_id, sha256, owner_id=owner_id)
        return self.put(project_id, owner_id=owner_id, path=meta["path"], data=data)

    def _row(self, artifact_id: str) -> dict:
        rows = self.store._q(
            "select id,project_id,path,sha256,size_bytes,created_at "
            "from wb_project_office_artifact where id=$1",
            [artifact_id],
        )
        if not rows:
            raise ProjectNotFound("project_office_artifact_not_found")
        row = rows[0]
        return {
            "artifactId": row["id"],
            "projectId": row["project_id"],
            "path": row["path"],
            "sha256": row["sha256"],
            "sizeBytes": row["size_bytes"],
            "createdAt": row["created_at"],
            "downloadable": True,
        }

    def list(self, project_id: str, *, owner_id: str) -> list[dict]:
        self._require_project(project_id, owner_id)
        rows = self.store._q(
            "select id from wb_project_office_artifact where project_id=$1 order by created_at",
            [project_id],
        )
        return [self._row(row["id"]) for row in rows]

    def has_any(self, project_id: str, *, owner_id: str) -> bool:
        self._require_project(project_id, owner_id)
        rows = self.store._q(
            "select 1 as ok from wb_project_office_artifact where project_id=$1 limit 1",
            [project_id],
        )
        return bool(rows)

    def get_bytes(self, project_id: str, artifact_id: str, *, owner_id: str) -> tuple[dict, bytes]:
        self._require_project(project_id, owner_id)
        meta = self._row(artifact_id)
        if meta["projectId"] != project_id:
            raise ProjectNotFound("project_office_artifact_not_found")
        rows = self.store._q(
            "select content,size_bytes from wb_project_office_content where hash=$1",
            [meta["sha256"]],
        )
        if not rows:
            raise ProjectStoreUnavailable("project_office_content_missing")
        try:
            data = base64.b64decode(rows[0]["content"], validate=True)
        except ValueError as exc:
            raise ProjectStoreUnavailable("project_office_content_corrupt") from exc
        if len(data) != rows[0]["size_bytes"] or hashlib.sha256(data).hexdigest() != meta["sha256"]:
            raise ProjectStoreUnavailable("project_office_content_corrupt")
        return meta, data

    def find_by_path(self, project_id: str, path: str, *, owner_id: str) -> dict | None:
        self._require_project(project_id, owner_id)
        try:
            rel = source_path(str(path or "").replace("\\", "/").lstrip("/"))
        except ValueError:
            return None
        rows = self.store._q(
            "select id from wb_project_office_artifact where project_id=$1 and path=$2",
            [project_id, rel],
        )
        return self._row(rows[0]["id"]) if rows else None

    def get_preview(self, project_id: str, artifact_id: str, *, owner_id: str) -> dict | None:
        self._require_project(project_id, owner_id)
        meta = self._row(artifact_id)
        if meta["projectId"] != project_id:
            raise ProjectNotFound("project_office_artifact_not_found")
        rows = self.store._q(
            "select kind,content from wb_project_office_preview where artifact_id=$1",
            [artifact_id],
        )
        if not rows:
            return None
        kind = rows[0]["kind"]
        if kind == "pdf":
            return {"kind": "pdf", "content": rows[0]["content"]}
        try:
            payload = json.loads(base64.b64decode(rows[0]["content"], validate=True))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        # ⚠ 2026-09-22 已入库的预览只有正文。后来启动会那份有了 shapes，
        #   但封面白字在 defRPr 上，入库时被丢掉。有坐标就不再重读，
        #   深蓝底上标题继续画成近黑。幻灯片每次按文件字节重算。
        #   算失败才退回库里的 JSON，不把预览打成 500。
        if payload.get("kind") == "slides":
            try:
                _meta, data = self.get_bytes(project_id, artifact_id, owner_id=owner_id)
                fresh = office_preview_payload(data, meta["path"])
                if isinstance(fresh, dict) and fresh.get("kind") == "slides":
                    return fresh
            except Exception:
                return payload
        return payload

    def _write_pdf_preview(self, artifact_id: str, pdf: bytes) -> None:
        self.store._q(
            "delete from wb_project_office_preview where artifact_id=$1",
            [artifact_id],
        )
        digest = hashlib.sha256(pdf).hexdigest()
        self.store._q(
            "insert into wb_project_office_preview"
            "(artifact_id,kind,sha256,size_bytes,content) values($1,$2,$3,$4,$5)",
            [artifact_id, "pdf", digest, len(pdf),
             base64.b64encode(pdf).decode("ascii")],
        )

    def _ensure_preview(self, artifact_id: str, data: bytes, path: str) -> None:
        # ⚠ 2026-09-23 review：这里原本先收一份 `preview_pdf`（沙盒里 soffice
        #   转的），但同一批提交里预览改成浏览器端 @silurus/ooxml 画原字节，
        #   沙盒转 PDF 那条路（render_office_pdf）一个调用者都没有，这个参数
        #   也就从来没人传——删掉。主机上有 soffice 时 try_host_pdf 仍是退路。
        present = self.store._q(
            "select artifact_id from wb_project_office_preview where artifact_id=$1",
            [artifact_id],
        )
        if present:
            return
        pdf = accepted_preview_pdf(try_host_pdf(data, path))
        if pdf:
            self._write_pdf_preview(artifact_id, pdf)
            return
        payload = office_preview_payload(data, path)
        if not payload:
            return
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.store._q(
            "insert into wb_project_office_preview"
            "(artifact_id,kind,sha256,size_bytes,content) values($1,$2,$3,$4,$5)",
            [artifact_id, str(payload.get("kind") or "slides"),
             hashlib.sha256(raw).hexdigest(), len(raw),
             base64.b64encode(raw).decode("ascii")],
        )


# 给测试/路由一个稳定 id 前缀，避免和会话 id 撞。
def office_artifact_download_url(project_id: str, artifact_id: str) -> str:
    """用户点得开的下载地址（同源、带登录 cookie）。

    ⚠ 2026-09-25 luna 隔离真机 sr-20260925003931-HP3KEB33FR：回执只给了
      沙盒路径，模型交给用户的是 `[下载…](sandbox:/home/user/workspace/…pptx)`，
      那是 E2B 里的路径，用户点不开。地址必须由宿主给，不许让模型猜。
    ⚠ 成对物：前端 `office-artifacts-client.ts::officeArtifactDownloadUrl`
      拼的是同一个地址（路由在 routes/project_sources.py）。改一边要改另一边。
    """
    return f"/api/sliderule/projects/{project_id}/artifacts/{artifact_id}"


#: markdown 链接 `[字](地址)`；地址里不许有空白和右括号（模型写的都是这种）。
_MD_LINK = re.compile(r"\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?\s*\)")
_USABLE_TARGET = re.compile(r"^(?:https?:|mailto:|/api/)", re.IGNORECASE)
_SANDBOX_SCHEME = re.compile(r"^sandbox:", re.IGNORECASE)


#: 沙盒里工作区的根（e2b_workspace_provider.PROJECT_ROOT）。模型写的绝对路径去掉它才是源码树里的路径。
_WORKSPACE_PREFIXES = ("/home/user/workspace/", "/home/user/", "/workspace/", "./")


def linked_text_deliverables(text: str, files: Mapping[str, str]) -> list[str]:
    """模型给用户的话里，用 `[字](路径)` 链接到的、源码树里的文本交付物（.md / .txt / .csv）。

    ⚠ 2026-10-04 真机 @doc-coauthoring 团队周会制度 sr-20261004174725-J5XFTG8673：收尾是
      `[team-weekly-meeting-guide.md](/home/user/workspace/team-weekly-meeting-guide.md)`。文件是 file_write 写进
      源码树的，产物库里没有它，链接换不成下载地址，用户点不开。
      照 Manus 的做法：交付就是「把文件附上」——这句话里的链接就是那份声明。链到的文件由宿主收进产物库。

    只认链接目标**逐字落在源码树里**的路径（去掉 sandbox:、工作区前缀之后），对不上的不猜；
    同名文件只有一份时才按文件名认。http(s) / mailto / /api/ 原样放过。
    """
    if not text or "](" not in text or not files:
        return []
    by_name: dict[str, list[str]] = {}
    for path in files:
        by_name.setdefault(Path(str(path)).name, []).append(str(path))
    found: list[str] = []
    for match in _MD_LINK.finditer(text):
        target = match.group(2).replace("\\/", "/")
        if _USABLE_TARGET.match(target):
            continue
        target = unquote(_SANDBOX_SCHEME.sub("", target))
        rel = target
        for prefix in _WORKSPACE_PREFIXES:
            if rel.startswith(prefix):
                rel = rel[len(prefix):]
                break
        rel = rel.lstrip("/")
        if deliverable_suffix(rel) not in TEXT_DELIVERABLE_EXTENSIONS:
            continue
        hit = rel if rel in files else None
        if hit is None:
            same = by_name.get(Path(rel).name) or []
            hit = same[0] if len(same) == 1 else None
        # ⚠ 2026-10-05 真机 @office-skills 奶茶店销售 Excel sr-20261005042518-6HZ395D3NQ：xlsx 一份没生成，
        #   收尾链了 office-skills 的工作说明 `[INSTRUCT.md](…)`，上一版把它收进产物库——办公目标的完工闸
        #   （has_any）就此亮了，这一轮判成 completed。假绿灯（§七）。交付物只认 output/（跟沙盒自动收同一条规矩）；
        #   INSTRUCT.md / LOG.md / README.md 是工作文件，链了也不是交付。
        if hit is not None and not is_auto_collected_text(hit):
            hit = None
        if hit is not None and hit not in found:
            found.append(hit)
    return found[:8]


def rewrite_deliverable_links(text: str, downloads: Mapping[str, str]) -> str:
    """模型给用户的话里，指向办公文件的假地址换成宿主给的真下载地址。

    ⚠ 2026-09-27 隔离真机 sr-20260927055919-BC2H6NDWZT：回执里写着真链接和
      「不要写沙盒里的路径」，模型收尾照样给了
      `[2026_Q3_Product_Review.pptx](sandbox:/mnt/data/2026_Q3_Product_Review.pptx)`——
      连路径都是编的（/mnt/data 是别家沙盒的习惯）。前端把它画成不可点的字
      （SessionStory 的 CLOSING_MARKDOWN），用户在收尾那句话里拿不到文件。
      只靠提示词挡不住，宿主手里有真地址，就由宿主换。

    只换**文件名对得上**本工程已收回文件的那种：`sandbox:`、`/mnt/…`、
    `/home/user/…`、裸相对路径都算。对不上的不猜——猜错比不可点更糟。
    http(s)、mailto、已经是 /api/ 的原样放过。
    """
    if not text or not downloads or "](" not in text:
        return text
    by_name: dict[str, str] = {}
    for path, url in downloads.items():
        name = Path(str(path)).name
        if name and isinstance(url, str) and url.startswith("/api/"):
            by_name.setdefault(name, url)

    known = set(by_name.values())
    path_of = {url: str(path) for path, url in downloads.items() if isinstance(url, str) and url.startswith("/api/")}

    def swap(match: re.Match) -> str:
        return _honest_format(_swap(match), path_of)

    def _swap(match: re.Match) -> str:
        label, target = match.group(1), match.group(2)
        target = target.replace("\\/", "/")      # `\/api\/…`：Markdown 转义的斜杠，同一个地址
        # ⚠ 2026-09-29 隔离真机第 119 轮 sr-20260929114248-GE1TQ9N3T8（新员工入职培训 PPT，追问「封面换深蓝、加问答页」）：
        #   收尾是 `[下载最终 PPTX](https://api/sliderule/projects/…/artifacts/art-…)`——相对地址前面
        #   安了个 `https://`，主机名成了 `api`，点了打不开。它以 https: 开头，下一句原样放过。
        #   去掉 scheme 之后 `/` + 主机 + 路径**逐字等于**宿主给的某个地址才换；真外链配不上，不动。
        split = urlsplit(target)
        if split.scheme.lower() in {"http", "https"} and "." not in split.netloc:
            rebuilt = "/" + split.netloc + split.path
            if rebuilt in known:
                return f"[{label}]({rebuilt})"
        if _USABLE_TARGET.match(target):
            return match.group(0)
        # ⚠ 2026-09-27 隔离真机第 68 轮 sr-20260927200602-F9YJD14NHC（门店销售 Excel 追问
        #   透视表）：模型把回执里的真地址抄成了 `sandbox:/api/sliderule/projects/…/artifacts/art-…`
        #   ——前面多了个 sandbox:。下面按文件名配，最后一段是 art-id，配不上，原样交给
        #   用户，点不开。去掉 scheme 后**逐字等于**宿主给的某个地址才换，不是猜。
        bare = _SANDBOX_SCHEME.sub("", target, count=1)
        if bare != target and bare in known:
            return f"[{label}]({bare})"
        name = Path(unquote(target.split("?", 1)[0].split("#", 1)[0])).name
        url = by_name.get(name)
        return f"[{label}]({url})" if url else match.group(0)

    return _MD_LINK.sub(swap, text)


#: 链接文字里明说的格式 → 它该指向的扩展名。只认拉丁字母写法（PDF / PPTX / Word …），中文「文档」「表格」
#: 太泛，不猜。
_CLAIMED_FORMATS = (
    (re.compile(r"(?<![A-Za-z])pdf(?![A-Za-z])", re.IGNORECASE), ".pdf"),
    (re.compile(r"(?<![A-Za-z])(?:pptx?|powerpoint)(?![A-Za-z])", re.IGNORECASE), ".pptx"),
    (re.compile(r"(?<![A-Za-z])(?:docx?|word)(?![A-Za-z])", re.IGNORECASE), ".docx"),
    (re.compile(r"(?<![A-Za-z])(?:xlsx?|excel)(?![A-Za-z])", re.IGNORECASE), ".xlsx"),
)


def _honest_format(link: str, path_of: Mapping[str, str]) -> str:
    """链接文字说的是一种格式、指向的收回文件是另一种：不许留一个点了拿错文件的链接。

    ⚠ 2026-09-29 隔离真机第 131 轮 sr-20260929164809-ATK2F34V0B（IT 设备领用须知 Word，追问「PDF 第一页加 logo 占位」）：
      PDF 交不出去（只收 .pptx/.docx/.xlsx），收尾却写 `[下载 PDF](…/artifacts/art-2a8eb32a…)`——
      那个地址是原来那份 .docx。用户点「下载 PDF」拿到一份旧的 Word。宿主知道每个地址背后是哪个文件，
      就由宿主拦：链接拆掉，字留着，括号里照实说它其实是什么。文字没说格式、或说的对得上，原样。
    """
    match = _MD_LINK.fullmatch(link)
    url = match.group(2).replace("\\/", "/") if match is not None else ""
    if url not in path_of:
        return link
    label = match.group(1)
    actual = Path(path_of[url]).suffix.lower()
    claimed = {ext for pattern, ext in _CLAIMED_FORMATS if pattern.search(label)}
    if not claimed or actual in claimed:
        return link
    return f"{label}（没有这个文件：这个链接其实是 {Path(path_of[url]).name}）"


def new_artifact_id() -> str:
    return "art-" + uuid.uuid4().hex[:40]
