"""连接器 —— 把**真实**外部数据接成实体行。

## 这个模块解决的是什么

2026-08-25 用户裁掉了"把造数据规划进 spec"那条提议，原话是：

> 那个数据如果规划到 SPEC 里面，我觉得还是假数据……就算这个网页是给别人
> 看的，假数据其实没有意义。

裁得对。仓里本来就站在这一边——`derive-binding-source.ts` 的注释写着
"模型缺席 / 实体为空时返回空源——**不编数据**"，`missingEntities` 写着
"给报告用——**不是**用来兜底造数据的"。缺的从来不是"造得更像"，是**真的**。

所以这里换了一个方向：**不是把"造什么数据"写进 spec，而是把"数据从哪来、
有哪些字段"写进 spec**。连接器自己声明一个实体 schema，spec 拿这份 schema
去建模，生成期再按同一份 schema 取一次真数据落成行。页面读到的字段名和值
是同一个来源，不需要事后把真数据往 LLM 编出来的形状里塞。

## 三条硬约束（改之前先读）

1. **fail-closed。** 取不到就是取不到：返回 ok=False 加一句人话原因，
   **绝不**回落成编的行。仓里第七条把这类归在"证据/闭环"一侧——增强类
   （生图/取色/合并优化）才允许 fail-open。一个"成功了但数字是假的"天气页
   比一个"数据源没接上"的空页危险得多，因为后者用户看得见，前者看不见。

2. **绑了连接器的实体不许铺演示种子。** demo-seed 的存在前提是"零行 = 一片
   空壳，展会上不好看"，那对普通实体成立；对连接器实体不成立——种子在这里
   正好是它要消灭的东西。这一条是本模块最容易被后人无声破坏的地方：
   种子铺上去不报错、页面还更好看，只有数字是假的。

3. **每一行都带来源与取数时间。** 跟种子行带 `seed: true` 同一个哲学：
   伪造得越像越该标出来，真实得越像也越该标出来源。渲染层据此出
   「实时 · 来源 · 几点取的」，用户一眼分得清这页数字算不算数。

## 为什么第一条链路是天气（Open-Meteo）

用户举的例子就是天气；工程上它也是最适合当第一条的：公开 API、**不要 key**
（不用先回答"用谁的凭据"这个大得多的问题）、返回结构规整、对错一眼看得出来
——判据能写成"北京 8 月最高温落在 15~45℃"这种能被变异咬住的形态，而不是
"返回了个数字"。股票金融那批真实感更强，但数字看着都像真的，首条链路的判据
反而没法写。

⚠ 这里只做**生成期取一次、快照进 runtime**（用户 2026-08-25 的裁决）。
  "运行时每次打开都现取"是同一个 seam 上的第二种取数模式，要先回答
  "用谁的 key / 别人打开你分享的应用算谁的额度"——那是权限边界，不是接线量级。
  别在这个模块里顺手把它做了。
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Tuple
from urllib.parse import quote

_TIMEOUT_S = 15.0

#: 单条链路试几次。
#:
#: ⚠ 2026-08-25 真机第一次跑就撞上：同一个 Open-Meteo 请求，手动 curl 12s 内
#:   回来，模块里 10s 超时——容器出网首包偶尔要十几秒。一次超时就报"取数失败"
#:   对用户是纯误伤（数据源好好的）。**只对传输层异常重试**：认不出城市那种
#:   业务失败重试一百次也还是认不出，重试它只是让用户多等。
_ATTEMPTS = 2

#: 取数总预算（含重试）。超了就如实说超时——不是等到天荒地老，也不是补个假的。
_BUDGET_S = 40.0


class ConnectorError(Exception):
    """取数失败。带一句能直接给用户看的中文原因。"""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class ConnectorField:
    id: str
    name: str
    type: str = "text"
    format: Optional[str] = None

    def to_entity_field(self) -> Dict[str, Any]:
        """转成五系统 datamodel 里的字段声明。"""
        out: Dict[str, Any] = {"id": self.id, "name": self.name, "type": self.type}
        if self.format:
            out["format"] = self.format
        return out


@dataclass(frozen=True)
class ConnectorArg:
    id: str
    name: str
    placeholder: str = ""
    default: str = ""
    required: bool = True


@dataclass(frozen=True)
class ConnectorSpec:
    id: str
    name: str
    description: str
    #: 落进 datamodel 的实体（id 要稳定：精修冻结 id 那套按 id 认页/认实体）
    entity_id: str
    entity_name: str
    fields: Tuple[ConnectorField, ...]
    args: Tuple[ConnectorArg, ...] = ()
    #: 数据来源的人话署名，进每一行的 provenance
    source: str = ""
    #: 需要哪个环境变量才能用；空 = 不需要凭据
    needs_env: str = ""

    def available(self) -> bool:
        return not self.needs_env or bool(os.getenv(self.needs_env))

    def entity_declaration(self) -> Dict[str, Any]:
        """给 spec 用的实体声明——**字段名就是真数据的字段名**。"""
        return {
            "id": self.entity_id,
            "name": self.entity_name,
            "fields": [f.to_entity_field() for f in self.fields],
        }

    def to_public(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "entityId": self.entity_id,
            "entityName": self.entity_name,
            "source": self.source,
            "available": self.available(),
            "args": [
                {
                    "id": a.id,
                    "name": a.name,
                    "placeholder": a.placeholder,
                    "default": a.default,
                    "required": a.required,
                }
                for a in self.args
            ],
            "fields": [f.to_entity_field() for f in self.fields],
        }


@dataclass(frozen=True)
class ConnectorFetch:
    ok: bool
    connector_id: str
    entity_id: str
    rows: Tuple[Dict[str, Any], ...] = ()
    source: str = ""
    fetched_at: str = ""
    #: 失败原因（人话，直接给用户看）。ok=True 时为空。
    error: str = ""

    def to_public(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "connectorId": self.connector_id,
            "entityId": self.entity_id,
            "rows": list(self.rows),
            "source": self.source,
            "fetchedAt": self.fetched_at,
            "error": self.error,
        }


# ─────────────────────────────────────────────── 天气（Open-Meteo，免 key）

#: WMO 天气代码 → 中文。取自 Open-Meteo 文档的 weather_code 表。
#: ⚠ 别改成"看不懂就写晴"：认不出的代码要如实落成「未知（代码 N）」，
#:   否则一次 API 扩表就会让页面上凭空多出一堆晴天。
_WMO: Dict[int, str] = {
    0: "晴", 1: "少云", 2: "多云", 3: "阴",
    45: "雾", 48: "雾凇",
    51: "毛毛雨", 53: "小雨", 55: "中雨",
    56: "冻毛毛雨", 57: "冻雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    66: "冻雨", 67: "强冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "阵雨", 81: "强阵雨", 82: "暴雨",
    85: "阵雪", 86: "强阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷阵雨伴冰雹",
}


def weather_text(code: Any) -> str:
    try:
        n = int(code)
    except (TypeError, ValueError):
        return "未知"
    return _WMO.get(n, f"未知（代码 {n}）")


WEATHER = ConnectorSpec(
    id="weather",
    name="天气",
    description="按城市取未来 7 天真实天气预报（Open-Meteo，免密钥）",
    entity_id="weather_daily",
    entity_name="天气预报",
    fields=(
        ConnectorField("date", "日期", "date"),
        ConnectorField("city", "城市", "text"),
        ConnectorField("condition", "天气", "text"),
        ConnectorField("temp_max", "最高温", "number", "temperature"),
        ConnectorField("temp_min", "最低温", "number", "temperature"),
        ConnectorField("rain_chance", "降水概率", "number", "percent"),
        ConnectorField("wind_max", "最大风速", "number"),
    ),
    args=(ConnectorArg("city", "城市", placeholder="北京", default="北京"),),
    source="Open-Meteo",
)


_FORECAST_DAYS = 7


def _http_get(url: str, timeout_s: float) -> Any:
    import httpx

    r = httpx.get(url, timeout=timeout_s, follow_redirects=True)
    r.raise_for_status()
    return r.json()


def _geocode(city: str, fetch: Callable[[str, float], Any], timeout_s: float) -> Dict[str, Any]:
    url = (
        "https://geocoding-api.open-meteo.com/v1/search"
        f"?name={quote(city)}&count=1&language=zh&format=json"
    )
    data = fetch(url, timeout_s) or {}
    results = data.get("results") or []
    if not results:
        # ⚠ 认不出城市**不是**"退回北京"。悄悄换一个城市，页面上每个数字都
        #   是真的，只有标题是错的——最难发现的一类假数据。
        raise ConnectorError(f"没有找到城市「{city}」，换个写法再试（如「北京」「Shanghai」）")
    top = results[0]
    return {
        "name": top.get("name") or city,
        "lat": top.get("latitude"),
        "lon": top.get("longitude"),
        "tz": top.get("timezone") or "auto",
    }


def _forecast(place: Dict[str, Any], fetch: Callable[[str, float], Any], timeout_s: float) -> Dict[str, Any]:
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={place['lat']}&longitude={place['lon']}"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
        "precipitation_probability_max,wind_speed_10m_max"
        f"&timezone={quote(str(place['tz']))}&forecast_days={_FORECAST_DAYS}"
    )
    data = fetch(url, timeout_s) or {}
    daily = data.get("daily") or {}
    if not daily.get("time"):
        raise ConnectorError("天气服务返回了空预报，稍后再试")
    return daily


def _weather_rows(city: str, fetch: Callable[[str, float], Any], timeout_s: float) -> Tuple[str, List[Dict[str, Any]]]:
    place = _geocode(city, fetch, timeout_s)
    daily = _forecast(place, fetch, timeout_s)
    days = daily.get("time") or []
    codes = daily.get("weather_code") or []
    tmax = daily.get("temperature_2m_max") or []
    tmin = daily.get("temperature_2m_min") or []
    rain = daily.get("precipitation_probability_max") or []
    wind = daily.get("wind_speed_10m_max") or []

    def at(seq: Any, i: int) -> Any:
        return seq[i] if isinstance(seq, list) and i < len(seq) else None

    rows: List[Dict[str, Any]] = []
    for i, day in enumerate(days):
        rows.append(
            {
                # id 由 (连接器, 城市, 日期) 决定：同一天重复取数覆盖同一行，
                # 不会每取一次就多铺 7 行。
                "id": f"weather-{place['name']}-{day}",
                "values": {
                    "date": day,
                    "city": place["name"],
                    "condition": weather_text(at(codes, i)),
                    "temp_max": at(tmax, i),
                    "temp_min": at(tmin, i),
                    "rain_chance": at(rain, i),
                    "wind_max": at(wind, i),
                },
            }
        )
    if not rows:
        raise ConnectorError("天气服务没有返回任何一天的预报")
    return str(place["name"]), rows


# ─────────────────────────────────────────────────────────── 注册表 / 取数

_REGISTRY: Dict[str, ConnectorSpec] = {WEATHER.id: WEATHER}

_FETCHERS: Dict[str, Callable[..., Tuple[str, List[Dict[str, Any]]]]] = {
    WEATHER.id: _weather_rows,
}


def list_connectors() -> List[Dict[str, Any]]:
    return [spec.to_public() for spec in _REGISTRY.values()]


def get_connector(connector_id: str) -> Optional[ConnectorSpec]:
    return _REGISTRY.get(str(connector_id or "").strip())


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime())


def fetch_rows(
    connector_id: str,
    args: Optional[Dict[str, Any]] = None,
    *,
    fetch_fn: Optional[Callable[[str, float], Any]] = None,
    timeout_s: Optional[float] = None,
    now_fn: Optional[Callable[[], str]] = None,
) -> ConnectorFetch:
    """取一次真数据。

    ⚠ **任何失败路径都返回 ok=False，绝不返回编出来的行。** 这个函数是
      "假数据不许进系统"这条产品判断在代码里的落点；把它改成"失败时给点
      兜底数据"，整条链路就白做了——页面照样好看，数字重新变成假的。
    """
    spec = get_connector(connector_id)
    if not spec:
        return ConnectorFetch(False, str(connector_id or ""), "", error=f"没有这个连接器：{connector_id}")
    if not spec.available():
        return ConnectorFetch(
            False, spec.id, spec.entity_id, error=f"{spec.name}还没配置凭据（{spec.needs_env}）"
        )

    fetch = fetch_fn or _http_get
    budget = float(timeout_s if timeout_s is not None else _TIMEOUT_S)
    now = now_fn or _iso_now
    handler = _FETCHERS.get(spec.id)
    if not handler:
        return ConnectorFetch(False, spec.id, spec.entity_id, error=f"{spec.name}还没有取数实现")

    values = dict(args or {})
    call_args = []
    for a in spec.args:
        raw = str(values.get(a.id) or "").strip() or a.default
        if a.required and not raw:
            return ConnectorFetch(False, spec.id, spec.entity_id, error=f"缺少参数：{a.name}")
        call_args.append(raw)

    started = time.monotonic()
    last: Optional[str] = None
    label, rows = "", []
    for attempt in range(_ATTEMPTS):
        try:
            label, rows = handler(*call_args, fetch, budget)
            last = None
            break
        except ConnectorError as exc:
            # 业务失败（城市认不出、返回空预报）——重试没有意义，直接如实回。
            return ConnectorFetch(False, spec.id, spec.entity_id, error=exc.reason)
        except Exception as exc:  # noqa: BLE001 — 外网什么都可能抛，如实转成人话
            last = f"{spec.name}取数失败：{type(exc).__name__}"
            if time.monotonic() - started > _BUDGET_S:
                break
    if last:
        return ConnectorFetch(False, spec.id, spec.entity_id, error=last)
    if time.monotonic() - started > _BUDGET_S:
        return ConnectorFetch(False, spec.id, spec.entity_id, error=f"{spec.name}取数超时")

    source = f"{spec.source} · {label}" if label else spec.source
    return ConnectorFetch(
        True, spec.id, spec.entity_id, rows=tuple(rows), source=source, fetched_at=now()
    )
