"""MCP 工具注册表 + web.search（P2a）：供应商链/门禁/回落/形状不变量。

全部 mock，零网络（conftest 已全局关搜索；本文件按需显式开）。
真网络活体冒烟：SLIDERULE_LIVE_WEB_TESTS=1 时跑最后一条。
"""

from __future__ import annotations

import os

import pytest

import services.mcp_tools as mcp_tools
from services.mcp_tools import MCP_TOOLS, _distill_queries, web_search
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


# ── 活体冒烟（显式开才碰网络）──────────────────────────────────────────


@pytest.mark.skipif(
    os.environ.get("SLIDERULE_LIVE_WEB_TESTS") != "1",
    reason="live web smoke (SLIDERULE_LIVE_WEB_TESTS=1 to enable)",
)
def test_live_wikipedia_smoke(monkeypatch):
    monkeypatch.setenv("SLIDERULE_WEB_SEARCH", "on")
    results = web_search("剧本杀门店组局", 3)
    assert results and results[0]["source"].startswith("https://")
