"""
Complete V5 driver ported from Node's session-driver.ts, mini-session.ts, and client runtime.

This replaces the entire Node V5 loop with Python RAG-backed execution.
All capabilities now produce real evidence via RAG, no templates, no degraded, no su8 issues.
"""

import os
import time
from typing import Dict, Any, AsyncGenerator, List, Optional
from datetime import datetime, timezone
from models.v5_state import V5SessionState, ProducedBy, SchedulingDecision
from .slide_rule_orchestrator import orchestrate_plan
from .slide_rule_session import pick_next_capabilities, pick_repair_capabilities, commit_artifact, append_reasoning_event, append_replay_event


def _has_pending_delivery_picks(state, user_instruction: str) -> bool:
    """交付意图下是否还有未提交的交付能力可选（用于门通过后的继续判定）。"""
    from .slide_rule_session import _is_delivery_intent

    if not _is_delivery_intent(user_instruction or ""):
        return False
    try:
        return bool(pick_next_capabilities(state, user_instruction or ""))
    except Exception:
        return False
from .v5_capability_executor import execute_v5_capability
from .persistence import persist_state
from .slide_rule_coverage import (
    evaluate_coverage_gate,
    reconcile_coverage,
    resolve_coverage_gaps_from_state,
)
from .v5_publish_closure_response import derive_publish_closure_response
from .v5_skill_runtime_graph import derive_skill_runtime_graph_response


def _result_to_dict(result: Any) -> Dict[str, Any]:
    """Normalize executor results from Pydantic model_dump() or plain dict capability results.
    This is the core adapter for /drive-full compat (task 119-04): keeps drive_full_v5_session
    and downstream pass-through working whether caps return ExecuteCapabilityResult (pydantic)
    or legacy/plain dicts. Deterministic; never triggers provider. Degraded/error results are
    passed through as-is (upper layers and error recording preserve fail-closed).
    """
    if isinstance(result, dict):
        return result
    if hasattr(result, "model_dump"):
        try:
            dumped = result.model_dump()
        except Exception:
            return {}
        normalized = dumped if isinstance(dumped, dict) else {}
        for key, value in getattr(result, "__dict__", {}).items():
            if key.startswith("_") or key in normalized:
                continue
            normalized[key] = value
        return normalized
    if hasattr(result, "__dict__"):
        return {
            key: value
            for key, value in getattr(result, "__dict__", {}).items()
            if not key.startswith("_")
        }
    return {}


def _commit_capability_result(
    state: V5SessionState,
    *,
    capability_id: str,
    role_id: str,
    turn_id: str,
    run_id: str,
    artifact_id: str,
    result_data: Dict[str, Any],
    duration_ms: int,
    parallel: Optional[bool] = None,
) -> None:
    produced = ProducedBy(capabilityRunId=run_id, capabilityId=capability_id, roleId=role_id)
    kind = "evidence" if "evidence" in capability_id or capability_id in ["mcp.call", "skill.invoke"] else ("report" if "report" in capability_id else "risk")
    commit_artifact(
        state,
        id=artifact_id,
        kind=kind,
        content=result_data.get("content", ""),
        summary=result_data.get("summary", ""),
        title=result_data.get("title"),
        provenance=result_data.get("provenance", "python-rag"),
        producedBy=produced,
        inputArtifactIds=[],
        turnId=turn_id,
        sources=result_data.get("sources", []),
    )
    if getattr(state, "capabilityRuns", None):
        last = state.capabilityRuns[-1]
        if hasattr(last, "result"):
            last.result = result_data
        elif isinstance(last, dict):
            last["result"] = result_data
        if hasattr(last, "timing"):
            timing: Dict[str, Any] = {"durationMs": duration_ms}
            if parallel is not None:
                # Timing telemetry marker: attribute this measurement to the
                # parallel batch path (absent on the untouched serial path).
                timing["parallel"] = parallel
            last.timing = timing


# ---------------------------------------------------------------------------
# Parallel capability batch (SLIDERULE_PARALLEL_CAPS)
#
# Product decision: no artificial speed-ups (no lower-quality shortcuts) — we
# only remove engineering waste. Within one drive loop each selected capability
# makes an INDEPENDENT provider call; serializing them wastes wall time.
#
# Design: "parallel execute, deterministic commit".
#   Phase A (visibility): capability_start reasoning/replay events for ALL
#     selected caps are appended + persisted BEFORE the batch runs, so pollers
#     see what's in flight.
#   Phase B (execute):    execute_v5_capability runs concurrently. It is
#     read-only on state (reads state.goal; appbundle/runtimeClosure caps also
#     read state.artifacts — those are commit-order sensitive and therefore run
#     as serial barriers at their original position, after preceding commits).
#   Phase C (commit):     commit_artifact / capabilityRuns / dependencyGraph /
#     error recording are applied SEQUENTIALLY in the original selection order,
#     so artifact/run ordering and execution-chain edges are byte-identical to
#     serial mode for the same results. State is never mutated concurrently.
#
# The serial code path below stays intact (reference semantics) and is chosen
# whenever the flag is explicitly false (or a single capability is selected).
# ---------------------------------------------------------------------------

def _parallel_caps_enabled() -> bool:
    """SLIDERULE_PARALLEL_CAPS: env wins (dynamic), settings next, default ON.

    Explicit "false"/"0"/"no"/"off" selects the untouched serial path.
    """
    env = os.getenv("SLIDERULE_PARALLEL_CAPS")
    if env is not None and str(env).strip() != "":
        return str(env).strip().lower() not in ("0", "false", "no", "off")
    try:
        from config.settings import settings as _settings
        return bool(getattr(_settings, "SLIDERULE_PARALLEL_CAPS", True))
    except Exception:
        return True


def _is_closure_cap(capability_id: str) -> bool:
    """这条能力是不是"发布收口"本身。

    跟下面的 `_is_commit_order_sensitive_cap` 分开写：那个还包含 synthesis /
    report（它们同样要当屏障），而"本轮收过口没有"必须只认收口本身——
    多认一个就会把没收口的轮次也标成已收口。
    """
    cap = (capability_id or "").lower()
    return "appbundle" in cap or "runtimeclosure" in cap


def _is_commit_order_sensitive_cap(capability_id: str) -> bool:
    """Caps whose EXECUTOR reads committed artifacts (not just goal text).

    execute_v5_capability's appbundle/runtimeClosure branch derives per-skill
    evidence from state.artifacts, so in serial mode it observes the commits of
    caps earlier in the same batch. Such caps must run as barriers.
    """
    cap = (capability_id or "").lower()
    if "appbundle" in cap or "runtimeclosure" in cap:
        return True
    # E17：综合/报告类的 prompt 注入上游产物（build_evidence_context），
    # 并行批里必须作为屏障段——等同轮前段 commit 后再执行，才能吃到
    # 同轮的风险/证据产物
    return "synthesis" in cap or "report" in cap


def _split_parallel_segments(selected: List[Dict[str, Any]]) -> List[List[Dict[str, Any]]]:
    """Split the selection into maximal parallel-safe groups; commit-order
    sensitive caps become single-element barrier segments at their position."""
    segments: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    for sel in selected:
        if _is_commit_order_sensitive_cap(sel.get("capabilityId", "")):
            if current:
                segments.append(current)
                current = []
            segments.append([sel])
        else:
            current.append(sel)
    if current:
        segments.append(current)
    return segments


def _llm_round_caps_enabled() -> bool:
    """轮内推理能力（risk.analyze / counter.argue / synthesis.merge / report.write…）
    是否走真 LLM。显式 SLIDERULE_LLM_ROUND_CAPS=0/false 关闭；默认跟随"是否配置了
    LLM 通道"——配置了就真调（每一步的想法可流式观测），没配置走确定性 RAG。"""
    env = os.getenv("SLIDERULE_LLM_ROUND_CAPS")
    if env is not None and str(env).strip() != "":
        return str(env).strip().lower() not in ("0", "false", "no", "off")
    try:
        from sliderule_llm.config import get_llm_config

        return bool(get_llm_config().api_key)
    except Exception:
        return False


def _execute_round_capability(cap: str, state: V5SessionState, role: str, turn_id: str) -> Any:
    """执行一个轮内能力：LLM 通道已配置且能力原生支持时走真 LLM（内容增量经
    capabilities 模块的 delta sink 实时流出），任何失败回落确定性 RAG 路径。
    回落结果 provenance 保持 python-rag（诚实标注），真 LLM 结果是 python-llm。"""
    if _llm_round_caps_enabled():
        try:
            from sliderule_llm.capabilities import (
                execute_capability as _native_execute,
                is_python_native_capability,
            )

            if is_python_native_capability(cap):
                goal = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal or "")
                # E17 证据上下文管道：上游已过门产物注入 prompt（用户裁决
                # 2026-07-16）。此前 payload 只送 goal——「综合各方结论」
                # 综合的不是各方结论。失败/停用回落空串，不挡执行。
                upstream = ""
                try:
                    from sliderule_llm.evidence_context import (
                        build_evidence_context,
                        evidence_context_enabled,
                    )

                    if evidence_context_enabled():
                        artifact_dicts = [
                            a if isinstance(a, dict) else a.model_dump()
                            for a in (getattr(state, "artifacts", []) or [])
                        ]
                        upstream = build_evidence_context(
                            artifact_dicts,
                            set(getattr(state, "staleArtifactIds", []) or []),
                            capability_id=cap,
                        )
                except Exception as ctx_exc:  # noqa: BLE001 — 注入失败不挡推演
                    print(f"[v5_full_driver] evidence context skipped: {str(ctx_exc)[:120]}")
                payload = {
                    "capabilityId": cap,
                    "state": {"goal": {"text": goal}},
                    "userText": goal,
                    "roleId": role,
                    "turnId": turn_id,
                    "upstreamEvidence": upstream,
                }
                if cap == "evidence.search":
                    from sliderule_llm.evidence import execute_evidence_runtime

                    return _native_execute(payload, evidence_retriever=execute_evidence_runtime)
                return _native_execute(payload)
        except Exception as exc:  # noqa: BLE001 — LlmError/transport 都回落，一步失败不许沉掉整场推演
            print(f"[v5_full_driver] native LLM cap {cap} failed, fallback to RAG: {str(exc)[:160]}")
            # 回退 RAG 也是降级：能力的原生结果没拿到，产出质量已经打折。
            # 影响面看是哪个能力——推演类退兜底只是结论粗糙，收口类才伤成品。
            from .run_degradation import (
                REASON_CAPABILITY_LLM_FALLBACK,
                impact_for_capability,
                mark_degraded,
            )
            mark_degraded(
                state,
                reason=REASON_CAPABILITY_LLM_FALLBACK,
                message=f"能力 {cap} 的 LLM 执行失败，回退 RAG：{str(exc)[:120]}",
                impact=impact_for_capability(cap),
            )
    return execute_v5_capability(cap, state, [], role, turn_id)


def _timed_execute(cap: str, state: V5SessionState, role: str, turn_id: str) -> Dict[str, Any]:
    """Execute one capability, catching its error (per-cap try/except identical
    to the serial path — one failure must not sink the batch). Read-only on state."""
    t0 = time.time()
    try:
        result = _execute_round_capability(cap, state, role, turn_id)
        return {
            "ok": True,
            "result_data": _result_to_dict(result),
            "error": None,
            "durationMs": int((time.time() - t0) * 1000),
        }
    except Exception as cap_exc:  # noqa: BLE001 — mirrors serial per-cap recovery
        return {
            "ok": False,
            "result_data": None,
            "error": cap_exc,
            "durationMs": int((time.time() - t0) * 1000),
        }


def _execute_group_parallel(state: V5SessionState, group: List[Dict[str, Any]], turn_id: str) -> List[Dict[str, Any]]:
    """Run a parallel-safe group concurrently; results aligned with group order.
    Max workers = number of selected caps in the group (picker caps selection at 5)."""
    if len(group) == 1:
        sel = group[0]
        return [_timed_execute(sel["capabilityId"], state, sel.get("roleId", "agent"), turn_id)]
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(len(group), 5)) as pool:
        futures = [
            pool.submit(_timed_execute, sel["capabilityId"], state, sel.get("roleId", "agent"), turn_id)
            for sel in group
        ]
        return [f.result() for f in futures]


def _emit_batch_capability_starts(state: V5SessionState, selected: List[Dict[str, Any]], loop: int) -> None:
    """Phase A: pre-emit capability_start reasoning/replay events for the whole
    batch and persist once, so stream watchers/pollers see what's in flight."""
    turn_id = f"loop-{loop}"
    for sel in selected:
        cap = sel["capabilityId"]
        role = sel.get("roleId", "agent")
        run_id = f"run-{loop}-{cap}"
        append_reasoning_event(
            state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_start",
            text=f"capability_started: {cap}", roleId=role, order=1,
        )
        append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap, capabilityRunId=run_id)
    persist_state(state)


def _commit_executed_outcome(
    state: V5SessionState,
    *,
    sel: Dict[str, Any],
    loop: int,
    outcome: Dict[str, Any],
    parallel: bool = True,
) -> None:
    """Phase C: apply one capability's state mutations (sequential, selection order).

    Success: commit_artifact + run result/timing + capability_complete (same as serial).
    Error: record_capability_run_error + degraded awaitDetail (same as serial) — an
    errored capability never prevents the other caps' commits.
    """
    cap = sel["capabilityId"]
    role = sel.get("roleId", "agent")
    turn_id = f"loop-{loop}"
    run_id = f"run-{loop}-{cap}"
    if outcome["ok"]:
        _commit_capability_result(
            state,
            capability_id=cap,
            role_id=role,
            turn_id=turn_id,
            run_id=run_id,
            artifact_id=f"art-{loop}-{cap}",
            result_data=outcome["result_data"] or {},
            duration_ms=outcome["durationMs"],
            parallel=parallel,
        )
        append_reasoning_event(
            state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
            text=f"capability_completed: {cap}", roleId=role, order=2,
        )
        persist_state(state)
    else:
        from .slide_rule_session import record_capability_run_error

        err = {"code": "capability_execution_failed", "message": str(outcome["error"])[:200], "capabilityId": cap}
        record_capability_run_error(
            state,
            capabilityId=cap,
            turnId=turn_id,
            error=err,
            roleId=role,
            timing={"durationMs": outcome["durationMs"], "parallel": parallel},
        )
        append_reasoning_event(
            state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
            text=f"capability_completed: {cap} (error)", roleId=role, order=2,
        )
        persist_state(state)
        state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"


def _append_loop_timing_event(state: V5SessionState, loop: int, caps: int, wall_ms: int) -> None:
    """Per-loop wall-duration telemetry with the parallel marker, so before/after
    measurements are attributable in the persisted reasoning ledger."""
    append_reasoning_event(
        state, turnId=f"loop-{loop}", capabilityRunId=f"loop-{loop}-timing", capabilityId="driver",
        kind="think", text=f"loop_timing: loop={loop} caps={caps} wallMs={wall_ms} parallel=true", order=3,
    )


def _run_selected_batch_parallel(state: V5SessionState, selected: List[Dict[str, Any]], loop: int) -> None:
    """Sync driver's parallel batch: pre-emit starts, execute concurrently,
    commit sequentially in the original selection order."""
    t_loop = time.time()
    turn_id = f"loop-{loop}"
    _emit_batch_capability_starts(state, selected, loop)
    for group in _split_parallel_segments(selected):
        outcomes = _execute_group_parallel(state, group, turn_id)
        for sel, outcome in zip(group, outcomes):
            _commit_executed_outcome(state, sel=sel, loop=loop, outcome=outcome, parallel=True)
    _append_loop_timing_event(state, loop, len(selected), int((time.time() - t_loop) * 1000))
    persist_state(state)


def _ensure_runtime_closure_evidence(state: V5SessionState, user_instruction: str, loop: int) -> V5SessionState:
    """Append Python-owned AppBundle closure evidence for replay when a real command ran.

    The UI can derive preview surfaces, but reload requires persisted Python evidence.
    This keeps the route fail-closed: if AppBundle reports missing skill evidence, the
    derived publishClosure is blocked rather than fabricated green.
    """
    goal_text = state.goal.get("text", "") if isinstance(state.goal, dict) else str(state.goal or "")
    # E37：指令为空但话题在场时不再静默跳过——一轮跑完却连 blocked 闭环都
    # 没有，右侧是一块假装无事发生的空看板。空指令回落 goal 原文照常收口。
    instruction = (user_instruction or "").strip() or (goal_text or "").strip()
    if not instruction:
        return state
    existing_closure = derive_publish_closure_response(state)
    _refine_set = False
    if existing_closure is not None and derive_skill_runtime_graph_response(state) is not None:
        blocked = bool(existing_closure.get("blocked")) if isinstance(existing_closure, dict) else bool(getattr(existing_closure, "blocked", False))
        if not blocked:
            # E29 增量迭代：闭环已收口 + 用户带来新的补充指令 → 精修模式，
            # 在现有五系统模型上做最小增量修改（同一结构闸把关），
            # 不再整轮白跑/模型原地不动。指令与话题原文相同（重新推演）不精修。
            current_model = extract_model_from_closure(existing_closure)
            if (
                instruction
                and instruction != (goal_text or "").strip()
                and current_model is not None
            ):
                from .v5_llm_generate import set_refine_context

                # 老会话没有版本史：先把现有模型记为 v1，精修后的才是 v2，
                # 否则「回退」无处可回
                if not (getattr(state, "modelVersions", None) or []):
                    record_model_version(
                        state, existing_closure,
                        goal_text or "初始版本",
                    )
                set_refine_context(current_model, instruction)
                _refine_set = True
            else:
                return state
        # blocked 的闭环允许在新一轮重建（例如 LLM 瞬时失败导致 0/6）：
        # fail-closed 语义不变——证据真缺失时重建后依然 blocked。

    import time as _time

    capability_id = "appbundle.runtimeClosure"
    role_id = "appbundle"
    turn_id = f"loop-{loop}-closure"
    run_id = f"run-{loop}-{capability_id}"
    append_reasoning_event(
        state,
        turnId=turn_id,
        capabilityRunId=run_id,
        capabilityId=capability_id,
        kind="capability_start",
        text=f"capability_started: {capability_id}",
        roleId=role_id,
        order=1,
    )
    append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=capability_id, capabilityRunId=run_id)
    persist_state(state)
    t0 = _time.time()
    try:
        result = execute_v5_capability(capability_id, state, [], role_id, turn_id)
        result_data = _result_to_dict(result)
        _commit_capability_result(
            state,
            capability_id=capability_id,
            role_id=role_id,
            turn_id=turn_id,
            run_id=run_id,
            artifact_id=f"art-{loop}-{capability_id}",
            result_data=result_data,
            duration_ms=int((_time.time() - t0) * 1000),
        )
        append_reasoning_event(
            state,
            turnId=turn_id,
            capabilityRunId=run_id,
            capabilityId=capability_id,
            kind="capability_complete",
            text=f"capability_completed: {capability_id}",
            roleId=role_id,
            order=2,
        )
        persist_state(state)
    except Exception as cap_exc:
        from .slide_rule_session import record_capability_run_error

        # E37 fail-closed 兜底：闭环重建炸掉也要落一个确定性 blocked 闭环
        # （挂在 error run 的 result 上，derive 能扫到）——回合结束后
        # publishClosure 不允许为 null，用户看到的是「发布检查未通过 +
        # 真实失败原因」，不是一块空看板。
        fallback_result = None
        try:
            from .v5_capability_executor import build_fallback_blocked_closure

            fallback_result = build_fallback_blocked_closure(state, goal_text, str(cap_exc)[:200])
        except Exception as fb_exc:  # noqa: BLE001 — 兜底失败不遮蔽原始错误
            print(f"[v5_full_driver] fallback blocked closure failed: {str(fb_exc)[:120]}")
        record_capability_run_error(
            state,
            capabilityId=capability_id,
            turnId=turn_id,
            error={"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": capability_id},
            roleId=role_id,
            timing={"durationMs": int((_time.time() - t0) * 1000)},
            result=fallback_result,
        )
        append_reasoning_event(
            state,
            turnId=turn_id,
            capabilityRunId=run_id,
            capabilityId=capability_id,
            kind="capability_complete",
            text=f"capability_completed: {capability_id} (error)",
            roleId=role_id,
            order=2,
        )
        persist_state(state)
    if _refine_set:
        from .v5_llm_generate import set_refine_context

        set_refine_context(None)
    return state


def goal_digest(state: "V5SessionState") -> str:
    """目标文本的确定性指纹，用作模型复用键的一半。"""
    import hashlib

    goal = getattr(state, "goal", None) or {}
    text = goal.get("text", "") if isinstance(goal, dict) else str(goal)
    return hashlib.sha256(str(text).strip().encode("utf-8")).hexdigest()[:16]


def reusable_model_for_turn(state: "V5SessionState") -> "Optional[Dict[str, Any]]":
    """本轮已经生成过、可以直接复用的五系统模型；没有就 None。

    ## 解决什么

    2026-08-04 真跑：模型自己在多个 loop 里选了收口，`MAX_REPEAT_PER_CAP=2`
    放行两次。第二次收口时生成入口**没有复用通道**，从头再调一次 LLM 生成
    （13 万字），拿到一份全新模型。而链路上那三道幂等保护
    （page.freeformOverview 已存在就跳过、chartColors 已有就不重取、
    sheet_used 计数）检查的全是「model 内部字段」——新模型上这些都是空，
    保护形同虚设。于是生图 100s + 取色 12s + 设计 100s 整套重跑一遍，
    两张不同参照图取出两套不同配色，后写的覆盖先写的，第一遍 233 秒全废。

    **锁挂在门上，但每次来的是一扇新门。** 这里补的就是那把会话级的锁。

    modelVersions 存的是**增强之后**的模型（证据由 model_to_linkage_artifacts
    从增强后的 model 转出），所以复用它等于连生图/取色/设计一并省掉——那三道
    既有的幂等保护这次会自然生效，因为终于是同一份 model 了。

    ## 复用键怎么定的

    两个开源方案各贡献一半：

    - vercel/turborepo#4572：缓存最大的坑是**影响输出的输入没进键**，改了
      东西还吃旧结果。所以 goal 必须进键（goalDigest）。
    - Stripe 幂等键：同一个键配不同参数必须报错而不是静默返回旧结果。这里
      对应的就是 goalDigest 对不上时**宁可重算**，绝不返回。

    作用域刻意收窄到**单轮（turnId）**：跨轮复用会让「用户补充需求之后仍然
    拿到旧模型」，那正是 turborepo 那个坑在我们这儿的形态。一轮 = 一次用户
    输入到闭环，轮内 goal 不会变，是安全的。

    精修（refine）与版本回退（override）有各自的通道，调用方在走到这里之前
    就分流了，不会误用本函数。
    """
    versions = list(getattr(state, "modelVersions", None) or [])
    if not versions:
        return None
    last = versions[-1]
    if not isinstance(last, dict) or not isinstance(last.get("model"), dict):
        return None
    turn = str(getattr(state, "lastTurnId", "") or "")
    if not turn or str(last.get("turnId") or "") != turn:
        return None  # 不是本轮的产物，不复用
    if str(last.get("goalDigest") or "") != goal_digest(state):
        return None  # 目标变了（或旧快照没记指纹）——宁可重算
    return last["model"]


def extract_model_from_closure(closure) -> "Optional[Dict[str, Any]]":
    """从闭环 perSkillEvidence 的 modelSection 还原五系统模型（缺任一段返回 None）。"""
    per_skill = (
        closure.get("perSkillEvidence") if isinstance(closure, dict)
        else getattr(closure, "perSkillEvidence", None)
    ) or {}
    model: Dict[str, Any] = {}
    for skill in ("datamodel", "workflow", "rbac", "page", "aigc", "appbundle"):
        ev = per_skill.get(skill) or {}
        section = ev.get("modelSection") if isinstance(ev, dict) else getattr(ev, "modelSection", None)
        if section is None:
            return None
        model[skill] = section
    return model


def record_model_version(state: "V5SessionState", publish_closure, instruction: str) -> None:
    """E29 版本快照：闭环携带完整模型且与上一版本不同 → 追加 modelVersions。"""
    model = extract_model_from_closure(publish_closure)
    if model is None:
        return
    versions = list(getattr(state, "modelVersions", None) or [])
    if versions:
        last = versions[-1].get("model") if isinstance(versions[-1], dict) else None
        if last == model:
            # 模型没变：不记新版本，但指针对齐到该版本（可能刚从回退态回来）
            state.currentModelVersionId = versions[-1].get("id")
            return
    # ID 必须单调递增、与截断解耦——旧实现 len(versions)+1 配合下面的 [-20:]
    # 截断,从第 22 版起恒生成 "mv-21":restore/findIndex 命中第一个同名旧
    # 快照,◀▶ 错乱(审查实锤)。取"历史最大序号+1",截断也不回卷。
    max_seq = 0
    for v in versions:
        vid = str(v.get("id") or "") if isinstance(v, dict) else ""
        if vid.startswith("mv-"):
            try:
                max_seq = max(max_seq, int(vid[3:]))
            except ValueError:
                pass
    new_id = f"mv-{max_seq + 1}"
    versions.append({
        "id": new_id,
        "turnId": str(getattr(state, "lastTurnId", "") or ""),
        "instruction": str(instruction or "")[:300],
        "createdAt": datetime.now(timezone.utc).isoformat(),
        # 复用键的一半（另一半是 turnId）。教训取自 vercel/turborepo#4572
        # 「cache doesn't invalidate on change in dependent code」——缓存最大
        # 的坑不是没命中，是**影响输出的输入没进键**，于是改了东西还吃旧结果。
        # 模型是照着 goal 生成的，goal 就必须进键；对不上宁可重算。
        "goalDigest": goal_digest(state),
        "model": model,
    })
    state.modelVersions = versions[-20:]  # 上限 20 版，防状态无限膨胀
    state.currentModelVersionId = new_id


_TRANSIENT_ERROR_MARKERS = (
    "timeout", "timed out", "connection", "connect", "reset", "unreachable",
    "dns", "proxy", "temporarily", "rate limit", "502", "503", "504",
    "网络", "超时",
)


def transient_blocked_signal(state: "V5SessionState") -> bool:
    """E26 自动补救判据：闭环 blocked 且失败样貌是「瞬时故障」（超时/连接类）
    才值得自动补救一次。检索成功但结果不相关不算——重试救不回来，
    交给用户点「补齐缺口」。看两处：本轮能力报错信息、闭环 blocker 的
    LLM 生成诊断（网关超时也会落在这里）。"""
    closure = getattr(state, "publishClosure", None)
    if closure is None:
        return False
    blocked = bool(closure.get("blocked")) if isinstance(closure, dict) else bool(getattr(closure, "blocked", False))
    if not blocked:
        return False

    def _is_transient(text: str) -> bool:
        low = (text or "").lower()
        return any(m in low for m in _TRANSIENT_ERROR_MARKERS)

    for r in (getattr(state, "capabilityRuns", []) or [])[-12:]:
        err = r.get("error") if isinstance(r, dict) else getattr(r, "error", None)
        if not err:
            continue
        msg = err.get("message") if isinstance(err, dict) else getattr(err, "message", "")
        if _is_transient(str(msg or "")):
            return True

    blockers = closure.get("blockers") if isinstance(closure, dict) else getattr(closure, "blockers", None)
    for b in blockers or []:
        code = str((b.get("code") if isinstance(b, dict) else getattr(b, "code", "")) or "")
        ref = str((b.get("ref") if isinstance(b, dict) else getattr(b, "ref", "")) or "")
        if code == "LLM_GENERATE_FAILED" and _is_transient(ref):
            return True
    return False


def _advance_turn_version(state: "V5SessionState") -> None:
    """一次 drive = 一个 turn：把 state.lastTurnId 步进一格。

    持久化守卫以 lastTurnId 为单调版本（同 turn 不可覆盖核心字段）。驱动器
    若不推进它，drive 开始时那笔"goal 还没写进"的快照就成了该版本的终点，
    之后所有含 goal/conversation/runtimePhase 的落盘全被静默拒绝——只剩
    append-only 的 artifacts 进盘，重启后会话"失忆"。实测踩过，勿删。
    """
    import re as _re

    raw = str(getattr(state, "lastTurnId", None) or "")
    m = _re.search(r"(\d+)\s*$", raw)
    seq = int(m.group(1)) + 1 if m else 1
    state.lastTurnId = f"turn-{seq}"


def drive_full_v5_session(initial_state: V5SessionState, max_loops: int = 10, user_instruction: str = "") -> V5SessionState:
    """
    Full replacement for Node's driveReasoningSession.
    Uses orchestrate + execute in loop until converge or budget.
    PYTHON_AUTHORITY for full path: real user_instruction flows to orchestrate_plan / pick_next_capabilities,
    driving capability selection, artifact/commit (via execute), GCOV evaluation, and phase to awaiting/done.
    Stop conditions (locked for test): coverage passed, empty picks from pick_next_capabilities, max_loops, no_progress (2 consecutive loops without new artifact or resolved gap progress), or max_repeat_guard (per-cap repeat limit excluded remaining candidates).
    no_progress and max_repeat_guard also append auditable SchedulingDecision entries to decisionLedger (stop reason, loop, evidence).
    Classification: PYTHON_AUTHORITY (user instruction -> artifacts, GCOV, await/done).
    Note: pick_next_capabilities end fallbacks often add picks; use max_loops and coverage for reliable stop in tests.
    All evidence from stable RAG.
    Implements V5.2 phase transitions (idle/orchestrating/awaiting/failed/done) as PYTHON_AUTHORITY.
    """
    state = initial_state
    _advance_turn_version(state)
    state.runtimePhase = "orchestrating"
    turn_base = f"full-{datetime.now(timezone.utc).strftime('%H%M%S')}"
    append_replay_event(state, kind="decision", turnId=f"loop-0", decisionId=f"phase-orchestrating-full")
    append_reasoning_event(state, turnId=f"loop-0", capabilityRunId="phase-full-0", capabilityId="driver", kind="think", text="phase_changed: orchestrating (full drive)", order=0)
    # Immediate persist after phase start so polling GET sees orchestrating before first loop execs
    persist_state(state)
    loop = 0
    plan = type("P", (), {"selected": []})()  # safe default for phase decision on early error
    picks = []
    executed_loops = 0
    no_progress_streak = 0
    MAX_REPEAT_PER_CAP = 2  # small threshold for guard testability; per V5.2 policy default higher but slice uses 2
    try:
        prev_art_count = len(getattr(state, "artifacts", []) or [])
        # simple resolved count from coverageGaps (status resolved)
        def _count_resolved(st):
            gaps = getattr(st, "coverageGaps", []) or []
            return sum(1 for g in gaps if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None)) == "resolved")
        prev_resolved = _count_resolved(state)
        while loop < max_loops:
            ui = user_instruction or ""
            plan = orchestrate_plan(state, f"loop-{loop}", ui)
            # PYTHON_AUTHORITY: use explicit pick_next_capabilities for V5.2 selection semantics + fallbacks
            # (pick is sole authority; empty means converge; no fallback to plan.selected)
            picks = pick_next_capabilities(state, ui)
            # E32 agentic pick（默认 on，SLIDERULE_AGENTIC_PICK=off 关）：
            # LLM 看全局提案替换非空规则选材——收敛权仍归规则（规则版为空
            # 照旧收敛，LLM 无权续命），词表封闭+重复护栏在提案侧验收，
            # 决策进台账（source="llm"）可审计可挑战。失败静默回落规则版。
            if picks:
                from .v5_agentic_pick import agentic_pick_next_capabilities
                _proposal = agentic_pick_next_capabilities(state, ui, loop_index=loop, max_loops=max_loops)
                if _proposal:
                    _now = datetime.now(timezone.utc).isoformat()
                    _dl = getattr(state, "decisionLedger", []) or []
                    _dl.append(SchedulingDecision(
                        id=f"dec-{loop}-agentic-pick",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks],
                        chose=[p["capabilityId"] for p in _proposal["picks"]],
                        skipped=[],
                        rationale=f"agentic pick: {_proposal['rationale']}",
                        createdAt=_now,
                        source="llm",
                    ))
                    state.decisionLedger = _dl
                    picks = _proposal["picks"]
                else:
                    # 回落规则版 = 本轮降级。记一条 Condition，闭环判定据此
                    # 拒发合格证——此前这里只在 stderr 打一行，闭环完全看不见。
                    from .run_degradation import (
                        IMPACT_REASONING,
                        REASON_AGENTIC_PICK_FALLBACK,
                        mark_degraded,
                    )
                    mark_degraded(
                        state,
                        reason=REASON_AGENTIC_PICK_FALLBACK,
                        message=f"第 {loop} 轮 LLM 选材未成，回落规则版选能力",
                        # 只决定「这轮挑哪几件活儿干」，挑出来的活儿照样认真执行，
                        # 做出来的东西不因此变差——显式写出来，不靠默认值猜
                        impact=IMPACT_REASONING,
                    )
            state = reconcile_coverage(state)
            selected = picks

            # max_repeat_guard: filter candidates by run count; stop if had picks but all filtered
            if picks:
                filtered = []
                for p in picks:
                    cid = p["capabilityId"]
                    cnt = sum(1 for r in (getattr(state, "capabilityRuns", []) or []) if (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) == cid)
                    if cnt < MAX_REPEAT_PER_CAP:
                        filtered.append(p)
                if len(picks) > 0 and len(filtered) == 0:
                    # auditable ledger entry for max_repeat_guard
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-max_repeat_guard",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks],
                        chose=[],
                        skipped=[{"capabilityId": p["capabilityId"], "reason": "max_repeat_guard"} for p in picks],
                        rationale=f"max_repeat_guard triggered at loop {loop} (counts >= {MAX_REPEAT_PER_CAP})",
                        createdAt=now,
                        source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "max_repeat_guard"
                    state.awaitDetail = f"max_repeat_guard: all remaining candidates excluded after {MAX_REPEAT_PER_CAP} repeats"
                    break
                selected = filtered if filtered else picks

            if not selected:
                # no_progress via consecutive no-pick (empty after rules) without progress
                no_progress_streak += 1
                if no_progress_streak >= 2:
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-no_progress",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in (picks or [])],
                        chose=[],
                        skipped=[],
                        rationale=f"no_progress: {no_progress_streak} consecutive loops with no state progress (empty pick)",
                        createdAt=now,
                        source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "no_progress"
                    state.awaitDetail = f"no_progress after {no_progress_streak} loops (empty picks, no art/gap advance)"
                    break
                picks = selected  # for final reason
                break  # converged per pick semantics (empty after all rules)
            # execute selected
            import time as _time
            # SLIDERULE_PARALLEL_CAPS (default ON): overlap the independent per-cap
            # provider calls; commits stay sequential in selection order. Explicit
            # false (or a single-cap batch) takes the serial reference path below.
            if _parallel_caps_enabled() and len(selected) > 1:
                _run_selected_batch_parallel(state, selected, loop)
                serial_selected = []
            else:
                serial_selected = selected
            for sel in serial_selected:
                cap = sel["capabilityId"]
                role = sel.get("roleId", "agent")
                turn_id = f"loop-{loop}"
                t0 = _time.time()
                run_id = f"run-{loop}-{cap}"
                # Emit start + replay for visibility (phase/cap events in state for browser)
                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_start",
                    text=f"capability_started: {cap}", roleId=role, order=1
                )
                append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap, capabilityRunId=run_id)
                # Immediate persist before execute: cap_start visible to session GET pollers during long capability exec (review finding 2)
                persist_state(state)
                try:
                    # Execute via full migrated executor - always real（LLM 通道配置时轮内能力走真 LLM）
                    result = _execute_round_capability(cap, state, role, turn_id)
                    result_data = _result_to_dict(result)
                    # Use Python-owned commitArtifact (artifact+run+gate+dependencyGraph updates)
                    art_id = f"art-{loop}-{cap}"
                    produced = ProducedBy(capabilityRunId=run_id, capabilityId=cap, roleId=role)
                    kind = "evidence" if "evidence" in cap or cap in ["mcp.call", "skill.invoke"] else ("report" if "report" in cap else "risk")
                    commit_artifact(
                        state,
                        id=art_id,
                        kind=kind,
                        content=result_data.get("content", ""),
                        summary=result_data.get("summary", ""),
                        title=result_data.get("title"),
                        provenance=result_data.get("provenance", "python-rag"),
                        producedBy=produced,
                        inputArtifactIds=[],
                        turnId=turn_id,
                        sources=result_data.get("sources", []),
                    )
                    # best-effort timing attach on success run (last appended)
                    dur = int((_time.time() - t0) * 1000)
                    if getattr(state, "capabilityRuns", None):
                        last = state.capabilityRuns[-1]
                        if hasattr(last, "result"):
                            last.result = result_data
                        elif isinstance(last, dict):
                            last["result"] = result_data
                        if hasattr(last, "timing"):
                            last.timing = {"durationMs": dur}
                    # Emit complete
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
                        text=f"capability_completed: {cap}", roleId=role, order=2
                    )
                    # Persist complete mid so pollers see finish before next cap/loop end
                    persist_state(state)
                except Exception as cap_exc:
                    # Record capability error without whole drive fail or state corruption
                    dur = int((_time.time() - t0) * 1000)
                    err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap}
                    # import here to keep top minimal; use the record from session (PYTHON slice)
                    from .slide_rule_session import record_capability_run_error
                    record_capability_run_error(
                        state,
                        capabilityId=cap,
                        turnId=turn_id,
                        error=err,
                        roleId=role,
                        timing={"durationMs": dur},
                    )
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap, kind="capability_complete",
                        text=f"capability_completed: {cap} (error)", roleId=role, order=2
                    )
                    # Persist error complete for visibility
                    persist_state(state)
                    state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"
                    # continue to next cap or stop decision; error run is auditable record
            executed_loops += 1
            # 同步驱动同款写回——理由见流式驱动那处的长注释。
            # 两条路径都得改：这个 bug 在提示词层，跟走哪条驱动无关。
            if any(_is_closure_cap(p.get("capabilityId", "")) for p in selected):
                _round_closure = derive_publish_closure_response(state)
                if _round_closure is not None:
                    state.publishClosure = _round_closure
                    persist_state(state)
            # update progress for no_progress detection
            now_art = len(getattr(state, "artifacts", []) or [])
            now_res = _count_resolved(state)
            if now_art > prev_art_count or now_res > prev_resolved:
                no_progress_streak = 0
            else:
                no_progress_streak += 1
            prev_art_count = now_art
            prev_resolved = now_res
            if no_progress_streak >= 2:
                now = datetime.now(timezone.utc).isoformat()
                dec = SchedulingDecision(
                    id=f"dec-{loop}-no_progress",
                    turnId=f"loop-{loop}",
                    saw=[p["capabilityId"] for p in (picks or [])],
                    chose=[p["capabilityId"] for p in selected],
                    skipped=[],
                    rationale=f"no_progress: {no_progress_streak} consecutive loops with no new artifact or resolved gap progress",
                    createdAt=now,
                    source="local_heuristic",
                )
                dl = getattr(state, "decisionLedger", []) or []
                dl.append(dec)
                state.decisionLedger = dl
                state.awaitReason = "no_progress"
                state.awaitDetail = f"no_progress streak {no_progress_streak} (no art/gap advance)"
                break
            # Check GCOV (resolve first: committed trusted caps close their gaps)
            state = resolve_coverage_gaps_from_state(state)
            gate = evaluate_coverage_gate(state)
            if gate.get("passed"):
                state.goal["status"] = "clear"
                # 交付意图：门通过但交付清单未出全时继续循环（单轮限选 5 个能力，
                # picker 会跳过已提交项），让一轮"打包交付"产出全部交付物。
                if _has_pending_delivery_picks(state, user_instruction):
                    loop += 1
                    persist_state(state)
                    continue
                break
            loop += 1
            persist_state(state)
        state = _ensure_runtime_closure_evidence(state, user_instruction, loop)
        # Final phase: done if clear/coverage, else awaiting (converged or budget)
        state = resolve_coverage_gaps_from_state(state)
        gate = evaluate_coverage_gate(state)
        if gate.get("passed") or (state.goal or {}).get("status") == "clear":
            if gate.get("passed") and isinstance(state.goal, dict):
                state.goal["status"] = "clear"  # 最终门通过时 phase/status 保持一致
            state.runtimePhase = "done"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text="phase_changed: done", order=10)
            persist_state(state)
        else:
            state.runtimePhase = "awaiting"
            if getattr(state, "awaitReason", None) in ("no_progress", "max_repeat_guard"):
                pass  # already set with ledger
            elif loop >= max_loops:
                state.awaitReason = "max_loops"
            else:
                # use last picks (from pick_next_capabilities) for convergence; empty pick owns converge decision
                state.awaitReason = "convergence" if not picks else "coverage"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text=f"phase_changed: awaiting ({state.awaitReason or 'coverage'})", order=10)
            persist_state(state)
    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"drive error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end", capabilityId="driver", kind="think", text=f"phase_changed: failed", order=10)
        persist_state(state)
    persist_state(state)
    return state


# ---------------------------------------------------------------------------
# Skill-ID mapping  (capability_id → one of the 6 front-end skill keys)
# ---------------------------------------------------------------------------

_CAP_SKILL_MAP: Dict[str, str] = {
    "data.model": "dataModel", "entity.model": "dataModel", "schema.design": "dataModel",
    "workflow.design": "workflow", "process.map": "workflow", "flow.chart": "workflow", "workflow.analyze": "workflow",
    "rbac.design": "rbac", "role.design": "rbac", "permission.model": "rbac", "access.control": "rbac",
    "page.design": "page", "ux.preview": "page", "ui.wireframe": "page", "page.layout": "page",
    "aigc.design": "aigc", "prompt.design": "aigc", "ai.feature": "aigc", "outcome.visualize": "aigc",
    "appbundle.runtimeClosure": "appBundle", "publish.bundle": "appBundle", "app.bundle": "appBundle",
}

_CAP_PREFIX_SKILL: list = [
    ("data.", "dataModel"), ("entity.", "dataModel"), ("schema.", "dataModel"),
    ("workflow.", "workflow"), ("process.", "workflow"), ("flow.", "workflow"),
    ("rbac.", "rbac"), ("role.", "rbac"), ("permission.", "rbac"),
    ("page.", "page"), ("ux.", "page"), ("ui.", "page"),
    ("aigc.", "aigc"), ("prompt.", "aigc"),
    ("appbundle.", "appBundle"), ("publish.", "appBundle"), ("bundle.", "appBundle"),
]


def _cap_to_skill_id(cap: str) -> str:
    """Map a capability_id to one of the 6 skill keys. Defaults to 'appBundle'."""
    direct = _CAP_SKILL_MAP.get(cap)
    if direct:
        return direct
    cap_lower = cap.lower()
    for prefix, skill in _CAP_PREFIX_SKILL:
        if cap_lower.startswith(prefix):
            return skill
    return "appBundle"


# Order in which the 5-system skills are emitted after closure (cross-skill
# dependency order: datamodel is the SSOT root; appbundle is the assembly root).
# Matches RUNTIME_CLOSURE_EDGES direction so the UI lights systems in causal order.
_SKILL_EMIT_ORDER = ["datamodel", "rbac", "workflow", "page", "aigc", "appbundle"]

# publishClosure.perSkillEvidence uses lowercase keys; the frontend SkillId type
# uses camelCase. Map so skill_start/skill_result carry the frontend-facing id.
_CLOSURE_KEY_TO_SKILL_ID = {
    "datamodel": "dataModel",
    "rbac": "rbac",
    "workflow": "workflow",
    "page": "page",
    "aigc": "aigc",
    "appbundle": "appBundle",
}


# ---------------------------------------------------------------------------
# SSE streaming driver
# ---------------------------------------------------------------------------

#: 体验层阶段 → 给人看的说法 + 实测耗时区间（2026-08-04 真机）。
#:
#: 带上"大概多久"是这条改动的重点，不是装饰：生参照图那一步在物理上没法流式
#: （图片一次性返回），屏幕上唯一能给的就是"在做什么 + 正常要多久"。有了这个
#: 区间，用户能自己判断"还在正常范围"还是"真卡了"；只给一个转圈图标的话，
#: 等 30 秒和等 3 分钟看起来一模一样。
#:
#: 区间取自实测：monitor.sheet 104.9s / monitor.palette 19.1s /
#: monitor.design 59.5s（同一轮，社区消防巡检）。写成范围而不是точ值——
#: 不同题目的内容量差得多，给个准数反而会让"稍微超一点"看着像出事。
#:
#: 只列**用户该看见的**三段。block.refimage / freeform.total 这些是内部子步骤，
#: 报出来只会把一条清晰的进度线拆成一堆看不懂的碎片。
#: model.generate 是 2026-08-05 补的，补的是**这条线上最长的一个洞**：
#: 真机一轮里 234.6s → 445.6s 之间 211 秒没有任何事件，正好夹在"选中收口"
#: 和"生成首页参照图"中间。上面三段之所以先被埋，是因为它们在最末尾、最显眼；
#: 而这一段比它们任何一段都长，只是没人想到去量它。
_ENRICH_STAGE_LABELS: Dict[str, tuple] = {
    "model.generate": ("生成五系统模型", "通常 120~220 秒"),
    "model.regenerate": ("按结构闸的意见重做模型", "通常 120~220 秒"),
    "monitor.sheet": ("生成首页参照图", "通常 60~120 秒"),
    "monitor.palette": ("从参照图读取配色", "通常 15~30 秒"),
    "monitor.design": ("照着参照图设计页面版式", "通常 40~90 秒"),
}


def _enrich_stage_event(phase: str, name: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """体验层阶段 → SSE 事件；名单外的阶段返回 None（不报内部子步骤）。

    复用 reasoning_step / reasoning_step_result 这对既有事件，而不是新造一种
    类型：前端已经会把它们渲染成"一条正在进行的步骤"，新类型意味着前端也要跟着
    改，而这次要解决的问题（黑屏）在后端补齐就够了。
    """
    entry = _ENRICH_STAGE_LABELS.get(name)
    if entry is None:
        return None
    label, hint = entry
    if phase == "start":
        return {"type": "reasoning_step", "label": label, "hint": hint, "stage": name}
    return {
        "type": "reasoning_step_result",
        "label": label,
        "stage": name,
        "ms": fields.get("ms"),
        # got=0 是"这一步跳过了/没产出"（比如没配生图 key），不是失败——
        # ok 才是失败标志。两者混同的话，未配置生图的环境会满屏红叉。
        "error": not fields.get("ok", True),
    }

async def drive_full_v5_session_stream(
    initial_state: "V5SessionState",
    max_loops: int = 10,
    user_instruction: str = "",
    repair: bool = False,
) -> AsyncGenerator[Dict[str, Any], None]:
    """Async generator mirroring drive_full_v5_session but yielding SSE dicts.

    Event shapes:
        {"type": "phase_change",  "phase": str}
        {"type": "skill_start",   "skill": str, "label": str}
        {"type": "skill_result",  "skill": str, "label": str, "error": bool,
                                  "modelSection": dict|None, "mermaid": str|None}
        {"type": "publish_closure", "data": dict}
        {"type": "complete",      "state": dict}

    E26 repair=True（缺口修复轮）：选材换成 pick_repair_capabilities——只重跑
    覆盖门标红的能力（开放缺口/合约缺失/接地不足），已 PASS 的产物与五系统
    模型原样复用（闭环重建本就先匹配既有产物，非 blocked 闭环直接返回）。
    agentic pick 不参与（修什么以门说了算），轮数收紧到 2。
    """
    import asyncio
    import queue as _queue
    import time as _time

    from sliderule_llm import capabilities as _caps

    from . import enrich_timing as _enrich_timing
    from . import v5_llm_generate as _gen

    # 全程共享的带标签 LLM 增量队列（label, chunk）：轮内能力（risk.analyze /
    # counter.argue / report.write…）与五系统起草的实时输出都汇到这里，由各
    # 执行点旁边的排水循环冲成 SSE llm_delta 事件。sink 是模块级单例——本次
    # 流注册、finally 注销；并发多会话时增量会交织（本地单人 dev 可接受）。
    _delta_q: "_queue.Queue[tuple[str, str]]" = _queue.Queue()
    _caps.set_capability_delta_sink(lambda cap_id, chunk: _delta_q.put((cap_id, chunk)))
    _gen.set_generate_delta_sink(lambda chunk: _delta_q.put(("five-system-model", chunk)))

    # 体验层（ENRICH）阶段事件（2026-08-04）。
    #
    # 真机量到这三段在 SSE 上是一个 **165.8 秒的洞**——比选材那六段加起来还长，
    # 而且落在最难受的位置：用户已经等了七八分钟、眼看要出结果，突然黑三分钟。
    # 后端本来就有 enrich-timing 埋点，数是现成的，只是从来没往前端送。
    #
    # ⚠ 其中生参照图那 ~105 秒**在物理上没法流式**——图片没有"逐字"这回事，
    # 它是画完一次性返回。这类操作能做的只有报告"在做什么 + 大概多久"：
    # 用户能判断"这是正常的"还是"卡了"，比一个转圈图标强得多。
    _stage_q: "_queue.Queue[tuple[str, str, dict]]" = _queue.Queue()
    _enrich_timing.set_stage_sink(
        lambda phase, name, fields: _stage_q.put((phase, name, dict(fields)))
    )

    async def _pump_llm_deltas(task: "asyncio.Task"):
        """任务运行期间持续排水：把队列里的（标签, 增量）按相邻同标签聚合成
        llm_delta 事件（150ms 批量，防逐 token 事件风暴）。先记完成标志再排水，
        保证任务结束瞬间到达的尾部增量也被冲出，不会滞留队列。"""
        while True:
            finished = task.done()
            batches: List[tuple] = []
            try:
                while True:
                    label, chunk = _delta_q.get_nowait()
                    if batches and batches[-1][0] == label:
                        batches[-1][1].append(chunk)
                    else:
                        batches.append((label, [chunk]))
            except _queue.Empty:
                pass
            for label, chunks in batches:
                yield {"type": "llm_delta", "text": "".join(chunks), "label": label}
            # 体验层阶段事件跟增量走同一个排水循环：它们发生在同一段时间里，
            # 分开两个泵只会让顺序不可预期。
            try:
                while True:
                    phase, name, fields = _stage_q.get_nowait()
                    ev = _enrich_stage_event(phase, name, fields)
                    if ev is not None:
                        yield ev
            except _queue.Empty:
                pass
            if finished:
                break
            await asyncio.sleep(0.15)

    state = initial_state
    if repair:
        max_loops = min(max_loops, 2)
    _advance_turn_version(state)
    state.runtimePhase = "orchestrating"
    append_replay_event(state, kind="decision", turnId="loop-0", decisionId="phase-orchestrating-full")
    append_reasoning_event(
        state, turnId="loop-0", capabilityRunId="phase-full-0",
        capabilityId="driver", kind="think",
        text=f"phase_changed: orchestrating ({'repair drive' if repair else 'full drive'})", order=0,
    )
    persist_state(state)
    yield {"type": "phase_change", "phase": "orchestrating", "repair": repair}

    loop = 0
    picks: list = []
    no_progress_streak = 0
    MAX_REPEAT_PER_CAP = 2

    try:
        prev_art_count = len(getattr(state, "artifacts", []) or [])

        def _count_resolved(st: "V5SessionState") -> int:
            gaps = getattr(st, "coverageGaps", []) or []
            return sum(
                1 for g in gaps
                if (g.get("status") if isinstance(g, dict) else getattr(g, "status", None)) == "resolved"
            )

        prev_resolved = _count_resolved(state)

        while loop < max_loops:
            ui = user_instruction or ""
            # ⚠ 规划信号必须发在**整段规划之前**，不是发在 agentic pick 之前。
            #
            # 2026-08-04 第一版发晚了：信号在 agentic pick 前面，可它前面还有
            # orchestrate_plan 和规则版 pick_next_capabilities。真机量到每轮
            # 仍有 8~10s 黑屏（六轮合计 57.6s），只是把黑屏从"整段"缩成了"前半段"。
            # 这也是"光看代码以为修好了、跑一遍才知道只填了一半"的典型——
            # 所以现在从进入这一轮就报，一直报到真开始干活。
            yield {"type": "reasoning_step", "label": "planning", "loop": loop}
            _planning_ok = True
            await asyncio.to_thread(orchestrate_plan, state, f"loop-{loop}", ui)
            picks = await asyncio.to_thread(
                (lambda st, _ui: pick_repair_capabilities(st)) if repair else pick_next_capabilities,
                state, ui,
            )
            # E32 agentic pick（默认 on）：与同步驱动同一语义（LLM 提案替换非空
            # 规则选材，收敛权归规则，台账 source="llm"，失败回落）。
            # 修复轮不参与——修什么以覆盖门说了算，不给 LLM 扩范围的机会。
            if picks and not repair:
                from .v5_agentic_pick import agentic_pick_next_capabilities
                _proposal = await asyncio.to_thread(
                    agentic_pick_next_capabilities, state, ui, loop_index=loop, max_loops=max_loops
                )
                _planning_ok = _proposal is not None
                if _proposal:
                    _now = datetime.now(timezone.utc).isoformat()
                    _dl = getattr(state, "decisionLedger", []) or []
                    _dl.append(SchedulingDecision(
                        id=f"dec-{loop}-agentic-pick",
                        turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks],
                        chose=[p["capabilityId"] for p in _proposal["picks"]],
                        skipped=[],
                        rationale=f"agentic pick: {_proposal['rationale']}",
                        createdAt=_now,
                        source="llm",
                    ))
                    state.decisionLedger = _dl
                    picks = _proposal["picks"]
                else:
                    # 同步驱动同款：回落规则版 = 本轮降级，闭环据此拒发合格证。
                    from .run_degradation import (
                        IMPACT_REASONING,
                        REASON_AGENTIC_PICK_FALLBACK,
                        mark_degraded,
                    )
                    mark_degraded(
                        state,
                        reason=REASON_AGENTIC_PICK_FALLBACK,
                        message=f"第 {loop} 轮 LLM 选材未成，回落规则版选能力",
                        # 只决定「这轮挑哪几件活儿干」，挑出来的活儿照样认真执行，
                        # 做出来的东西不因此变差——显式写出来，不靠默认值猜
                        impact=IMPACT_REASONING,
                    )
            state = await asyncio.to_thread(reconcile_coverage, state)
            selected = picks
            # 规划段收尾。**必须在这里发**，不能等到执行批次里去发——
            # 下面 max_repeat_guard / no_progress 两条都会 break 出循环，
            # 那两条路上如果没有 result，前端那条 planning 会一直转到流结束。
            yield {
                "type": "reasoning_step_result",
                "label": "planning",
                "loop": loop,
                "error": not _planning_ok,
            }

            # max_repeat_guard
            if picks:
                filtered = [
                    p for p in picks
                    if sum(
                        1 for r in (getattr(state, "capabilityRuns", []) or [])
                        if (r.get("capabilityId") if isinstance(r, dict) else getattr(r, "capabilityId", "")) == p["capabilityId"]
                    ) < MAX_REPEAT_PER_CAP
                ]
                if filtered:
                    selected = filtered
                else:
                    # all repeats exhausted
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-max_repeat_guard", turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in picks], chose=[], skipped=[
                            {"capabilityId": p["capabilityId"], "reason": "max_repeat_guard"} for p in picks
                        ],
                        rationale=f"max_repeat_guard at loop {loop}",
                        createdAt=now, source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "max_repeat_guard"
                    state.awaitDetail = f"max_repeat_guard: all candidates excluded after {MAX_REPEAT_PER_CAP} repeats"
                    break

            if not selected:
                no_progress_streak += 1
                if no_progress_streak >= 2:
                    now = datetime.now(timezone.utc).isoformat()
                    dec = SchedulingDecision(
                        id=f"dec-{loop}-no_progress", turnId=f"loop-{loop}",
                        saw=[p["capabilityId"] for p in (picks or [])],
                        chose=[], skipped=[],
                        rationale=f"no_progress: {no_progress_streak} loops",
                        createdAt=now, source="local_heuristic",
                    )
                    dl = getattr(state, "decisionLedger", []) or []
                    dl.append(dec)
                    state.decisionLedger = dl
                    state.awaitReason = "no_progress"
                    state.awaitDetail = f"no_progress after {no_progress_streak} loops"
                    break
                picks = selected
                break

            # Execute selected
            # SLIDERULE_PARALLEL_CAPS (default ON): pre-emit ALL capability_start
            # events (persisted) + reasoning_step SSE events, run the independent
            # provider calls concurrently, then commit sequentially in selection
            # order and emit reasoning_step_result per cap as commits land — so
            # step-event pairing stays coherent for stream watchers. Explicit
            # false (or single-cap batch) takes the serial reference path below.
            batch_parallel = _parallel_caps_enabled() and len(selected) > 1
            if batch_parallel:
                t_loop = _time.time()
                turn_id = f"loop-{loop}"
                await asyncio.to_thread(_emit_batch_capability_starts, state, selected, loop)
                for sel in selected:
                    yield {"type": "reasoning_step", "label": sel["capabilityId"], "loop": loop}
                for group in _split_parallel_segments(selected):
                    batch_task = asyncio.ensure_future(asyncio.gather(*[
                        asyncio.to_thread(
                            _timed_execute, sel["capabilityId"], state, sel.get("roleId", "agent"), turn_id
                        )
                        for sel in group
                    ]))
                    # 并行批执行期间排水：各能力的 LLM 想法带标签实时流出
                    #（并发时不同能力的增量按标签分事件，前端各自归位）。
                    async for _delta_event in _pump_llm_deltas(batch_task):
                        yield _delta_event
                    outcomes = batch_task.result()
                    for sel, outcome in zip(group, outcomes):
                        await asyncio.to_thread(
                            _commit_executed_outcome, state, sel=sel, loop=loop, outcome=outcome, parallel=True
                        )
                        yield {
                            "type": "reasoning_step_result",
                            "label": sel["capabilityId"],
                            "error": not outcome["ok"],
                            "summary": (outcome["result_data"] or {}).get("summary") if outcome["ok"] else None,
                        }
                _append_loop_timing_event(state, loop, len(selected), int((_time.time() - t_loop) * 1000))
                persist_state(state)
            for sel in ([] if batch_parallel else selected):
                cap = sel["capabilityId"]
                role = sel.get("roleId", "agent")
                turn_id = f"loop-{loop}"
                run_id = f"run-{loop}-{cap}"

                append_reasoning_event(
                    state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                    kind="capability_start", text=f"capability_started: {cap}", roleId=role, order=1,
                )
                append_replay_event(state, kind="capability_run", turnId=turn_id, capabilityId=cap, capabilityRunId=run_id)
                persist_state(state)

                # These are REASONING-engine capabilities (evidence.search, risk.analyze,
                # synthesis.merge ...), NOT the 5 skill-system capabilities. Emit them as
                # reasoning_step so the UI can show "thinking" progress without mislabeling
                # them as skills. The real 5-system skill sequence is emitted after the
                # closure computes (see per-skill emission below).
                yield {"type": "reasoning_step", "label": cap, "loop": loop}

                t0 = _time.time()
                result_data: Dict[str, Any] = {}
                cap_error = False
                try:
                    exec_task = asyncio.ensure_future(
                        asyncio.to_thread(_execute_round_capability, cap, state, role, turn_id)
                    )
                    # 串行执行期间排水：这一步的 LLM 想法带标签实时流出。
                    async for _delta_event in _pump_llm_deltas(exec_task):
                        yield _delta_event
                    result = exec_task.result()
                    result_data = _result_to_dict(result)
                    art_id = f"art-{loop}-{cap}"
                    produced = ProducedBy(capabilityRunId=run_id, capabilityId=cap, roleId=role)
                    kind_art = (
                        "evidence" if ("evidence" in cap or cap in ["mcp.call", "skill.invoke"])
                        else ("report" if "report" in cap else "risk")
                    )
                    commit_artifact(
                        state, id=art_id, kind=kind_art,
                        content=result_data.get("content", ""),
                        summary=result_data.get("summary", ""),
                        title=result_data.get("title"),
                        provenance=result_data.get("provenance", "python-rag"),
                        producedBy=produced, inputArtifactIds=[],
                        turnId=turn_id, sources=result_data.get("sources", []),
                    )
                    dur = int((_time.time() - t0) * 1000)
                    if getattr(state, "capabilityRuns", None):
                        last = state.capabilityRuns[-1]
                        if hasattr(last, "result"):
                            last.result = result_data
                        elif isinstance(last, dict):
                            last["result"] = result_data
                        if hasattr(last, "timing"):
                            last.timing = {"durationMs": dur}
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                        kind="capability_complete", text=f"capability_completed: {cap}", roleId=role, order=2,
                    )
                    persist_state(state)

                except Exception as cap_exc:
                    cap_error = True
                    dur = int((_time.time() - t0) * 1000)
                    err = {"code": "capability_execution_failed", "message": str(cap_exc)[:200], "capabilityId": cap}
                    from .slide_rule_session import record_capability_run_error
                    record_capability_run_error(
                        state, capabilityId=cap, turnId=turn_id, error=err, roleId=role,
                        timing={"durationMs": dur},
                    )
                    append_reasoning_event(
                        state, turnId=turn_id, capabilityRunId=run_id, capabilityId=cap,
                        kind="capability_complete", text=f"capability_completed: {cap} (error)", roleId=role, order=2,
                    )
                    persist_state(state)
                    state.awaitDetail = (getattr(state, "awaitDetail", None) or "") + f"; degraded cap {cap}"

                yield {
                    "type": "reasoning_step_result",
                    "label": cap,
                    "error": cap_error,
                    "summary": result_data.get("summary") if not cap_error else None,
                }

            # 本轮真收过口 → 立刻把闭环结果写回 state（2026-08-05）。
            #
            # 不写回的话，下一轮的状态摘要读 state.publishClosure 读到 None，
            # `_closure_line` 报「尚未收口」——**刚刚成功收完口的那一轮也一样**。
            # 模型据此再收一次，一次收口是整套重来：重新生成五系统模型、生参照图、
            # 取色、设计版式、落库。真机实测这一趟 472 秒。
            #
            # 之前 state.publishClosure 只在**循环全部结束之后**才赋值（本文件
            # 末尾），也就是说那条防重复收口的提示词在流式驱动里从来没生效过。
            # 单元测试是绿的，因为它自己手搓了一个带 publishClosure 的 state
            # （test_agentic_pick_closure_pressure.py 的 `_state`）——这正是
            # "测试钉住了措辞、没钉住数据从哪来"的典型缺口。
            #
            # 只在收口能力真的跑过的轮次写回。E37 之后 derive_* 永不返回 None
            # （拿不到证据就回落成 blocked 闭环），无条件赋值会让没收过口的轮次
            # 也报「blocked 0/6，可以再收一次」，把"还没做"说成"做了没成"。
            if any(_is_closure_cap(p.get("capabilityId", "")) for p in selected):
                _round_closure = derive_publish_closure_response(state)
                if _round_closure is not None:
                    state.publishClosure = _round_closure
                    persist_state(state)

            # progress tracking
            now_art = len(getattr(state, "artifacts", []) or [])
            now_res = _count_resolved(state)
            if now_art > prev_art_count or now_res > prev_resolved:
                no_progress_streak = 0
            else:
                no_progress_streak += 1
            prev_art_count = now_art
            prev_resolved = now_res

            if no_progress_streak >= 2:
                now = datetime.now(timezone.utc).isoformat()
                dec = SchedulingDecision(
                    id=f"dec-{loop}-no_progress", turnId=f"loop-{loop}",
                    saw=[p["capabilityId"] for p in (picks or [])],
                    chose=[p["capabilityId"] for p in selected],
                    skipped=[],
                    rationale=f"no_progress streak {no_progress_streak}",
                    createdAt=now, source="local_heuristic",
                )
                dl = getattr(state, "decisionLedger", []) or []
                dl.append(dec)
                state.decisionLedger = dl
                state.awaitReason = "no_progress"
                state.awaitDetail = f"no_progress streak {no_progress_streak}"
                break

            state = await asyncio.to_thread(resolve_coverage_gaps_from_state, state)
            gate = await asyncio.to_thread(evaluate_coverage_gate, state)
            if gate.get("passed"):
                state.goal["status"] = "clear"
                # 交付意图：门通过但交付清单未出全时继续循环（同步驱动同款逻辑）。
                if await asyncio.to_thread(_has_pending_delivery_picks, state, user_instruction):
                    loop += 1
                    persist_state(state)
                    continue
                break
            loop += 1
            persist_state(state)

        # 闭环证据重建里藏着最长的一步：新颖意图的五系统 LLM 生成（60~100s）。
        # 等待线程期间持续排水（共享带标签队列），把 LLM 的实时输出以
        # llm_delta 事件推给前端（Claude 式"看得见的想法"）。
        closure_task = asyncio.ensure_future(
            asyncio.to_thread(_ensure_runtime_closure_evidence, state, user_instruction, loop)
        )
        async for _delta_event in _pump_llm_deltas(closure_task):
            yield _delta_event
        state = closure_task.result()

        state = await asyncio.to_thread(resolve_coverage_gaps_from_state, state)
        gate = await asyncio.to_thread(evaluate_coverage_gate, state)
        if gate.get("passed") or (state.goal or {}).get("status") == "clear":
            if gate.get("passed") and isinstance(state.goal, dict):
                state.goal["status"] = "clear"  # 最终门通过时 phase/status 保持一致
            state.runtimePhase = "done"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
                capabilityId="driver", kind="think", text="phase_changed: done", order=10)
            persist_state(state)
        else:
            state.runtimePhase = "awaiting"
            if getattr(state, "awaitReason", None) not in ("no_progress", "max_repeat_guard"):
                if loop >= max_loops:
                    state.awaitReason = "max_loops"
                elif not picks:
                    state.awaitReason = "convergence"
                else:
                    state.awaitReason = "coverage"
            append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
                capabilityId="driver", kind="think",
                text=f"phase_changed: awaiting ({state.awaitReason or 'coverage'})", order=10)
            persist_state(state)

    except Exception as exc:
        state.runtimePhase = "failed"
        state.awaitReason = "ready"
        state.awaitDetail = f"drive error: {str(exc)[:120]}"
        append_reasoning_event(state, turnId=f"loop-{loop}", capabilityRunId="phase-full-end",
            capabilityId="driver", kind="think", text="phase_changed: failed", order=10)
        persist_state(state)
        yield {"type": "phase_change", "phase": "failed", "detail": state.awaitDetail}
    finally:
        # 注销模块级 sink：本次流之后的 LLM 调用不再往（已废弃的）队列里灌。
        _caps.set_capability_delta_sink(None)
        _gen.set_generate_delta_sink(None)
        _enrich_timing.set_stage_sink(None)
        # E29：精修/直供上下文兜底清理（异常路径防泄漏到下一轮）
        _gen.set_refine_context(None)
        _gen.set_model_override(None)

    persist_state(state)

    # Compute publish closure + skill graph (the REAL 5-system evidence).
    publish_closure = derive_publish_closure_response(state)
    skill_graph = derive_skill_runtime_graph_response(state)

    # Emit the real 5-system skill sequence, in cross-skill dependency order,
    # derived from perSkillEvidence. THIS is the authentic "which system is
    # being resolved" axis (the reasoning loop above is a different axis).
    # Each skill: skill_start -> (brief pause for UI animation) -> skill_result
    # carrying its evidence presence + graph edges + mermaid projection.
    if publish_closure is not None:
        per_skill = publish_closure.get("perSkillEvidence") or {}
        graph_by_skill = (skill_graph or {}).get("bySkill") or {}
        for closure_key in _SKILL_EMIT_ORDER:
            skill_id = _CLOSURE_KEY_TO_SKILL_ID.get(closure_key, "appBundle")
            ev = per_skill.get(closure_key) or {}
            present = ev.get("evidencePresent") is True
            edges = graph_by_skill.get(closure_key) or []

            yield {"type": "skill_start", "skill": skill_id, "label": closure_key}
            # Small yield-point so SSE consumers can animate the highlight in sequence.
            await asyncio.sleep(0.12)
            yield {
                "type": "skill_result",
                "skill": skill_id,
                "label": closure_key,
                "error": not present,
                "evidencePresent": present,
                "evidenceRef": ev.get("evidenceRef"),
                "artifactId": ev.get("artifactId"),
                "digest": ev.get("digest"),
                "edges": edges,
                "mermaid": _skill_edges_to_mermaid(closure_key, edges),
                # Gate-PASSED five-system model section for this skill (LLM path).
                # None on deterministic domains — the client degrades honestly.
                # Payload only: never consulted for trust/closure decisions.
                "modelSection": ev.get("modelSection"),
            }

    # Emit full closure payload after the per-skill walk.
    if publish_closure is not None:
        # 方案 B：真 LLM 收口总结——结合推演全程上下文（意图、五系统模型、
        # 风险/反方/综合等真实产出）生成对话总结，增量以 llm_delta
        # label "closure.summary" 实时流出；失败静默回落客户端模板（方案 A）。
        if _llm_round_caps_enabled():
            def _summarize() -> Optional[str]:
                from .v5_closure_summary import generate_closure_chat_summary

                return generate_closure_chat_summary(
                    state,
                    publish_closure,
                    on_delta=lambda chunk: _delta_q.put(("closure.summary", chunk)),
                )

            summary_task = asyncio.ensure_future(asyncio.to_thread(_summarize))
            async for _delta_event in _pump_llm_deltas(summary_task):
                yield _delta_event
            chat_summary = summary_task.result()
            if chat_summary:
                publish_closure["chatSummary"] = chat_summary

        state.publishClosure = publish_closure
        state.skillRuntimeGraph = skill_graph
        state.lastTurnId = f"turn-stream-{loop}-drive-full"
        # E29：模型变化才追加版本快照（前进/回退按钮的数据源）
        record_model_version(state, publish_closure, user_instruction)
        persist_state(state)
        yield {"type": "publish_closure", "data": publish_closure}

    yield {"type": "phase_change", "phase": state.runtimePhase}
    yield {"type": "complete", "state": state.model_dump()}


def _skill_edges_to_mermaid(skill: str, edges: list) -> str:
    """Render a skill's cross-system edges as a small mermaid flowchart.

    Deterministic; used by the UI's per-system screen. Empty edges -> minimal node.
    """
    lines = ["flowchart LR"]
    if not edges:
        lines.append(f'  {skill}["{skill}"]')
        return "\n".join(lines)
    seen = set()
    for e in edges:
        src = e.get("sourceSkill") if isinstance(e, dict) else None
        tgt = e.get("targetSkill") if isinstance(e, dict) else None
        key = e.get("evidenceKey") if isinstance(e, dict) else None
        state_lbl = e.get("state") if isinstance(e, dict) else None
        if not src or not tgt:
            continue
        edge_sig = f"{src}->{tgt}"
        if edge_sig in seen:
            continue
        seen.add(edge_sig)
        label = (key or state_lbl or "").replace('"', "'")
        lines.append(f'  {src}["{src}"] -->|{label}| {tgt}["{tgt}"]')
    return "\n".join(lines)
