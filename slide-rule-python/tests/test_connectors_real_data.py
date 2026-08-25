"""连接器：真数据进得来，进不来的时候**不许编**。

这个文件钉的是 2026-08-25 那条产品判断在代码里的落点——用户裁掉了
"把造数据规划进 spec"，理由是"假数据其实没有意义"。所以这里每一条正向判据
（取到了、字段对得上）都配了一条反向判据（取不到时**没有**行冒出来）。

⚠ 判据全部用**注入的 fetch**，不打真外网：真机连通性有它自己的验法
  （scripts 里的手动跑 + 生成期日志），单测要的是"失败路径怎么走"，
  而失败路径正是真外网最不配合复现的部分。
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import connectors as C  # noqa: E402


GEO_OK = {
    "results": [
        {"name": "北京", "latitude": 39.9, "longitude": 116.4, "timezone": "Asia/Shanghai"}
    ]
}
DAILY_OK = {
    "daily": {
        "time": ["2026-08-26", "2026-08-27"],
        "weather_code": [61, 3],
        "temperature_2m_max": [24.8, 29.5],
        "temperature_2m_min": [21.3, 22.2],
        "precipitation_probability_max": [78, 22],
        "wind_speed_10m_max": [9.6, 6.1],
    }
}


def fake_fetch(geo=GEO_OK, daily=DAILY_OK, *, calls=None):
    def _f(url, timeout_s):
        if calls is not None:
            calls.append(url)
        if "geocoding-api" in url:
            if isinstance(geo, Exception):
                raise geo
            return geo
        if isinstance(daily, Exception):
            raise daily
        return daily

    return _f


# ── 正向：真数据进得来，而且形状跟 spec 里声明的那份一致 ──────────────


def test_取到的行用的就是实体声明里的字段名():
    """整条设计的命门。

    ⚠ 这一条不是"字段名写对了没有"这种拼写检查，而是**这套做法成不成立**：
      连接器把 schema 交给 spec 去建模，生成期再按同一份 schema 落值。两边
      一旦分叉，页面上的孔和手里的值就对不上——`derive-binding-source` 会
      老老实实每格填「—」，而 problems 是空的（孔认得出，只是值没有），
      正是仓里记了十几次的那种不报错的失效。
    """
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    assert r.ok
    declared = {f["id"] for f in C.WEATHER.entity_declaration()["fields"]}
    for row in r.rows:
        assert set(row["values"].keys()) == declared


def test_值是真的透传下来的_不是重新编的():
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    first = r.rows[0]["values"]
    assert first["date"] == "2026-08-26"
    assert first["temp_max"] == 24.8
    assert first["rain_chance"] == 78
    assert first["condition"] == "小雨"  # WMO 61


def test_每一行都带来源与取数时间():
    """跟种子行带 seed:true 同一个哲学：真实得越像越该标出来源。"""
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch(), now_fn=lambda: "T0")
    assert r.source == "Open-Meteo · 北京"
    assert r.fetched_at == "T0"


def test_行_id_由城市加日期决定_重复取数不会越取越多():
    a = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    b = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch())
    assert [r["id"] for r in a.rows] == [r["id"] for r in b.rows]
    assert len({r["id"] for r in a.rows}) == len(a.rows)


# ── 反向：进不来的时候，一行都不许有 ───────────────────────────────


@pytest.mark.parametrize(
    "kwargs, 说的是",
    [
        (dict(geo=RuntimeError("boom")), "地理编码炸了"),
        (dict(daily=RuntimeError("boom")), "预报接口炸了"),
        (dict(geo={"results": []}), "城市认不出"),
        (dict(daily={"daily": {}}), "返回空预报"),
    ],
)
def test_取不到就是取不到_不许有兜底行(kwargs, 说的是):
    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch(**kwargs))
    assert r.ok is False, 说的是
    # ⚠ 这一条比 ok=False 重要：把失败改成"给点兜底数据"时 ok 可能还是 False，
    #   而页面照样铺满假数字。判据要钉在**有没有行**上。
    assert r.rows == (), 说的是
    assert r.error, "失败必须带一句人话原因，不许静静地空着"


def test_认不出城市不许悄悄换成默认城市():
    """最难发现的一类假数据：每个数字都是真的，只有标题是错的。"""
    r = C.fetch_rows("weather", {"city": "zzz"}, fetch_fn=fake_fetch(geo={"results": []}))
    assert r.ok is False
    assert r.rows == ()
    assert "zzz" in r.error


def test_没有这个连接器_和_没配凭据_都如实回绝(monkeypatch):
    miss = C.fetch_rows("nope", {}, fetch_fn=fake_fetch())
    assert miss.ok is False and miss.rows == () and "nope" in miss.error

    gated = C.ConnectorSpec(
        id="gated",
        name="要钥匙的",
        description="",
        entity_id="e",
        entity_name="E",
        fields=(C.ConnectorField("a", "A"),),
        needs_env="SOME_KEY_THAT_IS_NOT_SET",
    )
    monkeypatch.setitem(C._REGISTRY, "gated", gated)
    monkeypatch.delenv("SOME_KEY_THAT_IS_NOT_SET", raising=False)
    r = C.fetch_rows("gated", {}, fetch_fn=fake_fetch())
    assert r.ok is False and r.rows == () and "凭据" in r.error


# ── 重试：只对传输层，业务失败不重试 ───────────────────────────────


def test_传输层异常会再试一次_业务失败不重试():
    """⚠ 两半都要判。只判"会重试"的话，把业务失败也拖进重试同样绿——
    而那只是让用户对着一个永远认不出的城市多等一轮。"""
    calls = []
    C.fetch_rows("weather", {"city": "北京"}, fetch_fn=fake_fetch(geo=RuntimeError("x"), calls=calls))
    assert len(calls) == C._ATTEMPTS, "传输层炸了要再试"

    calls2 = []
    C.fetch_rows("weather", {"city": "zzz"}, fetch_fn=fake_fetch(geo={"results": []}, calls=calls2))
    assert len(calls2) == 1, "业务失败不许重试"


def test_第一次超时第二次成功_算成功():
    state = {"n": 0}

    def flaky(url, timeout_s):
        if "geocoding-api" in url:
            state["n"] += 1
            if state["n"] == 1:
                raise TimeoutError("首包慢")
            return GEO_OK
        return DAILY_OK

    r = C.fetch_rows("weather", {"city": "北京"}, fetch_fn=flaky)
    assert r.ok and len(r.rows) == 2


# ── 天气代码：认不出的不许写成晴 ────────────────────────────────────


def test_认不出的天气代码如实标未知():
    assert C.weather_text(61) == "小雨"
    assert C.weather_text(0) == "晴"
    # ⚠ 别改成"看不懂就写晴"：Open-Meteo 一次扩表就会让页面凭空多出一堆晴天。
    assert "未知" in C.weather_text(1234)
    assert "1234" in C.weather_text(1234)
    assert C.weather_text(None) == "未知"


def test_连接器清单对外只暴露公开信息():
    items = C.list_connectors()
    assert any(i["id"] == "weather" for i in items)
    w = next(i for i in items if i["id"] == "weather")
    assert w["entityId"] == "weather_daily"
    assert [f["id"] for f in w["fields"]][:2] == ["date", "city"]
    assert w["available"] is True
