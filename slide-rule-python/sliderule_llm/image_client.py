"""
sliderule_llm/image_client.py — 生图客户端（能力层，不接生产链路）。

复刻 skills/sliderule 那套已验证过的 image_settings.py 单一入口模式：
Key/地址/模型只从环境变量取（IMAGE_API_KEY / IMAGE_API_URL / IMAGE_MODEL），
三者缺一律 fail-closed，不内置任何第三方服务商地址当默认值——
避免在没人明确配置的情况下悄悄把 prompt 发到某个写死的外部端点。

出的图统一按「预览·未验证」对待：只示意、不写真实数据、用完即弃，
不落进产物给终端用户看——这条纪律由调用方（不是本模块）负责执行。
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from dataclasses import dataclass

RETRIES = 3
BACKOFF = 5  # 秒，退避基数：5, 10, 15
DEFAULT_TIMEOUT_S = 600
LABEL = "预览·未验证"


class ImageGenError(RuntimeError):
    pass


@dataclass(frozen=True)
class ImageGenConfig:
    url: str
    model: str
    key: str
    timeout: int
    # 请求体形态。不同服务商对"要多大的图"用的字段不一样，实测过两种：
    #   "size"       → {"size": "1792x1024"}          （OpenAI images 接口标准写法）
    #   "image_size" → {"image_size": "2K", "aspect_ratio": "16:9"}
    # 后者是那份第三方技能包默认模板用的写法。写成配置项而不是写死，是因为
    # 这两家我们都要能打——首页参照板可以单独指到出图更大的那家（见
    # freeform_block._generate_overview_sheet_b64）。
    body_style: str = "size"
    aspect_ratio: str = "16:9"


def get_image_gen_config(prefix: str = "") -> ImageGenConfig | None:
    """三项全配才返回配置；缺任意一项返回 None（调用方按 fail-closed 处理）。

    prefix 允许同一套变量名开出第二份独立配置——传 "SHEET_" 就读
    SHEET_IMAGE_API_URL / SHEET_IMAGE_MODEL / SHEET_IMAGE_API_KEY。
    没配（或只配了一部分）返回 None，调用方回落到默认那份，行为与从前逐字节
    一致。**不内置任何服务商地址或 key**，这条纪律对带前缀的那份同样成立。
    """
    url = os.environ.get(f"{prefix}IMAGE_API_URL") or ""
    model = os.environ.get(f"{prefix}IMAGE_MODEL") or ""
    key = os.environ.get(f"{prefix}IMAGE_API_KEY") or ""
    if not (url and model and key):
        return None
    timeout = int(
        os.environ.get(f"{prefix}IMAGE_TIMEOUT_S") or os.environ.get("IMAGE_TIMEOUT_S") or DEFAULT_TIMEOUT_S
    )
    body_style = (os.environ.get(f"{prefix}IMAGE_BODY_STYLE") or "size").strip()
    if body_style not in ("size", "image_size"):
        body_style = "size"
    aspect_ratio = (os.environ.get(f"{prefix}IMAGE_ASPECT_RATIO") or "16:9").strip()
    return ImageGenConfig(
        url=url,
        model=model,
        key=key,
        timeout=timeout,
        body_style=body_style,
        aspect_ratio=aspect_ratio,
    )


def _build_body(cfg: ImageGenConfig, prompt: str, size: str) -> dict:
    """按服务商的请求体形态装配（见 ImageGenConfig.body_style）。"""
    body: dict = {
        "model": cfg.model,
        "prompt": prompt,
        "response_format": "b64_json",
        "n": 1,
    }
    if cfg.body_style == "image_size":
        body["image_size"] = size
        body["aspect_ratio"] = cfg.aspect_ratio
    else:
        body["size"] = size
    return body


def _transient(exc: Exception) -> bool:
    return isinstance(exc, urllib.error.HTTPError) and exc.code in (429, 500, 502, 503, 504)


def generate_image_png(
    prompt: str,
    *,
    cfg: ImageGenConfig | None = None,
    size: str = "1024x1024",
) -> bytes:
    """调生图接口，返回 PNG 原始字节。三项配置缺失或多次重试后仍失败均抛 ImageGenError。

    size 的含义跟着 cfg.body_style 走：默认 "size" 形态传 "1792x1024" 这种
    宽x高；"image_size" 形态传 "2K" 这种档位名（另配 aspect_ratio）。

    历史记录更正（2026-07-30）：这里原本写着"image_size/aspect_ratio 那套在
    /v1/images/generations 上会挂到 504"——那是对**上一个**端点的结论，当前
    端点上复测能正常返回（只是 aspect_ratio 被忽略）。换端点必须重测，别把
    旧结论当常量。
    """
    resolved = cfg or get_image_gen_config()
    if resolved is None:
        raise ImageGenError("IMAGE_API_KEY / IMAGE_API_URL / IMAGE_MODEL 未完整配置，生图能力不可用")

    body = _build_body(resolved, prompt, size)
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {resolved.key}"}

    last_exc: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            req = urllib.request.Request(
                resolved.url,
                data=json.dumps(body).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=resolved.timeout) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            b64 = payload["data"][0]["b64_json"]
            return base64.b64decode(b64)
        except Exception as exc:  # noqa: BLE001 — 统一走下面的重试/包装逻辑
            last_exc = exc
            if attempt < RETRIES and _transient(exc):
                time.sleep(BACKOFF * attempt)
                continue
            break
    raise ImageGenError(f"生图失败（已重试 {RETRIES} 次）: {last_exc}")
