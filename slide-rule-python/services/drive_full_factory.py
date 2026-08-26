"""Factory envelope helper — the only ignition socket for product rehearsals.

⚠ 2026-08-27 从 routes/sliderule_full.py::drive_full_stream 抽出（本 worktree
约 1227–1334，不是设计文档里的旧行号）。抽之前用 grep 确认活路径：
persist-as-authority load_session、set_installed_skills / set_active_connectors /
set_preferred_device_override / set_design_system_override（finally 清空）、
E25 run_registry.start_run、E26 transient_blocked 自动补救恰好一次、
on_complete save_session。

命名字段。helper 不得再解析两套 HTTP payload 形状。
产品路径缺 session_id → 400，没有 anon- 回落。
脚本方言 /drive-full-stream 可 require_session_id=False + fallback_state。

内部 async-for drive_full_v5_session_stream(..., profile=)。
profile="app" 由 rehearse 传入；生成器消费短清单。禁止 HTTP factoryProfile。
控制面 rehearsal_control 只许调本 helper，不许直接调生成器。
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Literal, Optional

from fastapi import HTTPException
from pydantic import ValidationError

from models.v5_state import V5SessionState
from services.slide_rule_session import load_session, save_session
from services.sliderule_session_sanitizer import sanitize_session_state
from services.v5_full_driver import (
    drive_full_v5_session_stream,
    transient_blocked_signal,
)


def _adopt_owner(state: V5SessionState, viewer: Any) -> V5SessionState:
    if getattr(state, "ownerId", None):
        return state
    owner = str(getattr(viewer, "id", "") or "").strip()
    if owner:
        state.ownerId = owner
    return state


async def start_drive_full_factory_run(
    session_id: str,
    user_text: str,
    installed_skills: Any,
    active_connectors: Any,
    preferred_device: Any,
    design_system_id: Any,
    *,
    repair: bool = False,
    profile: Literal["full", "app"] = "full",
    max_loops: int = 10,
    require_session_id: bool = True,
    fallback_state: Optional[Dict[str, Any]] = None,
    viewer: Any = None,
):
    """启动（或附着）一条工厂 run。调用方传入已经拆好的命名字段。"""
    from services import run_registry
    from services.device_policy import set_preferred_device_override
    from services.identity_palette_hint import set_design_system_override
    from services.v5_llm_generate import set_active_connectors, set_installed_skills

    sid = str(session_id or "").strip()
    if require_session_id and not sid:
        raise HTTPException(status_code=400, detail="session_id required")

    persisted = await asyncio.to_thread(load_session, sid) if sid else None
    if persisted is not None:
        state = persisted
    elif require_session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    else:
        raw = fallback_state if isinstance(fallback_state, dict) else {}
        try:
            state = _adopt_owner(V5SessionState(**raw), viewer)
        except (ValidationError, TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc).splitlines()[0] or "invalid_state",
            ) from exc

    async def stream_factory():
        from services.product_charter import (
            activate_charter_for_run,
            clear_charter_for_run,
        )

        set_installed_skills(installed_skills)
        set_active_connectors(active_connectors)
        set_preferred_device_override(preferred_device)
        set_design_system_override(design_system_id)
        activate_charter_for_run(state, None)
        try:
            async for event in drive_full_v5_session_stream(
                state,
                max_loops=max_loops,
                user_instruction=user_text,
                repair=repair,
                profile=profile,
            ):
                if (
                    event.get("type") == "complete"
                    and not repair
                    and transient_blocked_signal(state)
                ):
                    async for repair_event in drive_full_v5_session_stream(
                        state,
                        max_loops=2,
                        user_instruction=user_text,
                        repair=True,
                        profile=profile,
                    ):
                        yield repair_event
                    return
                yield event
        finally:
            set_installed_skills(None)
            set_active_connectors(None)
            set_preferred_device_override(None)
            set_design_system_override(None)
            clear_charter_for_run()

    async def on_complete(event: Dict[str, Any]) -> Dict[str, Any]:
        if isinstance(event.get("state"), dict):
            final_state = V5SessionState.server_load(event["state"])
            final_state, _ = sanitize_session_state(final_state)
            final_state = await asyncio.to_thread(save_session, final_state)
            return {**event, "state": final_state.model_dump()}
        return event

    return await run_registry.start_run(
        sid or f"anon-{id(state)}",
        stream_factory,
        on_complete,
        user_text=user_text,
    )
