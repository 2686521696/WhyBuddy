"""Live-path harness for POST /api/sliderule/control-turn-stream.

⚠ 反向判据必须打在这条 HTTP 上：monkeypatch 的是
`services.rehearsal_control.start_drive_full_factory_run`（模块顶 import），
不是把 helper 单独调一遍。单独调会让「删掉 dispatcher 调用点」照样绿。
"""

from __future__ import annotations

import ast
import json
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi.testclient import TestClient

from app import app
from conftest import TEST_USER_ID
from models.v5_state import V5SessionState
from services.slide_rule_session import load_session, save_session
from sliderule_llm.control_client import ControlLlmResult

KEY = {"x-internal-key": "dev-slide-rule-internal"}
CONTROL_URL = "/api/sliderule/control-turn-stream"
ROOT = Path(__file__).resolve().parents[2]
PY_ROOT = Path(__file__).resolve().parents[1]

client = TestClient(app)


def new_sid(prefix: str = "ctl") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def six_fields(sid: str, user_text: str, **extra: Any) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "sessionId": sid,
        "userText": user_text,
        "installedSkills": extra.pop("installedSkills", []),
        "activeConnectors": extra.pop("activeConnectors", []),
        "preferredDevice": extra.pop("preferredDevice", "desktop"),
        "designSystemId": extra.pop("designSystemId", None),
    }
    body.update(extra)
    return body


def parse_sse(text: str) -> List[Dict[str, Any]]:
    events: List[Dict[str, Any]] = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped.startswith("data:"):
            continue
        raw = stripped[5:].strip()
        if not raw:
            continue
        try:
            events.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return events


def event_types(events: List[Dict[str, Any]]) -> List[str]:
    return [str(e.get("type") or "") for e in events]


def seed_session(sid: str, **kwargs: Any) -> V5SessionState:
    payload: Dict[str, Any] = {
        "sessionId": sid,
        "goal": kwargs.pop("goal", {"text": "", "status": "needs_refinement"}),
        "ownerId": kwargs.pop("ownerId", TEST_USER_ID),
        "conversation": kwargs.pop("conversation", []),
        "artifacts": kwargs.pop("artifacts", []),
    }
    payload.update(kwargs)
    return save_session(V5SessionState(**payload))


def goal_text(state: Optional[V5SessionState]) -> str:
    if state is None:
        return ""
    goal = getattr(state, "goal", None) or {}
    if isinstance(goal, dict):
        return str(goal.get("text") or "").strip()
    return str(getattr(goal, "text", "") or "").strip()


def llm_text(content: str) -> ControlLlmResult:
    return ControlLlmResult(
        content=content,
        tool_calls=[],
        usage={"total_tokens": 12},
        finish_reason="stop",
        model="ctrl-test",
        latency_ms=1,
    )


def llm_tool(
    name: str,
    arguments: Optional[Dict[str, Any]] = None,
    call_id: str = "call-1",
) -> ControlLlmResult:
    return ControlLlmResult(
        content="",
        tool_calls=[
            {
                "id": call_id,
                "name": name,
                "arguments": arguments or {},
            }
        ],
        usage={"total_tokens": 12},
        finish_reason="tool_calls",
        model="ctrl-test",
        latency_ms=1,
    )


def strip_python(path: Path) -> str:
    """剥注释 + 模块/函数/类文档串。标识符写在头注里不得把变异养绿。"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
        ):
            continue
        body = getattr(node, "body", None)
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            body.pop(0)
    return ast.unparse(tree)


def read_repo(*parts: str) -> str:
    return (ROOT.joinpath(*parts)).read_text(encoding="utf-8")


class ControlHarness:
    """Patch the live dispatcher imports, then POST the real route."""

    def __init__(self, monkeypatch: Any) -> None:
        self.helper_calls: List[Dict[str, Any]] = []
        self.llm_calls: List[Dict[str, Any]] = []
        self.invalidate_calls: List[Any] = []
        self.generator_calls: List[Any] = []
        self.llm_impl: Callable[..., ControlLlmResult] = (
            lambda messages, **kw: llm_text("ok")
        )
        self._install(monkeypatch)

    def _install(self, monkeypatch: Any) -> None:
        import services.rehearsal_control as rc
        from services import run_registry
        from services import v5_full_driver

        async def fake_helper(
            session_id: str,
            user_text: str,
            installed_skills: Any,
            active_connectors: Any,
            preferred_device: Any,
            design_system_id: Any,
            **kwargs: Any,
        ):
            self.helper_calls.append(
                {
                    "session_id": session_id,
                    "user_text": user_text,
                    "installed_skills": installed_skills,
                    "active_connectors": active_connectors,
                    "preferred_device": preferred_device,
                    "design_system_id": design_system_id,
                    **kwargs,
                }
            )
            state = load_session(session_id)
            dump = (
                state.model_dump()
                if state is not None
                else {"sessionId": session_id}
            )

            async def gen():
                yield {"type": "complete", "state": dump}

            return await run_registry.start_run(
                str(session_id), gen, user_text=user_text or ""
            )

        def fake_llm(messages, **kwargs):
            self.llm_calls.append({"messages": messages, "kwargs": kwargs})
            return self.llm_impl(messages, **kwargs)

        real_inv = rc.apply_user_intervention_invalidation

        def spy_inv(state, intervention):
            self.invalidate_calls.append(intervention)
            return real_inv(state, intervention)

        real_gen = v5_full_driver.drive_full_v5_session_stream

        async def spy_gen(*args, **kwargs):
            self.generator_calls.append({"args": args, "kwargs": kwargs})
            async for event in real_gen(*args, **kwargs):
                yield event

        monkeypatch.setattr(rc, "start_drive_full_factory_run", fake_helper)
        monkeypatch.setattr(rc, "call_control_llm", fake_llm)
        monkeypatch.setattr(rc, "apply_user_intervention_invalidation", spy_inv)
        monkeypatch.setattr(
            v5_full_driver, "drive_full_v5_session_stream", spy_gen
        )

    def post(
        self, body: Dict[str, Any], expect_status: int = 200
    ) -> Tuple[Any, List[Dict[str, Any]]]:
        response = client.post(CONTROL_URL, json=body, headers=KEY)
        assert response.status_code == expect_status, response.text[:1200]
        events = parse_sse(response.text) if response.status_code == 200 else []
        return response, events
