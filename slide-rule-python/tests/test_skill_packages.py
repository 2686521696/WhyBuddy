"""技能包（原版 SKILL.md 执行，技能库四期）测试。

语义锁点：
  1. 消息装配——SKILL.md 原文进 system prompt + 运行时边界 guard，
     用户输入原样进 user 消息（"原版指令执行"的定义本身）；
  2. 路由诚实契约与单能力试跑同口径：HTTP 恒 200，flag 关 →
     LLM_GENERATE_DISABLED，包不存在 → PACKAGE_NOT_FOUND，不伪造输出；
  3. 清单端点只出元数据不出正文（正文只在执行时进 prompt）。
"""

import os
import sys

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import routes.sliderule_full as sliderule_full  # noqa: E402
import services.v5_skill_packages as pkgs  # noqa: E402
from sliderule_llm.client import LlmError, LlmResult  # noqa: E402

app = FastAPI()
app.include_router(sliderule_full.router, prefix="/api/sliderule")
client = TestClient(app)

FAKE_PKG = {
    "id": "github-com-x-novel-skill-md",
    "repo": "github.com/x/novel",
    "path": "SKILL.md",
    "sourceUrl": "https://github.com/x/novel",
    "license": "MIT",
    "name": "网络小说创作",
    "description": "长篇小说章节生成",
    "content": "# 网络小说创作\n\n按大纲生成章节，保持人物卡一致性。",
    "truncated": False,
}


def _inject(monkeypatch):
    monkeypatch.setattr(pkgs, "_cache", [FAKE_PKG])


def _ok_llm(*_args, **_kwargs):
    return LlmResult(
        content="第一章：夜色如墨……",
        usage={"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        finish_reason="stop",
        model="fake",
        latency_ms=5,
    )


def test_build_messages_puts_skill_md_in_system_prompt() -> None:
    messages = pkgs.build_skill_messages(FAKE_PKG, "写一段开头")
    assert messages[0]["role"] == "system"
    assert "按大纲生成章节" in messages[0]["content"]  # SKILL.md 原文在场
    assert "[运行时说明]" in messages[0]["content"]  # 边界 guard 在场
    assert messages[1] == {"role": "user", "content": "写一段开头"}


def test_list_endpoint_returns_meta_without_content(monkeypatch) -> None:
    _inject(monkeypatch)
    res = client.get("/api/sliderule/skill-packages")
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    item = body["items"][0]
    assert item["name"] == "网络小说创作"
    assert "content" not in item
    assert item["contentChars"] > 0


def test_tryrun_runs_skill_and_honest_failures(monkeypatch) -> None:
    _inject(monkeypatch)
    monkeypatch.setenv("SLIDERULE_LLM_GENERATE_ENABLED", "1")
    monkeypatch.setattr("sliderule_llm.client.call_llm", _ok_llm)

    res = client.post(
        "/api/sliderule/skill-package-tryrun",
        json={"packageId": FAKE_PKG["id"], "input": "写一段开头"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert "第一章" in body["output"]

    # 包不存在 → 如实报，不伪造
    res2 = client.post(
        "/api/sliderule/skill-package-tryrun",
        json={"packageId": "ghost", "input": "x"},
    )
    assert res2.json()["code"] == "PACKAGE_NOT_FOUND"

    # LLM 失败 → LLM_GENERATE_FAILED
    def _boom(*_a, **_k):
        raise LlmError("provider down")

    monkeypatch.setattr("sliderule_llm.client.call_llm", _boom)
    res3 = client.post(
        "/api/sliderule/skill-package-tryrun",
        json={"packageId": FAKE_PKG["id"], "input": "x"},
    )
    assert res3.json()["code"] == "LLM_GENERATE_FAILED"


def test_tryrun_disabled_flag_never_fakes(monkeypatch) -> None:
    _inject(monkeypatch)
    monkeypatch.delenv("SLIDERULE_LLM_GENERATE_ENABLED", raising=False)
    res = client.post(
        "/api/sliderule/skill-package-tryrun",
        json={"packageId": FAKE_PKG["id"], "input": "x"},
    )
    assert res.status_code == 200
    assert res.json()["code"] == "LLM_GENERATE_DISABLED"
