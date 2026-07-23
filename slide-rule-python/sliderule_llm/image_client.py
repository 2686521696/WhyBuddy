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


def get_image_gen_config() -> ImageGenConfig | None:
    """三项全配才返回配置；缺任意一项返回 None（调用方按 fail-closed 处理）。"""
    url = os.environ.get("IMAGE_API_URL") or ""
    model = os.environ.get("IMAGE_MODEL") or ""
    key = os.environ.get("IMAGE_API_KEY") or ""
    if not (url and model and key):
        return None
    timeout = int(os.environ.get("IMAGE_TIMEOUT_S") or DEFAULT_TIMEOUT_S)
    return ImageGenConfig(url=url, model=model, key=key, timeout=timeout)


def _transient(exc: Exception) -> bool:
    return isinstance(exc, urllib.error.HTTPError) and exc.code in (429, 500, 502, 503, 504)


def generate_image_png(
    prompt: str,
    *,
    cfg: ImageGenConfig | None = None,
    size: str = "2K",
    aspect_ratio: str = "16:9",
) -> bytes:
    """调生图接口，返回 PNG 原始字节。三项配置缺失或多次重试后仍失败均抛 ImageGenError。"""
    resolved = cfg or get_image_gen_config()
    if resolved is None:
        raise ImageGenError("IMAGE_API_KEY / IMAGE_API_URL / IMAGE_MODEL 未完整配置，生图能力不可用")

    body = {
        "model": resolved.model,
        "prompt": prompt,
        "response_format": "b64_json",
        "image_size": size,
        "aspect_ratio": aspect_ratio,
        "n": 1,
    }
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
