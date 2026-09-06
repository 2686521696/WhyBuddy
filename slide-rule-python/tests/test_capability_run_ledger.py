# -*- coding: utf-8 -*-
"""台账要说得出一次执行的结局、花了多久、是谁写的。

## 事故形态（不是某一次真机，是 6 个构造点的常态）

`CapabilityRun` 此前**说不出结局**：只有 `error`（有值 = 失败）和嵌在
`timing` 里的 `durationMs`。于是：

  * "成功" 和 "没人填 error" 长得一模一样；
  * `engine_scheduling.commit_artifact*` 那条路径压根没有 timing，一条
    没有耗时的记录和一条耗时丢了的记录也长得一模一样；
  * `slide_rule_trust` 为了挂 ledgerEntryId 造的空壳，跟一次真执行长得一样；
  * 两个路由构造点是 `append(CapabilityRun(...))` 之后再按
    **`capabilityRuns[-1]`** 打耗时补丁 —— 下标 -1 假定"我刚 append 的
    一定还在最后"，并发或中间插了别的记录就把耗时记到别人头上，且不报错。

## 抄的是 grok 的哪一处

`xai-tool-protocol/src/session_event.rs`：

    ToolCallCompleted {
        tool_call_id: String,
        tool_name: String,
        duration_ms: u64,
        outcome: ToolCallOutcome,
    }

    pub enum ToolCallOutcome {
        Success, Error, Cancelled,
        #[serde(other)] Unknown,
    }

配一条反向判据：

    #[test]
    fn turn_ended_missing_required_field_rejected() {
        let v = json!({ … /* missing "outcome" */ });
        assert!(serde_json::from_value::<SessionEvent>(v).is_err());
    }

**三件事一起搬**：四档枚举（不是布尔）、必填、以及"少一个字段就失败"的
反向判据。

## ⚠ "必填"落在写路径，不在 pydantic

`CapabilityRun` 是**持久化记录**。库里已有的每条都没有这三个字段，改成
pydantic required 的话读回来会 `invalid_session` → `_coerce_many` 把**整条
会话跳过**（persistence.py:370），症状是「会话从侧栏消失了」——`AwaitReason`
头上记着的那三次事故就是这个形状，本轮已经踩了第四次（`spec_assumption`）。

所以：
  * 模型层三个字段有默认值（`status="unknown"` 就是 grok 那个
    `#[serde(other)] Unknown` 的对应物，如实说"不知道"）；
  * 写路径走 `CapabilityRun.server_record(...)`，三个参数 keyword-only
    且**无默认值** —— 漏一个是 TypeError；
  * 本文件最后那条扫全仓的判据禁止生产代码直接 `CapabilityRun(...)`。
    **这条才是防"加第 7 个构造点又忘填"的闸**（本仓第四条：只改一部分
    不报错、只有一部分不生效）。
"""

from __future__ import annotations

import ast
import pathlib

import pytest

from models.v5_state import CapabilityRun

PY_ROOT = pathlib.Path(__file__).parent.parent
#: 允许直接 `CapabilityRun(...)` 的地方：模型自己（`server_record` 里那一次
#: `cls(...)` 是本体）、以及持久化读回路径（历史记录没有那三个字段，
#: 读回来**必须**能用普通构造）。
_DIRECT_OK = {
    pathlib.Path("models/v5_state.py"),
}


def _production_py_files():
    for p in sorted(PY_ROOT.rglob("*.py")):
        parts = p.relative_to(PY_ROOT).parts
        if parts[0] in ("tests", ".venv", "__pycache__"):
            continue
        if "__pycache__" in parts:
            continue
        yield p


# ── 结局是四档枚举，不是布尔 ──────────────────────────────────────────
class Test结局:
    def test_四档跟grok的ToolCallOutcome一一对应(self):
        from models.v5_state import CapabilityRunStatus

        assert set(CapabilityRunStatus.__args__) == {
            "success",
            "error",
            "cancelled",
            "unknown",
        }, "词表漂了。四档对应 grok ToolCallOutcome 的 Success/Error/Cancelled/Unknown"

    def test_不许写没申报的结局(self):
        """变异：把 status 的类型从 Literal 改成 str → 本条红。"""
        with pytest.raises(Exception):
            CapabilityRun(
                id="r", capabilityId="c", turnId="t", status="没这一档"  # type: ignore[arg-type]
            )

    def test_默认是unknown而不是success(self):
        """⚠ 这一条是整件事的要害。默认 success 等于**替所有没填的记录撒谎**，
        而"没填"恰恰是此前 6 个构造点的常态。

        grok 的对应物是 `#[serde(other)] Unknown`：不知道就说不知道。
        """
        run = CapabilityRun(id="r", capabilityId="c", turnId="t")
        assert run.status == "unknown"
        assert run.durationMs is None
        assert run.provenance is None

    def test_老记录读回来不许报错(self):
        """库里每条历史记录都没有这三个字段。读不回来 → `_coerce_many` 把整条
        会话跳过 →「会话从侧栏消失了」。

        变异：把三个字段改成 pydantic required → 本条红。
        """
        old = {
            "id": "run-old",
            "capabilityId": "evidence.search",
            "turnId": "t0",
            "inputs": [],
            "outputs": ["a0"],
            "gateResults": [],
        }
        run = CapabilityRun(**old)
        assert run.status == "unknown", "老记录必须如实是 unknown，不是 success"


# ── 写路径三个字段必填 ────────────────────────────────────────────────
class Test写路径必填:
    @pytest.mark.parametrize("missing", ["status", "durationMs", "provenance"])
    def test_少任何一个都是TypeError(self, missing):
        """对应 grok 的 `turn_ended_missing_required_field_rejected`。

        变异：给 `server_record` 的任一参数加默认值 → 对应那档红。
        """
        kwargs = dict(
            status="success",
            durationMs=120,
            provenance="test.fixture",
            id="r",
            capabilityId="c",
            turnId="t",
        )
        kwargs.pop(missing)
        with pytest.raises(TypeError):
            CapabilityRun.server_record(**kwargs)  # type: ignore[arg-type]

    def test_三个都给就写得出来(self):
        run = CapabilityRun.server_record(
            status="error",
            durationMs=250,
            provenance="scheduling.error",
            id="r-1",
            capabilityId="risk.analyze",
            turnId="t-1",
            error={"code": "boom"},
        )
        assert run.status == "error"
        assert run.durationMs == 250
        assert run.provenance == "scheduling.error"

    def test_durationMs允许显式None但不许省略(self):
        """`scheduling.commit` 那条路径**真的没有计时**。逼它编一个 0 更糟：
        0 会被读成"这一步不花时间"。

        但省略不行 —— 显式 `None` 是一次有意识的声明，省略是忘了。
        """
        run = CapabilityRun.server_record(
            status="success",
            durationMs=None,
            provenance="scheduling.commit",
            id="r-2",
            capabilityId="evidence.search",
            turnId="t-2",
        )
        assert run.durationMs is None
        assert run.timing is None, "没有耗时就别造一个空 timing 出来"

    def test_顶层耗时与timing两处对齐(self):
        """两处书写、一处填。老读者取 `timing.durationMs`，新读者取顶层，
        不许出现两个不同的数。

        变异：去掉 `timing.setdefault("durationMs", …)` → 本条红。
        """
        run = CapabilityRun.server_record(
            status="success",
            durationMs=999,
            provenance="executor.run",
            id="r-3",
            capabilityId="report.write",
            turnId="t-3",
            timing={"startedAt": "2026-09-06T00:00:00Z"},
        )
        assert run.durationMs == 999
        assert (run.timing or {})["durationMs"] == 999
        assert (run.timing or {})["startedAt"] == "2026-09-06T00:00:00Z", (
            "对齐耗时的时候把调用方给的 timing 其它字段冲掉了"
        )

    def test_只给timing也把顶层补上(self):
        """反向也要对齐：调用方只给 timing 时顶层不许空着，否则按顶层字段
        做统计的人会数出一堆 0。"""
        run = CapabilityRun.server_record(
            status="success",
            durationMs=None,
            provenance="executor.run",
            id="r-4",
            capabilityId="report.write",
            turnId="t-4",
            timing={"durationMs": 42},
        )
        assert run.durationMs == 42

    def test_不许写没申报的来源(self):
        with pytest.raises(Exception):
            CapabilityRun.server_record(
                status="success",
                durationMs=1,
                provenance="随便写的",  # type: ignore[arg-type]
                id="r-5",
                capabilityId="c",
                turnId="t",
            )


# ── 这条才是真正的闸：不许绕过工厂 ────────────────────────────────────
class Test全仓构造点:
    def test_生产代码不许直接构造CapabilityRun(self):
        """**防"加第 7 个构造点又忘填"。**

        本仓第四条：只改一部分不报错、只有一部分不生效。台账三格如果靠
        "记得在 6 个地方都填"，第 7 个构造点出现的那天它就静默失效了 ——
        而失效的表现是"台账里有几条 unknown"，没有人会注意到。

        变异：把任一生产构造点改回 `CapabilityRun(...)` → 本条红并指名道姓。
        """
        offenders = []
        for path in _production_py_files():
            rel = path.relative_to(PY_ROOT)
            if rel in _DIRECT_OK:
                continue
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except SyntaxError as exc:  # pragma: no cover — 语法坏了另有判据管
                pytest.fail(f"{rel} 语法错误：{exc}")
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Name)
                    and node.func.id == "CapabilityRun"
                ):
                    offenders.append(f"{rel}:{node.lineno}")
        assert not offenders, (
            "这些地方直接构造了 CapabilityRun，绕过了 server_record 的必填检查："
            + ", ".join(offenders)
            + "。台账三格（status / durationMs / provenance）会静默变成 unknown/None。"
        )

    def test_判据自己没打空(self):
        """扫到的 `server_record(` 调用点必须真的存在。

        没有这一条的话，把全部构造点删干净也能让上面那条绿 —— 一个空判据。
        """
        found = []
        for path in _production_py_files():
            src = path.read_text(encoding="utf-8")
            if "CapabilityRun.server_record(" in src:
                found.append(path.relative_to(PY_ROOT).as_posix())
        assert len(found) >= 5, f"生产侧 server_record 调用点只量到 {found}"

    def test_ledger空壳如实报unknown(self):
        """⚠ 这一条是行为判据，不是形状判据。

        `slide_rule_trust` 为了挂 ledgerEntryId 会造一条空壳记录 —— 真正那次
        执行**没在台账里留下记录**，它的结局这条路径确实不知道。谎称 success
        的后果是台账里凭空多出一条"成功执行"，而它对应的执行根本没被观测到。

        抄 grok `ToolCallOutcome` 的 `#[serde(other)] Unknown`：不知道就说不
        知道。变异：把这里的 `status="unknown"` 改成 `"success"` → 本条红。
        """
        from models.v5_state import Artifact, ProducedBy, V5SessionState
        from services.slide_rule_trust import record_provenance_and_trust_ledger

        state = V5SessionState(
            sessionId="s-stub",
            goal={"text": "台账空壳"},
            artifacts=[],
            capabilityRuns=[],
        )
        art = Artifact.server_construct(
            id="a-stub",
            content="x",
            trustLevel="untrusted",
            producedBy=ProducedBy(
                capabilityRunId="run-never-recorded", capabilityId="evidence.search"
            ),
        )
        record_provenance_and_trust_ledger(state=state, artifact=art)

        stub = [r for r in state.capabilityRuns if r.id == "run-never-recorded"]
        assert stub, "空壳记录没造出来 —— 判据自己打空了"
        assert stub[0].status == "unknown", (
            "为挂 ledgerEntryId 造的空壳谎称了结局。那次执行没被观测到，"
            f"不许说成 {stub[0].status}"
        )
        assert stub[0].provenance == "trust.ledger_stub"
        assert stub[0].durationMs is None

    def test_每个来源都真的有人用(self):
        """申报了却没人用的档位说明词表和现实漂了。

        `test.fixture` 例外：它是给测试和脚本留的，生产代码里本来就不该出现。
        """
        from models.v5_state import CapabilityRunProvenance

        declared = set(CapabilityRunProvenance.__args__) - {"test.fixture"}
        used = set()
        for path in _production_py_files():
            src = path.read_text(encoding="utf-8")
            for name in declared:
                if f'provenance="{name}"' in src:
                    used.add(name)
        assert used == declared, (
            f"申报了但生产代码里没人写的来源：{sorted(declared - used)}；"
            f"（反过来也查：写了但没申报的会被 pydantic 当场拦下）"
        )
