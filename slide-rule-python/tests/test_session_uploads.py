"""用户原件进工作区。抄 OpenHands：洗净文件名，字节进工作区根。

⚠ 2026-09-22 抽出的文字进了消息，Word 原件没进沙盒。
  删掉执行器上的拷贝，或改回只存文字，本条变红。
"""
import ast
from pathlib import Path

from services.e2b_workspace_provider import E2BWorkspaceProvider, PROJECT_ROOT
from services.project_runtime_worker import _RuntimeTask
from services.project_store import ProjectStore
from services.session_uploads import sanitize_filename, upload_fact, workspace_path
from services.workspace_provider import WorkspaceHandle


ROOT = Path(__file__).resolve().parents[1]


def test_sanitize_keeps_the_leaf_name():
    assert sanitize_filename("../../报告.docx") == "报告.docx"
    assert sanitize_filename("a\\b.xlsx") == "b.xlsx"
    assert sanitize_filename("") == ""
    assert workspace_path("报告.docx") == "/home/user/workspace/报告.docx"


def test_upload_fact_names_the_path_and_not_a_parser():
    fact = upload_fact(["/home/user/workspace/报告.docx"])
    assert fact is not None
    assert "/home/user/workspace/报告.docx" in fact
    assert "python-docx" not in fact
    assert upload_fact([]) is None


def test_bytes_roundtrip_and_mount_on_the_worker(tmp_path):
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    stored = store.put_session_upload(
        "sess-1", owner_id="alice", name="notes/报告.docx", data=b"PK\x03\x04word")
    assert stored["name"] == "报告.docx"
    assert store.read_session_upload("sess-1", "报告.docx", owner_id="alice") == b"PK\x03\x04word"
    assert store.list_session_uploads("sess-1", owner_id="mallory") == []

    written = {}

    class Box:
        class files:
            @staticmethod
            def write(path, data):
                written[path] = data

    provider = E2BWorkspaceProvider.__new__(E2BWorkspaceProvider)
    provider._sandbox = lambda handle: Box()
    task = _task(store, provider)
    _RuntimeTask._mount_session_uploads(task)
    assert written[f"{PROJECT_ROOT}/报告.docx"] == b"PK\x03\x04word"
    assert "uploadsSkipped" not in task.result
    store.close()


def _task(store, provider, *, sandbox="sbx", supervisor=None):
    """_mount_session_uploads 需要的最小执行器：库、provider、沙盒、监督器账本、回执。"""
    import threading

    task = type("Task", (), {})()
    task.store = store
    task.owner_id = "alice"
    task.original = type("Op", (), {"sessionId": "sess-1"})()
    task.provider = provider
    task.handle = WorkspaceHandle("ws", sandbox)
    task.result = {}
    task.supervisor = supervisor or type(
        "Sup", (), {"_lock": threading.Lock(), "_mounted_uploads": {}})()
    return task


def test_one_bad_upload_does_not_block_the_command(tmp_path):
    """一份坏上传不许让整个会话的命令都起不来。放不进去的要说出来。

    ⚠ 2026-09-23 review：上一版任何一份读失败都直接抛，连 `ls` 都跑不了。
    把 `_mount_session_uploads` 里那个 try/except 去掉 → 本条红。
    """
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    store.put_session_upload("sess-1", owner_id="alice", name="好.docx", data=b"PK\x03\x04ok")
    store.put_session_upload("sess-1", owner_id="alice", name="坏.xlsx", data=b"PK\x03\x04bad")
    # 真实的坏法：库里那一行的 sha256 跟字节对不上（read_session_upload 报 corrupt）。
    store._q("update wb_session_upload set sha256=$1 where session_id=$2 and name=$3",
             ["0" * 64, "sess-1", "坏.xlsx"])
    written = {}
    provider = type("P", (), {"write_bytes": lambda self, handle, name, data: written.__setitem__(name, data)})()
    task = _task(store, provider)

    _RuntimeTask._mount_session_uploads(task)  # 不许抛

    assert written == {"好.docx": b"PK\x03\x04ok"}
    assert task.result["uploadsSkipped"] == ["坏.xlsx"]
    store.close()


def test_unchanged_uploads_are_not_pushed_again_into_the_same_sandbox(tmp_path):
    """同一台沙盒、sha256 没变：不再从库里读、不再推。换了内容就要重推。"""
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    store.put_session_upload("sess-1", owner_id="alice", name="表.xlsx", data=b"PK\x03\x04v1")
    pushes = []
    provider = type("P", (), {"write_bytes": lambda self, handle, name, data: pushes.append((name, data))})()
    first = _task(store, provider)
    _RuntimeTask._mount_session_uploads(first)
    second = _task(store, provider, supervisor=first.supervisor)
    _RuntimeTask._mount_session_uploads(second)
    assert pushes == [("表.xlsx", b"PK\x03\x04v1")]

    store.put_session_upload("sess-1", owner_id="alice", name="表.xlsx", data=b"PK\x03\x04v2")
    _RuntimeTask._mount_session_uploads(_task(store, provider, supervisor=first.supervisor))
    assert pushes[-1] == ("表.xlsx", b"PK\x03\x04v2")

    # 换一台沙盒（新建的）必须重推，账是按沙盒记的。
    _RuntimeTask._mount_session_uploads(
        _task(store, provider, sandbox="sbx-2", supervisor=first.supervisor))
    assert pushes[-1] == ("表.xlsx", b"PK\x03\x04v2") and len(pushes) == 3
    store.close()


def test_exec_mounts_uploads_after_source_sync():
    """The copy sits on the command path, after write_files and before the command."""
    src = (ROOT / "services" / "project_runtime_worker.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    host = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        and any(
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Attribute)
            and child.func.attr == "write_files"
            for child in ast.walk(node)
        )
    )
    calls = [
        child.func.attr
        for child in ast.walk(host)
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Attribute)
    ]
    assert calls.index("write_files") < calls.index("_mount_session_uploads")


def test_max_upload_fits_the_http_sql_gateway_body_limit(tmp_path, monkeypatch):
    """线上工程库走 HttpSqlGateway → db-api，db-api 按 content-length 卡 4MB。

    ⚠ 2026-09-23 review：原件整份 base64 进一个 SQL 参数，15MB 编码后约 20MB，
      大约 3MB 以上的文件在线上一律 413——本地 sqlite 没有这道门，别的判据全绿。
      这里把每一发 SQL **按网关真实的请求形状**（json {sql, params, timeout_ms,
      max_rows}）量一遍，跟 db-api 的默认上限比，而不是自己拍一个数。

    把 SESSION_UPLOAD_CHUNK_BYTES 调成 MAX_UPLOAD_BYTES（等于不分块）→ 本条红。
    """
    import json
    import re

    from services import project_store as store_mod
    from services.session_uploads import MAX_UPLOAD_BYTES
    from services.sql_gateway import numeric_to_format

    app_src = (ROOT.parent / "deploy" / "postgres-https-api" / "app.py").read_text(encoding="utf-8")
    limit = int(re.search(r'DB_API_MAX_BODY_BYTES", str\((\d+) \* (\d+) \* (\d+)\)', app_src)
                .expand(r"\1")) * 1024 * 1024
    assert limit == 4 * 1024 * 1024, "db-api 默认上限变了，重新看这条判据"

    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sizes = []
    original = store._q

    def measured(sql, params=None, *args, **kwargs):
        out_sql, out_params = numeric_to_format(sql, params)
        body = json.dumps({"sql": out_sql, "params": out_params,
                           "timeout_ms": 30000, "max_rows": 1000})
        sizes.append(len(body.encode("utf-8")))
        return original(sql, params, *args, **kwargs)

    monkeypatch.setattr(store, "_q", measured)
    payload = bytes(range(256)) * (MAX_UPLOAD_BYTES // 256)
    assert len(payload) == MAX_UPLOAD_BYTES
    store.put_session_upload("sess-big", owner_id="alice", name="报价表.xlsx", data=payload)

    assert max(sizes) < limit, f"最大一发请求体 {max(sizes)} 字节，超过 db-api 的 {limit}"
    # 反向：分块不许丢字节、不许乱序。
    assert store.read_session_upload("sess-big", "报价表.xlsx", owner_id="alice") == payload
    assert store_mod.SESSION_UPLOAD_CHUNK_BYTES < MAX_UPLOAD_BYTES


def test_replacing_an_upload_drops_the_old_chunks(tmp_path):
    """同名重传：旧块必须清掉，否则大文件换成小文件后读回来是新头拼旧尾。"""
    from services import project_store as store_mod

    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    big = b"A" * (store_mod.SESSION_UPLOAD_CHUNK_BYTES * 2 + 7)
    store.put_session_upload("sess-r", owner_id="alice", name="a.bin", data=big)
    store.put_session_upload("sess-r", owner_id="alice", name="a.bin", data=b"small")
    assert store.read_session_upload("sess-r", "a.bin", owner_id="alice") == b"small"
    rows = store._q("select count(*) as n from wb_session_upload_chunk where session_id=$1", ["sess-r"])
    assert int(rows[0]["n"]) == 1


def _upload_client(tmp_path, monkeypatch, *, viewer_id="alice"):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from middlewares.current_user import require_user
    from routes import project_sources as route
    from services import persistence
    from services.identity_store import User
    from services.session_blob_store import SqlSessionBlobStore

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("NODE_ENV", "development")
    monkeypatch.setenv("SLIDERULE_PROJECT_RUNTIME_INTERNAL_ENABLED", "1")
    monkeypatch.setattr("config.settings.settings.NODE_ENV", "development")
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'project.db'}")
    sessions = SqlSessionBlobStore(f"sqlite:///{tmp_path / 'session.db'}")
    monkeypatch.setattr(persistence, "_blob_store", lambda *_: sessions)
    monkeypatch.setattr(route, "get_project_store", lambda: store)
    app = FastAPI()
    app.include_router(route.router, prefix="/api/sliderule")
    app.dependency_overrides[require_user] = lambda: User(id=viewer_id, is_superuser=True)
    return TestClient(app), store, route


def test_upload_route_refuses_when_the_session_store_is_down(tmp_path, monkeypatch):
    """库读不到 ≠ 新会话。鉴权不许因为读失败被整个跳过。

    ⚠ 2026-09-23 review：路由只有 `if loaded.get("ok")` 一支，会话库 5xx 时
      跟「会话还没落库」走同一条路——鉴权跳过、文件照收。
    判据喂的是 persistence 在库读失败时**真实返回的形状**
    （`_store_error("db_read_failed", …)`），不是自己拼一个。

    把 `elif not _session_record_not_found(loaded)` 那一支删掉 → 本条红。
    """
    from services import persistence

    client, store, route = _upload_client(tmp_path, monkeypatch)
    down = {**persistence._store_error("db_read_failed", "gateway 502"), "sessionId": "sess-x"}
    assert down["ok"] is False and down["error"] != "not_found"
    monkeypatch.setattr(route.persistence, "load_session_record", lambda _sid: down)
    with client:
        response = client.post("/api/sliderule/sessions/sess-x/uploads?name=a.docx", content=b"PK\x03\x04")
    assert response.status_code == 503, response.text
    assert store.list_session_uploads("sess-x", owner_id="alice") == []


def test_upload_route_still_accepts_a_session_that_is_not_saved_yet(tmp_path, monkeypatch):
    """反向：第一句话之前就挂附件，会话还没落库——这是有意放行的。"""
    client, store, _route = _upload_client(tmp_path, monkeypatch)
    with client:
        response = client.post("/api/sliderule/sessions/sess-new/uploads?name=a.docx", content=b"PK\x03\x04")
    assert response.status_code == 200, response.text
    assert response.json()["path"] == "/home/user/workspace/a.docx"
    assert [row["name"] for row in store.list_session_uploads("sess-new", owner_id="alice")] == ["a.docx"]


def test_upload_route_refuses_someone_elses_session(tmp_path, monkeypatch):
    """反向：会话在，但不是你的 → 404，不许写进别人的会话。"""
    from models.v5_state import V5SessionState
    from services import persistence

    client, store, _route = _upload_client(tmp_path, monkeypatch, viewer_id="mallory")
    state = V5SessionState(sessionId="sess-alice", ownerId="alice", goal={"text": "报价表"})
    assert persistence.save_session_record(state, server_write=True)["ok"]
    with client:
        response = client.post("/api/sliderule/sessions/sess-alice/uploads?name=a.docx", content=b"PK\x03\x04")
    assert response.status_code == 404, response.text
    assert store.list_session_uploads("sess-alice", owner_id="mallory") == []


def test_upload_route_rejects_an_oversized_declared_length_before_reading(tmp_path, monkeypatch):
    """声明的长度超了就在读正文之前拒掉，不先把整份缓冲进内存。"""
    from services.session_uploads import MAX_UPLOAD_BYTES

    client, _store, _route = _upload_client(tmp_path, monkeypatch)
    with client:
        response = client.post(
            "/api/sliderule/sessions/sess-new/uploads?name=a.bin",
            content=b"x",
            headers={"content-length": str(MAX_UPLOAD_BYTES + 1)},
        )
    assert response.status_code in {400, 413}, response.text
