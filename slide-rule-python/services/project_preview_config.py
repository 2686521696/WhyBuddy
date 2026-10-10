"""Bounded relay configuration shared by runtime composition and HTTP edges.

A per-project label occupies a whole hostname label, giving each application its own
cookie/storage/service-worker origin. Credentials, paths and caller URLs cannot
turn this template into an arbitrary proxy or an entry on the main site.

⚠ 2026-10-10 用户：「之前做过强制关机再打开保持之前操作的内容」，可记账 / 计划这类默认工程每次重启数据全没。
  这里原来填的是实例号 `rt-pop-<操作号>`——**每开一次机换一个**。浏览器的 localStorage / IndexedDB / cookie
  按源（域名）隔离，域名一换，应用存在浏览器里的数据就读不到了；而默认模板的工具说明正是让模型把数据存在
  localStorage（project_tool_contracts）。15 分钟到期强制关机再叫醒，用户看到的就是「刷新了、数据也没了」。
  上面那句设计本意是「每个应用一个源」，实现却落在「每次开机一个源」上。
  现在填工程号的哈希（同一个工程永远同一个源，不同工程照旧隔离）。用哈希不用工程号原文：每个预览域名的
  HTTPS 证书都进公开的证书透明度日志，原文会把内部编号公之于众。模板占位符名 `{runtimeId}` 不改——
  线上 .env 和上线检查（project_rollout）都认这个名字。
  安全边界没变：凭证仍按操作发、兑换时核对「发给的域名 = 请求的域名」（project_preview_access），
  网关按凭证里的实例找隧道（server/project-preview/relay.ts），域名只决定浏览器存储归谁。
"""

from __future__ import annotations

import hashlib
import os
import re
from urllib.parse import urlsplit


def gateway_key() -> str:
    value = os.getenv("WHYBUDDY_PROJECT_PREVIEW_GATEWAY_KEY", "")
    if len(value) < 32 or len(value) > 4096 or any(ord(char) < 33 or ord(char) > 126 for char in value):
        raise ValueError("project_preview_gateway_not_configured")
    return value


def preview_label_for_project(project_id: str) -> str:
    """预览域名最左边那一段：同一个工程永远一样，不同工程不一样，不暴露工程号原文。"""
    if not isinstance(project_id, str) or not project_id.strip():
        raise ValueError("project_preview_project_id_invalid")
    return "pv-" + hashlib.sha256(project_id.encode("utf-8")).hexdigest()[:32]


def origin_for_project(project_id: str) -> str:
    """这个工程的预览源。工程的每一次开机（开发服务器、验收、模型自己的浏览器）都用它。"""
    return _origin_for_label(preview_label_for_project(project_id))


def _origin_for_label(runtime_id: str) -> str:
    if not isinstance(runtime_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,61}[a-z0-9]", runtime_id):
        raise ValueError("project_preview_runtime_id_invalid")
    template = os.getenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", "")
    if template.count("{runtimeId}") != 1:
        raise ValueError("project_preview_origin_not_configured")
    value = template.replace("{runtimeId}", runtime_id)
    if any(char in value for char in ("{", "}", "\\", "\r", "\n", "\t", " ")):
        raise ValueError("project_preview_origin_invalid")
    try:
        parsed = urlsplit(value)
        host, port = parsed.hostname or "", parsed.port
    except ValueError as exc:
        raise ValueError("project_preview_origin_invalid") from exc
    labels = host.split(".")
    if (parsed.scheme not in {"https", "http"} or parsed.username is not None or parsed.password is not None
            or parsed.path or parsed.query or parsed.fragment or not parsed.netloc
            or len(labels) < 2 or labels[0] != runtime_id or len(host) > 253
            or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)
            or (port is not None and not 1 <= port <= 65535)
            or (parsed.scheme == "http" and not host.endswith(".localhost"))):
        raise ValueError("project_preview_origin_invalid")
    # Reject noncanonical netloc encodings/case and empty explicit ports.
    canonical = f"{parsed.scheme}://{host}" + (f":{port}" if port is not None else "")
    if canonical != value:
        raise ValueError("project_preview_origin_invalid")
    # WHATWG URL.origin (Node gateway and browser) omits a default port. Issue
    # the same origin here or a valid :443/:80 template creates grants which
    # the real gateway can never redeem despite identical network destinations.
    if (parsed.scheme, port) in {("https", 443), ("http", 80)}:
        return f"{parsed.scheme}://{host}"
    return canonical


def preview_configuration_enabled() -> bool:
    try:
        gateway_key()
        _origin_for_label("rt-configuration-probe")
        return True
    except ValueError:
        return False


def published_preview_url(value: str | None) -> str | None:
    """E2B's official published host. Internal preview copies this when the
    private relay is unreachable from the sandbox.

    2026-09-16 TicketStream：runtime 已 ready，但 agent 往
    `{runtimeId}.preview.miantuan.ai` 拨 WSS，DNS 到公网机且 TLS 失败，
    本机 :3002 网关永远接不到。GET 一直 `project_preview_tunnel_not_started`。
    E2B `sandbox.get_host(port)` 是他们文档里的预览口，源与工作台隔离。
    只认 `*.e2b.app` / `*.e2b.dev`；别的 previewUrl 不许当可打开预览。
    allowlist / production 不许走这条。
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
    except ValueError:
        return None
    if (parsed.scheme != "https" or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.port not in (None, 443)
            or not host.endswith((".e2b.app", ".e2b.dev"))
            or host.count(".") < 2):
        return None
    return f"https://{host}/"
