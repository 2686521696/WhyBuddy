"""产品宪章 opt-in 必须接在通电的 spec-first / scope_card 上。

仓里第一条 + 第三条：函数写对了 ≠ 它被调用了。这个文件里每一条正向
（opt-in 真 → 宪章进 prompt）都配反向（opt-in 假 / 没旗 / 删调用点 → 不进）。

判据剥注释后再 grep 调用点——只写在模块头里的 charter_prompt_block 不算。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import product_charter as pc  # noqa: E402
from services.rehearsal_control import _system_prompt  # noqa: E402
from services.spec_tree import build_spec_prompt  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _clean():
    pc.reset_charter_cache()
    yield
    pc.reset_charter_cache()


def _strip_py(src: str) -> str:
    src = re.sub(r'"""[\s\S]*?"""', "", src)
    src = re.sub(r"'''[\s\S]*?'''", "", src)
    src = re.sub(r"#.*", "", src)
    return src


def _src(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


SAMPLE = {
    "industry": "咖啡烘焙",
    "terms": "生豆批次、出炉曲线",
    "defaultRoles": "烘焙主管",
    "hardCompliance": "食品留样 48 小时",
    "brandConstraints": "不要写成连锁奶茶",
}


def test_opt_in_关着_spec_prompt_里不许出现宪章():
    pc.set_charter_context(SAMPLE, opt_in=False)
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert pc.CHARTER_MARKER not in user
    assert "咖啡烘焙" not in user
    assert pc.charter_prompt_block() == ""


def test_opt_in_开着_spec_prompt_里必须有宪章():
    """活路径：build_spec_prompt 自己去读 charter_prompt_block。
    直接调 charter_prompt_block 全绿、调用点被删照样绿——所以要从拼 prompt
    的那个函数里找它。"""
    pc.set_charter_context(SAMPLE, opt_in=True)
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert pc.CHARTER_MARKER in user
    assert "咖啡烘焙" in user
    assert "食品留样 48 小时" in user
    assert "不是证据" in user


def test_opt_in_关着时_prompt与从前逐字一致():
    """库里/上下文有宪章但没打旗，spec-first prompt 必须跟清空后逐字节一样。
    否则『关着』只是不写标记、正文仍漏进去。"""
    pc.clear_charter_for_run()
    baseline = build_spec_prompt("做一个订单管理系统")
    pc.set_charter_context(SAMPLE, opt_in=False)
    assert build_spec_prompt("做一个订单管理系统") == baseline


def test_没有旗_存着宪章也不许注入():
    """库里有文档 ≠ 打了沿用旗。自动灌就是自动沿用。"""
    state = SimpleNamespace(sessionId="s-no-flag", ownerId="u1", productCharter=None, charterReuseNext=False)
    pc.save_charter(scope="session", scope_id="s-no-flag", charter=SAMPLE, reuse_next=False)
    pc.activate_charter_for_run(state, {})
    user = build_spec_prompt("做一个天气看板")[-1]["content"]
    assert pc.CHARTER_MARKER not in user
    assert "咖啡烘焙" not in user
    scope = _system_prompt(state)
    assert pc.CHARTER_MARKER not in scope


def test_账户下一场沿用旗才注入():
    state = SimpleNamespace(sessionId="s-next", ownerId="acct-1", productCharter=None, charterReuseNext=False)
    pc.save_charter(scope="account", scope_id="acct-1", charter=SAMPLE, reuse_next=True)
    pc.activate_charter_for_run(state, {})
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert "咖啡烘焙" in user
    assert pc.CHARTER_MARKER in _system_prompt(state)


def test_payload显式false盖过账户旗():
    state = SimpleNamespace(sessionId="s-off", ownerId="acct-1", productCharter=None, charterReuseNext=False)
    pc.save_charter(scope="account", scope_id="acct-1", charter=SAMPLE, reuse_next=True)
    pc.activate_charter_for_run(state, {"reuseCharter": False})
    user = build_spec_prompt("做一个订单管理系统")[-1]["content"]
    assert "咖啡烘焙" not in user


def test_payload_reuseCharter_true才把正文送进_scope与spec():
    state = SimpleNamespace(sessionId="s-on", ownerId="u2", productCharter=None, charterReuseNext=False)
    pc.activate_charter_for_run(
        state, {"productCharter": SAMPLE, "reuseCharter": True}
    )
    assert pc.CHARTER_MARKER in build_spec_prompt("做个应用")[-1]["content"]
    assert pc.CHARTER_MARKER in _system_prompt(state)


def test_五系统模型字段不许进宪章():
    stuffed = {
        "industry": "烘焙",
        "datamodel": {"entities": [{"id": "order", "fields": []}]},
        "rbac": {"roles": ["admin"]},
        "workflow": {},
        "page": {},
        "aigc": {},
        "appbundle": {},
        "fiveSystemModel": {"x": 1},
    }
    cleaned = pc.normalize_charter(stuffed)
    assert "datamodel" not in cleaned
    assert "rbac" not in cleaned
    assert cleaned == {"industry": "烘焙"}
    pc.set_charter_context(stuffed, opt_in=True)
    block = pc.charter_prompt_block()
    assert "entities" not in block
    assert "admin" not in block
    assert "烘焙" in block


def test_建造者文档路径不许当宪章正文():
    cleaned = pc.normalize_charter(
        {"industry": "见 Claude.md 第三条", "terms": "AGENTS.md 里的闸"}
    )
    assert cleaned == {}


def test_调用点写在_spec_first与_scope_prompt_剥注释后还在():
    spec = _strip_py(_src("slide-rule-python/services/spec_tree.py"))
    control = _strip_py(_src("slide-rule-python/services/rehearsal_control.py"))
    # 活路径：build_spec_prompt / _system_prompt 里真的调用了。
    build = spec[spec.index("def build_spec_prompt") : spec.index("def generate_spec_tree")]
    assert "charter_prompt_block()" in build
    sys_fn = control[control.index("def _system_prompt") : control.index("def _usage_tokens")]
    assert "charter_prompt_block()" in sys_fn
    # 反面：只接在老生成器 _build_user_content 上不算。
    gen = _strip_py(_src("slide-rule-python/services/v5_llm_generate.py"))
    # 允许也接，但不得是唯一接法——上面两条已经锁了活路径。
    assert "def build_spec_prompt" in spec


def test_同步和流式两条驱动都激活了也都清空了():
    routes = _strip_py(_src("slide-rule-python/routes/sliderule_full.py"))
    helper = _strip_py(_src("slide-rule-python/services/drive_full_factory.py"))
    control = _strip_py(_src("slide-rule-python/services/rehearsal_control.py"))
    assert "activate_charter_for_run(state, payload)" in routes
    assert "activate_charter_for_run(state, None)" in helper
    assert "activate_charter_for_run(state, payload)" in control
    assert routes.count("clear_charter_for_run()") >= 1
    assert helper.count("clear_charter_for_run()") >= 1
    assert control.count("clear_charter_for_run()") >= 1
