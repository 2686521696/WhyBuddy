"""全套件测试基线环境（P2a 引入，2026-07-16）。

外呼工具（web.search 真搜索）在测试里全局关闭：测试必须确定性、
不碰网络（CI 无凭据也要绿；维基/搜索供应商的延迟与波动不进测试）。
需要验证工具行为的测试自行 monkeypatch 开关与供应商（见
test_mcp_tools.py）；需要真网络的活体冒烟用
SLIDERULE_LIVE_WEB_TESTS=1 显式开。
"""

import os
import tempfile
from pathlib import Path

os.environ.setdefault("SLIDERULE_WEB_SEARCH", "off")
# 会话存储全套件隔离（E14 揭出的老毛病）：不少路由/驱动测试不各自
# monkeypatch 存储路径，跑一遍 pytest 就往开发库灌几十个 fixture 会话，
# 工作台「我的应用」全是垃圾卡。默认落临时目录；显式设置的测试不受影响。
os.environ.setdefault(
    "SLIDERULE_SESSIONS_FILE",
    str(Path(tempfile.mkdtemp(prefix="sliderule-tests-")) / "sessions.json"),
)
# 应用库全套件隔离（2026-08-05，为一次真实污染补的）。
#
# 上面那条会话隔离的理由，对应用库**一字不差地成立**，而且后果更重：会话
# 灌的是本机开发库，应用库灌的可能是**共享的远端库**。真实发生过——
# .env 里配上 APP_STORE_HTTP_API_URL 指向线上 /db-api 之后跑一遍 pytest，
# 91 行 fixture 应用 + 23 张参照图直接写进了生产库（s1/s2/e6/u4 这些夹具
# id 一看就是测试的），同时 28 条用例因为读到彼此的残留而红。
#
# 那次是"库刚建好还没接应用"，清掉就完事；接上线之后同样一条命令就会往
# 真实用户数据里掺垃圾，而且分不清哪些该删。
#
# 所以三个入口一起按空：HTTP API 两个变量、以及远端 DSN。落到临时 SQLite，
# 每次 pytest 一个新目录，跑完自然消失。
#
# ⚠ 这里只改**默认值**——os.environ 的优先级高于 .env 文件，但显式
# monkeypatch settings 的测试仍然照自己的来（测 Neon/HTTP 后端本身的用例
# 就是这么做的），一条都不会被这段挡住。
_APP_STORE_TEST_DIR = Path(tempfile.mkdtemp(prefix="sliderule-appstore-tests-"))
os.environ.setdefault("APP_STORE_HTTP_API_URL", "")
os.environ.setdefault("APP_STORE_HTTP_API_KEY", "")
os.environ.setdefault(
    "APP_STORE_DATABASE_URL", f"sqlite:///{_APP_STORE_TEST_DIR / 'apps.db'}"
)
os.environ.setdefault("APP_STORE_FILE", str(_APP_STORE_TEST_DIR / "apps.json"))

# P2b 执行类工具同理全局关闭：测试不开真沙盒（活体验证用
# SLIDERULE_LIVE_SANDBOX_TESTS=1 显式开，见 test_mcp_tools.py）
os.environ.setdefault("SLIDERULE_CODE_RUN", "off")
# E32 agentic pick 产品默认 on——测试基线关：驱动循环测试要确定性
# 选材（无 key 时它也只是快速回落，但不该依赖"恰好没配 key"这种巧合）。
# 验证提案行为的测试自行 monkeypatch（见 test_agentic_pick.py 若有）。
os.environ.setdefault("SLIDERULE_AGENTIC_PICK", "off")
# 权限体系上线后（2026-08-02）：推演接口要求登录（匿名只能查看）。
# 全套件里有几十条**验证推演管线**的测试，它们跟身份无关却会被 401 挡住。
#
# 这里给它们一个默认的"已登录"身份，用 FastAPI 的 dependency_overrides 注入。
# 两条纪律：
#   · **不是**让内部密钥绕过登录。Node 代理每个请求都带内部密钥，那样等于
#     线上全部绕过——那才是真正危险的做法。
#   · 关心身份本身的测试（test_auth_identity / test_app_routes_access）用
#     `real_auth` fixture 把这个覆盖摘掉，走真实令牌解析。
os.environ.setdefault("SLIDERULE_AUTH_SECRET", "sliderule-test-secret-" + "x" * 24)

import pytest  # noqa: E402


class _TestUser:
    """默认测试身份：普通登录用户（**不是**超管——超管会掩盖权限不足的 bug）。"""

    id = "u-test-default"
    email = "test@example.com"
    is_active = True
    is_superuser = False

    def public(self):
        return {"id": self.id, "email": self.email, "isSuperuser": False}


# ⚠️ 套件里有测试会 `importlib.reload(app)`（test_drive_persists_goal.py:92），
# 那会**重建整个 FastAPI app 对象**。而别的模块在收集期就把旧对象绑进了
# 模块级 TestClient。只往"当前那个 app"装覆盖的话，请求走的是旧对象、拿不到
# 覆盖——表现是单独跑绿、全量跑红。所以这里记住见过的每一个实例，一起装。
_seen_apps: list = []


def _all_apps() -> list:
    import sys

    mod = sys.modules.get("app")
    current = getattr(mod, "app", None) if mod else None
    if current is not None and not any(a is current for a in _seen_apps):
        _seen_apps.append(current)
    return list(_seen_apps)


@pytest.fixture(autouse=True)
def _default_logged_in_user():
    """全套件默认已登录。用 real_auth fixture 可摘掉。"""
    try:
        from middlewares.current_user import optional_user
    except Exception:  # noqa: BLE001 — 缺依赖时跳过
        yield
        return
    apps = _all_apps()
    for a in apps:
        a.dependency_overrides[optional_user] = lambda: _TestUser()
    try:
        yield
    finally:
        for a in _all_apps():
            a.dependency_overrides.pop(optional_user, None)


@pytest.fixture
def real_auth():
    """摘掉默认身份覆盖，走真实的令牌/Cookie 解析。

    关心"匿名会不会被拦住"的测试必须用它——否则默认覆盖会让匿名分支永远测不到。
    """
    from middlewares.current_user import optional_user

    for a in _all_apps():
        a.dependency_overrides.pop(optional_user, None)
    yield
    for a in _all_apps():
        a.dependency_overrides.pop(optional_user, None)
