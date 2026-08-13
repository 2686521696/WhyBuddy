# -*- coding: utf-8 -*-
"""走 LLM 的路径，token 预算不许写死——全链路只有一个 `LLM_MAX_TOKENS`。

## 这条闸是怎么来的（三次同一个病）

**第一次（生成路径）**：`v5_llm_generate` 写死 8000。推理模型的思考 token 和
正文**共用同一个 max_tokens**，8000 全被思考吃光，正文一个字都没有，
`finish_reason=length`，客户端收到的是 `empty content from LLM (stream)`。
那句错误看着像"服务商坏了"——**这正是它危险的地方**：换模型的人会去查网关、
查网络、怀疑 key，而不会想到调 max_tokens。修法：提到 8000 + 加个专属环境变量。

**第二次（轮内能力）**：同一个病换个地方发作。线上跑一道真题，`intent.clarify`
占着连接算了 115.5 秒、正文一个字没吐，整轮被它一个人从 22 秒拖到 116 秒
（并行批的耗时等于最慢那个），最后还得回退 RAG——产出也打了折。真因是预算
写死在 `execute_capability(max_tokens: int = 2000)` 的**函数签名默认值**里：
没有名字、搜不到、也没人会想起它跟模型换代有关。修法：再加一个专属环境变量。

**第三次（换 DeepSeek）**：前两个专属环境变量都调大了，挂掉的却是它俩都管不着
的**第三处**——`freeform_block` 里写死的 14000，思考吃光，整个首页设计失败，
3 次重试全一样，白烧 433.8 秒。

## 所以这次改的是形态，不是数字

前两次的修法（"加一个有名字的专属旋钮"）本身就是病因：**旋钮越多，漏的越多。**
一次全库扫下来 26 处写死的预算，分布在调用点和签名默认值里，其中
`client.py` 的 `max_tokens: int = 2000` 是最深的一处——凡是没显式传参的调用点
全被它按在 2000，谁都看不见。

现在全链路一个 `LLM_MAX_TOKENS`（默认 65536，见 `config.DEFAULT_MAX_TOKENS`）：

- 写死的预算**一处都不许留**（本文件的 AST 扫描是判据，不是靠 grep 靠自觉）；
- 分路旋钮 `LLM_GENERATE_MAX_TOKENS` / `LLM_ROUND_CAP_MAX_TOKENS` **已删**，
  且钉住"删干净了"——留着它们比没有更糟：旧 .env 里一个
  `LLM_ROUND_CAP_MAX_TOKENS=32000` 会让那条路悄悄比全局窄，正是要根除的形态。

数字该多大是产品决定（花钱），但"藏起来的预算"不该再发生第四次。
"""

import ast
import inspect
from pathlib import Path

import pytest

from sliderule_llm import capabilities as caps
from sliderule_llm.config import DEFAULT_MAX_TOKENS, default_max_tokens

_PY_ROOT = Path(__file__).resolve().parent.parent
_LLM_DIR = _PY_ROOT / "sliderule_llm"

#: 扫描范围：所有会真的发 LLM 请求的生产代码。tests/ 自己排除——单测靠显式
#: 传小值控成本是正当的（见 `test_显式传值仍然优先`）。
_SCANNED_DIRS = ("sliderule_llm", "services", "routes", "scripts")


def _hardcoded_budget_sites() -> list[str]:
    """全库找写死的 max_tokens。

    用 AST 不用正则：正则看不见 `max_tokens: int = 2000` 这种**签名默认值**
    （第二次和第三次栽的就是它），还会把注释和提示词里的字面量当成命中。
    """
    sites: list[str] = []
    for folder in _SCANNED_DIRS:
        for path in sorted((_PY_ROOT / folder).rglob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            rel = path.relative_to(_PY_ROOT)
            for node in ast.walk(tree):
                if isinstance(node, ast.Call):
                    for kw in node.keywords:
                        if kw.arg == "max_tokens" and isinstance(kw.value, ast.Constant) and isinstance(
                            kw.value.value, int
                        ):
                            sites.append(f"{rel}:{kw.value.lineno} 调用点写死 {kw.value.value}")
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    a = node.args
                    groups = (
                        (a.args, a.defaults, len(a.args) - len(a.defaults)),
                        (a.kwonlyargs, a.kw_defaults, 0),
                    )
                    for names, defaults, offset in groups:
                        for i, default in enumerate(defaults):
                            if default is None:
                                continue
                            if names[i + offset].arg == "max_tokens" and isinstance(
                                default, ast.Constant
                            ) and isinstance(default.value, int):
                                sites.append(
                                    f"{rel}:{default.lineno} 签名默认值写死 {default.value}"
                                )
    return sites


class Test全链路只有一个旋钮:
    def test_没有任何写死的预算(self):
        sites = _hardcoded_budget_sites()
        assert not sites, (
            "又出现写死的 token 预算了：\n  "
            + "\n  ".join(sites)
            + "\n\n改成 default_max_tokens()（调用点）或 `max_tokens: int | None = None`"
            "（签名，让下游兜底）。理由见本文件头——这个病已经犯过三次。"
        )

    def test_默认值是六万五(self):
        assert default_max_tokens() == DEFAULT_MAX_TOKENS == 65536

    def test_环境变量能覆盖(self, monkeypatch):
        monkeypatch.setenv("LLM_MAX_TOKENS", "32000")
        assert default_max_tokens() == 32000

    @pytest.mark.parametrize("bad", ["", "   ", "32k", "abc", "0", "-1"])
    def test_写坏了退回默认_不许崩(self, monkeypatch, bad):
        # 这类开关最怕"配错一个字符就整场炸"——推演挂掉比用默认值糟得多。
        # 空串是 compose 的 ${VAR:-default} 传进来的常见形态，别让它变成 0。
        monkeypatch.setenv("LLM_MAX_TOKENS", bad)
        assert default_max_tokens() == DEFAULT_MAX_TOKENS

    def test_现读环境变量_不做模块级常量(self, monkeypatch):
        """评测脚本改完环境变量要立刻生效，不能等重启进程。"""
        monkeypatch.setenv("LLM_MAX_TOKENS", "12345")
        assert default_max_tokens() == 12345
        monkeypatch.setenv("LLM_MAX_TOKENS", "23456")
        assert default_max_tokens() == 23456

    @pytest.mark.parametrize(
        "retired", ["LLM_GENERATE_MAX_TOKENS", "LLM_ROUND_CAP_MAX_TOKENS"]
    )
    def test_分路旋钮删干净了(self, retired):
        """留着分路值比没有更糟：旧 .env 里的一个小数字会让那条路悄悄比全局窄，
        而那正是这次要根除的形态（三次事故里有两次是"某条路的预算特别小"）。

        判据钉在**字面量**上，不是"文件里出现过这个词"：注释里的墓碑
        （"这个变量已经删了，别再加回来"）是要留的，读它才是要禁的。
        AST 里没有注释，正好分得开。
        """
        offenders: list[str] = []
        for folder in _SCANNED_DIRS:
            for path in sorted((_PY_ROOT / folder).rglob("*.py")):
                for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                    if isinstance(node, ast.Constant) and node.value == retired:
                        offenders.append(f"{path.relative_to(_PY_ROOT)}:{node.lineno}")
        assert not offenders, f"{retired} 已经废弃，但还有人读它：{offenders}"


class Test预算不写死在签名里:
    def test_轮内能力(self):
        default = inspect.signature(caps.execute_capability).parameters["max_tokens"].default
        assert default is None, (
            f"max_tokens 的默认值又变回写死的 {default!r} 了。"
            "签名里只留 None，实际值走 default_max_tokens()——理由见本文件头。"
        )

    def test_客户端三个入口(self):
        """`client.py` 是最深的一层：调用点不传 max_tokens 时由它兜底。
        它以前写死 2000，等于给全链路设了一个谁都看不见的天花板。"""
        from sliderule_llm import client

        for name in ("_call_llm_once", "_call_llm_once_streaming", "call_llm"):
            fn = getattr(client, name)
            assert inspect.signature(fn).parameters["max_tokens"].default is None, (
                f"client.{name} 的 max_tokens 又有写死的默认值了"
            )

    def test_显式传值仍然优先(self):
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

    def test_不传就用全局配置值(self, monkeypatch):
        monkeypatch.setenv("LLM_MAX_TOKENS", "4321")
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
        assert "LLM_MAX_TOKENS" in msg, "得告诉人改哪个旋钮"

    def test_不是预算问题时不乱扣帽子(self):
        from sliderule_llm.client import _empty_content_hint

        msg = _empty_content_hint("stop", 8000, None)
        assert "预算被吃光" not in msg, "finish_reason=stop 却说是预算问题，是在误导"

    def test_两处空内容报错都带上了提示(self):
        """非流式和流式**两条路**都要带——线上跑的是流式那条，
        但换个 wire_api 就走另一条，只补一半等于没补。"""
        import re

        src = (_LLM_DIR / "client.py").read_text(encoding="utf-8")
        raises = re.findall(r'raise LlmError\(\s*\n?\s*f?"empty content from LLM[^"]*"', src)
        assert len(raises) >= 2, f"只找到 {len(raises)} 处空内容报错，预期两条路都在"
        for site in raises:
            assert site.lstrip("raise LlmError(").lstrip().startswith("f"), (
                f"这处空内容报错还是死字符串，没带 finish_reason：{site}"
            )


class Test结构化档位是地板不是收窄:
    """`reasoning_effort` 允许分路（它是任务属性），但分路值**只许往上抬**。

    这条闸和上面 `max_tokens` 那组是同一条纪律的两面：

    - `max_tokens` 是上限，分路只会更窄 → 旋钮直接收成一个（见文件头）。
    - `reasoning_effort` 是任务属性，"判个意图"和"拼一棵七层深的节点树"
      需要的思考量差一个量级，所以留了分路。

    但留分路就得防它反向咬人。这个常量当初是配"全局 low"用的，无条件覆盖成
    medium 没问题；全局回到 medium 之后，无条件覆盖就变成陷阱——谁把全局调到
    high，最需要思考的那条路会被默认值悄悄按回 medium。症状是深层 JSON 契约
    静默校验失败（`5 validation errors ... tag Field required`），
    和当初 low 跑挂首页设计一模一样，最难查。
    """

    def test_全局比地板低时抬回来(self, monkeypatch):
        from sliderule_llm.config import DEFAULT_STRUCTURED_REASONING_EFFORT, structured_reasoning_effort

        monkeypatch.setenv("LLM_REASONING_EFFORT", "low")
        monkeypatch.delenv("LLM_STRUCTURED_REASONING_EFFORT", raising=False)
        assert structured_reasoning_effort() == DEFAULT_STRUCTURED_REASONING_EFFORT == "medium"

    @pytest.mark.parametrize("global_effort", ["medium", "high"])
    def test_全局已经不低于地板就不插手(self, monkeypatch, global_effort):
        """返回空串 = 不传 reasoning_effort = 跟全局走。全局 high 时**尤其**
        不能覆盖：那才是这条闸存在的理由。"""
        from sliderule_llm.config import structured_reasoning_effort

        monkeypatch.setenv("LLM_REASONING_EFFORT", global_effort)
        monkeypatch.delenv("LLM_STRUCTURED_REASONING_EFFORT", raising=False)
        assert structured_reasoning_effort() == ""

    def test_认不出的全局档位不插手(self, monkeypatch):
        """网关自定义档位是运维明确写下的选择，不该被一个默认值改掉。"""
        from sliderule_llm.config import structured_reasoning_effort

        monkeypatch.setenv("LLM_REASONING_EFFORT", "turbo-thinking")
        monkeypatch.delenv("LLM_STRUCTURED_REASONING_EFFORT", raising=False)
        assert structured_reasoning_effort() == ""

    def test_显式配空串是逃生舱(self, monkeypatch):
        """某些网关不认这个参数，配空值要能整条退回全局档位。"""
        from sliderule_llm.config import structured_reasoning_effort

        monkeypatch.setenv("LLM_REASONING_EFFORT", "low")
        monkeypatch.setenv("LLM_STRUCTURED_REASONING_EFFORT", "")
        assert structured_reasoning_effort() == ""

    def test_显式配的地板照样只往上抬(self, monkeypatch):
        from sliderule_llm.config import structured_reasoning_effort

        monkeypatch.setenv("LLM_REASONING_EFFORT", "high")
        monkeypatch.setenv("LLM_STRUCTURED_REASONING_EFFORT", "medium")
        assert structured_reasoning_effort() == ""

        monkeypatch.setenv("LLM_REASONING_EFFORT", "low")
        monkeypatch.setenv("LLM_STRUCTURED_REASONING_EFFORT", "high")
        assert structured_reasoning_effort() == "high"

    def test_模板里全局不是_low(self):
        """.env.example 是新部署的默认值。low 省的是思考量，也就是产出正确率
        （实测把首页设计跑挂，3 次尝试全是 `tag Field required`）。"""
        import re

        text = (_PY_ROOT.parent / ".env.example").read_text(encoding="utf-8")
        values = re.findall(r"^LLM_REASONING_EFFORT=(.*)$", text, re.MULTILINE)
        assert values, "模板里找不到 LLM_REASONING_EFFORT"
        for value in values:
            assert value.strip().lower() != "low", (
                "模板把全局推理档位配成了 low：它快一倍，但快出来的那一半是从产出里省的。"
            )
