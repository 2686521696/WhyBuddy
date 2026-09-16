"""预览链路的部署配置：Caddy、compose、Python 三者必须对得上。

## 这条判据来自一次真机 502（2026-09-16）

    https://rt-probe.preview.156.239.47.108.sslip.io/  → 502

502 恰恰证明**前三关都通了**：通配符 DNS 解析到了、on-demand TLS 给一个
从没见过的子域当场签了证书、vhost 路由也命中了——它是反代那一步才失败的。
失败原因是 Caddy 反代 `172.18.0.1:3002`（宿主网桥网关），而 compose 里的
project-preview 发布在 `127.0.0.1:3002`：**宿主回环上的监听收不到从网桥
网关来的流量**。两套拓扑并存，哪套都不成立。

⚠ 这种坏法完全静默：Caddy 起得来、网关容器起得来、Python 起得来，
  每一件单看都健康，只有用户点「打开预览」时打不开。仓里当时
  **没有任何判据覆盖部署配置**，所以它可以一直躺着。

这份判据钉三件事，任何一件漂了就红。
"""

from __future__ import annotations

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
CADDYFILE = ROOT / "caddy" / "Caddyfile"
COMPOSE = ROOT / "docker-compose.project.yml"


def _preview_vhost() -> str:
    """Caddyfile 里 `*.preview.*` 那个站点块。"""
    text = CADDYFILE.read_text(encoding="utf-8")
    start = text.index("*.preview.")
    # 站点块从第一个 `{` 到与之配对的 `}`
    brace = text.index("{", start)
    depth, index = 0, brace
    while index < len(text):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
        index += 1
    raise AssertionError("预览站点块没有闭合")


def _services() -> dict:
    return yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]


def test_caddy_反代的是一个真的存在的服务名():
    """⚠ 这是那次 502 的直接原因。"""
    vhost = _preview_vhost()
    match = re.search(r"reverse_proxy\s+(\S+)", vhost)
    assert match, f"预览站点块里没有 reverse_proxy：{vhost}"
    upstream = match.group(1)
    host, _, port = upstream.rpartition(":")
    assert port == "3002", f"预览网关端口应为 3002，实际 {upstream}"
    services = _services()
    assert host in services, (
        f"Caddy 反代 {upstream}，但 docker-compose.project.yml 里没有叫 {host} 的服务。"
        f"现有服务：{sorted(services)}。"
        "⚠ 写成宿主 IP（比如 172.18.0.1）时这条会红——那正是 2026-09-16 那次 502："
        "容器里的 Caddy 打不到宿主回环上的监听。"
    )


def test_两侧的网关key引用同一个变量():
    """Python 发票、网关兑票，用的必须是同一把。

    ⚠ 两边各配各的是最阴的坏法：票照发、界面照常显示就绪，兑票时静默失败。
      在 compose 里引用**同一个变量名**，就从源头上不可能配歪。
    """
    services = _services()
    key = "WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY"
    python_env = services["python"]["environment"]
    gateway_env = services["project-preview"]["environment"]
    assert key in python_env, (
        f"python 服务没有 {key}——Python 侧 os.getenv 读不到，"
        "preview_configuration_enabled() 会是 False，界面停在「尚未配置」，"
        "而网关侧照样起得来。"
    )
    assert key in gateway_env, f"project-preview 服务没有 {key}"
    assert python_env[key] == gateway_env[key], (
        "两侧必须引用同一个 ${...} 表达式，才能保证是同一把 key；"
        f"现在 python={python_env[key]!r} gateway={gateway_env[key]!r}"
    )


def test_python侧拿得到来源模板():
    """`origin_for_runtime()` 少了它就抛 project_preview_origin_not_configured。"""
    python_env = _services()["python"]["environment"]
    name = "WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE"
    assert name in python_env, (
        f"python 服务没有 {name}。它是 os.getenv 读的，只靠 env_file 间接给"
        "会在 .env 漏填时静默退回「尚未配置」。"
    )
    assert "{runtimeId}" in python_env[name] or python_env[name].startswith("${"), (
        f"{name} 必须是含 {{runtimeId}} 的模板或一个 ${{...}} 引用，实际 {python_env[name]!r}"
    )


def test_预览不许绕过TLS入口直接裸露():
    """⚠ publish 必须绑回环。绑 0.0.0.0 等于把生成应用直接挂公网，
    绕过 Caddy 的 TLS 与 on-demand 证书那一层。"""
    ports = _services()["project-preview"].get("ports") or []
    for entry in ports:
        assert str(entry).startswith("127.0.0.1:"), (
            f"project-preview 的 publish 必须绑 127.0.0.1，实际 {entry!r}"
        )
