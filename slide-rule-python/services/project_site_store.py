"""发布到应用市场的网页工程，在线打开要的那份构建产物（dist）。

⚠ 2026-10-02 用户：「接着做在线打开运行」。发布通道（ProjectDeliveryService.publication）上架的是截图 + 源码，
  别人要复刻到自己的工作台才能跑。验收那一步本来就在沙盒里 `npm run build` 出了 dist、算了 outputHash
  （VerificationBuildEvidence），只是字节没留下。这里把**那一份**留下：收回的字节按验收脚本同一条公式
  重算 outputHash，对不上就不收——市场里在线打开的，就是通过验收的那一份构建，不是别处重新编一份。

只收静态构建（react-vite-app / counter，serverKind=static-dist）。任务模板要 Node 后端（server.mjs），
静态托管跑不起来，照实说「复刻后在自己的工作台运行」。

收回是增强项：失败了验收照样算数，只是这一版不能在线打开（§七 fail-open）。
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import zipfile

MAX_SITE_BYTES = 16 * 1024 * 1024
MAX_SITE_FILES = 2000
_DDL = ("create table if not exists wb_project_site_build (project_id varchar(80) not null, "
        "output_hash varchar(64) not null, revision varchar(240) not null, size_bytes integer not null, "
        "content text not null, primary key(project_id, output_hash))")


def build_output_hash(files: dict[str, bytes]) -> str:
    """跟沙盒里 ARTIFACT_IO_SCRIPT 的 "output" 一条公式：逐层目录排序遍历，[路径, 字节数, sha256]。

    逐层排序 = 按路径分段比较（"a/b" 排在 "a.txt" 前面），不是整串排序。"""
    entries = [[path, len(data), hashlib.sha256(data).hexdigest()]
               for path, data in sorted(files.items(), key=lambda item: item[0].split("/"))]
    encoded = json.dumps(entries, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    return hashlib.sha256(encoded).hexdigest()


class ProjectSiteStore:
    def __init__(self, store):
        self.store = store
        store._q(_DDL)

    def put(self, project_id: str, *, revision: str, output_hash: str, files: dict[str, bytes]) -> None:
        if not files or len(files) > MAX_SITE_FILES or sum(len(v) for v in files.values()) > MAX_SITE_BYTES:
            raise ValueError("project_site_build_too_large")
        if "index.html" not in files:
            raise ValueError("project_site_build_index_missing")
        if any(path.startswith("/") or ".." in path.split("/") for path in files):
            raise ValueError("project_site_build_path_invalid")
        if build_output_hash(files) != output_hash:
            raise ValueError("project_site_build_hash_mismatch")
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(files):
                archive.writestr(path, files[path])
        content = base64.b64encode(buffer.getvalue()).decode()
        self.store._q("insert into wb_project_site_build(project_id,output_hash,revision,size_bytes,content) "
                      "values($1,$2,$3,$4,$5) on conflict(project_id,output_hash) do nothing",
                      [project_id, output_hash, revision, sum(len(v) for v in files.values()), content])

    def has(self, project_id: str, output_hash: str) -> bool:
        return bool(self.store._q("select 1 as ok from wb_project_site_build where project_id=$1 and output_hash=$2",
                                  [project_id, output_hash]))

    def files(self, project_id: str, output_hash: str) -> dict[str, bytes] | None:
        rows = self.store._q("select content from wb_project_site_build where project_id=$1 and output_hash=$2",
                             [project_id, output_hash])
        if not rows:
            return None
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(rows[0]["content"], validate=True))) as archive:
            files = {name: archive.read(name) for name in archive.namelist()}
        # 读回来再核一遍：库里那份被改过就不托管（证据类 fail-closed）
        return files if build_output_hash(files) == output_hash else None
