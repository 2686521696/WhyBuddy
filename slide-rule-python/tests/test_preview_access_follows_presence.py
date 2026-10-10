"""有人在看，浏览器授权就续；没人看了，照旧 5 分钟内失效。

⚠ 2026-10-10 用户：「预览的时候并且在使用操作页面会自动刷新」。浏览器授权签出来是 300s 死钟：
  到点网关掐掉热更新长连接、cookie 过期、前端清票重开，iframe 整页重载——人正点着页面，每 5 分钟一次。
  现在前端每分钟一声 /preview/keepalive（只在预览面看得见时），把这条运行上还活着的授权往后挪，
  挪到不超过运行本身的寿命（ProjectPreviewAccess.extend_browser_access 头注）。

走真 SQL 授权表、真 HTTP 路由（world 夹具同 test_project_preview_access）。
第一条先证明「不续就断」，后面每条续的判据都配一条「不该续的没续」（CLAUDE.md §3）。
变异（逐条实测过）见各条 docstring。
"""
from datetime import datetime

import pytest

from services.project_preview_access import PreviewAccessDenied
from project_actor_support import project_actor  # noqa: F401  (fixture, world 依赖它)
from test_project_preview_access import _browser, _runtime_change, world  # noqa: F401  (fixture)


def _keepalive(world):
    response = world.client.post(f"/project-operations/{world.operation.operationId}/preview/keepalive")
    assert response.status_code == 200, response.text
    body = response.json()
    return None if body["accessExpiresAt"] is None else datetime.fromisoformat(body["accessExpiresAt"]).timestamp()


def test_without_keepalive_the_grant_still_dies_at_five_minutes(world):
    """基线：这正是用户看到的那次重载——不续，300s 一到网关就拒。"""
    browser = _browser(world)
    world.clock["now"] += 300
    with pytest.raises(PreviewAccessDenied):
        world.access.authorize_browser(browser.secret, audience=world.audience)


def test_keepalive_moves_the_live_grant_and_the_relay_keeps_its_connection(world):
    """变异：extend 里不写库（只算返回值）→ 第二个断言红；validate_binding 照旧逐字比 expiresAt → 最后一段红。"""
    browser = _browser(world)
    old_binding = browser.scope.to_wire()
    world.clock["now"] += 240
    until = _keepalive(world)
    assert until == pytest.approx(world.clock["now"] + 300, abs=1e-6)
    world.clock["now"] += 200                      # 原到期时刻（+300）之后 140s
    assert world.access.authorize_browser(browser.secret, audience=world.audience).grant_id == browser.scope.grant_id
    # 网关手里还是挪之前那份 binding：照旧认，并拿回现在的到期时刻去挪长连接的掐断时刻
    refreshed = world.access.validate_binding(old_binding, audience=world.audience)
    assert refreshed.expires_at == pytest.approx(until, abs=1e-6)


def test_keepalive_records_activity_like_touch(world):
    """换口不许丢掉原来 /touch 的那一半：运行的「没人用」钟也得续上。"""
    _browser(world)
    _keepalive(world)
    assert world.store.get_operation(world.operation.operationId, owner_id="u1").lastAccessAt is not None


def test_never_beyond_the_runtime_lifetime(world):
    _runtime_change(world, expiresAt=world.clock["now"] + 350)
    _browser(world)
    world.clock["now"] += 240
    assert _keepalive(world) == pytest.approx(world.clock["now"] + 110, abs=1e-6)


def test_expired_or_revoked_grants_are_not_brought_back(world):
    """变异：去掉 expires_at>now → 第一段红；去掉 revoked_at is null → 第二段红。"""
    lapsed = _browser(world)
    world.clock["now"] += 301                      # 没人看超过 5 分钟：已经失效
    assert _keepalive(world) is None
    with pytest.raises(PreviewAccessDenied):
        world.access.authorize_browser(lapsed.secret, audience=world.audience)

    revoked = _browser(world)
    world.access.revoke_grant(revoked.scope.grant_id, owner_id="u1")
    assert _keepalive(world) is None
    with pytest.raises(PreviewAccessDenied):
        world.access.authorize_browser(revoked.secret, audience=world.audience)


def test_the_relay_still_cannot_claim_a_later_deadline_than_the_server(world):
    browser = _browser(world)
    with pytest.raises(PreviewAccessDenied):
        world.access.validate_binding({**browser.scope.to_wire(), "expiresAt": browser.expires_at + 1},
                                      audience=world.audience)


def test_other_owner_cannot_keep_someone_elses_preview_alive(world):
    _browser(world)
    world.viewer["id"] = "mallory"
    assert world.client.post(f"/project-operations/{world.operation.operationId}/preview/keepalive").status_code == 404
