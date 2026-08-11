# -*- coding: utf-8 -*-
"""走 LLM 的路径，token 预算不许写死在函数默认值里（2026-08-11）。

## 这条闸是怎么来的

线上跑一道真题（社区团购团长管理系统），`intent.clarify` 占着连接算了
**115.5 秒，正文一个字都没吐**，抛 `empty content from LLM (stream)`。
并行批的耗时等于最慢那一个，于是它一个人把整轮从 22 秒拖到 116 秒——
**净空耗 93 秒**，最后还得回退 RAG，产出也打了折。

排查下来不是超时（超时报的是另一句 `timeout after Ns`），是**预算不够**：
推理模型（线上 `gpt-5.6-luna` + `LLM_REASONING_EFFORT=medium`）的
**思考 token 和正文共用同一个 max_tokens**，思考把 2000 吃光，
`finish_reason=length`，正文自然是空的。

## 为什么这条值得单独钉

**这个坑仓库已经踩过一次，并且写下来了。** `v5_llm_generate.py` 的
`_DEFAULT_GENERATE_MAX_TOKENS` 头上原话：

    ⚠️ 推理模型必须调大。它们的思考 token 和正文共用同一个 max_tokens：
    实测 deepseek-v4 在这条链路上 8000 全被思考吃掉，正文一个字都没有，
    finish_reason=length，客户端看到的是 `empty content from LLM (stream)`
    ——表现像"服务商坏了"，其实是预算不够。

那次的修复只补在**生成**那条路上（提到 8000 + 环境变量可覆盖）。
轮内能力那条路的预算还写死在 `execute_capability(max_tokens: int = 2000)`
的**函数签名默认值**里——没有名字、搜不到、也没人会想起它跟模型换代有关。
于是同一个病换个地方又发作了一次。

所以这条闸守的不是某个具体数字，是**预算得有名字、可覆盖、找得到**。
数字该多大是产品决定（花钱），但"藏在签名里"不该再发生第三次。
"""

import inspect
import re
from pathlib import Path

import pytest

from sliderule_llm import capabilities as caps

_LLM_DIR = Path(__file__).resolve().parent.parent / "sliderule_llm"


class Test预算得有名字可覆盖:
    def test_轮内能力的预算不写死在签名里(self):
        sig = inspect.signature(caps.execute_capability)
        default = sig.parameters["max_tokens"].default
        assert default is None, (
            f"max_tokens 的默认值又变回写死的 {default!r} 了。"
            "预算要走 round_cap_max_tokens()（有名字、认环境变量），"
            "签名里只留 None——理由见本文件头。"
        )

    def test_有一个能查到的默认值(self):
        assert caps.round_cap_max_tokens() == 8000

    def test_环境变量能覆盖(self, monkeypatch):
        monkeypatch.setenv("LLM_ROUND_CAP_MAX_TOKENS", "32000")
        assert caps.round_cap_max_tokens() == 32000

    @pytest.mark.parametrize("bad", ["", "   ", "abc", "0", "-1"])
    def test_环境变量写坏了退回默认_不许崩(self, monkeypatch, bad):
        # 这类开关最怕的是"配错了直接炸"——推演整场挂掉比用默认值糟得多
        monkeypatch.setenv("LLM_ROUND_CAP_MAX_TOKENS", bad)
        assert caps.round_cap_max_tokens() == 8000

    def test_显式传值仍然优先(self, monkeypatch):
        """评测脚本和单测靠显式传值控制成本，不能被默认值吃掉。"""
        seen = {}

        def fake_caller(messages, **kwargs):
            seen.update(kwargs)

            class R:
                content = "内容"
                model = "m"
                usage = None

            return R()

        caps.execute_capability(
            {"capabilityId": "risk.analyze", "goal": "某目标"}, caller=fake_caller, max_tokens=123
        )
        assert seen.get("max_tokens") == 123

    def test_不传就用配置值(self, monkeypatch):
        monkeypatch.setenv("LLM_ROUND_CAP_MAX_TOKENS", "4321")
        seen = {}

        def fake_caller(messages, **kwargs):
            seen.update(kwargs)

            class R:
                content = "内容"
                model = "m"
                usage = None

            return R()

        caps.execute_capability({"capabilityId": "risk.analyze", "goal": "某目标"}, caller=fake_caller)
        assert seen.get("max_tokens") == 4321


class Test空内容报错必须说清为什么:
    """**差一个 finish_reason，"预算不够"和"服务商挂了"长得一模一样。**

    信息一直在手上（`finish` 就在同一个函数里，成功路径还会塞进 LlmResult），
    只是没写进错误消息，于是排查方向整个偏到上游去。
    """

    def test_finish_reason_进了错误消息(self):
        from sliderule_llm.client import _empty_content_hint

        msg = _empty_content_hint("length", 2000, {"completion_tokens": 2000})
        assert "finish_reason=length" in msg
        assert "max_tokens=2000" in msg

    def test_预算吃光时给出可执行的下一步(self):
        from sliderule_llm.client import _empty_content_hint

        msg = _empty_content_hint("length", 2000, None)
        assert "不是服务商故障" in msg, "没说清是预算问题，读的人还是会去查上游"
        assert "LLM_ROUND_CAP_MAX_TOKENS" in msg, "得告诉人改哪个旋钮"

    def test_不是预算问题时不乱扣帽子(self):
        from sliderule_llm.client import _empty_content_hint

        msg = _empty_content_hint("stop", 8000, None)
        assert "预算被吃光" not in msg, "finish_reason=stop 却说是预算问题，是在误导"

    def test_两处空内容报错都带上了提示(self):
        """非流式和流式**两条路**都要带——线上跑的是流式那条，
        但换个 wire_api 就走另一条，只补一半等于没补。"""
        src = (_LLM_DIR / "client.py").read_text(encoding="utf-8")
        raises = re.findall(r'raise LlmError\(\s*\n?\s*f?"empty content from LLM[^"]*"', src)
        assert len(raises) >= 2, f"只找到 {len(raises)} 处空内容报错，预期两条路都在"
        for site in raises:
            assert site.lstrip("raise LlmError(").lstrip().startswith("f"), (
                f"这处空内容报错还是死字符串，没带 finish_reason：{site}"
            )
