"""积分制（照 New API）：算法、账本、四处计量出口、拦截、归属账号、接口。

⚠ 2026-10-09 上线开关改成 public 后，任何登录账号都能开 E2B 电脑、调模型，没有按账号的额度（credit_ledger 头注）。

判据的形状（CLAUDE.md 一、二、三）：
- 计量出口打的是**真函数**（call_llm 普通 / 流式、call_control_llm、generate_image_png），只把网络换成假的服务商——
  直调记账函数只能证明记账函数对，证明不了四处真的接上了。
- 每条「该记 / 该拦」配一条「不该」：没登记计量器不记；超管不拦；额度用完连网络都不碰；拦截不进网关熔断。
- 请求级计量走真登录（real_auth）：conftest 默认把 optional_user 换成假用户，那样「登录用户写进请求状态」那一行根本不跑。
"""

from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import credit_service
from services.credit_ledger import CODE_DISABLED, CreditError, CreditStore
from services.credit_ledger import (DEFAULT_OPTIONS, QUOTA_PER_POINT, computer_quota, llm_quota,
                                     normalize_options)
from services.project_store import ProjectStore
from sliderule_llm import usage_meter


@pytest.fixture
def store():
    project_store = ProjectStore.from_url("sqlite:///:memory:")
    credit_service.reset_credit_store()
    yield project_store, credit_service.get_credit_store(project_store)
    credit_service.reset_credit_store()


# ── 一、算法（New API service/quota.go 的公式） ────────────────────────────

def test_the_quota_formula_is_new_apis():
    options = normalize_options({})
    usage = {"prompt_tokens": 10_000, "completion_tokens": 2_000, "prompt_tokens_details": {"cached_tokens": 8_000}}
    # (2000 未命中 + 8000×0.1 + 2000×8) × 1.25 = 23500
    assert llm_quota("unknown-model", usage, options) == 23_500
    responses_usage = {"input_tokens": 10_000, "output_tokens": 2_000, "input_tokens_details": {"cached_tokens": 8_000}}
    assert llm_quota("unknown-model", responses_usage, options) == 23_500
    assert llm_quota("m", {"prompt_tokens": 1}, normalize_options({"default_model_ratio": 0.0001})) == 1   # 至少 1
    assert llm_quota("m", None, options) == 0 and llm_quota("m", {}, options) == 0                        # 没报不猜


def test_model_prices_match_by_name_then_longest_prefix():
    options = normalize_options({"model_ratio": {"gpt-5": 0.625, "gpt-5-mini": 0.125}})
    usage = {"prompt_tokens": 1_000_000}
    assert llm_quota("gpt-5-2025-08-07", usage, options) == 625_000
    assert llm_quota("gpt-5-mini-x", usage, options) == 125_000
    assert llm_quota("claude", usage, options) == 1_250_000


def test_computer_time_and_bad_options():
    options = normalize_options({"computer_quota_per_minute": 600, "default_model_ratio": "oops", "nope": 1})
    assert computer_quota(90, options) == 900 and computer_quota(0, options) == 0
    assert options["default_model_ratio"] == DEFAULT_OPTIONS["default_model_ratio"] and "nope" not in options


# ── 二、账本 ───────────────────────────────────────────────────────────────

def test_a_new_account_gets_the_signup_grant_once(store):
    _, ledger = store
    first = ledger.account("u1")
    again = ledger.account("u1")
    assert first["quota"] == again["quota"] == DEFAULT_OPTIONS["quota_for_new_user"]
    rows, total = ledger.logs(owner_id="u1")
    assert total == 1 and rows[0]["kind"] == "system"


def test_consume_is_atomic_and_a_ref_is_charged_once(store):
    _, ledger = store
    start = ledger.account("u1")["quota"]
    assert ledger.consume("u1", 100, ref="computer:op:1") == start - 100
    assert ledger.consume("u1", 100, ref="computer:op:1") is None                       # 同一段结算两次
    assert ledger.account("u1")["quota"] == start - 100
    assert ledger.consume("u1", 10 ** 12) < 0                                            # 花出去的如实记，允许负


def test_a_code_is_redeemed_exactly_once(store):
    _, ledger = store
    code = ledger.create_codes(name="内测", quota=1_000, count=1, actor="root")[0]
    assert ledger.redeem("u1", code["code"]) == 1_000
    with pytest.raises(CreditError, match="credit_code_used"):
        ledger.redeem("u2", code["code"])
    with pytest.raises(CreditError, match="credit_code_not_changeable"):
        ledger.set_code_status(code["id"], 1)                                            # 用掉的不许改回可用
    assert ledger.account("u2")["quota"] == DEFAULT_OPTIONS["quota_for_new_user"]


def test_disabled_and_expired_codes_do_not_pay(store):
    _, ledger = store
    disabled, expiring = ledger.create_codes(name="x", quota=500, count=2, actor="root", expires_at=time.time() + 60)
    ledger.set_code_status(disabled["id"], CODE_DISABLED)
    with pytest.raises(CreditError, match="credit_code_disabled"):
        ledger.redeem("u1", disabled["code"])
    ledger._q("update wb_credit_redemption set expires_at=$1 where id=$2", [time.time() - 1, expiring["id"]])
    with pytest.raises(CreditError, match="credit_code_expired"):
        ledger.redeem("u1", expiring["code"])
    with pytest.raises(CreditError, match="credit_code_invalid"):
        ledger.redeem("u1", "nope")


def test_unknown_options_are_refused(store):
    _, ledger = store
    with pytest.raises(CreditError, match="credit_option_unknown"):
        ledger.set_options({"free_money": True}, actor="root")
    assert ledger.set_options({"quota_for_new_user": 5}, actor="root")["quota_for_new_user"] == 5


# ── 三、四处计量出口：真函数 + 假服务商 ──────────────────────────────────────

USAGE = {"prompt_tokens": 1_000, "completion_tokens": 100}


def _cfg():
    from sliderule_llm.config import LlmConfig

    return LlmConfig(api_key="k", base_url="https://llm.test/v1", model="model-x", router_model=None,
                     wire_api="chat_completions", reasoning_effort=None, timeout_ms=10_000, stream=False,
                     unlimited_models=(), model_fallbacks=(), max_context=100_000, max_concurrent=4,
                     provider_name="test", chat_thinking_type=None)


@pytest.fixture
def provider(monkeypatch):
    """假服务商：记下被打了几次；回答带 usage。"""
    hits = []
    original_sync, original_async = httpx.Client, httpx.AsyncClient

    def handler(request):
        hits.append(request)
        body = json.loads(request.content or b"{}")
        if body.get("stream"):
            chunks = [{"choices": [{"delta": {"content": "hi"}}]},
                      {"choices": [{"delta": {}, "finish_reason": "stop"}], "usage": USAGE}]
            text = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
            return httpx.Response(200, text=text, headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"model": "model-x", "usage": USAGE, "choices": [
            {"message": {"role": "assistant", "content": "hi"}, "finish_reason": "stop"}]})

    monkeypatch.setattr(httpx, "Client", lambda *a, **kw: original_sync(*a, transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(httpx, "AsyncClient",
                        lambda *a, **kw: original_async(*a, transport=httpx.MockTransport(handler), **kw))
    return hits


def _charged(ledger, owner):
    return [row for row in ledger.logs(owner_id=owner, kind="consume")[0]]


def test_call_llm_plain_and_streaming_both_report(store, provider):
    from sliderule_llm.client import call_llm

    project_store, ledger = store
    with credit_service.metered_for("u1", project_store=project_store):
        call_llm([{"role": "user", "content": "x"}], config=_cfg())
        call_llm([{"role": "user", "content": "x"}], config=_cfg(), on_delta=lambda _: None)
    rows = _charged(ledger, "u1")
    assert len(rows) == 2 and len(provider) == 2
    assert {(row["promptTokens"], row["completionTokens"]) for row in rows} == {(1_000, 100)}
    assert all(row["quota"] == -llm_quota("model-x", USAGE, ledger.options()) for row in rows)


def test_the_control_loop_call_reports(store, provider, monkeypatch):
    from sliderule_llm import control_client

    monkeypatch.setattr(control_client, "get_llm_config", _cfg)
    project_store, ledger = store
    with credit_service.metered_for("u1", project_store=project_store):
        asyncio.run(control_client.call_control_llm([{"role": "user", "content": "x"}]))
    assert len(_charged(ledger, "u1")) == 1


def test_an_image_reports(store, monkeypatch):
    from sliderule_llm import image_client

    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps({"data": [{"b64_json": "iVBORw0KGgo="}]}).encode()

    monkeypatch.setattr(image_client.urllib.request, "urlopen", lambda *a, **kw: _Resp())
    monkeypatch.setattr(image_client, "_png_from_payload", lambda payload, timeout: b"png")
    cfg = SimpleNamespace(url="https://img.test", key="k", model="img-1", timeout=5, body_style="size")
    monkeypatch.setattr(image_client, "_build_body", lambda *a: {})
    project_store, ledger = store
    with credit_service.metered_for("u1", project_store=project_store):
        image_client.generate_image_png("cat", cfg=cfg)
    rows = _charged(ledger, "u1")
    assert len(rows) == 1 and rows[0]["quota"] == -DEFAULT_OPTIONS["image_quota"]


def test_nothing_is_recorded_without_a_meter(store, provider):
    from sliderule_llm.client import call_llm

    _, ledger = store
    call_llm([{"role": "user", "content": "x"}], config=_cfg())
    assert len(provider) == 1 and ledger.logs(kind="consume")[1] == 0


# ── 四、拦截 ───────────────────────────────────────────────────────────────

def _drain(ledger, owner):
    ledger.credit(owner, -ledger.account(owner)["quota"], kind="manage", note="清零")


def test_an_exhausted_account_never_reaches_the_provider(store, provider, monkeypatch):
    from sliderule_llm import control_client
    from sliderule_llm.client import LlmError, call_llm
    from sliderule_llm.gateway_circuit import reject_reason

    monkeypatch.setattr(control_client, "get_llm_config", _cfg)
    monkeypatch.setattr(credit_service, "_owner_is_superuser", lambda owner: False)
    project_store, ledger = store
    _drain(ledger, "u1")
    with credit_service.metered_for("u1", project_store=project_store):
        with pytest.raises(LlmError, match="额度已用完") as plain:
            call_llm([{"role": "user", "content": "x"}], config=_cfg())
        for _ in range(4):
            with pytest.raises(LlmError, match="额度已用完") as control:
                asyncio.run(control_client.call_control_llm([{"role": "user", "content": "x"}]))
    assert not plain.value.transient and not control.value.transient                    # 重试只会再被拦一次
    assert provider == []                                                                # 网络一次都没碰
    assert reject_reason() is None                                                       # 没算进熔断连累别人


def test_a_superuser_is_metered_but_not_stopped(store, provider):
    from sliderule_llm.client import call_llm

    project_store, ledger = store
    _drain(ledger, "root")
    with usage_meter.metered(credit_service.OwnerMeter("root", superuser=True, project_store=project_store)):
        call_llm([{"role": "user", "content": "x"}], config=_cfg())
    assert len(provider) == 1 and len(_charged(ledger, "root")) == 1


def test_a_broken_ledger_lets_calls_through(store, provider, monkeypatch):
    """账本挂了不许把所有人关在门外（credit_service 头注）。"""
    from sliderule_llm.client import call_llm

    def boom(*a, **kw):
        raise RuntimeError("db down")

    monkeypatch.setattr(credit_service, "get_credit_store", boom)
    with credit_service.metered_for("u1"):
        call_llm([{"role": "user", "content": "x"}], config=_cfg())
    assert len(provider) == 1


# ── 五、请求级：真登录 → 请求状态 → 懒计量器 → 真 call_llm ────────────────────────

@pytest.fixture
def identity(tmp_path, monkeypatch, real_auth):
    pytest.importorskip("pwdlib")
    pytest.importorskip("jwt")
    from config.settings import settings
    from services import app_store, auth_service, identity_store, project_store as project_store_mod
    from services import session_blob_store

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(settings, "APP_STORE_DATABASE_URL", f"sqlite:///{tmp_path / 'apps.db'}", raising=False)
    monkeypatch.setattr(settings, "APP_STORE_HTTP_API_URL", "", raising=False)
    monkeypatch.setenv("SLIDERULE_IDENTITY_SQLITE", f"sqlite:///{tmp_path / 'id.db'}")
    monkeypatch.setenv("SLIDERULE_AUTH_SECRET", "u" * 48)
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("APP_STORE_NEON_HTTP", raising=False)
    for reset in (identity_store.reset_identity_cache, app_store.reset_backend_cache, session_blob_store.reset_cache,
                  project_store_mod.reset_project_store, credit_service.reset_credit_store):
        reset()
    credit_service._superuser_cache.clear()
    from routes.credits import install_credit_wiring

    install_credit_wiring()

    def mk(email):
        started = auth_service.start_registration(email, "correct-horse-battery")
        return auth_service.complete_registration(email, "correct-horse-battery", started["devCode"])

    people = {"root": mk("root@example.com"), "alice": mk("alice@example.com"), "bob": mk("bob@example.com")}
    yield people
    for reset in (identity_store.reset_identity_cache, app_store.reset_backend_cache, session_blob_store.reset_cache,
                  project_store_mod.reset_project_store, credit_service.reset_credit_store):
        reset()


def _hdr(who):
    return {"x-internal-key": "dev-slide-rule-internal", "Authorization": f"Bearer {who['token']}"}


def _uid(who):
    return who["user"]["id"]


def test_a_logged_in_request_pays_for_its_model_calls(identity, provider):
    from fastapi import Depends
    from middlewares.current_user import optional_user
    from sliderule_llm.client import call_llm

    mini = FastAPI()
    mini.add_middleware(credit_service.CreditMeterMiddleware)

    @mini.post("/think")
    def think(viewer=Depends(optional_user)):    # 真的 optional_user（real_auth 摘了默认覆盖）
        call_llm([{"role": "user", "content": "x"}], config=_cfg())
        return {"ok": True}

    client = TestClient(mini)
    assert client.post("/think", headers=_hdr(identity["alice"])).status_code == 200
    ledger = credit_service.get_credit_store()
    assert len(_charged(ledger, _uid(identity["alice"]))) == 1
    assert client.post("/think").status_code == 200                                      # 匿名：不记在任何人头上
    assert ledger.logs(kind="consume")[1] == 1


def test_the_real_app_carries_the_request_meter_and_the_wiring(monkeypatch):
    """反向：中间件在、账本却没接到库上（configure 没调），所有记账都会静静跳过——等于人人免费。"""
    monkeypatch.setattr(credit_service, "_project_store_provider", None)
    monkeypatch.setattr(credit_service, "_superuser_lookup", None)
    import importlib

    import app as app_module

    real_app = importlib.reload(app_module).app
    assert any(m.cls is credit_service.CreditMeterMiddleware for m in real_app.user_middleware)
    assert credit_service.configured()


def test_an_exhausted_user_cannot_open_a_control_turn(identity, tmp_path, monkeypatch):
    """真路由、真会话：额度用完回 402 + 原话（前端照实显示，不转圈），控制回合一条都不建。"""
    from app import app as real_app

    monkeypatch.setenv("SLIDERULE_SESSIONS_FILE", str(tmp_path / "sessions.json"))
    client = TestClient(real_app)
    created = client.post("/api/sliderule/sessions", json={"goal": {"text": "做个待办"}}, headers=_hdr(identity["alice"]))
    assert created.status_code == 200, created.text
    sid = created.json().get("sessionId") or created.json().get("id")
    body = {"sessionId": sid, "userText": "hi", "installedSkills": [], "activeConnectors": [],
            "preferredDevice": "desktop", "designSystemId": None}
    _drain(credit_service.get_credit_store(), _uid(identity["alice"]))
    got = client.post("/api/sliderule/control-turn-stream", headers=_hdr(identity["alice"]), json=body)
    assert got.status_code == 402
    assert got.json()["code"] == "credit_exhausted" and "额度已用完" in got.json()["message"]
    assert "这一轮没有开始" in got.json()["message"]
    # 反向：有额度的人走得过这道闸（后面是什么结果不归这条判据管，只要不是 402）
    other = client.post("/api/sliderule/sessions", json={"goal": {"text": "做个待办"}}, headers=_hdr(identity["bob"])).json()
    passed = client.post("/api/sliderule/control-turn-stream", headers=_hdr(identity["bob"]),
                         json={**body, "sessionId": other.get("sessionId") or other.get("id")})
    assert passed.status_code != 402


# ── 六、后台执行的归属：控制回合、工程工作器、电脑时长 ─────────────────────────────

def test_a_durable_control_run_pays_as_its_owner(monkeypatch):
    """调度器在后台执行，不在请求里：_produce_reported 里登记的是这条回合的主人。"""
    from services import control_run_service

    seen = []

    async def fake_produce(self, record):
        seen.append(getattr(usage_meter.current(), "owner_id", None))

    monkeypatch.setattr(control_run_service.ControlRunService, "_produce", fake_produce)
    service = control_run_service.ControlRunService.__new__(control_run_service.ControlRunService)
    service.project_store = None
    asyncio.run(service._produce_reported({"runId": "r1", "sessionId": "s1", "ownerId": "owner-7"}))
    assert seen == ["owner-7"]


def test_project_work_pays_for_its_computer_and_its_model_calls(monkeypatch, setup):  # noqa: F811
    """真工作器：服务器起来、闲置到期，电脑时长按这一段扣；工作器线程里的模型调用记在操作主人头上。"""
    from test_project_runtime_worker import Provider, eventually, state, submit

    store_, project, _, make_worker, _ = setup
    worker = make_worker(idle_seconds=1)
    ledger = credit_service.get_credit_store(store_)
    monkeypatch.setattr(credit_service, "_owner_is_superuser", lambda owner: False)

    class TalkingProvider(Provider):
        def start_process(self, handle, command, **kwargs):
            usage_meter.report_llm("model-x", USAGE)                                     # 工作器线程里调了一次模型
            return super().start_process(handle, command, **kwargs)

    worker.provider_factory = lambda: TalkingProvider()
    first = submit(worker, project)
    eventually(lambda: state(store_, first, "expired"))
    rows = eventually(lambda: [r for r in ledger.logs(owner_id="alice", kind="consume")[0] if r["seconds"]])
    assert rows and rows[0]["seconds"] > 0
    assert any(r["model"] == "model-x" for r in ledger.logs(owner_id="alice", kind="consume")[0])


def test_an_exhausted_owner_cannot_start_a_computer(monkeypatch, setup):  # noqa: F811
    from services.credit_service import CreditExhaustedError
    from test_project_runtime_worker import submit

    store_, project, _, make_worker, _ = setup
    worker = make_worker()
    monkeypatch.setattr(credit_service, "_owner_is_superuser", lambda owner: False)
    ledger = credit_service.get_credit_store(store_)
    _drain(ledger, "alice")
    with pytest.raises(CreditExhaustedError):
        submit(worker, project)
    assert store_.list_project_operations(project.projectId, owner_id="alice", after_id="", limit=10) == []


# ── 七、接口 ───────────────────────────────────────────────────────────────

def test_users_see_and_redeem_their_own_credits(identity):
    from app import app as real_app

    client = TestClient(real_app)
    me = client.get("/api/sliderule/credits/me", headers=_hdr(identity["alice"])).json()
    assert me["account"]["points"] == DEFAULT_OPTIONS["quota_for_new_user"] / QUOTA_PER_POINT
    code = credit_service.get_credit_store().create_codes(name="t", quota=100 * QUOTA_PER_POINT, count=1,
                                                         actor="root")[0]["code"]
    got = client.post("/api/sliderule/credits/redeem", json={"code": code}, headers=_hdr(identity["alice"]))
    assert got.status_code == 200 and got.json()["points"] == 100
    again = client.post("/api/sliderule/credits/redeem", json={"code": code}, headers=_hdr(identity["bob"]))
    assert again.status_code == 400 and again.json()["message"] == "credit_code_used"
    logs = client.get("/api/sliderule/credits/logs", headers=_hdr(identity["alice"])).json()
    assert {row["kind"] for row in logs["items"]} == {"system", "topup"}
    assert client.get("/api/sliderule/credits/me").status_code == 401


def test_only_superusers_manage_credits(identity):
    from app import app as real_app

    client = TestClient(real_app)
    paths = ["/api/sliderule/account/admin/credits/users", "/api/sliderule/account/admin/credits/codes",
             "/api/sliderule/account/admin/credits/logs", "/api/sliderule/account/admin/credits/options"]
    for path in paths:
        assert client.get(path, headers=_hdr(identity["alice"])).status_code == 403
        assert client.get(path, headers=_hdr(identity["root"])).status_code == 200
    alice = _uid(identity["alice"])
    adjusted = client.post(f"/api/sliderule/account/admin/credits/users/{alice}/adjust",
                           json={"mode": "set", "points": 42, "note": "测试"}, headers=_hdr(identity["root"]))
    assert adjusted.status_code == 200 and adjusted.json()["account"]["points"] == 42
    made = client.post("/api/sliderule/account/admin/credits/codes", json={"name": "批次", "points": 10, "count": 3},
                       headers=_hdr(identity["root"])).json()["items"]
    assert len(made) == 3 and len({row["code"] for row in made}) == 3
    users = client.get("/api/sliderule/account/admin/credits/users", headers=_hdr(identity["root"])).json()["items"]
    assert next(u for u in users if u["id"] == alice)["account"]["points"] == 42
    options = client.put("/api/sliderule/account/admin/credits/options", json={"image_quota": 0},
                         headers=_hdr(identity["root"])).json()
    assert options["image_quota"] == 0
    manage = credit_service.get_credit_store().logs(owner_id=alice, kind="manage")[0]
    assert manage and manage[0]["actor"] == "root@example.com" and manage[0]["note"] == "测试"


from test_project_runtime_worker import setup  # noqa: E402,F401  （夹具）
from project_actor_support import project_actor  # noqa: E402,F401  （夹具）
