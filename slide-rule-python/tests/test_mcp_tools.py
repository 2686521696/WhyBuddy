"""MCP 工具注册表 + web.search（P2a）：供应商链/门禁/回落/形状不变量。

全部 mock，零网络（conftest 已全局关搜索；本文件按需显式开）。
真网络活体冒烟：SLIDERULE_LIVE_WEB_TESTS=1 时跑最后一条。
"""

from __future__ import annotations

import os

import pytest

import services.mcp_tools as mcp_tools
from services.mcp_tools import MCP_TOOLS, _distill_queries, code_run, web_search
from services.rag_service import retrieve_evidence


@pytest.fixture
def search_on(monkeypatch):
    monkeypatch.setenv("SLIDERULE_WEB_SEARCH", "on")


def _fake_results(tag: str, n: int = 3):
    return [
        {
            "content": f"{tag} 内容 {i}",
            "source": f"https://example.com/{tag}/{i}",
            "title": f"{tag}-{i}",
            "score": 0.7,
            "id": f"web-{tag}-{i}",
            "retrieval": f"web:{tag}",
        }
        for i in range(n)
    ]


# ── 门禁与回落 ─────────────────────────────────────────────────────────


def test_disabled_by_conftest_default():
    # conftest 全局 SLIDERULE_WEB_SEARCH=off：任何测试不显式开就绝不外呼
    assert os.environ.get("SLIDERULE_WEB_SEARCH") == "off"
    assert web_search("任何话题") is None


def test_provider_chain_first_hit_wins(search_on, monkeypatch):
    monkeypatch.setattr(mcp_tools, "_search_tavily", lambda q, k: None)  # 无 key
    monkeypatch.setattr(mcp_tools, "_search_serper", lambda q, k: _fake_results("serper", 2))
    monkeypatch.setattr(
        mcp_tools, "_search_wikipedia", lambda q, k: pytest.fail("后位供应商不该被调")
    )
    monkeypatch.setattr(mcp_tools, "_PROVIDERS", (
        ("tavily", mcp_tools._search_tavily),
        ("serper", mcp_tools._search_serper),
        ("wikipedia", mcp_tools._search_wikipedia),
    ))
    results = web_search("民宿动态定价", 4)
    assert [r["retrieval"] for r in results] == ["web:serper", "web:serper"]


def test_provider_exception_falls_through(search_on, monkeypatch):
    def _boom(q, k):
        raise RuntimeError("供应商炸了")

    monkeypatch.setattr(mcp_tools, "_PROVIDERS", (
        ("boom", _boom),
        ("ok", lambda q, k: _fake_results("ok", 1)),
    ))
    results = web_search("x", 3)
    assert results and results[0]["retrieval"] == "web:ok"


def test_all_providers_dead_returns_none(search_on, monkeypatch):
    monkeypatch.setattr(mcp_tools, "_PROVIDERS", (("dead", lambda q, k: None),))
    assert web_search("x", 3) is None


# ── retrieve_evidence 融合契约 ─────────────────────────────────────────


def test_retrieve_evidence_falls_back_to_local_when_web_off():
    results = retrieve_evidence("权限系统风险", top_k=4)
    assert results  # 本地基线兜底永不空
    assert all(r["retrieval"] in ("keyword", "vector") for r in results)
    # 形状不变量：下游 report/evidence 汇编依赖这些键
    for r in results:
        assert {"content", "source", "score", "id", "retrieval"} <= set(r.keys())


def test_retrieve_evidence_merges_web_first(search_on, monkeypatch):
    monkeypatch.setattr(mcp_tools, "_PROVIDERS", (
        ("fake", lambda q, k: _fake_results("fake", 2)),
    ))
    results = retrieve_evidence("民宿动态定价", top_k=5)
    # 真源优先在前，不足由本地补足；形状同构
    assert results[0]["retrieval"] == "web:fake"
    assert results[1]["retrieval"] == "web:fake"
    assert any(r["retrieval"] in ("keyword", "vector") for r in results[2:])
    for r in results:
        assert {"content", "source", "score", "id", "retrieval"} <= set(r.keys())


def test_retrieve_evidence_web_saturates_top_k(search_on, monkeypatch):
    monkeypatch.setattr(mcp_tools, "_PROVIDERS", (
        ("fake", lambda q, k: _fake_results("fake", 8)),
    ))
    results = retrieve_evidence("剧本杀", top_k=4)
    assert len(results) == 4
    assert all(r["retrieval"] == "web:fake" for r in results)


# ── 蒸馏与注册表 ──────────────────────────────────────────────────────


def test_distill_queries_prefix_ladder():
    qs = _distill_queries("宠物医院预约问诊系统")
    assert "宠物医院" in qs and "宠物" in qs  # 递减前缀候选
    qs2 = _distill_queries("民宿房态管理与动态定价助手")
    assert any(q.startswith("民宿") for q in qs2)
    assert any(q.startswith("动态定价") or q == "动态定价" for q in qs2)


def test_registry_descriptor_mcp_shape():
    tool = MCP_TOOLS["web.search"]
    assert tool["readOnly"] is True  # P2a 只读；P2b 执行类必须走沙盒
    assert tool["inputSchema"]["required"] == ["query"]
    assert callable(tool["handler"])


def test_registry_execution_tools_declare_sandbox():
    """注册表纪律：所有执行类工具（readOnly=False）必须声明隔离面。"""
    for name, tool in MCP_TOOLS.items():
        if tool["readOnly"] is False:
            assert tool.get("sandbox"), f"{name} 是执行类却没声明沙盒"


def test_code_run_registry_descriptor():
    tool = MCP_TOOLS["code.run"]
    assert tool["readOnly"] is False
    assert tool["sandbox"] == "e2b"
    assert tool["inputSchema"]["required"] == ["code"]
    assert tool["handler"] is code_run


# ── code.run 沙盒执行（P2b）：fail-closed / 形状 / 回收 ───────────────


class _FakeExecution:
    def __init__(self, stdout=(), stderr=(), text="", error=None):
        self.logs = type("Logs", (), {"stdout": list(stdout), "stderr": list(stderr)})()
        self.text = text
        self.error = error


class _FakeSandbox:
    def __init__(self, execution=None, boom=None):
        self._execution = execution or _FakeExecution()
        self._boom = boom
        self.killed = False
        self.sandbox_id = "sbx-fake-1"

    def run_code(self, code, timeout=None):
        if self._boom:
            raise self._boom
        return self._execution

    def kill(self):
        self.killed = True


def test_code_run_disabled_by_conftest_default():
    # conftest 全局 SLIDERULE_CODE_RUN=off：不显式开就绝不碰沙盒
    assert code_run("print(1)") is None


def test_code_run_fail_closed_without_key(monkeypatch):
    monkeypatch.setenv("SLIDERULE_CODE_RUN", "on")
    monkeypatch.delenv("E2B_API_KEY", raising=False)
    monkeypatch.setattr(
        mcp_tools, "_e2b_sandbox", lambda t: pytest.fail("无 key 不该建沙盒")
    )
    assert code_run("print(1)") is None  # fail-closed：绝不回落宿主执行


def test_code_run_happy_path_shape_and_kill(monkeypatch):
    monkeypatch.setenv("SLIDERULE_CODE_RUN", "on")
    monkeypatch.setenv("E2B_API_KEY", "test-key")
    sbx = _FakeSandbox(_FakeExecution(stdout=["42\n"], text="42"))
    monkeypatch.setattr(mcp_tools, "_e2b_sandbox", lambda t: sbx)
    out = code_run("print(6*7)")
    assert out["ok"] is True
    assert out["stdout"] == "42\n"
    assert out["provenance"] == "sandbox:e2b" and out["retrieval"] == "sandbox:e2b"
    assert out["sandboxId"] == "sbx-fake-1"
    assert sbx.killed  # 用完即毁，不留计费悬挂


def test_code_run_execution_error_reported(monkeypatch):
    monkeypatch.setenv("SLIDERULE_CODE_RUN", "on")
    monkeypatch.setenv("E2B_API_KEY", "test-key")
    err = type("Err", (), {"name": "ZeroDivisionError", "value": "division by zero"})()
    sbx = _FakeSandbox(_FakeExecution(stderr=["boom\n"], error=err))
    monkeypatch.setattr(mcp_tools, "_e2b_sandbox", lambda t: sbx)
    out = code_run("1/0")
    assert out["ok"] is False
    assert "ZeroDivisionError" in out["error"]
    assert sbx.killed


def test_code_run_kills_sandbox_even_on_crash(monkeypatch):
    monkeypatch.setenv("SLIDERULE_CODE_RUN", "on")
    monkeypatch.setenv("E2B_API_KEY", "test-key")
    sbx = _FakeSandbox(boom=RuntimeError("传输层炸了"))
    monkeypatch.setattr(mcp_tools, "_e2b_sandbox", lambda t: sbx)
    with pytest.raises(RuntimeError):
        code_run("print(1)")
    assert sbx.killed  # finally 保证回收


# ── 活体冒烟（显式开才碰网络）──────────────────────────────────────────


@pytest.mark.skipif(
    os.environ.get("SLIDERULE_LIVE_WEB_TESTS") != "1",
    reason="live web smoke (SLIDERULE_LIVE_WEB_TESTS=1 to enable)",
)
def test_live_wikipedia_smoke(monkeypatch):
    monkeypatch.setenv("SLIDERULE_WEB_SEARCH", "on")
    results = web_search("剧本杀门店组局", 3)
    assert results and results[0]["source"].startswith("https://")


@pytest.mark.skipif(
    os.environ.get("SLIDERULE_LIVE_SANDBOX_TESTS") != "1",
    reason="live E2B sandbox smoke (SLIDERULE_LIVE_SANDBOX_TESTS=1 + E2B_API_KEY to enable)",
)
def test_live_e2b_code_run_smoke(monkeypatch):
    monkeypatch.setenv("SLIDERULE_CODE_RUN", "on")
    out = code_run("import sys; print('sliderule-sandbox-ok', sys.version_info[:2])")
    assert out is not None and out["ok"] is True
    assert "sliderule-sandbox-ok" in out["stdout"]
    assert out["provenance"] == "sandbox:e2b" and out["sandboxId"]
