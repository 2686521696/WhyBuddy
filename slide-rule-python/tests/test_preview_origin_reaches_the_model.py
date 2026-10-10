"""模型知道预览页面在浏览器里的来源，会校验来源的框架才不至于把所有提交都拒掉。

⚠ 2026-10-10 线上 Django 读书打卡 sr-20261010143514-9KNB9FZ5Q9：页面打得开、GET 全 200，表单一提交
  就是「Forbidden (Origin checking failed - https://pv-942f….preview.38.76.207.227.sslip.io does not match any
  trusted origins.)」。网关把 Host 换成回环地址，浏览器的 Origin 原样过去。提示里只讲了 Host（ALLOWED_HOSTS），
  模型照做了；页面本身在 HTTPS 预览域名上这件事没人说，它花了几轮验收才从日志里倒推出来。

判据：
- 通配来源从部署配的那条模板算出来（线上那条原样），跟真发票用的 origin_for_project 是同一个域；
- 真系统提示（_system_prompt + 注入的真 ProjectTools + 真 supervisor）里有这句；
- 反向：没接预览网关 / 没配模板 / 办公工作区，不说这句（说了是误导）。
变异：rehearsal_control 不传来源、supervisor 不报——各自变红。
"""

from __future__ import annotations

from urllib.parse import urlsplit

from models.v5_state import V5SessionState
from services import rehearsal_control as control
from services.project_preview_config import origin_for_project, preview_origin_pattern
from services.project_runtime_worker import ProjectRuntimeSupervisor
from services.project_store import ProjectStore
from services.project_tools import ProjectTools

LIVE_TEMPLATE = "https://{runtimeId}.preview.38.76.207.227.sslip.io"
LIVE_PATTERN = "https://*.preview.38.76.207.227.sslip.io"


def _session(kind="web-app"):
    plan = {"planId": "plan-django", "revision": 1, "planContent": "用 Django 做读书打卡", "deliverableKind": kind}
    return V5SessionState(sessionId="sr-origin", ownerId="alice", runtimeKind="project", projectId="prj-1",
        goal={"text": "用 Django 做读书打卡", "status": "clear"},
        controlTranscript=[{**plan, "kind": "plan_written", "role": "assistant", "text": plan["planContent"]}])


def _prompt_with(tmp_path, preview_runtime, kind="web-app"):
    tmp_path.mkdir(parents=True, exist_ok=True)
    store = ProjectStore.from_url(f"sqlite:///{tmp_path / 'p.db'}")
    supervisor = ProjectRuntimeSupervisor(store, lambda: None, preview_runtime=preview_runtime)
    token = control._PROJECT_TOOLS.set(ProjectTools(store, supervisor, "alice"))
    try:
        return control._system_prompt(_session(kind))
    finally:
        control._PROJECT_TOOLS.reset(token)
        store.close()


def test_the_pattern_is_the_same_domain_the_real_grants_are_issued_on(monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", LIVE_TEMPLATE)
    assert preview_origin_pattern() == LIVE_PATTERN
    real = urlsplit(origin_for_project("prj-a67ae604e0a3595ca641f56f5a583e05"))
    assert real.hostname == "pv-942f9040d6901dcde2df36530fa5630a.preview.38.76.207.227.sslip.io"   # 线上那个
    assert real.hostname.split(".", 1)[1] == urlsplit(LIVE_PATTERN.replace("*", "x")).hostname.split(".", 1)[1]
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    assert preview_origin_pattern() is None


def test_the_live_system_prompt_names_the_origin_to_trust(tmp_path, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", LIVE_TEMPLATE)
    prompt = _prompt_with(tmp_path, preview_runtime=object())
    assert f"CSRF_TRUSTED_ORIGINS = ['{LIVE_PATTERN}']" in prompt
    assert "Origin" in prompt


def test_without_the_preview_gateway_or_for_office_work_it_is_not_said(tmp_path, monkeypatch):
    monkeypatch.setenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE", LIVE_TEMPLATE)
    assert "CSRF_TRUSTED_ORIGINS" not in _prompt_with(tmp_path / "a", preview_runtime=None)
    assert "CSRF_TRUSTED_ORIGINS" not in _prompt_with(tmp_path / "b", preview_runtime=object(), kind="office-file")
    monkeypatch.delenv("WHYBUDDY_PROJECT_PREVIEW_ORIGIN_TEMPLATE")
    prompt = _prompt_with(tmp_path / "c", preview_runtime=object())
    assert "CSRF_TRUSTED_ORIGINS" not in prompt and "ALLOWED_HOSTS" in prompt          # Host 那句照旧在
